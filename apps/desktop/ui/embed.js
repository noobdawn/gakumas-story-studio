(() => {
  'use strict';
  if (new URLSearchParams(location.search).get('embedded') !== '1') return;
  document.body.classList.add('embedded-player');
  const status = document.querySelector('#bridge-status');
  document.querySelector('.preview-tools').prepend(status);
  document.querySelector('.live-label').textContent = 'Unity 嵌入预览';
  document.querySelectorAll('.preview-tools > span').forEach(el => {
    if (el.textContent === '窗口化') el.textContent = '嵌入窗口';
    if (el.textContent === '独立 Player') el.textContent = '实验模式';
  });
  document.querySelector('.statusbar span:last-child').textContent = 'LOCAL DEMO / Unity 嵌入预览';
  const viewport = document.querySelector('.viewport');
  const dockNotice=document.createElement('div');dockNotice.className='dock-preview-notice hidden';dockNotice.textContent='浮动面板遮住预览，移开面板或停靠后恢复';viewport.append(dockNotice);
  const modal = document.querySelector('#overlay');
  const endpoint = '/' + location.pathname.split('/')[1] + '/bounds';
  let pending = null, busy = false, last = '', inset = null, metricRequest = 0;
  async function send() {
    if (busy || !pending) return;
    busy = true;
    const bounds = pending; pending = null;
    try {
      const response = await fetch(endpoint, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(bounds)});
      if (!response.ok) throw Error('窗口位置同步失败');
    } catch (e) {
      status.textContent = e.message;
      last = '';
    } finally { busy = false; if (pending) send(); }
  }
  function layout() {
    const r = viewport.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const workspace=document.querySelector('.workspace').getBoundingClientRect();
    const clipped=r.left<workspace.left-1||r.right>workspace.right+1||r.top<workspace.top-1||r.bottom>workspace.bottom+1;
    const blocked=clipped||document.body.classList.contains('dock-dragging')||[...document.querySelectorAll('.dock-floating')].some(el=>{const b=el.getBoundingClientRect();return b.left<r.right&&b.right>r.left&&b.top<r.bottom&&b.bottom>r.top;});
    dockNotice.textContent=clipped?'请滚动工作区或扩大窗口以显示完整预览':'浮动面板遮住预览，移开面板或停靠后恢复';
    dockNotice.classList.toggle('hidden',!blocked);
    const x = Math.round(r.left*d), y = Math.round(r.top*d);
    const bounds = {x, y, width:Math.max(1,Math.round(r.right*d)-x), height:Math.max(1,Math.round(r.bottom*d)-y),
      ...(inset?{insetX:Math.round(inset.x*d),insetY:Math.round(inset.y*d)}:{}),
      visible:!document.hidden && modal.classList.contains('hidden') && !blocked && r.width>1 && r.height>1};
    const key=JSON.stringify(bounds); if(key===last)return; last=key; pending=bounds; send();
  }
  new ResizeObserver(layout).observe(viewport);
  new MutationObserver(layout).observe(modal,{attributes:true,attributeFilter:['class']});
  async function refreshMetrics(){if(!window.projectAPI?.windowMetrics)return;const request=++metricRequest;try{const m=await window.projectAPI.windowMetrics();if(request!==metricRequest)return;inset={x:m.contentBounds.x-m.bounds.x,y:m.contentBounds.y-m.bounds.y};layout();}catch(_){}}
  window.addEventListener('resize',()=>{layout();refreshMetrics();});
  window.addEventListener('creator-layout-change',layout);
  document.querySelector('.workspace').addEventListener('scroll',layout);
  function watchDpi(){const query=matchMedia(`(resolution: ${devicePixelRatio}dppx)`);query.addEventListener('change',()=>{layout();refreshMetrics();watchDpi();},{once:true});}
  watchDpi();
  document.addEventListener('visibilitychange',layout);
  layout();
  refreshMetrics();
})();
