// Run with Electron, not node --test. No app host, game data or visible windows.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const ui=path.resolve(__dirname,'../../ui');
const temporary=fs.mkdtempSync(path.join(process.env.GSS_UI_CHECK_TEMP||os.tmpdir(),'gss-layout-'));
app.setPath('userData',path.join(temporary,'profile'));
app.disableHardwareAcceleration();
const preload=path.join(temporary,'fixture.cjs');
fs.writeFileSync(preload,`const long='E:/人工夹具/'+ '很长的目录/'.repeat(25);
window.fixture={job:{state:'idle'},voice:{state:'idle'},ready:false};
window.assetAPI={setupStatus:async()=> '初始化向导测试',settingsInfo:async()=>({game:{state:'valid',path:long},root:long,managedPath:long,job:fixture.job,visualNext:fixture.ready}),settingsStats:async()=>({totalBytes:0,categories:[]}),settingsGame:async()=>{},settingsCache:async()=>{},settingsStart:async()=>{fixture.job={state:'running',phase:'解包角色、动作、场景和音频',message:'人工夹具'};},settingsCancel:async()=>{fixture.job={state:'cancelled',message:'已取消'};},settingsClear:async()=>{},setupRestart:async()=>{}};
window.setupAPI={info:async()=>({data:long,settings:{engine:'none'},status:fixture.voice,models:Array.from({length:30},(_,i)=>({id:String(i),name:'中文声库 '+i,bytes:1000000})),terms:'人工使用说明'}),data:async()=>{},download:async()=>{fixture.voice={state:'running',phase:'download',received:50,total:100,itemIndex:1,itemTotal:3};},cancel:async()=>{fixture.voice={state:'cancelled'};},finish:async()=>{}};
`);
let win;
const results=[];
async function js(code){return win.webContents.executeJavaScript(code);}
async function metrics(width,height,scale){await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:scale,mobile:false});await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');}
async function run(){
  win=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{offscreen:true,preload,contextIsolation:false,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.debugger.attach('1.3');
  const errors=[];win.webContents.on('console-message',(_e,...args)=>{const message=typeof args[0]==='object'?args[0].message:args[1];if(String(message).includes('Uncaught'))errors.push(message);});
  await win.loadFile(path.join(ui,'asset-setup.html'));
  await js('refresh()');
  const matrix=[[800,500,1],[1024,600,1.25],[1280,720,1.5],[1920,1040,2],[2560,1380,1.5],[3840,2100,1]];
  for(const [w,h,dpr] of matrix){
    await metrics(w,h,dpr);
    for(let step=0;step<4;step++){
      const state=await js(`step=${step};show();$('#engine').value='voicevox';$('#engine').onchange();({footer:$('.setup-footer').getBoundingClientRect().bottom,view:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,body:$('.setup-content').clientHeight,select:(()=>{const c=getComputedStyle($('#engine'));return {inner:$('#engine').clientHeight-parseFloat(c.paddingTop)-parseFloat(c.paddingBottom),line:parseFloat(c.lineHeight)||parseFloat(c.fontSize)*1.5}})()})`);
      assert.ok(state.footer<=state.view+1,JSON.stringify({w,h,step,state}));assert.equal(state.overflow,false);assert.ok(state.body>100);if(step===1)assert.ok(state.select.inner>=state.select.line-1,JSON.stringify(state));
    }
    results.push({page:'wizard',w,h,dpr,steps:4});
  }
  await js(`step=1;show();fixture.voice={state:'running',phase:'download',received:50,total:100};refresh()`);
  assert.equal(await js(`$('#voice-progress progress').value`),.5);
  assert.equal(await js(`$('#next').disabled`),true);
  await js(`fixture.voice={state:'running',phase:'unpack'};refresh()`);
  assert.equal(await js(`$('#voice-progress progress').hasAttribute('value')`),false);
  await js(`fixture.voice={state:'error',message:'离线测试失败'};refresh()`);
  assert.equal(await js(`$('#next').disabled`),false);
  await metrics(800,500,2);
  await js(`step=2;show();$('#asset-settings-page>details').open=true;$('.setup-content').scrollTop=99999`);
  assert.ok(await js(`$('.setup-content').scrollTop>0`));
  // The editor shell uses the real markup, styles and docking script, with no backend app.
  const html=fs.readFileSync(path.join(ui,'index.html'),'utf8').replace('<head>','<head><base href="'+pathToFileURL(ui+path.sep).href+'">').replace(/<script src="\.\/([^\"]+)"><\/script>/g,(full,name)=>['layout-schema.js','layout.js','task-progress.js','asset-settings.js','animation-layers.js','animation-layer-ui.js','character-colors.js','character-color-editor.js','settings-file-links.js','color-inputs.js'].includes(name)?full:'');
  const fixture=path.join(temporary,'editor.html');fs.writeFileSync(fixture,html);await win.loadFile(fixture);
  for(const [w,h,dpr] of matrix){
    await metrics(w,h,dpr);
    const state=await js(`({footer:$('.statusbar')})`.replace("$('.statusbar')","document.querySelector('.statusbar').getBoundingClientRect().bottom"));
    assert.ok(state.footer<=h+1);
    const panels=await js(`[...document.querySelectorAll('.dock-group')].map(e=>({w:e.clientWidth,h:e.clientHeight}))`);
    assert.ok(panels.every(p=>p.w>=175&&p.h>=155),JSON.stringify(panels));
    results.push({page:'editor',w,h,dpr,panels:panels.length});
  }
  await js(`document.querySelector('#overlay').classList.remove('hidden');document.querySelector('#modal').innerHTML='<div class="modal-head"><h2>设置测试</h2><button>关闭</button></div><div class="modal-body">'+window.creatorAssetSettings.html+'<select><option>中文文字完整显示</option></select><button class="solid-button">确认</button></div>'`);
  await metrics(800,500,2);
  const modal=await js(`(()=>{const m=document.querySelector('#modal'),b=m.querySelector('.modal-body'),s=m.querySelector('select'),c=getComputedStyle(s);b.scrollTop=99999;return {bottom:m.getBoundingClientRect().bottom,scroll:b.scrollTop,inner:s.clientHeight-parseFloat(c.paddingTop)-parseFloat(c.paddingBottom),line:parseFloat(c.lineHeight)||parseFloat(c.fontSize)*1.5};})()`);
  assert.ok(modal.bottom<=500&&modal.scroll>0&&modal.inner>=modal.line-1,JSON.stringify(modal));
  const animationClip=await require('./animation-clip-ui.cjs')(js);
  const characterColors=await require('./character-colors-ui.cjs')(js);
  results.push({characterColors});
  results.push({settingsFiles:await require('./settings-files-ui.cjs')(js)});
  assert.deepEqual(errors,[]);
  return {passed:true,matrix:results,progressStates:'passed',modal:'passed',animationClip,visibleUI:'not tested; emulated device scale only'};
}
app.whenReady().then(run).then(result=>{console.log(JSON.stringify(result));fs.writeFileSync(path.resolve(__dirname,'../../../..','.local/ui-layout-result.json'),JSON.stringify(result,null,2));app.exit(0);}).catch(e=>{console.error(e.stack);app.exit(1);});
app.on('will-quit',()=>{if(win&&!win.isDestroyed())win.destroy();});
process.on('exit',()=>{try{fs.rmSync(temporary,{recursive:true,force:true});}catch{}});
