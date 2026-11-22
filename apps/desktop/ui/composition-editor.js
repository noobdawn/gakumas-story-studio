globalThis.CreatorCompositionEditor=function(e){
 'use strict';const C=CreatorComposition,$=s=>document.querySelector(s);
 function commit(t,fn){if(t?.locked)return e.notify('轨道已锁定');const before=e.copy();try{fn();C.validate(e.state());e.remember(before);e.close();e.render();}catch(error){Object.assign(e.state(),before);e.notify(error.message);}}
 const seamNames={dissolve:'叠化',black:'淡出到黑再淡入',wipe:'从左向右擦除'};
 function seamFields(t,c){
  return (e.state().transitions||[]).filter(x=>x.trackId===t.id&&(x.leftId===c.id||x.rightId===c.id)).map(x=>
   `<button class="add-component" data-clip-seam="${e.esc(x.id)}">${x.leftId===c.id?'片尾':'片头'}接缝 · ${seamNames[x.kind]} · ${Number(x.duration.toFixed(3))} 秒</button>`
  ).join('');
 }
 function seam(t,a,b){const state=e.state(),previous=state.transitions.find(x=>x.leftId===a.id&&x.rightId===b.id);
  e.modal(`<div class="modal-head"><h2>片段转场</h2><button data-close>×</button></div><div class="modal-body"><p>${e.esc(a.name)} → ${e.esc(b.name)}</p><div class="field"><label>转场</label><select id="seam-kind">${Object.entries(seamNames).map(([key,name])=>`<option value="${key}" ${previous?.kind===key?'selected':''}>${name}</option>`).join('')}</select></div><div class="field"><label>时长（秒）</label><input class="input" id="seam-duration" type="number" step="${1/e.fps()}" min="${1/e.fps()}" max="${Math.min(a.len,b.len)*2}" value="${previous?.duration||Math.min(.5,a.len,b.len)}"></div><p class="hint">转场以接缝为中心，不改变总时长和声音。视频需有相应源素材余量；图片可直接延展。</p><button id="seam-save" class="solid-button" ${t.locked?'disabled':''}>保存</button>${previous?'<button id="seam-remove" class="top-button">移除转场</button>':''}<p id="seam-error" class="error"></p></div>`);
  $('#seam-save').onclick=()=>{const before=e.copy();try{if(e.state()!==state||t.locked||!state.tracks.includes(t)||!t.clips.includes(a)||!t.clips.includes(b))throw Error('工程或轨道已改变');const duration=Math.round(Number($('#seam-duration').value)*e.fps())/e.fps(),x={id:previous?.id||e.id(),trackId:t.id,leftId:a.id,rightId:b.id,kind:$('#seam-kind').value,duration};state.transitions=state.transitions.filter(y=>y.id!==x.id);state.transitions.push(x);C.validate(state);for(const time of [b.start-duration/2,b.start+duration/2-1/e.fps()/100])C.mediaSamples(state,t,time,e.asset);e.remember(before);e.close();e.render();}catch(error){state.transitions=before.transitions;$('#seam-error').textContent=error.message;}};
  if(previous)$('#seam-remove').onclick=()=>commit(t,()=>state.transitions=state.transitions.filter(x=>x.id!==previous.id));
 }
 function decorate(){if(e.state().compositionVersion!==1)return;const box=$('#tracks');
  for(const t of e.state().tracks.filter(t=>t.type==='media')){const lane=box.querySelector(`[data-lane="${CSS.escape(t.id)}"]`);if(!lane)continue;const clips=[...t.clips].sort((a,b)=>a.start-b.start);for(let i=1;i<clips.length;i++){const a=clips[i-1],b=clips[i];if(Math.abs(a.start+a.len-b.start)>1e-7)continue;const existing=e.state().transitions.find(x=>x.leftId===a.id&&x.rightId===b.id),button=document.createElement('button');button.className='seam-transition'+(existing?' configured':'');button.style.left=(b.start/e.duration()*100)+'%';button.textContent=existing?'⋈':'＋';button.title=existing?'编辑接缝转场':'在连续片段间添加转场';button.setAttribute('aria-label',button.title);button.onpointerdown=event=>event.stopPropagation();button.onclick=event=>{event.stopPropagation();seam(t,a,b);};lane.append(button);}}
 }
 function baseLayout(t,c){
  const world=t.type==='camera'&&e.state().tracks.find(track=>track.type==='world');
  return C.layout({...world?.compositionLayout,...c.compositionLayout});
 }
 function fields(t,c){if(e.state().compositionVersion!==1)return '';
  const world=t.type==='camera',editable=world||C.visual(t),l=baseLayout(t,c);
  const input=(k,n,m=100)=>`<label class="media-property">${n}<input class="input" data-composition-layout="${k}" data-mult="${m}" type="number" step="any" value="${Number((l[k]*m).toFixed(3))}"></label>`;
  const geometry=input('x','位置 X（%）')+input('y','位置 Y（%）')+input('scale','缩放（%）')+input('width','宽度（%）')+input('height','高度（%）')+input('rotation','旋转（°）',1)+input('opacity','不透明度（%）');
  const extra=input('cropLeft','左裁剪（%）')+input('cropRight','右裁剪（%）')+input('cropTop','上裁剪（%）')+input('cropBottom','下裁剪（%）')+input('originX','轴心 X（偏离中心 %）')+input('originY','轴心 Y（偏离中心 %）')+
    [['flipX','水平翻转'],['flipY','垂直翻转']].map(([k,n])=>`<label class="dialogue-link"><input type="checkbox" data-picture-flag="${k}" ${l[k]?'checked':''}> ${n}</label>`).join('');
  const flags=`<label class="dialogue-link"><input type="checkbox" data-picture-aspect ${c.pictureLock!==false?'checked':''}> 锁定宽高比</label>`;
  const generic=!editable?'':`<details class="inspector-section" ${t.type==='media'?'':'open'}><summary>${world?'拍摄画面构图':t.type==='media'?'合成变换':'位置与大小'}</summary>
    ${world?`<p class="hint">${Object.keys(c.compositionLayout||{}).length?'此镜头含片段覆盖':'继承「演出画面」轨道布局'}</p><button data-picture-inherit>恢复轨道布局</button>`:''}
    <select data-picture-align aria-label="画布对齐"><option value="">画布对齐…</option><option value="center">居中</option><option value="corner">右上角画中画</option><option value="full">铺满</option></select>${geometry}${flags}<details><summary>裁剪、轴心与翻转</summary>${extra}</details></details>`;
  if(t.type==='media')return seamFields(t,c)+generic;if(t.type!=='dialogue')return generic;const p={x:0,y:0,scale:1,opacity:1,...c.dialogueLayout};return generic+'<div class="inspector-section"><div class="section-title">字幕画面布局</div>'+Object.entries({x:'水平偏移',y:'垂直偏移（向上）',scale:'缩放',opacity:'不透明度'}).map(([key,label])=>`<div class="field"><label>${label}（%）</label><input class="input" data-dialogue-layout="${key}" type="number" step="1" min="${key==='scale'?10:key==='opacity'?0:-200}" max="${key==='scale'?500:key==='opacity'?100:200}" value="${p[key]*100}"></div>`).join('')+'<p class="hint">字幕参与画面层次，可与图片和演出画面交换前后顺序。</p></div>';}
 function bind(t,c){
  document.querySelectorAll('[data-clip-seam]').forEach(button=>button.onclick=()=>{
   const x=e.state().transitions.find(x=>x.id===button.dataset.clipSeam);
   const pair=x&&C.join(e.state(),x);if(pair&&!t.locked)seam(t,pair.a,pair.b);
  });
  const set=patch=>{C.layout({...baseLayout(t,c),...patch});Object.assign(c.compositionLayout||={},patch);};
  document.querySelectorAll('[data-composition-layout]').forEach(input=>input.onchange=()=>commit(t,()=>{
   const k=input.dataset.compositionLayout,v=input.valueAsNumber/Number(input.dataset.mult),l=baseLayout(t,c),patch={[k]:v};
   if(c.pictureLock!==false&&['width','height'].includes(k)){const other=k==='width'?'height':'width';patch[other]=l[other]*v/l[k];}set(patch);
  }));
  document.querySelectorAll('[data-picture-flag]').forEach(el=>el.onchange=()=>commit(t,()=>set({[el.dataset.pictureFlag]:el.checked})));
  const locked=$('[data-picture-aspect]');if(locked)locked.onchange=()=>commit(t,()=>{c.pictureLock=locked.checked;});
  const inherit=$('[data-picture-inherit]');if(inherit)inherit.onclick=()=>commit(t,()=>{delete c.compositionLayout;});
  const align=$('[data-picture-align]');if(align)align.onchange=()=>commit(t,()=>{if(align.value==='corner')set({x:.32,y:.32,scale:.3,width:1,height:1});else if(align.value==='full')set({x:0,y:0,scale:1,width:1,height:1});else set({x:0,y:0});});
  document.querySelectorAll('[data-dialogue-layout]').forEach(input=>input.onchange=()=>commit(t,()=>{c.dialogueLayout={...c.dialogueLayout,[input.dataset.dialogueLayout]:Number(input.value)/100};}));}
 return {decorate,fields,bind,seam,baseLayout};
};
