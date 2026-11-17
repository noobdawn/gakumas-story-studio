(function(root){root.CreatorCharacterColorEditor=function(env){
 const C=root.CreatorCharacterColors;
 function mount(asset){
  if(asset.type!=='角色')return;
  const state=env.state(),pair=C.colors(asset),section=document.createElement('div');section.className='inspector-section';section.id='character-colors';
  const source=C.code(asset)==='krnh'?'游戏通用默认色（未找到专属配置）':C.code(asset)?'游戏对白默认配色':'通用默认配色';
  section.innerHTML=`<div class="section-title">姓名条颜色</div><div class="character-name-preview" style="background:linear-gradient(90deg,${pair[0]},${pair[1]});color:${C.custom(asset)?C.contrast(pair):C.label(state,{speaker:asset.alias||asset.source})}">${env.esc(asset.alias||asset.source)}</div><div class="character-color-fields"><label>左端<input type="color" id="actor-color-left" value="${pair[0]}"><span>${pair[0].toUpperCase()}</span></label><label>右端<input type="color" id="actor-color-right" value="${pair[1]}"><span>${pair[1].toUpperCase()}</span></label></div><button class="add-component" id="actor-color-reset" ${C.custom(asset)?'':'disabled'}>恢复默认配色</button><p class="hint">${C.custom(asset)?'本工程自定义配色':source}。自动颜色的对白跟随此设置；单句手动颜色优先。仅用于游戏素材对话框。</p>`;
  document.querySelector('#inspector').appendChild(section);
  const left=section.querySelector('#actor-color-left'),right=section.querySelector('#actor-color-right');
  function save(reset){if(!section.isConnected||env.state()!==state)return;const before=structuredClone(state);if(C.set(state,asset,reset?null:left.value,reset?null:right.value)){env.remember(before);env.render();}}
  left.onchange=right.onchange=()=>save(false);section.querySelector('#actor-color-reset').onclick=()=>save(true);
 }
 return {mount};
};})(globalThis);
