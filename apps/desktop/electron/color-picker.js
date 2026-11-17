'use strict';
const path=require('node:path');
const valid=c=>typeof c==='string'&&/^#[0-9a-f]{6}$/i.test(c);
function pixel(image,x,y){
 if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=1||y>=1)throw Error('取色坐标无效');
 const {width,height}=image.getSize(),p=image.crop({x:Math.min(width-1,Math.floor(x*width)),y:Math.min(height-1,Math.floor(y*height)),width:1,height:1}).toBitmap();
 // NativeImage's Windows bitmap is BGRA; read the original captured pixel, not the magnifier.
 return '#'+[p[2],p[1],p[0]].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function create({BrowserWindow,ipcMain,screen,desktopCapturer,parent,hidden=false}){
 let current=null;
 function known(event){const s=current;if(!s||event.senderFrame!==event.sender.mainFrame)throw Error('取色窗口已关闭');if(event.sender===s.window.webContents)return {s,kind:'panel'};const view=s.views.find(v=>v.window.webContents===event.sender);if(view)return {s,kind:'screen',view};throw Error('无效取色窗口');}
 function stopScreens(s,value=null){const done=s.screenDone;s.screenDone=null;const views=s.views;s.views=[];for(const v of views)if(!v.window.isDestroyed())v.window.destroy();done?.(value);}
 function finish(s,value=null){if(current!==s)return;current=null;s.owner?.removeListener('closed',s.ownerClosed);stopScreens(s);if(!s.window.isDestroyed())s.window.destroy();s.resolve(value);}
 function secure(window){window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());window.webContents.on('render-process-gone',()=>{if(current)finish(current);});}
 function options(){return {show:false,autoHideMenuBar:true,backgroundColor:'#282c30',webPreferences:{preload:path.join(__dirname,'color-picker/preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}};}
 ipcMain.handle('color-picker:init',event=>{const {s,kind,view}=known(event);return kind==='panel'?{kind,color:s.color}:{kind,image:view.image.toDataURL()};});
 ipcMain.handle('color-picker:confirm',(event,color)=>{const {s,kind}=known(event);if(kind!=='panel'||color!==null&&!valid(color))throw Error('颜色无效');finish(s,color);});
 ipcMain.handle('color-picker:sample',(event,x,y)=>{const {s,kind,view}=known(event);if(kind!=='screen')throw Error('无效屏幕取色');const color=pixel(view.image,x,y);stopScreens(s,color);return color;});
 ipcMain.handle('color-picker:cancel-screen',event=>{const {s}=known(event);stopScreens(s);});
 ipcMain.handle('color-picker:screen',async event=>{
  const {s,kind}=known(event);if(kind!=='panel'||s.capturing)throw Error('屏幕取色正在进行');s.capturing=true;s.screenCancelled=false;s.window.hide();
  const cancel=()=>{s.screenCancelled=true;stopScreens(s);};let timer;
  for(const name of ['display-added','display-removed','display-metrics-changed'])screen.on(name,cancel);
  try{
   await new Promise(r=>setTimeout(r,120));if(current!==s||s.screenCancelled)return null;
   const displays=screen.getAllDisplays();
   const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.max(...displays.map(d=>Math.round(d.bounds.width*d.scaleFactor))),height:Math.max(...displays.map(d=>Math.round(d.bounds.height*d.scaleFactor)))},fetchWindowIcons:false});
   if(current!==s||s.screenCancelled)return null;
   const captures=displays.map(d=>{const source=sources.find(x=>x.display_id===String(d.id));if(!source||source.thumbnail.isEmpty())throw Error('无法获取屏幕画面，请重试');return {display:d,image:source.thumbnail};});
   const result=new Promise(resolve=>{s.screenDone=resolve;});
   for(const capture of captures){
    const window=new BrowserWindow({...options(),...capture.display.bounds,frame:false,skipTaskbar:true,alwaysOnTop:true,resizable:false,movable:false,enableLargerThanScreen:true});
    const view={...capture,window};s.views.push(view);secure(window);window.setAlwaysOnTop(true,'screen-saver');window.setBounds(capture.display.bounds);window.on('closed',cancel);
    window.webContents.on('before-input-event',(e,input)=>{if(input.key==='Escape'){e.preventDefault();stopScreens(s);}});
    await window.loadFile(path.join(__dirname,'color-picker/screen.html'));if(current!==s||!s.screenDone)return null;
   }
   timer=setTimeout(cancel,120000);
   if(!hidden){for(const v of s.views)v.window.showInactive();const cursor=screen.getCursorScreenPoint(),display=screen.getDisplayNearestPoint(cursor);(s.views.find(v=>v.display.id===display.id)||s.views[0]).window.focus();}
   return await result;
  }catch(error){if(current!==s||s.screenCancelled)return null;throw error;}finally{clearTimeout(timer);for(const name of ['display-added','display-removed','display-metrics-changed'])screen.removeListener(name,cancel);stopScreens(s);s.capturing=false;if(current===s&&!hidden){s.window.show();s.window.focus();}}
 });
 async function pick(color){
  if(!valid(color))throw Error('颜色须为六位十六进制值');if(current)throw Error('请先完成当前取色');
  const owner=parent?.();if(owner?.isDestroyed())return null;
  const window=new BrowserWindow({...options(),width:350,height:480,resizable:false,minimizable:false,maximizable:false,title:'选择颜色',parent:owner,alwaysOnTop:true});
  const result=new Promise(resolve=>{current={window,owner,color,views:[],resolve};});const s=current;s.ownerClosed=()=>finish(s);owner?.once('closed',s.ownerClosed);secure(window);
  window.on('closed',()=>finish(s));window.webContents.on('before-input-event',(e,input)=>{if(input.key==='Escape'){e.preventDefault();finish(s);}});
  try{await window.loadFile(path.join(__dirname,'color-picker/index.html'));if(current===s&&!hidden)window.show();}catch(e){finish(s);throw e;}
  return result;
 }
 return {pick,cancel:()=>{if(current)finish(current);}};
}
module.exports={create,pixel,valid};
