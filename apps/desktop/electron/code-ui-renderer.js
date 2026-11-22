'use strict';
const {BrowserWindow,session}=require('electron');
const {validate}=require('../ui/code-ui');
const crypto=require('node:crypto');

let isolated;
function restrictedSession(){
  if(isolated)return isolated;
  isolated=session.fromPartition('gss-code-ui-'+crypto.randomUUID());
  isolated.setPermissionRequestHandler((_w,_p,done)=>done(false));
  isolated.setPermissionCheckHandler(()=>false);
  isolated.webRequest.onBeforeRequest((details,done)=>done({cancel:!details.url.startsWith('data:')}));
  return isolated;
}

function create(){
  const surfaces=new Map();
  let queue=Promise.resolve(),active=null,foreground=0,warmEpoch=0,closed=false;

  async function initialize(win,width,height){
    const wc=win.webContents;
    wc.setWindowOpenHandler(()=>({action:'deny'}));
    wc.on('will-navigate',e=>e.preventDefault());
    wc.on('will-attach-webview',e=>e.preventDefault());
    // Only the trusted shell loads. Authored markup cannot replace its CSP or reach the editor.
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'"><style>html,body{margin:0;background:transparent;overflow:hidden}</style><body></body>'));
    wc.setZoomFactor(1);wc.debugger.attach('1.3');
    await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await wc.debugger.sendCommand('Emulation.setDefaultBackgroundColorOverride',{color:{r:0,g:0,b:0,a:0}});
  }
  function drop(key){
    const surface=surfaces.get(key);
    if(!surface)return;
    surfaces.delete(key);
    if(!surface.win.isDestroyed())surface.win.destroy();
  }
  function getSurface(key,width,height){
    let s=surfaces.get(key);
    if(s&&s.win.isDestroyed()){surfaces.delete(key);s=null;}
    if(s)surfaces.delete(key);
    else{
      if(surfaces.size>=2)drop(surfaces.keys().next().value);
      const win=new BrowserWindow({show:false,width,height,useContentSize:true,transparent:true,backgroundColor:'#00000000',
        webPreferences:{session:restrictedSession(),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false,offscreen:true}});
      s={win,ready:initialize(win,width,height),last:null};
    }
    surfaces.set(key,s);return s;
  }
  async function draw(surface,{code,time,duration}){
    await surface.ready;
    const wc=surface.win.webContents;
    // Rebuild each exact sample so reverse seeks and exports never inherit another frame's DOM.
    await wc.executeJavaScript(`(async()=>{document.body.innerHTML=${JSON.stringify(code.html)};document.getElementById('gss-style')?.remove();const style=document.createElement('style');style.id='gss-style';style.textContent=${JSON.stringify(code.css)};document.head.append(style);await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));const time=${time},duration=${duration};await (async()=>{${code.js}\n;if(typeof render==='function')await render(time,duration);})();for(const a of document.getAnimations()){a.pause();a.currentTime=time*1000;}document.body.getBoundingClientRect();})()`);
    const {data}=await wc.debugger.sendCommand('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
    if(data.length>300000)throw Error('UI 图像超过 300 KB，请简化画面或降低输出分辨率');
    return data;
  }
  async function capture(args,background){
    const {code,time,duration,width,height,purpose='preview'}=args;
    validate(code);
    if(![time,duration].every(x=>Number.isFinite(x)&&x>=0&&x<=7200)||![width,height].every(x=>Number.isInteger(x)&&x>=64&&x<=1920)||
       !['preview','export'].includes(purpose))throw Error('UI 渲染尺寸或时间无效');
    const hash=crypto.createHash('sha256').update(JSON.stringify([code.html,code.css,code.js])).digest('hex');
    const key=hash+'/'+width+'x'+height,s=getSurface(key,width,height);
    const last=s.last;
    if(last&&last.time===time&&last.duration===duration&&last.purpose===purpose)return last.png;
    let cancel,timer;
    const stopped=new Promise((_,reject)=>{cancel=reject;});
    const work={background,cancelled:false,cancel(){work.cancelled=true;cancel(Error('UI 取样已中断'));}};
    active=work;
    try{
      timer=setTimeout(()=>cancel(Error('UI 代码执行超时，请检查循环和异步操作')),5000);
      const png=await Promise.race([draw(s,args),stopped]);
      s.last={time,duration,purpose,png};return png;
    }catch(error){
      drop(key);
      if(background&&work.cancelled)return null;
      throw error;
    }finally{clearTimeout(timer);if(active===work)active=null;}
  }
  function interrupt(){
    warmEpoch++;
    if(active?.background)active.cancel();
  }
  function render(args,background=false){
    if(closed)return Promise.reject(Error('代码 UI 渲染器已关闭'));
    if(background&&foreground)return Promise.resolve(null);
    if(!background){foreground++;interrupt();}
    const epoch=warmEpoch;
    const task=queue.then(()=>{
      if(closed)throw Error('代码 UI 渲染器已关闭');
      if(background&&(epoch!==warmEpoch||foreground))return null;
      return capture(args,background);
    }).finally(()=>{if(!background)foreground--;});
    queue=task.catch(()=>{});return task;
  }
  function close(){
    closed=true;warmEpoch++;active?.cancel();
    for(const key of surfaces.keys())drop(key);
  }
  return {render,interrupt,close};
}
module.exports={create};
