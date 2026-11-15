'use strict';
// Electron screen workArea and BrowserWindow bounds are already in DIP.
function fitBounds(bounds,area){
  const width=Math.min(bounds.width,area.width),height=Math.min(bounds.height,area.height);
  return {x:Math.round(Math.max(area.x,Math.min(bounds.x,area.x+area.width-width))),y:Math.round(Math.max(area.y,Math.min(bounds.y,area.y+area.height-height))),width:Math.round(width),height:Math.round(height)};
}
function options(screen,kind){
  const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const preferred=kind==='setup'?{width:1000,height:780}:{width:1440,height:900};
  const width=Math.min(preferred.width,area.width),height=Math.min(preferred.height,area.height);
  return {...fitBounds({x:area.x+(area.width-width)/2,y:area.y+(area.height-height)/2,width,height},area),minWidth:Math.min(760,area.width),minHeight:Math.min(480,area.height)};
}
function watch(win,screen){
  let timer;
  const fit=()=>{if(win.isDestroyed())return;const bounds=win.getBounds(),area=screen.getDisplayMatching(bounds).workArea;win.setMinimumSize(Math.min(760,area.width),Math.min(480,area.height));if(win.isMaximized()||win.isFullScreen())return;const next=fitBounds(bounds,area);if(Object.keys(next).some(k=>next[k]!==bounds[k]))win.setBounds(next);};
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(fit,150);};
  win.on('moved',schedule);screen.on('display-metrics-changed',schedule);screen.on('display-removed',schedule);
  win.once('closed',()=>{clearTimeout(timer);screen.removeListener('display-metrics-changed',schedule);screen.removeListener('display-removed',schedule);});
}
module.exports={fitBounds,options,watch};
