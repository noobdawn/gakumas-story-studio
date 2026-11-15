'use strict';
// Run main-process orchestration with fake Electron and fake child processes.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
async function start(mode){
 const handlers=new Map(),windows=[],spawns=[];let finished,relaunches=0;
 const service=new Proxy({}, {get:()=>async()=>{}});
 const catalog=path.resolve('fixture/cache/runs/id/catalog'),visual={catalog,view:path.join(catalog,'player-view')};
 const cache={initialise:async()=>{},pinVisual:async()=>{if(mode==='invalid')throw Error('清单已变化');return mode==='missing'?null:visual;},info:async()=>({warning:'请准备资源',visualNext:mode!=='missing'}),rejectVisual:()=>{},isBusy:()=>false,close:async()=>{}};
 class Window extends EventEmitter{
  constructor(){super();windows.push(this);this.webContents=new EventEmitter();this.webContents.mainFrame={url:''};this.webContents.setWindowOpenHandler=()=>{};this.webContents.send=()=>{};}
  setMenu(){}setMenuBarVisibility(){}isDestroyed(){return false;}getNativeWindowHandle(){return Buffer.alloc(8);}
  async loadURL(url){this.loaded=url;this.webContents.mainFrame.url=url;this.webContents.emit('did-finish-load');}
 }
 const app={setPath(){},on(){},quit(){},relaunch(){relaunches++;},whenReady:()=>({then(fn){return {catch(handler){finished=Promise.resolve().then(fn).catch(handler);}};}})};
 const electron={app,BrowserWindow:Window,Menu:{buildFromTemplate:x=>x},ipcMain:{handle:(n,f)=>handlers.set(n,f),on(){}},dialog:{showErrorBox:(title,message)=>{throw Error(title+': '+message);}},safeStorage:{}};
 const fakeRequire=name=>{
  if(name==='electron')return electron;
  if(name==='./runtime-paths')return {...require('../runtime-paths'),configure(){}};
  if(name==='./bundled-resources')return {install:async()=>{}};
  if(name==='./setup-wizard')return {create:()=>({read:async()=>({completed:mode!=='onboarding'}),busy:()=>false,cancel(){}})};
  if(name==='node:fs')return {...fs,mkdtempSync:()=>path.resolve('fixture/profile'),existsSync:()=>false};
  if(name==='node:child_process')return {spawn:(exe,args)=>{spawns.push({exe,args});const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;setImmediate(()=>{if(mode==='failed'){child.stderr.write('native startup failed');child.exitCode=1;child.emit('exit',1);}else{child.stdout.write('Editor: http://127.0.0.1:3210/token/ui/?embedded=1\n');}});return child;}};
  if(name==='./asset-cache')return {create:()=>cache};
  if(name.startsWith('./'))return {create:()=>service};
  return require(name);
 };
 const filename=path.resolve(__dirname,'../main.js');
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{require:fakeRequire,__dirname:path.dirname(filename),process:{platform:'win32',env:{CREATOR_TEST_INSTANCE:'1'},argv:[],stdout:{write(){}}},Buffer,URL,console,setTimeout,clearTimeout});
 await finished;
 return {handlers,windows,spawns,event:{sender:windows[0].webContents,senderFrame:windows[0].webContents.mainFrame},relaunches};
}
for(const mode of ['missing','invalid','onboarding'])test(mode+' cache opens preparation without any Player process',async()=>{
 const r=await start(mode);assert.equal(r.spawns.length,0);assert.match(r.windows[0].loaded,/asset-setup\.html$/);assert(r.handlers.get('assets:setup-status')(r.event));
 assert.throws(()=>r.handlers.get('assets:setup-status')({...r.event,senderFrame:{url:r.windows[0].loaded}}),/不允许/);
 if(mode==='missing')await assert.rejects(r.handlers.get('assets:setup-restart')(r.event),/资源准备完成/);
});
test('valid cache passes only its catalog to the host',async()=>{const r=await start('valid');assert.equal(r.spawns.length,1);const args=r.spawns[0].args;assert(args.includes('--catalog-root'));assert(!args.includes('--bundles'));assert.match(r.windows[0].loaded,/^http:\/\/127\.0\.0\.1:/);});
test('failed cached preview returns to preparation without a sample retry',async()=>{const r=await start('failed');assert.equal(r.spawns.length,1);assert.match(r.windows[0].loaded,/asset-setup\.html$/);assert.match(r.handlers.get('assets:setup-status')(r.event),/native startup failed/);});
