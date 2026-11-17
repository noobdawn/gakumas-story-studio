'use strict';
const {BrowserWindow,session}=require('electron');
const {validate}=require('../ui/code-ui');
const crypto=require('node:crypto');
// No preload, Node, disk, network or application bridge in authored documents.
function create(){
 let window=null,key='',chain=Promise.resolve(),last=null;
 const isolated=session.fromPartition('gss-code-ui-'+crypto.randomUUID());
 isolated.setPermissionRequestHandler((_w,_p,done)=>done(false));
 isolated.setPermissionCheckHandler(()=>false);
 isolated.webRequest.onBeforeRequest((details,done)=>done({cancel:!details.url.startsWith('data:')}));
 function close(){if(window&&!window.isDestroyed())window.destroy();window=null;key='';last=null;}
 async function render({code,time,duration,width,height}){
  validate(code);if(![time,duration].every(x=>Number.isFinite(x)&&x>=0&&x<=7200)||![width,height].every(x=>Number.isInteger(x)&&x>=64&&x<=1920))throw Error('UI 渲染尺寸或时间无效');
  const next=JSON.stringify([code,width,height]),frameKey=next+':'+time+':'+duration;
  if(last?.key===frameKey)return last.png;
  let timer;
  try{return await Promise.race([(async()=>{
   if(key!==next){close();window=new BrowserWindow({show:false,width,height,useContentSize:true,transparent:true,backgroundColor:'#00000000',webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false,offscreen:true}});
    const wc=window.webContents;wc.setWindowOpenHandler(()=>({action:'deny'}));wc.on('will-navigate',e=>e.preventDefault());wc.on('will-attach-webview',e=>e.preventDefault());
    // Load only a trusted shell. Authored markup cannot precede/replace its CSP.
    await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'"><style>html,body{margin:0;background:transparent;overflow:hidden}</style><body></body>'));
    wc.setZoomFactor(1);wc.debugger.attach('1.3');await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await wc.debugger.sendCommand('Emulation.setDefaultBackgroundColorOverride',{color:{r:0,g:0,b:0,a:0}});
    key=next;
   }
   const wc=window.webContents;
   // Rebuild each sample: random access must not inherit the last frame's DOM/JS state.
   await wc.executeJavaScript(`(async()=>{document.body.innerHTML=${JSON.stringify(code.html)};document.getElementById('gss-style')?.remove();const style=document.createElement('style');style.id='gss-style';style.textContent=${JSON.stringify(code.css)};document.head.append(style);await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));const time=${time},duration=${duration};await (async()=>{${code.js}\n;if(typeof render==='function')await render(time,duration);})();for(const a of document.getAnimations()){a.pause();a.currentTime=time*1000;}document.body.getBoundingClientRect();})()`);
   const result=await wc.debugger.sendCommand('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
   if(result.data.length>300000)throw Error('UI 图像超过 300 KB，请简化画面或降低输出分辨率');last={key:frameKey,png:result.data};return result.data;
  })(),new Promise((_,reject)=>{timer=setTimeout(()=>{close();reject(Error('UI 代码执行超时，请检查循环和异步操作'));},5000);})]);}catch(error){close();throw error;}finally{clearTimeout(timer);}
 }
 return {render:args=>{const result=chain.then(()=>render(args));chain=result.catch(()=>{});return result;},close};
}
module.exports={create};
