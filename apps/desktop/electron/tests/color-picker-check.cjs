// Hidden Electron windows and artificial screens only. Never captures the real desktop.
const {app,BrowserWindow,ipcMain,nativeImage}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const temp=fs.mkdtempSync(path.join(process.env.GSS_UI_CHECK_TEMP||os.tmpdir(),'color-check-'));app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){const v=await fn();if(v)return v;await delay(30);}throw Error('Hidden picker timeout');}
const js=(w,c)=>w.webContents.executeJavaScript(c);
async function run(){
 const screen=new EventEmitter();screen.getAllDisplays=()=>[{id:1,bounds:{x:0,y:0,width:640,height:480},scaleFactor:1},{id:2,bounds:{x:-900,y:0,width:900,height:600},scaleFactor:1.5}];
 const bitmap=Buffer.alloc(100*60*4);for(let y=0;y<60;y++)for(let x=0;x<100;x++){const i=(y*100+x)*4;bitmap[i]=x>=50?255:0;bitmap[i+1]=y>=30?128:0;bitmap[i+2]=x<50?255:0;bitmap[i+3]=255;}
 const image=nativeImage.createFromBitmap(bitmap,{width:100,height:60});let captureOptions,fail=false;
 const api=require('../color-picker').create({BrowserWindow,ipcMain,screen,desktopCapturer:{getSources:async o=>{captureOptions=o;if(fail)throw Error('人工捕获失败');return [{display_id:'1',thumbnail:image},{display_id:'2',thumbnail:image}];}},hidden:true});
 const pick=api.pick('#26b4eb');const panel=await until(()=>BrowserWindow.getAllWindows()[0]);await until(()=>js(panel,`!!document.querySelector('#hex')&&document.querySelector('#hex').value==='#26B4EB'`).catch(()=>false));
 const layout=await js(panel,`({height:innerHeight,bottom:document.querySelector('#apply').getBoundingClientRect().bottom,overflow:document.documentElement.scrollHeight>innerHeight})`);assert.ok(layout.bottom<=layout.height&&!layout.overflow,JSON.stringify(layout));
 await js(panel,`document.querySelector('#hex').value='#123';document.querySelector('#hex').oninput()`);assert.equal(await js(panel,`document.querySelector('#apply').disabled`),true);
 await js(panel,`document.querySelector('#screen').click()`);await until(()=>BrowserWindow.getAllWindows().length===3);
 const views=BrowserWindow.getAllWindows().filter(w=>w!==panel);assert.ok(views.every(w=>!w.isVisible()&&w.isAlwaysOnTop()));assert.deepEqual(captureOptions.thumbnailSize,{width:1350,height:900});
 const second=views.find(w=>w.getBounds().x<0)||views[1];await until(()=>js(second,`document.querySelector('#desktop')?.complete&&document.querySelector('#desktop')?.naturalWidth>0`).catch(()=>false));
 await js(second,`void picker.sample(.75,.75)`);await until(()=>BrowserWindow.getAllWindows().length===1);await until(()=>js(panel,`document.querySelector('#hex').value==='#0080FF'`));
 await js(panel,`document.querySelector('#apply').click()`);assert.equal(await pick,'#0080ff');assert.equal(BrowserWindow.getAllWindows().length,0);
 // Escape/cancel and capture failure leave no covering windows or display listeners.
 const canceled=api.pick('#abcdef');const panel2=await until(()=>BrowserWindow.getAllWindows()[0]);await until(()=>js(panel2,`!!document.querySelector('#screen')`).catch(()=>false));await js(panel2,`document.querySelector('#screen').click()`);await until(()=>BrowserWindow.getAllWindows().length===3);
 screen.emit('display-removed');await until(()=>BrowserWindow.getAllWindows().length===1);assert.equal(await js(panel2,`document.querySelector('#hex').value`),'#ABCDEF');
 await until(()=>js(panel2,`!document.querySelector('#screen').disabled`));assert.equal(await js(panel2,`document.querySelector('#error').textContent`),'');fail=true;await js(panel2,`document.querySelector('#screen').click()`);await until(()=>js(panel2,`document.querySelector('#error').textContent.includes('人工捕获失败')`));assert.equal(BrowserWindow.getAllWindows().length,1);
 panel2.close();assert.equal(await canceled,null);assert.equal(screen.listenerCount('display-removed'),0);assert.equal(BrowserWindow.getAllWindows().length,0);
 assert.equal(require('../color-picker').pixel(image,0,0),'#ff0000');assert.throws(()=>require('../color-picker').pixel(image,1,0));
 return {passed:true,hidden:true,realDesktopCaptured:false,layout,screenPixel:'#0080ff',displayRemoval:true,captureFailure:true,windowsClosed:true};
}
app.whenReady().then(run).then(r=>{console.log(JSON.stringify(r));app.exit(0);}).catch(e=>{console.error(e.stack);app.exit(1);});
