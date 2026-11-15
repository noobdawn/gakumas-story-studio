(() => {
  'use strict';
  const workspace=document.querySelector('.workspace');
  if(!workspace)return;
  const center=workspace.querySelector('.center');
  const preview=document.createElement('section');preview.className='creator-preview-panel';
  preview.append(center.querySelector('.preview-head'),center.querySelector('.preview-area'));
  const panes={hierarchy:workspace.querySelector('.left-panel'),preview,timeline:document.querySelector('#timeline-panel'),assets:document.querySelector('#assets-panel'),inspector:workspace.querySelector('.right-panel')};
  const names={hierarchy:'场景层级',preview:'场景预览',timeline:'时间轴',assets:'素材浏览器',inspector:'属性'};
  const tabs={timeline:document.querySelector('#tab-timeline'),assets:document.querySelector('#tab-assets')};
  for(const id of Object.keys(panes))if(!tabs[id]){tabs[id]=document.createElement('button');tabs[id].type='button';tabs[id].textContent=names[id];tabs[id].onclick=()=>activate(id);}
  const changed=()=>{window.dispatchEvent(new Event('creator-layout-change'));window.dispatchEvent(new Event('resize'));};
  let root,drag=null,indicator=null,suppressClick=false;
  function group(ids,selected){const el=document.createElement('section');el.className='dock-group';el._ids=ids.slice();el._selected=selected||ids[0];const bar=document.createElement('div');bar.className='dock-tabs';bar.setAttribute('role','tablist');const body=document.createElement('div');body.className='dock-body';el.append(bar,body);refresh(el);return el;}
  function refresh(g){const bar=g.firstElementChild,body=g.lastElementChild;for(const id of g._ids){const tab=tabs[id],pane=panes[id];tab.className='bottom-tab dock-tab';tab.dataset.dockTab=id;tab.title='拖动标签可拆分或合并面板';tab.setAttribute('role','tab');tab.classList.toggle('active',id===g._selected);tab.setAttribute('aria-selected',String(id===g._selected));pane.classList.toggle('hidden',id!==g._selected);bar.append(tab);body.append(pane);}}
  function split(orientation,a,b,ratio=.5){const el=document.createElement('div');el.className='dock-split '+orientation;const divider=document.createElement('div');divider.className='dock-divider';divider.title='拖动调整面板大小';divider.setAttribute('role','separator');divider.tabIndex=0;divider.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();setRatio(el,Math.max(.08,Math.min(.92,el._ratio+(['ArrowLeft','ArrowUp'].includes(e.key)?-.03:.03))));changed();});el.append(a,divider,b);setRatio(el,ratio);divider.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();divider.setPointerCapture(e.pointerId);const r=el.getBoundingClientRect();const move=ev=>{if(ev.pointerId!==e.pointerId)return;const v=orientation==='horizontal'?(ev.clientX-r.left)/r.width:(ev.clientY-r.top)/r.height;setRatio(el,Math.max(.08,Math.min(.92,v)));changed();};const end=ev=>{if(ev.pointerId!==e.pointerId)return;divider.removeEventListener('pointermove',move);divider.removeEventListener('pointerup',end);divider.removeEventListener('pointercancel',end);};divider.addEventListener('pointermove',move);divider.addEventListener('pointerup',end);divider.addEventListener('pointercancel',end);});return el;}
  const paneMinimum={hierarchy:[180,160],preview:[280,180],timeline:[320,220],assets:[320,220],inspector:[240,180]};
  function minimum(el){
    if(el.classList.contains('dock-group'))return el._ids.reduce((v,id)=>v.map((n,i)=>Math.max(n,paneMinimum[id][i])),[0,0]);
    const a=minimum(el.firstElementChild),b=minimum(el.lastElementChild),horizontal=el.classList.contains('horizontal');
    return horizontal?[a[0]+b[0]+5,Math.max(a[1],b[1])]:[Math.max(a[0],b[0]),a[1]+b[1]+5];
  }
  function setRatio(el,ratio){
    el._ratio=ratio;
    const axis=el.classList.contains('horizontal')?0:1,size=(axis===0?el.clientWidth:el.clientHeight)-5;
    const a=minimum(el.firstElementChild)[axis],b=minimum(el.lastElementChild)[axis];
    const applied=size>=a+b?Math.max(a/size,Math.min(1-b/size,ratio)):a/(a+b);
    el.firstElementChild.style.flex=applied+' 1 0';el.lastElementChild.style.flex=(1-applied)+' 1 0';
    const divider=el.children[1];divider.setAttribute('aria-orientation',axis===0?'vertical':'horizontal');divider.setAttribute('aria-valuenow',Math.round(applied*100));
  }
  let fitFrame;
  function fit(){cancelAnimationFrame(fitFrame);fitFrame=requestAnimationFrame(()=>{
    if(!root)return;
    function visit(el){const [w,h]=minimum(el);el.style.minWidth=w+'px';el.style.minHeight=h+'px';if(el.classList.contains('dock-split')){setRatio(el,el._ratio);visit(el.firstElementChild);visit(el.lastElementChild);}}
    visit(root);
  });}
  new ResizeObserver(fit).observe(workspace);
  window.addEventListener('creator-layout-change',fit);

  function activate(id){const tab=tabs[id],g=tab?.closest('.dock-group');if(!g)return;g._selected=id;refresh(g);changed();}
  function findTarget(x,y){const el=document.elementFromPoint(x,y),g=el?.closest('.dock-group');if(!g)return null;const bar=g.firstElementChild.getBoundingClientRect(),r=g.getBoundingClientRect();if(y<=bar.bottom){const nodes=[...g.firstElementChild.querySelectorAll('[data-dock-tab]')],index=nodes.findIndex(t=>{const b=t.getBoundingClientRect();return x<b.left+b.width/2;});return {g,side:'center',rect:r,index:index<0?nodes.length:index};}const px=(x-r.left)/Math.max(r.width,1),py=(y-r.top)/Math.max(r.height,1),m=Math.min(px,1-px,py,1-py);let side='center';if(m<.25)side=m===px?'left':m===1-px?'right':m===py?'top':'bottom';return {g,side,rect:r};}
  function showTarget(target){if(!indicator){indicator=document.createElement('div');indicator.className='dock-target';document.body.append(indicator);}if(!target){indicator.hidden=true;return;}indicator.hidden=false;const {rect:r,side}=target;let x=r.left,y=r.top,w=r.width,h=r.height;if(side==='left')w*=.35;else if(side==='right'){x+=w*.65;w*=.35;}else if(side==='top')h*=.35;else if(side==='bottom'){y+=h*.65;h*=.35;}else{x+=w*.2;y+=h*.2;w*=.6;h*=.6;}Object.assign(indicator.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});}
  function removeGroup(g){const parent=g.parentElement;if(!parent?.classList.contains('dock-split'))return;const sibling=parent.firstElementChild===g?parent.lastElementChild:parent.firstElementChild;sibling.style.flex=parent.style.flex||'1 1 0%';parent.replaceWith(sibling);if(parent===root){root=sibling;root.style.flex='1 1 0%';}}
  function move(id,target){const source=tabs[id].closest('.dock-group'),dest=target?.g;if(!source||!dest)return;if(source===dest&&target.side==='center'){const previous=source._ids.indexOf(id),index=target.index??source._ids.length;source._ids.splice(previous,1);source._ids.splice(Math.max(0,index-(previous<index?1:0)),0,id);activate(id);return;}if(source===dest&&source._ids.length===1)return;
    source._ids=source._ids.filter(x=>x!==id);if(source._ids.length){if(source._selected===id)source._selected=source._ids[0];refresh(source);}else removeGroup(source);
    if(target.side==='center'){dest._ids.splice(target.index??dest._ids.length,0,id);dest._selected=id;refresh(dest);}else{const next=group([id],id),horizontal=['left','right'].includes(target.side),first=['left','top'].includes(target.side);const inheritedFlex=dest.style.flex;const placeholder=document.createElement('div');dest.replaceWith(placeholder);const container=split(horizontal?'horizontal':'vertical',...(first?[next,dest]:[dest,next]));container.style.flex=inheritedFlex||'1 1 0%';placeholder.replaceWith(container);if(dest===root){root=container;root.style.flex='1 1 0%';}}
    changed();
  }
  function reset(){const left=group(['hierarchy']),view=group(['preview']),bottom=group(['timeline','assets'],'timeline'),right=group(['inspector'],'inspector');const middle=split('vertical',view,bottom,.61);const outer=split('horizontal',middle,right,.76);root=split('horizontal',left,outer,.15);workspace.replaceChildren(root);workspace.classList.add('dock-workspace');changed();}
  for(const [id,tab] of Object.entries(tabs)){
    tab.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();suppressClick=false;}},true);
    tab.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={id,pointer:e.pointerId,x:e.clientX,y:e.clientY,moved:false};tab.setPointerCapture(e.pointerId);});
    tab.addEventListener('pointermove',e=>{if(!drag||drag.pointer!==e.pointerId)return;if(!drag.moved&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<6)return;if(!drag.moved){drag.moved=true;document.body.classList.add('dock-dragging');changed();}const t=findTarget(e.clientX,e.clientY);showTarget(t);});
    const end=e=>{if(!drag||drag.pointer!==e.pointerId)return;const d=drag;drag=null;document.body.classList.remove('dock-dragging');indicator?.remove();indicator=null;if(d.moved){changed();suppressClick=true;setTimeout(()=>suppressClick=false,0);if(e.type==='pointerup')move(id,findTarget(e.clientX,e.clientY));else changed();}};tab.addEventListener('pointerup',end);tab.addEventListener('pointercancel',end);
  }
  // Native Player is a child window; temporarily hide it while an asset is dragged across the preview.
  document.querySelector('#asset-grid').addEventListener('dragstart',()=>{document.body.classList.add('dock-dragging');changed();});
  const finishAssetDrag=()=>{if(!drag&&document.body.classList.contains('dock-dragging')){document.body.classList.remove('dock-dragging');changed();}};
  document.addEventListener('dragend',finishAssetDrag);document.addEventListener('drop',finishAssetDrag);
  function snapshotNode(el){if(el.classList.contains('dock-group'))return {type:'group',tabs:el._ids.slice(),active:el._selected};return {type:'split',direction:el.classList.contains('horizontal')?'horizontal':'vertical',ratio:el._ratio,first:snapshotNode(el.firstElementChild),second:snapshotNode(el.lastElementChild)};}
  function snapshot(){return {version:1,root:snapshotNode(root)};}
  function apply(layout){layout=CreatorLayoutSchema.normalize(layout);function build(n){return n.type==='group'?group(n.tabs,n.active):split(n.direction,build(n.first),build(n.second),n.ratio);}root=build(layout.root);workspace.replaceChildren(root);root.style.flex='1 1 0%';changed();}
  window.CreatorPanelLayout={activate,snapshot,apply,reset};
  reset();
})();
