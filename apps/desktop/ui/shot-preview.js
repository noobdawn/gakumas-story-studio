(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CreatorShotPreview=api;
})(globalThis,function(){
  'use strict';
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const geometry=t=>['animation','expression','camera','scene','transform','visualEffect','visualFilter'].includes(t.type);
  const affectsWorld=(t,c)=>!['visualFilter','visualEffect'].includes(t.type)||
    c.visualEffect?.scope==='categories'&&c.visualEffect.targets?.some(k=>k==='background'||k==='actors');
  function firstChange(a,b){
    const settings=s=>{const g=s.globalSettings;return [s.projectId,s.sceneId,s.hiddenSceneProps,s.layerSchema,s.compositionVersion,g.fps,g.aspect,g.render,g.physicsMode,g.physicsEnabled,g.outlineWidth,g.outlineEnabled,
      s.objects.filter(o=>o.type!=='画面').map(({name,icon,...o})=>o)];};
    if(!same(settings(a),settings(b)))return 0;
    const build=s=>{
      const result=new Map();
      for(const t of s.tracks.filter(t=>geometry(t)&&t.enabled!==false)){
        const clips=t.clips.filter(c=>affectsWorld(t,c));if(!clips.length)continue;
        result.set(t.id,{settings:[t.type,t.target,t.layerRole,t.weight,t.scope,t.blendMode],clips});
      }
      return result;
    };
    const old=build(a),next=build(b);let earliest=Infinity;
    if(!same([...old.keys()].filter(k=>next.has(k)),[...next.keys()].filter(k=>old.has(k))))return 0;
    for(const id of new Set([...old.keys(),...next.keys()])){
      const a=old.get(id),b=next.get(id);
      if(!a||!b||!same(a.settings,b.settings)){for(const c of [...(a?.clips||[]),...(b?.clips||[])])earliest=Math.min(earliest,c.start);continue;}
      const fields=({name,nameEdited,storyTiming,masks,compositionLayout,pictureLock,...rest})=>a.settings[0]==='visualFilter'||a.settings[0]==='visualEffect'?{...rest,compositionLayout}:rest;
      const oldClips=new Map(a.clips.map(c=>[c.id,c]));
      for(const c of b.clips){
        const prev=oldClips.get(c.id);if(!prev||!same(fields(prev),fields(c)))earliest=Math.min(earliest,c.start,prev?.start??Infinity);
        oldClips.delete(c.id);
      }
      for(const c of oldClips.values())earliest=Math.min(earliest,c.start);
    }
    return earliest;
  }
  function signature(s){
    return JSON.stringify([s.actorInstances,s.actorPosition,s.actorRotation,s.actorScale,s.actorPlacementId,s.motionLayers,s.motionId,s.motionTime,s.motionActive,s.idleMotionId,s.idleMotionTime,s.blendMotionId,s.blendMotionTime,s.blendWeight,
      s.cameraEnabled,s.cameraPosition,s.cameraRotation,s.fov,s.sceneId,s.sceneVisible,s.sceneProps,s.renderSettings,s.physicsEnabled,s.physicsMode,s.physicsFrame,s.physicsFrameRate,s.outlineWidth,
      s.postEffects?.targets?.filter(t=>t.target==='actors'||t.target==='background')]);
  }
  function create(e){
    const frames=new Map();let version=0,session='',nextFrame=-1,lastInput=0,busy=false,retryAt=0,size='',disposed=false;
    const now=()=>Date.now();
    function interrupt(){lastInput=now();}
    function invalidate(from=0){
      if(!Number.isFinite(from))return;
      for(const key of frames.keys())if(key/e.fps()>=from-1e-7)frames.delete(key);
      version++;session='';nextFrame=-1;retryAt=0;e.draw?.(frames);interrupt();
    }
    function lookup(time,s){
      if(s.editorSelectedId||!s.composition?.nodes.some(n=>n.kind==='world'))return null;
      const row=frames.get(Math.round(time*e.fps()));
      return row&&row.signature===signature(s)?row.key:null;
    }
    async function step(){
      if(disposed||busy||e.blocked()||now()-lastInput<700||now()<retryAt)return;
      const area=e.area();if(!area)return;
      const [width,height]=e.size(),dims=width+'x'+height;
      if(size!==dims){size=dims;invalidate();return;}
      const fps=e.fps(),count=Math.max(1,Math.min(8*fps,Math.floor(600*1024**2/(8*width*height))));
      const start=Math.max(0,Math.ceil(area.start*fps-1e-6)),end=Math.ceil((area.start+area.len)*fps-1e-6);
      const current=Math.max(start,Math.min(end-1,Math.floor(e.time()*fps+1e-7)));
      const from=start+Math.floor((current-start)/count)*count,to=Math.min(from+count,end);
      let wanted=from;while(wanted<to&&frames.has(wanted))wanted++;if(wanted===to)return;
      if(!session||nextFrame>wanted){session=e.id();nextFrame=e.physics()?0:wanted;}
      if(!e.physics())nextFrame=wanted;
      const capture=nextFrame===wanted,n=Math.min(2,capture?to-nextFrame:wanted-nextFrame);
      const first=nextFrame,v=version;
      busy=true;
      try{
        const states=Array.from({length:n},(_,i)=>e.sample((first+i)/fps));
        const reply=await e.post({session,states,width,height,capture});
        const evicted=new Set(reply.evicted);if(evicted.size)for(const [i,r] of frames)if(evicted.has(r.key))frames.delete(i);
        if(disposed||v!==version)return;
        if(capture){
          if(reply.keys.length!==n)throw Error('拍摄缓存返回帧数无效');
          reply.keys.forEach((key,i)=>frames.set(first+i,{key,signature:signature(states[i])}));
          e.draw?.(frames);
        }
        nextFrame=first+n;
      }catch(error){if(v===version){session='';nextFrame=-1;retryAt=now()+30000;e.error?.(error);}}
      finally{busy=false;}
    }
    return {step,interrupt,invalidate,lookup,changed:(a,b)=>invalidate(firstChange(a,b)),dispose(){disposed=true;version++;frames.clear();}};
  }
  return {create,firstChange,signature};
});
