/* Screen-space media editing. Layout belongs to a layer; clips only store overrides. */
globalThis.CreatorScreenMediaEditor={create(env){
 'use strict';const M=CreatorScreenMedia,$=s=>document.querySelector(s),esc=env.esc;
 let units='percent',snap=true,gesture=null;const preparations=new Map();
 const state=()=>env.state(),layer=t=>state().objects.find(o=>o.id===t.target),asset=c=>env.asset(c.assetId);
 const editable=t=>!t?.locked;
 function commit(fn,positioned=[]){const before=env.copy();try{fn();env.remember(before,positioned);env.render();return true;}catch(e){env.restore(before);env.notify(e.message);return false;}}
 function readInfo(a){
  if(!M.isVisual(a)||!a.scope)throw Error('请先导入图片或视频文件');
  if(!preparations.has(a.id)){
   const job=window.assetAPI.visualInfo(a).then(M.validateInfo).finally(()=>preparations.delete(a.id));
   preparations.set(a.id,job);
  }
  return preparations.get(a.id);
 }
 async function prepare(a){const info=await readInfo(a);a.visual=info;return info;}
 function replaceSource(t,c){
  const previousLink=c.mediaLink;
  env.pickSource(t,c,{
   key:'media',title:'替换画面素材',hint:'保留片段布局与关键帧。从新素材开头播放，关联声音随画面更新。',
   items:()=>env.assets().filter(a=>M.isVisual(a)&&a.scope),describe:a=>a.type,prepare:readInfo,
   apply:(a,info)=>{
    const linked=env.related(c);
    if(c.mediaLink!==previousLink||linked.some(item=>env.getClip(item.id)?.track.locked))throw Error('音画关联已改变或轨道已锁定');
    const old=asset(c),oldName=c.name;
    if(old&&!c.nameEdited&&c.name===env.label(old))c.name=env.label(a);
    a.visual=info;c.assetId=a.id;c.sourceOffset=0;
    const projectAsset=state().assets.find(x=>x.id===a.id);
    if(projectAsset)projectAsset.visual=info;
    if(!info.hasAudio){
     for(const track of state().tracks)if(track.type==='audio')track.clips=track.clips.filter(item=>!linked.includes(item));
     delete c.mediaLink;
    }else if(linked.length===1){
     addLinkedAudio(t,c);
    }else{
     for(const item of linked)if(item!==c){
      item.assetId=a.id;item.sourceOffset=0;delete item.originalLoop;
      if(!item.nameEdited&&item.name===oldName+' · 声音')item.name=c.name+' · 声音';
     }
    }
   }
  });
 }
 const overlaps=(clip,start,len)=>start<clip.start+clip.len-1e-6&&start+len>clip.start+1e-6;
 function addLinkedAudio(track,clip){
  const sound=M.linkedSoundTrack(state().tracks,track,clip,env.id);
  if(!state().tracks.includes(sound))state().tracks.push(sound);
  clip.mediaLink=env.id();
  sound.clips.push({id:env.id(),name:clip.name+' · 声音',assetId:clip.assetId,start:clip.start,len:clip.len,
    sourceOffset:clip.sourceOffset,mediaRate:clip.mediaRate||1,mediaLink:clip.mediaLink,audioLoop:clip.loop===true,volume:1});
  sound.clips.sort((a,b)=>a.start-b.start);
 }
 async function add(a,track,start=state().current,options={}){
  if(env.supported&&!env.supported())throw Error('请重启使用新版 Player 后再添加画面');
  const original=state(),anchor=options.anchor||track,object=options.object;
  env.notify('正在准备画面素材…');
  const info=await readInfo(a),s=state();
  if(s!==original||[track,anchor].some(t=>t&&!s.tracks.includes(t))||object&&!s.objects.includes(object))throw Error('工程或目标轨道已改变，请重新拖入');
  if(!env.asset(a.id))throw Error('画面素材已移除，请重新添加');
  if(object)track=s.tracks.find(t=>t.target===object.id&&t.type==='media');
  if(track&&track.type!=='media')throw Error('目标必须是画面轨道');
  if(track?.locked)throw Error('画面轨道已锁定');
  start=env.quantize(start);
  const len=env.quantize(Math.min(info.kind==='video'?info.duration:5,env.duration()-start));
  if(len<env.frame())throw Error('落点之后没有足够的时间');
  if(track?.clips.some(c=>overlaps(c,start,len))){
   if(!options.newTrackOnOverlap)throw Error('此层已有重叠片段，请添加到新画面层');
   track=null;
  }
  const positioned=[],clip={id:env.id(),name:env.label(a),assetId:a.id,start,len,sourceOffset:0,loop:false,mediaRate:1};
  const added=commit(()=>{
   a.visual=info;
   const localAsset=s.assets.find(x=>x.id===a.id);if(localAsset)localAsset.visual=info;
   if(!track){
    const o=object||M.newLayer(s,M.preset(info.kind==='video'?'full':'center'),env.id);
    if(!object)s.objects.push(o);
    track=M.newTrack(o,env.id);
    if(options.newTrackOnOverlap){CreatorComposition.placeMediaTrack(s,track,anchor);positioned.push(track.id);}
    else s.tracks.push(track);
   }
   track.clips.push(clip);track.clips.sort((a,b)=>a.start-b.start);
   if(info.hasAudio)addLinkedAudio(track,clip);
   env.selectClip(clip.id);
  },positioned);
  if(added){env.close();env.timeline(track.id);return {track,clip};}
 }
 function picker(t,at,object){const entries=env.assets().filter(M.isVisual);env.modal(`<div class="modal-head"><h2>添加图片 / 视频</h2><button class="icon-button" data-close>×</button></div><div class="modal-body"><p class="hint">${t||object?'放入当前画面层，继承其默认位置。':'新建固定在画布上的画面层。'}可先在素材浏览器导入文件。</p><input class="input" id="media-pick-query" placeholder="搜索素材"><div id="media-pick-list"></div></div>`);const draw=()=>{$('#media-pick-list').innerHTML=entries.filter(a=>(env.label(a)+' '+a.source).toLowerCase().includes($('#media-pick-query').value.toLowerCase())).map(a=>`<button class="add-component" data-media-pick="${esc(a.id)}">${a.type==='视频'?'▶':'▧'} ${esc(env.label(a))}</button>`).join('')||'<p class="hint">暂无图片或视频，请先导入。</p>';$('#media-pick-list').querySelectorAll('[data-media-pick]').forEach(b=>b.onclick=()=>{b.disabled=true;add(env.asset(b.dataset.mediaPick),t,at??state().current,{object}).catch(e=>{b.disabled=false;env.notify(e.message);});});};$('#media-pick-query').oninput=draw;draw();}
 function draws(){const result=[];for(const t of state().tracks.filter(t=>t.type==='media'&&t.enabled!==false)){const o=layer(t);if(!o||o.visible===false)continue;for(const {clip:c,time} of (state().compositionVersion===1?CreatorComposition.mediaSamples(state(),t,state().current,env.asset):t.clips.filter(c=>state().current>=c.start&&state().current<c.start+c.len).map(clip=>({clip,time:state().current})))){const a=asset(c);if(!M.isVisual(a)||!a.scope||!a.visual)throw Error('画面素材不可用，请在素材属性重新准备：'+c.name);const evaluated=M.layout(o,c,state().current-c.start);result.push({id:c.id,pivot:[evaluated.anchorX+evaluated.x,evaluated.anchorY+evaluated.y],asset:a,time:a.type==='视频'?M.sourceTime(c,state().current,a.visual):0,...M.quad(M.layout(o,c,state().current-c.start),a.visual,env.aspect())});}}if(result.length>32)throw Error('最多同时显示 32 个画面层');return result;}
 function selected(){const found=env.found();if(found?.track.type==='media')return found;const o=env.object();if(o?.type==='画面'){const t=state().tracks.find(t=>t.type==='media'&&t.target===o.id),c=t?.clips.find(c=>state().current>=c.start&&state().current<c.start+c.len);if(c)return {track:t,clip:c};}return null;}
 function selection(){const f=selected();return {mediaSelectedId:f?.clip.id||'',mediaEditable:!!f&&editable(f.track)&&!env.playing()&&state().current>=f.clip.start&&state().current<f.clip.start+f.clip.len,mediaSnap:snap};}
 function updateLayout(t,c,patch){const o=layer(t),target=c?(c.mediaLayout||={}):(o.mediaLayout||={}),current=M.layout(o,c,state().current-(c?.start||0));for(const [k,v] of Object.entries(patch)){if(c&&c.mediaKeys?.[k]?.length){const time=env.quantize(Math.max(0,Math.min(c.len,state().current-c.start))),keys=c.mediaKeys[k].filter(v=>Math.abs(v.time-time)>env.frame()/2);keys.push({time,value:v});keys.sort((a,b)=>a.time-b.time);c.mediaKeys[k]=keys;}else target[k]=v;}M.validateLayout({...current,...patch});if(!c)for(const track of state().tracks.filter(t=>t.type==='media'&&t.target===o.id))for(const item of track.clips)M.layout(o,item,0);}
 const labels={x:'水平偏移',y:'垂直偏移',width:'宽度',height:'高度',scale:'整体缩放',scaleX:'横向缩放',scaleY:'纵向缩放',rotation:'旋转（°）',opacity:'不透明度',pivotX:'图像轴心 X',pivotY:'图像轴心 Y',cropLeft:'左侧裁剪',cropRight:'右侧裁剪',cropTop:'上侧裁剪',cropBottom:'下侧裁剪'};
 const groups=[['位置与锚点',['x','y','pivotX','pivotY']],['大小与缩放',['width','height','scale','scaleX','scaleY']],['外观',['rotation','opacity']],['裁剪',['cropLeft','cropRight','cropTop','cropBottom']]];
 function keyList(c){if(!c)return '';const keys=Object.entries(c.mediaKeys||{}).flatMap(([property,values])=>values.map(v=>({...v,property}))).sort((a,b)=>a.time-b.time);if(!keys.length)return '';return '<div class="inspector-section"><div class="section-title">画面关键帧</div>'+keys.slice(0,200).map(k=>`<div class="media-key-row"><button class="keyframe-jump" data-media-jump="${k.time}">${k.time.toFixed(3)} 秒 · ${labels[k.property]}</button><button data-media-delete-key="${k.property},${k.time}" title="删除关键帧">×</button></div>`).join('')+(keys.length>200?'<p class="hint">这里只列出前 200 项；时间轴保留完整标记。</p>':'')+'</div>';}
 function fields(t,c){const o=layer(t),l=M.layout(o,c,Math.max(0,state().current-(c?.start||0))),a=c&&asset(c),dims=env.dimensions(),factor=k=>['x','width'].includes(k)&&units==='pixels'?dims[0]:['y','height'].includes(k)&&units==='pixels'?dims[1]:k==='rotation'?1:100;
 const input=k=>`<div class="media-property"><label>${labels[k]}${k!=='rotation'?' ('+(['x','y','width','height'].includes(k)&&units==='pixels'?'px':'%')+')':''}</label><input type="number" class="input" data-media-field="${k}" step="${k==='rotation'?.1:.1}" value="${Number((l[k]*factor(k)).toFixed(3))}">${c&&M.animated.includes(k)?`<button class="camera-key" data-media-key="${k}" title="添加或删除当前帧关键帧">${c.mediaKeys?.[k]?.some(v=>Math.abs(v.time-(state().current-c.start))<env.frame()/2)?'◆':'◇'}</button>`:''}</div>`;
 return `<div class="inspector-section"><div class="section-title">画面 · ${c?'片段布局':'图层默认布局'}</div><p class="hint">画面合成中越靠上的轨道越靠前，可与字幕和演出画面交换层次。</p>${c?`<button class="add-component" data-media-layer>编辑图层默认布局</button><button class="add-component" data-media-inherit>清除片段覆盖，继承图层布局</button>`:''}<div class="field"><label>布局预设</label><select data-media-preset><option value="">选择预设…</option><option value="left">左侧立绘</option><option value="center">居中立绘</option><option value="right">右侧立绘</option><option value="full">铺满画面</option><option value="corner">右上角画中画</option></select></div><div class="field"><label>位置与尺寸的显示单位</label><select data-media-units><option value="percent" ${units==='percent'?'selected':''}>画布百分比</option><option value="pixels" ${units==='pixels'?'selected':''}>像素（${dims[0]} × ${dims[1]}）</option></select></div><label class="dialogue-link"><input type="checkbox" data-media-snap ${snap?'checked':''}> 预览拖动时吸附边缘和中心</label><div class="media-anchors">${[1,.5,0].flatMap(y=>[0,.5,1].map(x=>`<button data-media-anchor="${x},${y}" class="${l.anchorX===x&&l.anchorY===y?'active':''}" title="画布锚点">${x===.5&&y===.5?'●':'○'}</button>`)).join('')}</div>${groups.map(([title,keys],index)=>`<details open class="media-group"><summary>${title}<button data-media-reset="${index}" title="重置本组">重置</button></summary>${keys.map(input).join('')}</details>`).join('')}<div class="field"><label>画面适配</label><select data-media-fit>${[['contain','完整显示'],['cover','填满并裁剪'],['stretch','拉伸']].map(([v,n])=>`<option value="${v}" ${l.fit===v?'selected':''}>${n}</option>`).join('')}</select></div>${[['lockAspect','锁定宽高比例'],['flipX','水平翻转'],['flipY','垂直翻转']].map(([k,n])=>`<label class="dialogue-link"><input type="checkbox" data-media-flag="${k}" ${l[k]?'checked':''}> ${n}</label>`).join('')}<p class="hint">正 X 向右，正 Y 向上，允许移出画布。轴心默认底部中央。◇ 为片段记录关键帧；已有关键帧时修改数值记录当前帧。</p></div>${c?`<div class="inspector-section">${a?.type==='视频'?`<div class="field"><label>源起点（秒）</label><input class="input" data-media-offset type="number" min="0" max="${a.visual?.duration||3600}" step="0.001" value="${c.sourceOffset||0}"></div><div class="field"><label>播放速度</label><input class="input" data-media-rate type="number" min=".25" max="4" step=".05" value="${c.mediaRate||1}"></div><label class="dialogue-link"><input type="checkbox" data-media-loop ${c.loop?'checked':''}> 循环视频和关联声音</label><p class="hint">源长 ${a.visual?.duration?.toFixed(3)||'?'} 秒；不循环时到末尾保持最后一帧。拖长片段不会自动改变速度。</p>`:''}${c.mediaLink?'<button class="add-component" data-media-unlink>解除与声音的联动</button><button class="add-component" data-media-mute>切换关联声音静音</button>':''}</div>`:''}`+keyList(c);
 }
 function bind(t,c){const box=$('#inspector'),o=layer(t),l=()=>M.layout(o,c,Math.max(0,state().current-(c?.start||0))),dims=env.dimensions();const edit=fn=>{if(!editable(t)||c?.mediaLink&&env.related(c).some(item=>env.getClip(item.id).track.locked))return env.notify('画面或关联声音轨道已锁定');commit(fn);};
 box.querySelector('[data-media-units]').onchange=e=>{units=e.target.value;env.inspector();};box.querySelector('[data-media-snap]').onchange=e=>{snap=e.target.checked;env.sync();};
 box.querySelector('[data-media-preset]').onchange=e=>{if(e.target.value)edit(()=>updateLayout(t,c,M.preset(e.target.value)));};
 box.querySelectorAll('[data-media-anchor]').forEach(b=>b.onclick=()=>edit(()=>{const [anchorX,anchorY]=b.dataset.mediaAnchor.split(',').map(Number);updateLayout(t,c,{anchorX,anchorY});}));
 box.querySelectorAll('[data-media-field]').forEach(input=>input.onchange=()=>edit(()=>{const k=input.dataset.mediaField,factor=['x','width'].includes(k)&&units==='pixels'?dims[0]:['y','height'].includes(k)&&units==='pixels'?dims[1]:k==='rotation'?1:100,value=Number(input.value)/factor,old=l(),patch={[k]:value};if(old.lockAspect&&['width','height'].includes(k)){const other=k==='width'?'height':'width';patch[other]=old[other]*value/old[k];}updateLayout(t,c,patch);}));
 box.querySelectorAll('[data-media-key]').forEach(b=>b.onclick=()=>edit(()=>{if(state().current<c.start||state().current>c.start+c.len)throw Error('请将播放头移到片段内');const k=b.dataset.mediaKey,time=env.quantize(state().current-c.start),value=l()[k];c.mediaKeys||={};const keys=c.mediaKeys[k]||[],found=keys.some(v=>Math.abs(v.time-time)<env.frame()/2);c.mediaKeys[k]=keys.filter(v=>Math.abs(v.time-time)>=env.frame()/2);if(!found)c.mediaKeys[k].push({time,value});c.mediaKeys[k].sort((a,b)=>a.time-b.time);}));
 box.querySelectorAll('[data-media-reset]').forEach(b=>b.onclick=e=>{e.preventDefault();edit(()=>{const keys=[...groups[Number(b.dataset.mediaReset)][1],...(b.dataset.mediaReset==='0'?['anchorX','anchorY']:[])];for(const k of keys){if(c){delete c.mediaLayout?.[k];delete c.mediaKeys?.[k];}else (o.mediaLayout||={})[k]=M.defaults[k];}});});
 box.querySelector('[data-media-fit]').onchange=e=>edit(()=>updateLayout(t,c,{fit:e.target.value}));box.querySelectorAll('[data-media-flag]').forEach(b=>b.onchange=()=>edit(()=>updateLayout(t,c,{[b.dataset.mediaFlag]:b.checked})));
 const on=(selector,fn)=>{const b=box.querySelector(selector);if(b)b.onclick=fn;};on('[data-media-layer]',()=>env.selectObject(o.id));on('[data-media-inherit]',()=>edit(()=>{delete c.mediaLayout;delete c.mediaKeys;}));
 on('[data-media-unlink]',()=>edit(()=>{for(const item of env.related(c))delete item.mediaLink;}));on('[data-media-mute]',()=>edit(()=>{for(const item of env.related(c))if(item!==c)item.volume=(item.volume??1)>0?0:1;}));
 for(const [selector,key] of [['[data-media-offset]','sourceOffset'],['[data-media-rate]','mediaRate'],['[data-media-loop]','loop']]){const input=box.querySelector(selector);if(input)input.onchange=()=>edit(()=>{const value=key==='loop'?input.checked:Number(input.value);if(key==='sourceOffset'&&(!Number.isFinite(value)||value<0||value>=asset(c).visual.duration))throw Error('源起点须在视频内');if(key==='mediaRate'&&(!Number.isFinite(value)||value<.25||value>4))throw Error('播放速度须为 0.25–4 倍');for(const item of env.related(c))item[key==='loop'&&item!==c?'audioLoop':key]=value;});}
 on('[data-media-replace]',()=>replaceSource(t,c));
 box.querySelectorAll('[data-media-jump]').forEach(b=>b.onclick=()=>{state().current=c.start+Number(b.dataset.mediaJump);env.sync();env.inspector();});box.querySelectorAll('[data-media-delete-key]').forEach(b=>b.onclick=()=>edit(()=>{const [property,time]=b.dataset.mediaDeleteKey.split(',');c.mediaKeys[property]=c.mediaKeys[property].filter(k=>k.time!==Number(time));}));
 if(!editable(t))box.querySelectorAll('input,select,button:not(.keyframe-jump,[data-inspect-related])').forEach(b=>b.disabled=true);
 }
 function objectInspector(o){const t=state().tracks.find(t=>t.type==='media'&&t.target===o.id);if(!t){
  $('#inspector').innerHTML='<div class="inspector-section"><h3>'+esc(o.name)+'</h3><button class="add-component" id="media-layer-add">添加图片 / 视频片段…</button></div>';
  $('#media-layer-add').onclick=()=>picker(null,state().current,o);return true;
 }$('#inspector').innerHTML=`<div class="inspector-section"><div class="field"><label>图层名称</label><input class="input" id="media-layer-name" value="${esc(o.name)}"></div><label class="dialogue-link"><input type="checkbox" id="media-layer-visible" ${o.visible!==false?'checked':''}> 显示图层</label><button class="add-component" id="media-layer-add">添加图片 / 视频片段…</button><button class="add-component" id="media-layer-front">向前一层</button><button class="add-component" id="media-layer-back">向后一层</button></div>`+fields(t,null);bind(t,null);$('#media-layer-name').onchange=e=>commit(()=>{o.name=e.target.value.trim().slice(0,100)||'画面';t.name=o.name;});$('#media-layer-visible').onchange=e=>commit(()=>o.visible=e.target.checked);$('#media-layer-add').onclick=()=>picker(t);for(const [selector,step] of [['#media-layer-front',-1],['#media-layer-back',1]])$(selector).onclick=()=>commit(()=>{const tracks=state().tracks,media=state().compositionVersion===1?CreatorComposition.tracks(state()):tracks.filter(t=>t.type==='media'),other=media[media.indexOf(t)+step];if(t.locked||other?.locked)throw Error('请先解锁轨道');if(other)CreatorComposition.reorder(state(),t,other,true);});return true;}
 function assetInspector(a){$('#inspector').innerHTML=`<div class="inspector-section"><h3>${esc(env.label(a))}</h3><p class="hint">${a.type==='视频'?'视频':'图片'} · ${esc(a.source)}</p>${a.visual?`<p>${a.visual.width} × ${a.visual.height}${a.visual.duration?' · '+a.visual.duration.toFixed(2)+' 秒':''}</p>`:''}<button class="add-component" id="media-asset-rename">修改别名</button><button class="add-component" id="media-asset-add">添加到新画面层</button><button class="add-component" id="media-asset-ready">检查 / 准备素材</button><p class="hint">拖到画面轨道空位会沿用该层布局。落点重叠或指向其他类型轨道时，在目标轨道正上方新建画面层。GIF 当前导入第一帧；视频使用 H.264 播放副本，原文件保留。</p><p class="hint">超出 4096 像素的画面按比例缩小，视频帧率最高 60。</p></div>`;$('#media-asset-rename').onclick=()=>env.rename(a.id);$('#media-asset-add').onclick=()=>add(a).catch(e=>env.notify(e.message));$('#media-asset-ready').onclick=async()=>{try{await prepare(a);env.inspector();env.sync();env.notify('画面素材已就绪');}catch(e){env.notify(e.message);}};}
 function consume(event){if(!event?.id||!['begin','move','end'].includes(event.phase)||![event.dx,event.dy,event.scale].every(Number.isFinite))return;const f=env.getClip(event.id);if(!f||!editable(f.track)||env.playing()||selected()?.clip.id!==event.id){if(gesture&&gesture.state===state())env.remember(gesture.before);gesture=null;return;}if(gesture&&(gesture.state!==state()||gesture.time!==state().current))gesture=null;if(!gesture||gesture.id!==event.id){gesture={id:event.id,state:state(),time:state().current,before:env.copy(),layout:M.layout(layer(f.track),f.clip,state().current-f.clip.start)};}if(event.phase==='begin')return;const base=gesture.layout;try{updateLayout(f.track,f.clip,{x:base.x+event.dx,y:base.y+event.dy,scale:Math.max(.001,Math.min(20,base.scale*event.scale))});env.sync();if(event.phase==='end'){env.remember(gesture.before);gesture=null;env.inspector();}}catch(e){if(gesture)env.restore(gesture.before);gesture=null;env.notify(e.message);}}

 return {add,picker,draws,selection,fields,bind,objectInspector,assetInspector,consume,selected,prepare};
}};
