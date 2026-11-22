(function(root,factory){
  if(typeof module==='object')module.exports=factory(require('./code-ui'));
  else root.CreatorCodeUIPreview=factory(root.CreatorCodeUI);
})(globalThis,U=>{
  'use strict';

  // Prepare a small group of adjacent frames per layer before switching Chromium surfaces.
  function* samples(state,anchor,fps){
    if(state.compositionVersion!==1)return;
    const end=Math.ceil(state.globalSettings.duration*fps),ahead=Math.min(end,anchor+5*fps),behind=Math.max(0,anchor-fps);
    const clips=state.tracks.filter(t=>t.type==='ui'&&t.enabled!==false).flatMap(t=>t.clips)
      .filter(c=>c.uiKind==='code'&&c.start<ahead/fps&&c.start+c.len>behind/fps);
    const doneStatic=new Set();
    for(const [start,stop] of [[anchor,ahead],[behind,anchor]]){
      for(let block=start;block<stop;block+=6){
        for(const c of clips){
          if(doneStatic.has(c))continue;
          const first=Math.max(block,Math.floor(c.start*fps));
          const last=Math.min(stop,block+6,Math.floor((c.start+c.len)*fps)+1);
          for(let frame=first;frame<last;frame++){
            const time=frame/fps;
            if(time<c.start||time>=c.start+c.len)continue;
            yield U.sample(c,time);
            if(U.isStatic(c.codeUI,c.codeUISampling)){doneStatic.add(c);break;}
          }
        }
      }
    }
  }

  function create(e,{maxBytes=32*1024*1024,maxFrames=2048}={}){
    const frames=new Map(),pending=new Map(),sources=new WeakMap();
    const now=e.now||Date.now;
    let bytes=0,generation=0,revision=0,plan=null,busy=false,warming=false,lastInput=now(),status='';
    function report(value){if(status!==value){status=value;e.status?.(value);}}
    function identity(code){
      let row=sources.get(code);
      if(!row||row.code.html!==code.html||row.code.css!==code.css||row.code.js!==code.js){
        U.validate(code);
        const copy={html:code.html,css:code.css,js:code.js};
        const data=new TextEncoder().encode(JSON.stringify([copy.html,copy.css,copy.js]));
        const hash=crypto.subtle.digest('SHA-256',data).then(buffer=>Array.from(new Uint8Array(buffer),v=>v.toString(16).padStart(2,'0')).join(''));
        row={code:copy,hash};sources.set(code,row);
      }
      return row;
    }
    const key=(hash,a)=>[hash,a.width,a.height,a.duration,a.time].join('/');
    function lookup(k,pin){
      const existing=frames.get(k);if(!existing)return;
      if(pin)existing.pin=pin;
      frames.delete(k);frames.set(k,existing);return existing.png;
    }
    function store(k,png,pin){
      if(typeof png!=='string'||!png.length)throw Error('代码 UI 未返回有效图像');
      if(lookup(k,pin))return true;
      if(png.length>maxBytes)return false;
      while(frames.size>=maxFrames||bytes+png.length>maxBytes){
        const oldest=frames.keys().next().value,entry=frames.get(oldest);
        if(pin&&entry.pin===pin)return false;
        frames.delete(oldest);bytes-=entry.png.length;
      }
      frames.set(k,{png,pin});bytes+=png.length;return true;
    }
    async function render(args){
      const gen=generation,source=identity(args.code),k=key(await source.hash,args);
      if(gen!==generation)throw Error('代码 UI 工程已切换');
      const hit=lookup(k);if(hit)return hit;
      if(pending.has(k))return pending.get(k);
      const operation=e.render({...args,code:source.code}).then(png=>{
        if(gen===generation)store(k,png,null);
        return png;
      });
      pending.set(k,operation);
      try{return await operation;}finally{if(pending.get(k)===operation)pending.delete(k);}
    }
    function interrupt(){
      lastInput=now();plan=null;report('');
      if(warming){warming=false;e.cancelWarm();}
    }
    function changed(){revision++;interrupt();}
    function reset(){generation++;changed();pending.clear();frames.clear();bytes=0;e.reset?.();}
    async function step(){
      if(busy||now()-lastInput<650||e.blocked())return;
      const state=e.state(),fps=state.globalSettings.fps;
      const anchor=Math.max(0,Math.min(Math.ceil(state.globalSettings.duration*fps)-1,Math.floor(state.current*fps+1e-7)));
      const {width,height}=U.dimensions(state.globalSettings.aspect);
      const area=[anchor,fps,width,height].join('/');
      if(!plan||plan.area!==area)plan={area,iterator:samples(state,anchor,fps),pin:Symbol(),failed:new Set(),count:0,done:false};
      const p=plan;if(p.done)return;
      busy=true;
      try{
        // Yield even on an entirely cached window so editor input can run between steps.
        for(let i=0;i<48;i++){
          p.job??=p.iterator.next();
          if(p.job.done){
            p.done=true;report(!p.count?'':p.failed.size?'partial':'ready');return;
          }
          const n=p.job.value,source=identity(n.codeUI),hash=await source.hash;
          if(plan!==p||e.blocked())return;
          const args={code:source.code,width,height,time:n.localTime,duration:n.duration};
          const k=key(hash,args);
          if(lookup(k,p.pin)||p.failed.has(hash)){p.count++;p.job=null;continue;}
          report('preparing');warming=true;
          let png;
          try{png=await e.warm(args);}
          catch(error){if(plan===p){p.failed.add(hash);e.error?.(error);}return;}
          finally{warming=false;}
          if(plan!==p||!png)return;
          if(!store(k,png,p.pin)){p.done=true;report('partial');return;}
          p.count++;p.job=null;return;
        }
      }finally{busy=false;}
    }
    return {render,step,interrupt,changed,reset,get revision(){return revision;}};
  }
  return {create,samples};
});
