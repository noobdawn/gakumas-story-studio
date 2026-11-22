globalThis.CreatorClipPropertiesEditor=function(e){
  'use strict';
  const P=CreatorClipProperties,$=s=>document.querySelector(s),num=n=>Number(n.toFixed(4));
  let owner=null,page='',sub='基础',maskId='',gesture=null;
  function change(track,fn){
    if(track.locked)return e.notify('轨道已锁定');
    const before=e.copy();
    try{if(fn()===false)return;e.remember(before);e.render();}
    catch(error){e.restore(before);e.notify(error.message);}
  }
  const tab=(name,active,attr)=>`<button type="button" ${attr}="${name}" aria-pressed="${name===active}">${name}</button>`;
  function audioFields({clip:c}){
    const v=c.volume??1;
    return `<div class="field"><label for="clip-volume-db">音量（dB）</label><div class="clip-gain"><input id="clip-volume" type="range" min="0" max="1" step=".001" value="${v}" aria-label="音量"><input id="clip-volume-db" class="input" type="number" max="0" step=".1" value="${v?num(20*Math.log10(v)):''}" placeholder="−∞"></div></div>
      <label class="dialogue-link"><input id="clip-muted" type="checkbox" ${c.muted?'checked':''}> 静音</label>
      <div class="vector clip-timing">${[['fadeIn','淡入','in'],['fadeOut','淡出','out']].map(([k,n,side])=>`<label>${n}（秒）<input id="clip-fade-${side}" type="number" min="0" max="${c.len}" step="any" value="${c[k]||0}"></label>`).join('')}</div>`;
  }
  function speedFields(c,video){
    return `<div class="inspector-section"><div class="section-title">常规变速</div><label>播放倍率</label><div class="clip-gain"><input data-rate-slider type="range" min=".25" max="4" step=".05" value="${c.mediaRate||1}" aria-label="播放倍率"><input class="input" ${video?'data-media-rate':'id="clip-audio-rate"'} data-rate-value type="number" min=".25" max="4" step="any" value="${c.mediaRate||1}" aria-label="精确播放倍率"></div>
      <p data-rate-length>时间轴时长 ${num(c.len)} 秒</p>${c.mediaLink?'<p class="hint">画面与原声联动</p>':''}</div>`;
  }
  function maskFields(c){
    const masks=c.masks||[],m=masks.find(v=>v.id===maskId)||masks[0];maskId=m?.id||'';
    const field=(k,n,unit=100)=>`<label class="media-property">${n}<input class="input" type="number" step="any" data-mask-field="${k}" data-unit="${unit}" value="${num(m[k]*unit)}"></label>`;
    const size=m&&['circle','rectangle'].includes(m.shape);
    return `<div class="inspector-section"><div class="clip-mask-actions">${m?`<select data-mask-select aria-label="当前蒙版">${masks.map((v,i)=>`<option value="${e.esc(v.id)}" ${v===m?'selected':''}>${i+1} · ${P.shapes[v.shape]}</option>`).join('')}</select>`:''}<button data-mask-add ${masks.length>=8?'disabled':''}>添加蒙版</button></div>${!m?'':`
      <div class="field"><label>形状<select data-mask-shape>${Object.entries(P.shapes).map(([k,n])=>`<option value="${k}" ${m.shape===k?'selected':''}>${n}</option>`).join('')}</select></label></div>
      <label class="dialogue-link"><input type="checkbox" data-mask-enabled ${m.enabled?'checked':''}> 启用</label>
      ${field('x','中心 X（%）')}${field('y','中心 Y（%）')}${field('rotation','旋转（°）',1)}${field('feather','羽化（%）')}
      ${size?field('width','宽（%）')+field('height','高（%）')+`<label class="dialogue-link"><input type="checkbox" data-mask-lock ${m.lockAspect?'checked':''}> 锁定宽高比</label>`:m.shape==='mirror'?field('height','两条边界间距（%）'):''}
      ${m.shape==='rectangle'?field('radius','圆角（%）'):''}<button data-mask-remove>移除蒙版</button>`}</div>`;
  }
  function fields(t,c,{source,info,specific,picture,sound,soundOptions,speed,special,compose}){
    const tabs=[];
    if(special && !['camera','audio'].includes(t.type))tabs.push(special);
    if(picture)tabs.push('画面');
    if(sound)tabs.push('音频');
    if(speed)tabs.push('变速');
    if(t.type==='camera')tabs.push('镜头');
    if(t.type==='audio'&&c.dialogue)tabs.push('配音');
    if(owner!==c.id){finishGesture();owner=c.id;page='';sub='基础';maskId='';}
    if(!tabs.includes(page))page=tabs[0];
    const pane=(name,body)=>`<div data-clip-pane="${name}" ${page===name?'':'hidden'}>${body}</div>`;
    const maskAllowed=picture&&compose;
    const nav=tabs.length>1?`<nav class="clip-tabs" aria-label="片段属性">${tabs.map(n=>tab(n,page,'data-clip-tab')).join('')}</nav>`:'';
    return source+nav+(picture?pane('画面',(maskAllowed?`<div class="clip-tabs minor">${['基础','蒙版'].map(n=>tab(n,sub,'data-picture-tab')).join('')}</div>`:'')+
      `<div ${maskAllowed&&sub==='蒙版'?'hidden':''}>${picture}</div>`+(maskAllowed?`<div ${sub==='基础'?'hidden':''}>${maskFields(c)}</div>`:'')):'')+
      (sound?pane('音频',audioFields(sound)+soundOptions+e.effects.fields(sound.track,sound.clip)):'')+
      (speed?pane('变速',speedFields(c,t.type==='media')):'')+
      (special?pane(special,specific):specific)+`<details class="inspector-section clip-info"><summary>片段信息</summary>${info}</details>`;
  }
  function bind(t,c,sound){
    const box=$('#inspector');
    box.querySelectorAll('[data-clip-tab],[data-picture-tab]').forEach(b=>b.onclick=()=>{
      finishGesture();if(b.dataset.clipTab)page=b.dataset.clipTab;else sub=b.dataset.pictureTab;e.inspector();e.sync();
    });
    const speed=box.querySelector('[data-rate-value]'),slider=box.querySelector('[data-rate-slider]');
    if(speed){
      const draft=value=>{const output=box.querySelector('[data-rate-length]');try{output.textContent=`时间轴时长 ${num(c.len)} → ${num(P.newLength(c,value,e.fps()))} 秒`;}catch{output.textContent='倍率范围为 0.25–4';}};
      slider.oninput=()=>{speed.value=slider.value;draft(slider.valueAsNumber);};
      speed.oninput=()=>{if(Number.isFinite(speed.valueAsNumber))slider.value=speed.value;draft(speed.valueAsNumber);};
      slider.onchange=speed.onchange=()=>change(t,()=>P.retime(e.state(),t,c,speed.valueAsNumber));
      speed.disabled=slider.disabled=t.locked||!!sound?.track.locked;
    }
    if(sound){
      const a=sound.clip,v=box.querySelector('#clip-volume'),db=box.querySelector('#clip-volume-db');let before;
      v.oninput=()=>{if(sound.track.locked)return;before||=e.copy();a.volume=v.valueAsNumber;db.value=a.volume?num(20*Math.log10(a.volume)):'';e.audio();};
      v.onchange=v.onblur=()=>{if(before){e.remember(before);before=null;}};
      db.onchange=()=>change(sound.track,()=>{if(db.value&&!Number.isFinite(db.valueAsNumber)||db.valueAsNumber>0)throw Error('音量最高为 0 dB');a.volume=db.value?10**(db.valueAsNumber/20):0;});
      box.querySelector('#clip-muted').onchange=ev=>change(sound.track,()=>{a.muted=ev.target.checked;});
      for(const [key,side] of [['fadeIn','in'],['fadeOut','out']])box.querySelector('#clip-fade-'+side).onchange=ev=>change(sound.track,()=>{
        const v=ev.target.valueAsNumber;if(!Number.isFinite(v)||v<0||v>a.len)throw Error('淡入淡出时长须在片段内');a[key]=v;
      });
      e.effects.bind(sound.track,a);
      if(sound.track.locked)box.querySelector('[data-clip-pane="音频"]').querySelectorAll('input,button,select').forEach(el=>el.disabled=true);
    }
    const m=c.masks?.find(v=>v.id===maskId);
    const bind=(selector,event,fn)=>{const el=box.querySelector(selector);if(el)el[event]=fn;};
    bind('[data-mask-add]','onclick',()=>change(t,()=>{const m=P.mask(e.id());(c.masks||=[]).push(m);maskId=m.id;P.validateMasks(c.masks);}));
    bind('[data-mask-select]','onchange',ev=>{maskId=ev.target.value;e.inspector();e.sync();});
    if(!m)return;
    bind('[data-mask-remove]','onclick',()=>change(t,()=>{c.masks=c.masks.filter(v=>v!==m);if(!c.masks.length)delete c.masks;}));
    bind('[data-mask-shape]','onchange',ev=>change(t,()=>{m.shape=ev.target.value;if(m.shape==='circle'&&m.lockAspect)m.width=Math.min(4,m.height/e.layerAspect(t,c));}));
    for(const [sel,k] of [['enabled','enabled'],['lock','lockAspect']])bind('[data-mask-'+sel+']','onchange',ev=>change(t,()=>{m[k]=ev.target.checked;}));
    box.querySelectorAll('[data-mask-field]').forEach(el=>el.onchange=()=>change(t,()=>{
      const k=el.dataset.maskField,value=el.valueAsNumber/Number(el.dataset.unit);
      if(m.lockAspect&&['circle','rectangle'].includes(m.shape)&&['width','height'].includes(k))m[k==='width'?'height':'width']*=value/m[k];
      m[k]=value;P.validateMasks(c.masks);
    }));
  }
  function selection(shot){
    const f=e.found(),c=f?.clip;
    if(!c||owner!==c.id||page!=='画面'||f.track.locked||f.track.enabled===false||e.state().current<c.start||e.state().current>=c.start+c.len)return null;
    if(f.track.type==='camera'&&c!==shot)return null;
    const layerId=f.track.type==='camera'?e.state().tracks.find(t=>t.type==='world'&&t.enabled!==false)?.id:c.id;
    if(!layerId)return null;
    if(sub==='蒙版')return c.masks?.some(m=>m.enabled&&m.id===maskId)?{maskEdit:{layerId,maskId}}:null;
    if(['camera','ui','dialogue'].includes(f.track.type))return {layoutNodeId:layerId,mediaSelectedId:c.id,mediaEditable:true};
    return null;
  }
  function editingMask(){return page==='画面'&&sub==='蒙版'&&owner===e.found()?.clip.id;}
  function finishGesture(){
    if(!gesture)return;
    const g=gesture;gesture=null;
    if(g.changed)e.remember(g.before);
    if(g.resume)e.setPlaying(true);
  }
  function consumeLayout(ev){
    const f=e.found();
    if(!ev||!f||f.clip.id!==ev.id||!['camera','ui','dialogue'].includes(f.track.type))return false;
    if(page!=='画面'||sub!=='基础'||f.track.locked)return true;
    if(ev.phase==='begin'){
      const resume=e.playing();if(resume)e.setPlaying(false);
      gesture={before:e.copy(),clip:f.clip,layout:e.baseLayout(f.track,f.clip),resume};return true;
    }
    if(gesture?.clip!==f.clip)return true;
    const l=gesture.layout;
    if(ev.dx||ev.dy)gesture.moved=true;
    if(ev.scale!==1)gesture.scaled=true;
    if(gesture.moved||gesture.scaled){
      const p=f.clip.compositionLayout||={};gesture.changed=true;
      if(gesture.moved){p.x=Math.max(-10,Math.min(10,l.x+ev.dx));p.y=Math.max(-10,Math.min(10,l.y+ev.dy));}
      if(gesture.scaled)p.scale=Math.max(.001,Math.min(20,l.scale*ev.scale));
    }
    if(ev.phase==='end')finishGesture();
    e.inspector();e.sync();return true;
  }
  function consume(ev){
    if(!ev?.maskId)return;
    const f=e.found(),m=f?.clip.masks?.find(v=>v.id===ev.maskId);
    if(!m||f.track.locked||owner!==f.clip.id||maskId!==m.id||page!=='画面'||sub!=='蒙版'){if(gesture?.mask)finishGesture();return;}
    if(ev.phase==='begin'){const resume=e.playing();if(resume)e.setPlaying(false);gesture={before:e.copy(),mask:m,resume};return;}
    if(gesture?.mask!==m)return;
    for(const k of ['x','y','width','height']){if(m[k]!==ev[k])gesture.changed=true;m[k]=ev[k];}
    if(ev.phase==='end')finishGesture();
    e.inspector();e.sync();
  }
  return {fields,bind,selection,editingMask,consume,consumeLayout,dragging:()=>!!gesture};
};
