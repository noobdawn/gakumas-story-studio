globalThis.CreatorUITransitionEditor=function(e){
  const $=s=>document.querySelector(s),esc=e.esc,engine=CreatorUITransitions;
  const aspect=()=>{const [w,h]=e.state().globalSettings.aspect.split(':').map(Number);return w/h;};
  const choices=()=>engine.choices(e.entries());
  const layoutOrMissing=asset=>{try{return asset&&engine.layout(asset,e.entries(),aspect());}catch{return null;}};
  function addTrack(){const s=e.state(),n=s.tracks.filter(t=>t.type==='ui').length+1,t={id:e.id(),name:'UI 层 '+n,type:'ui',target:'scene',uiLayer:true,clips:[]};s.tracks.push(t);return t;}
  function insert(assetId,start,preferred){
    if(!e.supported())throw Error('请重启工作台，使用支持 UI 转场的 Player');
    const original=e.entries().find(a=>a.id===assetId),asset=original&&engine.layout(original,e.entries(),aspect());if(!asset)throw Error('转场素材未准备完成');
    const len=Math.ceil(engine.total(asset)*e.fps())/e.fps();
    if(start+len>e.duration()+1e-6)throw Error('演出剩余时长不足，请将播放头前移或延长演出');
    if(preferred&&(preferred.locked||preferred.enabled===false))throw Error('请先启用并解锁目标轨道');
    const s=e.state(),before=structuredClone(s),free=t=>!t.locked&&t.enabled!==false&&!t.clips.some(c=>start<c.start+c.len&&start+len>c.start);
    const track=preferred&&free(preferred)?preferred:s.tracks.find(t=>t.type==='ui'&&free(t))||addTrack();
    const clip={id:e.id(),name:original.alias.replace(/ · (横版|竖版)$/,''),assetId:engine.canonical(assetId),start,len,uiKind:'transition'};track.clips.push(clip);e.select(clip.id);e.remember(before);e.closeModal();e.reveal(clip.id);e.render();return clip;
  }
  async function picker(preferred,assetId,start){
    e.pause();await e.ready();const entries=choices();
    e.showModal(`<div class="modal-head"><div><h2>添加 UI 叠加</h2><p>只叠加画面，场景由场景轨道控制</p></div><button class="icon-button" data-close aria-label="关闭">×</button></div><div class="modal-body">${!entries.length?'<p class="error">没有可用的转场素材，请准备资源。'+esc(e.error())+'</p>':`<div class="field"><label>转场效果</label><select id="ui-transition-asset">${entries.map(a=>`<option value="${esc(a.id)}" ${a.id===engine.canonical(assetId||'')?'selected':''}>${esc(a.alias)}</option>`).join('')}</select></div><p class="hint">遮入 → 停留 → 揭开。将场景轨道的切换点放在转场的遮挡区间内，可遮住换景过程。</p><button class="solid-button" id="ui-transition-insert">插入当前时间</button>`}<p class="error" id="ui-transition-error"></p></div>`);
    const button=$('#ui-transition-insert');if(button)button.onclick=()=>{try{insert($('#ui-transition-asset').value,start??e.state().current,preferred);}catch(x){$('#ui-transition-error').textContent=x.message;}};
  }
  function fields(clip){const original=e.entries().find(a=>a.id===clip.assetId),asset=layoutOrMissing(original),cover=asset&&engine.covered(clip,asset);return `<div class="field"><label>UI 效果</label><select id="ui-effect-choice">${!asset?`<option value="${esc(clip.assetId)}" selected>素材缺失</option>`:''}${choices().map(a=>`<option value="${esc(a.id)}" ${a.id===engine.canonical(clip.assetId)?'selected':''}>${esc(a.alias)}</option>`).join('')}</select></div><p class="hint">${cover?'遮挡参考区间：'+cover.start.toFixed(3)+' ～ '+cover.end.toFixed(3)+' 秒。可将场景轨道的切换点放在这里。':'转场素材缺失，请准备资源。'}</p><p class="hint">自动适配工程画幅。此片段只显示 UI，不改变场景。拉长片段会等比例放慢效果；画面合成中上层在前。</p>`;}
  function bind(clip){const input=$('#ui-effect-choice');if(input)input.onchange=()=>{const asset=e.entries().find(a=>a.id===input.value);if(!asset)return;const before=structuredClone(e.state());clip.assetId=asset.id;clip.name=asset.alias.replace(/ · (横版|竖版)$/,'');e.remember(before);e.render();};}
  return {addTrack,insert,picker,fields,bind};
};
