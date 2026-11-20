(function(root){'use strict';
 root.CreatorAnimationLayerUI=function(e){
  const $=s=>document.querySelector(s),esc=e.esc,L=CreatorAnimationLayers;
  const labels={animation:'动画',expression:'表情',decal:'贴花 / 特效',gaze:'注视'},scopes={full:'全身',head:'头颈',upperBody:'上半身',lowerBody:'下半身',leftArm:'左臂和手',rightArm:'右臂和手'};
  const options=(items,value)=>Object.entries(items).map(([k,v])=>`<option value="${k}" ${k===value?'selected':''}>${v}</option>`).join('');
  function change(fn){const before=structuredClone(e.state());fn();e.remember(before);e.render();}
  function addTrack(actor,type,role='overlay'){
   const s=e.state(),tracks=s.tracks.filter(t=>t.target===actor.id&&t.type===type),t={id:e.id(),target:actor.id,type,layerRole:role,name:actor.name+' · '+(role==='base'?(type==='animation'?'基础动画':'基础表情'):(type==='animation'?'动画叠加 ':'表情叠加 ')+(tracks.filter(t=>t.layerRole==='overlay').length+1)),clips:[]};
   s.tracks.push(t);if(!actor.components.includes(type))actor.components.push(type);return t;
  }
  function trackFor(actor,type,start,len,preferred,forceOverlay=false){
   const free=t=>t&&!t.locked&&t.enabled!==false&&!t.clips.some(c=>start<c.start+c.len-1e-6&&start+len>c.start+1e-6);
   const tracks=e.state().tracks.filter(t=>t.target===actor.id&&t.type===type);
   const base=tracks.find(t=>t.layerRole==='base');
   if(!preferred&&!forceOverlay){if(!base)return addTrack(actor,type,'base');preferred=base;}
   if(free(preferred)&&(!forceOverlay||preferred.layerRole==='overlay'))return preferred;
   return tracks.find(t=>t.layerRole==='overlay'&&free(t))||addTrack(actor,type);
  }
  async function addClip(actor,assetId,start,preferred,settings={}){
   const s=e.state(),def=e.motion(assetId),face=e.face(assetId),shape=e.shape(assetId),type=def?'animation':'expression';
   if(!actor||(!def&&!face&&!shape))throw Error('角色或素材不可用');
   if(face)await e.prepare(actor,assetId,start);
   if(settings.stillWanted&&!settings.stillWanted())throw Error('操作已取消或演出设置已改变，请重新添加');
   if(e.state()!==s||!s.objects.includes(actor)||preferred&&!s.tracks.includes(preferred))throw Error('工程或轨道已改变，请重新添加');
   if(preferred?.locked||preferred?.enabled===false)throw Error('目标轨道已锁定或停用');
   if(shape&&!e.supports(actor,shape.source))throw Error('此角色缺少该形变或特效');
   if(face&&!face.channels.some(c=>e.supports(actor,c.shape)))throw Error('此角色没有可用的表情通道');
   const raw=settings.length??(def?.isPose||face&&face.length<=1.01/e.fps()?3:def?.length||face?.length||3),len=Math.min(Math.ceil((raw-.000001)*e.fps())/e.fps(),e.duration()-start);
   if(len<1/e.fps())throw Error('演出剩余时长不足');
   const before=structuredClone(s),track=settings.newLayer?addTrack(actor,type):trackFor(actor,type,start,len,preferred,!!def?.isAdditive);
   const clip={id:e.id(),name:e.name(assetId),assetId,start,len,weight:100,fadeIn:0,fadeOut:0};
   if(def){clip.layerPlayback=true;clip.loop=!!def.isLoop;if(track.layerRole==='overlay'){clip.blendMode=def.isAdditive?'additive':'override';clip.scope=def.defaultScope||'full';if(def.isAdditive){clip.fadeIn=Math.min(.15,len/4);clip.fadeOut=Math.min(.15,len/4);}}}
   if(face)clip.playback='hold';track.clips.push(clip);e.selectClip(clip.id);if(settings.commit!==false){e.remember(before);e.render();}
   return {clips:[clip.id],length:len,skipped:face?face.channels.filter(c=>!e.supports(actor,c.shape)).length:0,trackId:track.id};
  }
  function openClipPicker(actor,preferred,type='expression',newLayer=false){
   const body=type==='animation',subject=body?'动作':'表情';
   const kinds=body?{all:'全部动作',pose:'静态姿势',animation:'动画',overlay:'可叠加动作'}:{face:'完整表情',shape:'单项形变',effect:'贴花 / 特效'};
   const initial=e.state(),start=initial.current,initialFps=e.fps(),initialDuration=e.duration();
   e.showModal(`<div class="modal-head"><div><h2>添加${subject}片段</h2><p>${esc(actor.name)} · 从 ${start.toFixed(2)} 秒开始</p></div><button data-close class="icon-button" aria-label="关闭">×</button></div><div class="modal-body"><p class="hint">${newLayer?'选择素材后创建叠加层并插入片段。':'选择素材后插入时间轴。'}</p><div class="field"><label for="expression-picker-search">搜索${subject}</label><input id="expression-picker-search" class="input" placeholder="按名称或原始资源名搜索"><label for="expression-picker-kind">素材类型</label><select id="expression-picker-kind">${options(kinds,Object.keys(kinds)[0])}</select></div><div id="expression-picker-list" class="expression-picker-list" aria-label="可选${subject}"></div><p id="expression-picker-count" class="hint"></p><p id="expression-picker-error" class="error" role="alert"></p><button id="expression-picker-resident" class="add-component">查看角色常驻设置</button></div>`);
   const modal=$('#modal'),list=$('#expression-picker-list'),search=$('#expression-picker-search'),kind=$('#expression-picker-kind');let busy=false;
   function draw(){
    const terms=search.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean),mode=kind.value;
    const candidates=e.assets().filter(a=>{if(body){const def=e.motion(a.id);return !!def&&L.matchesFilter(def,mode);}const face=e.face(a.id),shape=e.shape(a.id);return mode==='face'?!!face:!!shape&&e.supports(actor,shape.source)&&(mode==='shape'?shape.source.startsWith('b_'):!shape.source.startsWith('b_'));});
    const matches=candidates.filter(a=>terms.every(term=>(e.name(a.id)+' '+a.source).toLocaleLowerCase().includes(term)));
    matches.sort((a,b)=>Number(e.name(b.id).includes(actor.name))-Number(e.name(a.id).includes(actor.name)));
    list.innerHTML=matches.slice(0,100).map(a=>`<button class="costume-picker-row" data-expression-pick="${esc(a.id)}"><span>${esc(e.name(a.id))}<small>${esc(a.source)}</small></span><small>${body?motionKind(e.motion(a.id)):e.face(a.id)?e.face(a.id).length<=1.01/e.fps()?'静态表情':e.face(a.id).length.toFixed(2)+' 秒':'权重控制'}</small></button>`).join('')||`<p class="hint">${candidates.length?'没有匹配的素材，请更换搜索词。':'此类型暂无可用素材，请检查资源缓存是否已准备。'}</p>`;
    $('#expression-picker-count').textContent=`匹配 ${matches.length} 项${matches.length>100?'，显示前 100 项，请继续搜索':''}`;
   }
   search.oninput=draw;kind.onchange=draw;
   $('#expression-picker-resident').onclick=()=>{if(busy)return;e.closeModal();e.manageResident(actor);};
   list.onclick=async event=>{
    const button=event.target.closest('[data-expression-pick]');if(!button||busy)return;busy=true;
    modal.querySelectorAll('button:not([data-close]),input,select').forEach(x=>x.disabled=true);
    const valid=()=>initial===e.state()&&initial.objects.includes(actor)&&$('#expression-picker-list')===list&&!$('#overlay').classList.contains('hidden')&&e.fps()===initialFps&&e.duration()===initialDuration;
    try{
     if(!valid())throw Error('工程或演出设置已改变，请重新选择素材');
     const base=preferred||initial.tracks.find(t=>t.target===actor.id&&t.type===type&&t.layerRole==='base');
     const result=await addClip(actor,button.dataset.expressionPick,start,newLayer?undefined:base,{stillWanted:valid,newLayer});
     e.closeModal();e.revealClip(result.clips[0]);e.notify('已添加'+subject+'片段'+(result.skipped?'；跳过 '+result.skipped+' 个此角色不支持的通道':''));
    }catch(error){if($('#expression-picker-list')===list)$('#expression-picker-error').textContent=error.message;}
    finally{busy=false;if($('#expression-picker-list')===list)modal.querySelectorAll('button,input,select').forEach(x=>x.disabled=false);}
   };
   draw();search.focus();
  }
  function residentMarkup(actor){
   return `<div class="inspector-section resident-section"><div class="section-title">常驻叠加 <button id="resident-add" class="tool-button">＋ 添加</button></div><p class="hint">按列表顺序生效；时间轴表情临时覆盖相同通道，片段结束后恢复。注视尚未实现。</p><div class="resident-list">${(actor.residentLayers||[]).map((x,i)=>`<div class="resident-item ${x.enabled?'':'resident-muted'}"><label><input type="checkbox" data-resident-enable="${esc(x.id)}" ${x.enabled?'checked':''} ${x.kind==='gaze'?'disabled':''}><span><b>${esc(x.kind==='gaze'?'注视玩家（预留）':e.name(x.assetId))}</b><small>${labels[x.kind]} · ${x.kind==='gaze'?'未实现':x.weight+'%'+(x.kind==='animation'?' · '+scopes[x.scope]:'')}</small></span></label><div class="resident-actions"><button data-resident-edit="${esc(x.id)}">设置</button><button data-resident-move="${esc(x.id)}" data-step="-1" ${i?'':'disabled'} title="上移">↑</button><button data-resident-move="${esc(x.id)}" data-step="1" ${i<actor.residentLayers.length-1?'':'disabled'} title="下移">↓</button><button data-resident-remove="${esc(x.id)}" title="移除">×</button></div></div>`).join('')||'<p class="hint">尚无常驻叠加。</p>'}</div><label class="dialogue-link"><input id="inherit-body-face" type="checkbox" ${actor.inheritBodyFace?'checked':''}> 继承身体动作配套表情</label><p class="hint">配套表情作为底层，常驻表情与时间轴可继续覆盖；旧工程默认关闭。</p></div>`;
  }
  function bindResident(actor){
   $('#resident-add').onclick=()=>editResident(actor);
   $('#inherit-body-face').onchange=ev=>change(()=>actor.inheritBodyFace=ev.target.checked);
   document.querySelectorAll('[data-resident-enable]').forEach(b=>b.onchange=()=>change(()=>actor.residentLayers.find(x=>x.id===b.dataset.residentEnable).enabled=b.checked));
   document.querySelectorAll('[data-resident-remove]').forEach(b=>b.onclick=()=>change(()=>actor.residentLayers=actor.residentLayers.filter(x=>x.id!==b.dataset.residentRemove)));
   document.querySelectorAll('[data-resident-edit]').forEach(b=>b.onclick=()=>editResident(actor,actor.residentLayers.find(x=>x.id===b.dataset.residentEdit)));
   document.querySelectorAll('[data-resident-move]').forEach(b=>b.onclick=()=>change(()=>{const list=actor.residentLayers,i=list.findIndex(x=>x.id===b.dataset.residentMove),j=i+Number(b.dataset.step);if(j>=0&&j<list.length)[list[i],list[j]]=[list[j],list[i]];}));
  }
  function bodyFields(value,prefix){return `<div class="field"><label>混合方式</label><select id="${prefix}-blend">${options({additive:'原生增量叠加',override:'按部位覆盖'},value.blendMode||'override')}</select></div><div class="field"><label>作用范围</label><select id="${prefix}-scope">${options(scopes,value.scope||'full')}</select></div><label class="dialogue-link"><input id="${prefix}-loop" type="checkbox" ${value.loop?'checked':''}> 循环播放</label><p class="hint">原生增量仅用于游戏明确标记的叠加动作。普通动作可按部位覆盖；下方层优先，道具约束与 IK 尚未接入。</p>`;}
  function editResident(actor,current){
   const draft=current?structuredClone(current):{id:e.id(),kind:'animation',enabled:true,weight:100,assetId:'',blendMode:'additive',scope:'full',loop:true,condition:'always',playback:'hold'};
   e.showModal(`<div class="modal-head"><div><h2>${current?'设置':'添加'}常驻叠加</h2><p>${esc(actor.name)}</p></div><button data-close class="icon-button">×</button></div><div class="modal-body"><div class="field"><label>内容类型</label><select id="resident-kind">${options(labels,draft.kind)}</select></div><div id="resident-editor"></div><p id="resident-error" class="error"></p><button id="resident-save" class="solid-button">保存</button></div>`);
   function draw(){
    const gaze=draft.kind==='gaze';
    $('#resident-editor').innerHTML=gaze?'<p class="hint">预留注视玩家设置，当前不会改变角色眼睛或头部方向。</p>':`<div class="field"><label>素材</label><input id="resident-search" class="input" placeholder="搜索名称或原名"><select id="resident-asset" size="6"></select><p class="hint" id="resident-count"></p></div><div class="field"><label>权重（%）</label><input id="resident-weight" class="input" type="number" min="0" max="100" value="${draft.weight}"></div>${draft.kind==='animation'?bodyFields(draft,'resident')+`<div class="field"><label>生效时机</label><select id="resident-condition">${options({always:'始终生效',resident:'仅使用常驻动画时'},draft.condition||'always')}</select></div>`:`<div class="field"><label>播放方式</label><select id="resident-playback">${options({hold:'保持指定姿态',loop:'循环播放'},draft.playback||'hold')}</select></div><div class="field"><label>取样位置（秒）</label><input id="resident-offset" class="input" type="number" min="0" step="0.033333" value="${draft.sourceOffset||0}"></div><p class="hint">保持模式默认取表情末尾；可调整取样位置。形变与贴花直接使用权重。</p>`}`;
    if(gaze)return;
    const list=e.assets().filter(a=>draft.kind==='animation'?!!e.motion(a.id):draft.kind==='expression'?!!e.face(a.id)||!!e.shape(a.id)&&e.shape(a.id).source.startsWith('b_'):!!e.shape(a.id)&&!e.shape(a.id).source.startsWith('b_'));
    const paint=()=>{const terms=$('#resident-search').value.toLowerCase().trim().split(/\s+/).filter(Boolean),matched=list.filter(a=>terms.every(x=>(e.name(a.id)+' '+a.source).toLowerCase().includes(x))),shown=matched.slice(0,120);const chosen=list.find(a=>a.id===draft.assetId);if(chosen&&!shown.includes(chosen))shown.unshift(chosen);$('#resident-asset').innerHTML=(!chosen&&draft.assetId?`<option value="${esc(draft.assetId)}" selected>素材缺失：${esc(draft.assetId)}</option>`:'<option value="">请选择素材</option>')+shown.map(a=>`<option value="${esc(a.id)}" ${a.id===draft.assetId?'selected':''}>${esc(e.name(a.id))}</option>`).join('');$('#resident-count').textContent=`匹配 ${matched.length} 项，最多显示 120 项；可继续搜索。`;};
    $('#resident-search').oninput=paint;paint();
    $('#resident-asset').onchange=ev=>{draft.assetId=ev.target.value;const d=e.motion(draft.assetId),f=e.face(draft.assetId);if(d){$('#resident-blend').value=d.isAdditive?'additive':'override';$('#resident-scope').value=d.defaultScope||'full';$('#resident-loop').checked=!!d.isLoop;}else if(f)$('#resident-offset').value=Math.max(0,f.length-.0001).toFixed(4);};
   }
   $('#resident-kind').onchange=ev=>{draft.kind=ev.target.value;draft.assetId='';draw();};draw();
   $('#resident-save').onclick=async()=>{const button=$('#resident-save');button.disabled=true;try{
    const s=e.state();let item;
    if(draft.kind==='gaze')item={id:draft.id,kind:'gaze',enabled:false,weight:100,targetType:'camera',gazeScope:'eyes'};
    else {
     item={id:draft.id,kind:draft.kind,enabled:current?.enabled??true,weight:Number($('#resident-weight').value),assetId:$('#resident-asset').value};
     if(draft.kind==='animation'){Object.assign(item,{blendMode:$('#resident-blend').value,scope:$('#resident-scope').value,loop:$('#resident-loop').checked,condition:$('#resident-condition').value});const d=e.motion(item.assetId);if(!d||item.blendMode==='additive'&&!d.isAdditive)throw Error('所选动作不是原生增量动画，请改为按部位覆盖');}
     else{Object.assign(item,{playback:$('#resident-playback').value,sourceOffset:Number($('#resident-offset').value)});const face=e.face(item.assetId);if(face){if(item.sourceOffset>face.length)throw Error('取样位置超出表情时长');await e.prepare(actor,item.assetId,0);}else if(!e.shape(item.assetId)||!e.supports(actor,e.shape(item.assetId).source))throw Error('此角色缺少该形变或特效');}
    }
    if(!L.validateResident(item))throw Error('请检查素材、权重和取样位置');
    if(e.state()!==s||!s.objects.includes(actor))throw Error('工程或角色已改变');
    if(!current&&actor.residentLayers.length>=32)throw Error('每个角色最多设置 32 项常驻叠加');
    const before=structuredClone(s);if(current){const index=actor.residentLayers.indexOf(current);if(index<0)throw Error('常驻设置已改变');actor.residentLayers[index]=item;}else actor.residentLayers.push(item);e.remember(before);e.closeModal();e.render();
   }catch(err){const out=$('#resident-error');if(out)out.textContent=err.message;}finally{if(button.isConnected)button.disabled=false;}};
  }
  const motionKind=def=>def.isAdditive?'原生增量动画':def.isPose?'静态姿势':def.isLoop?'循环动画':'单次动画';
  function motionFields(track,clip){
   if(track.type!=='animation')return '';
   const def=e.motion(clip.assetId),asset=e.assets().find(a=>a.id===clip.assetId)||def;
   return CreatorClipSources.card(esc,{
    title:'动画素材',name:asset?e.name(clip.assetId):clip.assetId||'未指定动画',
    source:asset?.source,detail:def?motionKind(def)+' · 源时长 '+Number(def.length.toFixed(3))+' 秒':'',
    error:def?'':'动画素材缺失或不可用，请准备资源或更换动画。',
    controls:`<button id="clip-motion-replace" class="add-component" ${track.locked?'disabled':''}>更换动画…</button>`
   });
  }
  function openMotionPicker(track,clip){
   CreatorClipSources.picker(e,track,clip,{
    key:'motion',title:'更换动画',followSourceName:true,hint:'保留片段排时和播放设置，新动画从头播放。',
    kinds:{all:'全部',pose:'仅姿势',animation:'仅动画',overlay:'仅可叠加'},
    items:kind=>e.assets().filter(a=>{const d=e.motion(a.id);return d&&(track.layerRole==='overlay'||!d.isAdditive)&&L.matchesFilter(d,kind);}),
    describe:a=>motionKind(e.motion(a.id))+' · '+Number(e.motion(a.id).length.toFixed(3))+' 秒',
    apply:a=>L.replaceMotion(track,clip,a.id,e.motion)
   });
  }
  function expressionKind(id){
   if(e.face(id))return 'face';
   const shape=e.shape(id);
   if(shape)return shape.source.startsWith('b_')?'shape':'effect';
  }
  const expressionKinds={face:'完整表情',shape:'单项形变',effect:'贴花 / 特效'};
  function expressionFields(track,clip){
   if(track.type!=='expression'||clip.lipVisemes)return '';
   const actor=e.state().objects.find(o=>o.id===track.target),def=e.face(clip.assetId),shape=e.shape(clip.assetId);
   const asset=e.assets().find(a=>a.id===clip.assetId)||def||shape,kind=expressionKind(clip.assetId);
   const details=[expressionKinds[kind]];
   if(def){
    details.push('源时长 '+Number(def.length.toFixed(3))+' 秒');
    if(def.originalName)details.push('原片 '+def.originalName+'，从 '+Number(def.sourceOffset.toFixed(3))+' 秒分段');
    if(def.channels&&actor)details.push('角色可用通道 '+def.channels.filter(c=>e.supports(actor,c.shape)).length+' / '+def.channels.length);
   }
   const unavailable=!kind||!actor||!e.actorSupported(actor)||shape&&!e.supports(actor,shape.source)||def&&(!e.layered||def.channels&&!def.channels.some(c=>e.supports(actor,c.shape)));
   return CreatorClipSources.card(esc,{
    title:clip.lipSyncSource?'口型嘴形':'表情素材',name:asset?e.name(clip.assetId):clip.assetId||'未指定表情',source:asset?.source,
    detail:details.filter(Boolean).join(' · '),error:unavailable?'此表情素材缺失或当前角色无法使用，可重新选择。':'',
    controls:`<button id="clip-expression-replace" class="add-component" ${track.locked?'disabled':''}>${clip.lipSyncSource?'更换嘴形':'更换表情'}…</button>`
   });
  }
  function openExpressionReplacement(track,clip){
   const actor=e.state().objects.find(o=>o.id===track.target);
   if(!actor||!e.actorSupported(actor))return e.notify('角色不可用');
   const mouthOnly=Boolean(clip.lipSyncSource);
   const kinds={...expressionKinds};if(!e.layered)delete kinds.face;
   CreatorClipSources.picker(e,track,clip,{
    key:'expression',title:mouthOnly?'更换口型嘴形':'更换表情',followSourceName:!mouthOnly,
    hint:'保留自定义片段名、排时、权重关键帧和渐变，新素材从头取样。',
    kinds:mouthOnly?null:{all:'全部',...kinds},
    items:kind=>e.assets().filter(a=>{
     const type=expressionKind(a.id);
     if(!type||!kinds[type]||kind&&kind!=='all'&&kind!==type)return false;
     const shape=e.shape(a.id);
     if(mouthOnly)return !!shape&&shape.source.startsWith('b_mouth.')&&e.supports(actor,shape.source);
     if(shape)return e.supports(actor,shape.source);
     const channels=e.face(a.id).channels;
     return !channels||channels.some(c=>e.supports(actor,c.shape));
    }),
    describe:a=>expressionKinds[expressionKind(a.id)],
    prepare:async a=>{if(e.face(a.id))await e.prepare(actor,a.id,clip.start);},
    apply:a=>{
     if(!e.state().objects.includes(actor)||track.target!==actor.id)throw Error('片段所属角色已改变');
     const face=e.face(a.id);
     if(face&&!face.channels?.some(c=>e.supports(actor,c.shape)))throw Error('角色没有可用的表情通道');
     if((mouthOnly||!e.layered)&&e.state().tracks.some(t=>t.type==='expression'&&t.enabled!==false&&t.target===actor.id&&t.clips.some(c=>c!==clip&&c.assetId===a.id&&c.start<clip.start+clip.len-1e-6&&clip.start<c.start+c.len-1e-6)))throw Error('已有重叠的同名形变片段');
     if(clip.weight===undefined)clip.weight=L.faceWeight(clip,e.face);
     clip.assetId=a.id;clip.sourceOffset=0;
     if(face)clip.playback=clip.loop?'loop':clip.playback||'hold';
     else delete clip.playback;
     delete clip.loop;
     if(mouthOnly)clip.lipEdited=true;
    }
   });
  }
  function bindSources(track,clip){
   const motion=$('#clip-motion-replace'),expression=$('#clip-expression-replace');
   if(motion)motion.onclick=()=>openMotionPicker(track,clip);
   if(expression)expression.onclick=()=>openExpressionReplacement(track,clip);
  }
  function clipFields(track,clip){
   if(track.type==='animation')return (track.layerRole==='overlay'?`<div class="layer-clip-fields"><div class="field"><label>叠加权重（%）</label><input id="layer-weight" class="input" type="number" min="0" max="100" value="${clip.weight??100}"></div>${bodyFields(clip,'layer')}</div>`:`<label class="dialogue-link"><input id="layer-loop" type="checkbox" ${clip.loop?'checked':''}> 在片段范围内循环</label><div class="field"><label for="layer-end">源动画结束后</label><select id="layer-end" ${clip.loop?'disabled':''}>${options({resident:'恢复常驻动画',hold:'保持末帧'},clip.layerPlayback?'hold':'resident')}</select></div>`);
   if(track.type==='expression'&&!clip.lipSyncSource&&e.face(clip.assetId))return `<div class="field"><label>表情播放方式</label><select id="layer-playback">${options({hold:'播放后保持末帧',loop:'在片段范围内循环'},clip.loop?'loop':clip.playback||'hold')}</select></div><p class="hint">整套面部曲线保存在一个片段中；说话口型只临时接管嘴部。</p>`;
   return '';
  }
  function bindClip(track,clip){
   const fields={weight:'weight',blend:'blendMode',scope:'scope',loop:'loop',playback:'playback',end:'layerPlayback'};
   for(const [key,field] of Object.entries(fields)){
    const input=$('#layer-'+key);if(!input)continue;
    input.disabled=!!track.locked||(key==='end'&&clip.loop===true);
    input.onchange=()=>{
     if(track.locked||input.disabled)return;
     let value=input.value;
     if(key==='loop')value=input.checked;
     if(key==='end')value=input.value==='hold';
     if(key==='weight'){
      value=input.valueAsNumber;
      if(!Number.isFinite(value)||value<0||value>100){e.notify('权重须在 0–100 之间');e.render();return;}
     }
     if(key==='blend'&&value==='additive'&&!e.motion(clip.assetId)?.isAdditive){e.notify('此动作没有原生增量数据');e.render();return;}
     change(()=>{clip[field]=value;if(key==='playback')delete clip.loop;});
    };
   }
  }
  return {residentMarkup,bindResident,motionFields,expressionFields,bindSources,clipFields,bindClip,addClip,openClipPicker};
 };
})(globalThis);
