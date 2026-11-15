'use strict';
const runtime=require('./runtime-paths');runtime.configure();
const {app, BrowserWindow, dialog, ipcMain, Menu, shell} = require('electron');
const {spawn} = require('node:child_process');
const writeGuard = require('./write-guard').create(pathForLibrary());
const library = require('./media-library').create(pathForLibrary(),{assertWritable:writeGuard.assertWritable,prepareVisual:require('./visual-media').prepare,onProgress:info=>{if(win&&!win.isDestroyed())win.webContents.send('assets:import-progress',info);}});
const voices = require('./voice-library').create({dataRoot:pathForLibrary(),assertWritable:writeGuard.assertWritable});
const pronunciation = require('./pronunciation-store').create(pathForLibrary(),{assertWritable:writeGuard.assertWritable});
const wizard=require('./setup-wizard').create({runtime,assertWritable:writeGuard.assertWritable,dialog,window:()=>win,voices});
const translation = require('./deepseek-translation').create(pathForLibrary(),{assertWritable:writeGuard.assertWritable,safeStorage:require('electron').safeStorage,...(process.platform==='win32'?{protector:require('./windows-secret-storage')}: {})});
let filmAudio = require('./film-audio-catalog').create(null);
let filmAudioPreview = require('./film-audio-preview').create({catalog:filmAudio});
const http = require('node:http');
const path = require('node:path');
const readline = require('node:readline');
const fs = require('node:fs');
const os = require('node:os');
const store = require('./project-store');
const gameDirectory = require('./game-directory').create(pathForLibrary());

function pathForLibrary() { return runtime.data(); }

const root = runtime.host;
const bundledPython=runtime.python();
const assetCache=require('./asset-cache').create({dataRoot:pathForLibrary(),gameDirectory,python:process.env.CREATOR_PYTHON||(fs.existsSync(bundledPython)?bundledPython:'python'),assertWritable:writeGuard.assertWritable,onActivate:async catalog=>{const next=require('./film-audio-catalog').create(catalog);if(catalog&&!(await next.list()).length)throw Error('缓存中的音频清单为空');await filmAudioPreview.close();filmAudio=next;filmAudioPreview=require('./film-audio-preview').create({catalog:filmAudio});}});
const gameInventory=require('./game-inventory').create({dataRoot:pathForLibrary(),python:process.env.CREATOR_PYTHON||(fs.existsSync(bundledPython)?bundledPython:'python'),assertWritable:writeGuard.assertWritable});
const audioBuilder=require('./audio-catalog-builder').create({dataRoot:pathForLibrary(),assertWritable:writeGuard.assertWritable,python:process.env.CREATOR_PYTHON||(fs.existsSync(bundledPython)?bundledPython:'python'),onComplete:async catalog=>{if(closing)throw Error('工作台正在关闭');const next=require('./film-audio-catalog').create(catalog);if(!(await next.list()).length)throw Error('准备的音频清单为空');const dataRoot=await fs.promises.realpath(pathForLibrary()),allowed=path.join(dataRoot,'audio-catalogs')+path.sep;if(!catalog.toLowerCase().startsWith(allowed.toLowerCase()))throw Error('创作器数据目录已变化，无法保存音频清单');const config=path.join(dataRoot,'audio-catalog.json'),temp=config+'.'+require('node:crypto').randomUUID()+'.tmp';await writeGuard.assertWritable(dataRoot);await fs.promises.writeFile(temp,JSON.stringify({catalog}),{encoding:'utf8',flag:'wx'});try{if(closing)throw Error('工作台正在关闭');await fs.promises.rename(temp,config);}catch(error){await fs.promises.unlink(temp).catch(()=>{});throw error;}await filmAudioPreview.close();filmAudio=next;filmAudioPreview=require('./film-audio-preview').create({catalog:filmAudio});}});
const costumeThumbnails=require('./costume-thumbnail').create({python:process.env.CREATOR_PYTHON||(fs.existsSync(bundledPython)?bundledPython:'python'),script:path.join(root,'costume_thumbnail.py')});
const motionThumbnails=require('./motion-thumbnail').create({python:process.env.CREATOR_PYTHON||(fs.existsSync(bundledPython)?bundledPython:'python'),script:path.join(root,'motion_thumbnail.py'),root:pathForLibrary(),assertWritable:writeGuard.assertWritable});
// The prototype saves projects to explicit files; each process gets its own browser cache.
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-electron-'));
app.setPath('userData', profileDir);
app.setPath('sessionData', profileDir);
let setupMode=false,setupReason='';
let win, host, sessionUrl, closing = false, previewBundles=null, previewPlayer=null, pendingCostumeSave=null,previewCatalog=null;
let currentProject = null, rendererReady = false, closePending = false;
const startupProject=require('./startup-project').create({args:process.argv,read:file=>store.read(file),onAccept:project=>{currentProject=project;}});
ipcMain.handle('project:startup',event=>{checkSender(event);return startupProject.take();});
ipcMain.handle('project:startup-done',(event,applied)=>{checkSender(event);return startupProject.accept(applied);});
const gameDialogs=require('./game-directory-dialogs').create({store:gameDirectory,dialog,window:()=>win});
const controlToken=process.env.CREATOR_CONTROL_TOKEN||'';
let controlServer=null, controlSeq=0;const controlPending=new Map();
function controlEnabled(){return Boolean(controlServer);}
function controlFile(file,extension){if(typeof file!=='string'||!path.isAbsolute(file)||path.extname(file).toLowerCase()!==extension)throw Error('文件路径无效');return path.resolve(file);}
ipcMain.on('control:result',(event,seq,result)=>{try{checkSender(event);}catch{return;}const pending=controlPending.get(seq);if(!pending)return;controlPending.delete(seq);clearTimeout(pending.timer);result?.ok?pending.resolve(result.result):pending.reject(Error(result?.error||'控制命令失败'));});
ipcMain.handle('control:film-audio-list',event=>{checkSender(event);if(!controlEnabled())throw Error('控制接口未启用');return filmAudio.list();});
ipcMain.handle('control:film-audio-import',async(event,ids,projectId)=>{checkSender(event);if(!controlEnabled())throw Error('控制接口未启用');return withFilmRead(async()=>{const entries=await filmAudio.resolveEntries(ids);return library.importFiles(entries.map(x=>x.file),'project',projectId,entries);});});
ipcMain.handle('control:save-new',async(event,file,doc)=>{checkSender(event);if(!controlEnabled())throw Error('控制接口未启用');file=controlFile(file,'.json');const hash=await store.writeNew(file,doc,writeGuard.assertWritable);currentProject={file,hash};return {name:path.basename(file)};});
ipcMain.handle('control:load',async(event,file)=>{checkSender(event);if(!controlEnabled())throw Error('控制接口未启用');file=controlFile(file,'.json');const result=await store.read(file);currentProject={file,hash:result.hash};return {document:result.doc,name:path.basename(file)};});
ipcMain.handle('control:output',async(event,file)=>{checkSender(event);if(!controlEnabled())throw Error('控制接口未启用');file=controlFile(file,'.mp4');const parent=await fs.promises.realpath(path.dirname(file));await writeGuard.assertWritable(parent);const target=path.join(parent,path.basename(file));try{await fs.promises.lstat(target);throw Error('目标已存在');}catch(e){if(e.code!=='ENOENT')throw e;}return target;});
ipcMain.on('control:close',event=>{try{checkSender(event);}catch{return;}if(!controlEnabled()||closing)return;closing=true;controlServer.close();shutdownHost().finally(()=>{if(win&&!win.isDestroyed())win.destroy();app.quit();});});
function dispatchControl(command,args){if(!rendererReady||!win||win.isDestroyed())return Promise.reject(Error('工作台尚未就绪'));return new Promise((resolve,reject)=>{const seq=++controlSeq;const timer=setTimeout(()=>{controlPending.delete(seq);reject(Error('命令超时，执行结果未知'));},300000);controlPending.set(seq,{resolve,reject,timer});win.webContents.send('control:command',seq,command,args);});}


function checkSender(event) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== sessionUrl)
    throw new Error('不允许的工程操作来源');
}
ipcMain.handle('assets:motion-thumbnails',(event,ids)=>{checkSender(event);if(closing||!previewPlayer)throw Error('动画预览不可用');return motionThumbnails.listStatic(ids,previewPlayer,previewBundles);});
ipcMain.handle('assets:motion-preview',async(event,id)=>{checkSender(event);if(closing||!previewBundles||!previewPlayer)throw Error('动画预览不可用');return motionThumbnails.generate(id,previewBundles,previewPlayer,previewCatalog);});
ipcMain.handle('assets:thumbnails', event => { checkSender(event); return library.listThumbnails(); });
ipcMain.handle('assets:costume-thumbnails', (event,ids) => { checkSender(event); return {}; });
ipcMain.handle('assets:costume-thumbnail', async(event,assetId) => { checkSender(event);if(closing||!previewBundles||!previewPlayer)throw Error('服装预览不可用');if(pendingCostumeSave)throw Error('正在生成另一张服装缩略图');const job=(async()=>{const data=await costumeThumbnails.generate(assetId,previewBundles,previewPlayer,previewCatalog);return data;})();pendingCostumeSave=job;try{return await job;}finally{if(pendingCostumeSave===job)pendingCostumeSave=null;} });
ipcMain.handle('assets:save-thumbnail', (event, assetId, dataUrl) => { checkSender(event); return library.saveThumbnail(assetId,dataUrl); });
ipcMain.handle('assets:list-shared', event => { checkSender(event); return library.listShared(); });
ipcMain.handle('assets:delete-file', (event,asset) => {checkSender(event);return library.deleteFile(asset);});
const assetLocation=require('./asset-location').create({catalog:()=>previewCatalog,mediaFile:a=>library.locateFile(a),filmEntries:ids=>filmAudio.resolveEntries(ids),reveal:file=>shell.showItemInFolder(file)});
ipcMain.handle('assets:reveal',(event,asset)=>{checkSender(event);return withFilmRead(()=>assetLocation.open(asset));});
ipcMain.handle('assets:visual-info', (event, asset) => { checkSender(event); return library.visualInfo(asset); });
ipcMain.handle('assets:preview', (event, asset) => { checkSender(event); return library.preview(asset); });
ipcMain.handle('assets:audio-status', (event,asset) => {checkSender(event);return library.audioStatus(asset);});
ipcMain.handle('assets:original-loop',async(event,asset)=>{checkSender(event);if(!asset?.filmAudio?.catalogId)throw Error('此音频没有本地来源记录，请重新导入');return withFilmRead(async()=>{const [entry]=await filmAudio.resolveEntries([asset.filmAudio.catalogId]);return library.bindOriginalLoop(asset,entry);});});
ipcMain.handle('assets:restore-audio', async(event,asset) => {checkSender(event);if((await library.audioStatus(asset)).available)throw Error('素材文件已存在，不会覆盖');const choice=await dialog.showOpenDialog(win,{title:'重新关联缺失音频',properties:['openFile'],filters:[{name:'相同格式音频',extensions:[asset.extension.slice(1)]}]});if(choice.canceled||!choice.filePaths.length)return null;return library.restoreAudio(asset,choice.filePaths[0]);});
ipcMain.handle('voices:list', event => { checkSender(event); return voices.list(); });
ipcMain.handle('voices:rename', (event,id,alias) => { checkSender(event); return voices.rename(id,alias); });
ipcMain.handle('voices:preview', (event,id,styleId) => { checkSender(event); return voices.preview(id,styleId); });
ipcMain.handle('voices:pronunciation-read', event => {checkSender(event);return pronunciation.read();});
ipcMain.handle('voices:pronunciation-save', (event,rules,revision) => {checkSender(event);return pronunciation.save(rules,revision);});
ipcMain.handle('translation:read', event => {checkSender(event);return translation.read();});
ipcMain.handle('translation:save', (event,settings) => {checkSender(event);return translation.save(settings);});
ipcMain.handle('translation:run', (event,lines) => {checkSender(event);return translation.translate(lines);});
ipcMain.handle('voices:cook', async (event,projectId,reference,text,language) => { checkSender(event); const result=await voices.cook(reference,text,language); const asset=await library.saveGenerated(projectId,result.bytes);return {asset:result.timing?{...asset,voiceTiming:result.timing}:asset,spokenText:result.spokenText}; });
async function importAssets(event, files, projectId, filmEntries) {
  checkSender(event);
  if(!Array.isArray(files)||!files.length)return null;
  const choice=await dialog.showMessageBox(win,{type:'question',title:'导入素材',message:`导入 ${files.length} 个文件`,detail:'选择素材的使用范围。素材会复制到创作器数据目录。',buttons:['仅本工程','全部工程','取消'],defaultId:0,cancelId:2,noLink:true});
  if(choice.response===2)return null;
  return library.importFiles(files,choice.response===0?'project':'shared',projectId,filmEntries);
}
ipcMain.handle('assets:film-list', event => { checkSender(event); return filmAudio.list(); });
async function requireGameForAssetOperation(){const game=await gameDirectory.status();if(assetCache.hasPinnedVisual()&&game.state!=='valid')throw Error('当前 Player 正在使用缓存，不能切换游戏目录；请先停用并重启');return gameDialogs.requireDirectory();}
ipcMain.handle('assets:film-prepare',async event=>{checkSender(event);if(assetCache.isBusy()||assetSettingsDialogOpen)throw Error('资产设置或解包正在进行');const game=await requireGameForAssetOperation();if(!game)return null;return audioBuilder.start(game);});
ipcMain.handle('assets:film-prepare-status',event=>{checkSender(event);return audioBuilder.getStatus();});
ipcMain.handle('assets:inventory-start',async event=>{checkSender(event);const game=await requireGameForAssetOperation();if(!game)return null;return gameInventory.start(game);});
ipcMain.handle('assets:inventory-status',event=>{checkSender(event);return gameInventory.getStatus();});
ipcMain.handle('assets:inventory-cancel',event=>{checkSender(event);return gameInventory.cancel();});
let assetSettingsDialogOpen=false,filmReads=0;
async function withFilmRead(action){if(assetSettingsDialogOpen)throw Error('资产设置正在进行，请稍后重试');filmReads++;try{return await action();}finally{filmReads--;}}
function ensureAssetSettingsIdle(){if(filmReads||assetSettingsDialogOpen||assetCache.isBusy()||audioBuilder.getStatus().state==='running')throw Error('素材准备或资产设置正在进行，请先等待或停止');}
async function withAssetSettingsDialog(action){ensureAssetSettingsIdle();assetSettingsDialogOpen=true;try{return await action();}finally{assetSettingsDialogOpen=false;}}
const assetSettings=require('./asset-settings').create({cache:assetCache,gameDirectory,validateGame:require('./game-directory').validate,dialog,window:()=>win});
async function chooseGameDirectory(){return withAssetSettingsDialog(()=>assetSettings.game());}
ipcMain.handle('assets:settings-visual-disable',event=>{checkSender(event);return withAssetSettingsDialog(()=>assetCache.disableVisual());});
ipcMain.handle('assets:settings-info',event=>{checkSender(event);return assetCache.info();});
ipcMain.handle('assets:settings-stats',event=>{checkSender(event);return assetCache.stats();});
ipcMain.handle('assets:settings-game',event=>{checkSender(event);return chooseGameDirectory();});
ipcMain.handle('assets:settings-cache',event=>{checkSender(event);return withAssetSettingsDialog(()=>assetSettings.directory());});
ipcMain.handle('assets:settings-clear',event=>{checkSender(event);return withAssetSettingsDialog(()=>assetSettings.clear());});
ipcMain.handle('assets:settings-partial-audio',event=>{checkSender(event);return withAssetSettingsDialog(()=>assetCache.usePartialAudio());});
ipcMain.handle('assets:settings-start',event=>{checkSender(event);return withAssetSettingsDialog(()=>assetSettings.start());});
ipcMain.handle('assets:settings-cancel',async event=>{checkSender(event);if(assetSettingsDialogOpen)throw Error('请先完成当前资产设置确认');assetSettingsDialogOpen=true;try{return await assetSettings.cancel();}finally{assetSettingsDialogOpen=false;}});
ipcMain.handle('assets:settings-review',(event,options)=>{checkSender(event);return withAssetSettingsDialog(()=>assetSettings.review({force:options?.force===true}));});
ipcMain.handle('assets:film-preview', (event,id) => { checkSender(event);if(closing)throw Error('工作台正在关闭');return filmAudioPreview.url(id); });
ipcMain.handle('assets:film-import', async (event,ids,projectId) => { checkSender(event);return withFilmRead(async()=>{const entries=await filmAudio.resolveEntries(ids);return importAssets(event,entries.map(x=>x.file),projectId,entries);}); });
ipcMain.handle('assets:drop', (event,files,projectId)=>importAssets(event,files,projectId));
ipcMain.handle('assets:choose', async (event,projectId)=>{checkSender(event);const choice=await dialog.showOpenDialog(win,{title:'导入图片、视频或音乐',properties:['openFile','multiSelections'],filters:[{name:'图片、视频和音乐',extensions:['png','jpg','jpeg','webp','gif','mp4','mov','webm','mkv','wav','mp3','ogg','m4a']}]});if(choice.canceled)return null;return importAssets(event,choice.filePaths,projectId);});
ipcMain.handle('window:metrics', event => { checkSender(event); return {contentSize:win.getContentSize(), bounds:win.getBounds(), contentBounds:win.getContentBounds(), views:win.contentView.children.map(view=>view.getBounds())}; });
ipcMain.on('app:edit', (event, command) => { try { checkSender(event); if(['undo','redo','copy','paste'].includes(command))win.webContents[command](); } catch (_) {} });
ipcMain.handle('video:choose', async event => {
  checkSender(event);
  const choice=await dialog.showSaveDialog(win,{title:'导出视频',defaultPath:'演出.mp4',filters:[{name:'MP4 视频',extensions:['mp4']}],properties:['showOverwriteConfirmation']});
  if(choice.canceled||!choice.filePath)return null;
  const file=path.resolve(choice.filePath), parent=fs.realpathSync(path.dirname(file)), target=path.join(parent,path.basename(file));
  await writeGuard.assertWritable(parent);
  if(currentProject && target.toLowerCase()===path.resolve(currentProject.file).toLowerCase())throw Error('不能覆盖当前工程');
  return target;
});
ipcMain.handle('project:open', async event => {
  checkSender(event);
  const choice=await dialog.showOpenDialog(win,{title:'打开工程',properties:['openFile'],filters:[{name:'演出工程',extensions:['json']}]});
  if(choice.canceled) return null;
  const file=choice.filePaths[0], result=await store.read(file);
  currentProject={file,hash:result.hash};
  return {document:result.doc,name:path.basename(file)};
});
ipcMain.handle('project:save', async (event, document, saveAs) => {
  checkSender(event); store.validate(document);
  let file=currentProject?.file, expected=currentProject?.hash ?? null;
  if(saveAs || !file) {
    const choice=await dialog.showSaveDialog(win,{title:'保存工程',defaultPath:'演出工程.json',filters:[{name:'演出工程',extensions:['json']}],properties:['showOverwriteConfirmation']});
    if(choice.canceled || !choice.filePath) return null;
    file=choice.filePath;
    expected=currentProject && path.resolve(file).toLowerCase()===path.resolve(currentProject.file).toLowerCase()?currentProject.hash:null;
  }
  const hash=await store.write(file,document,expected,writeGuard.assertWritable); currentProject={file,hash};
  return {name:path.basename(file)};
});
ipcMain.handle('project:forget', event => { checkSender(event); currentProject=null; });
ipcMain.handle('project:confirm-unsaved', async event => {
  checkSender(event);
  const choice=await dialog.showMessageBox(win,{type:'warning',title:'未保存的更改',message:'当前工程有未保存的更改。',detail:'保存后再继续，或放弃本次更改。',buttons:['保存','放弃更改','取消'],defaultId:0,cancelId:2,noLink:true});
  return ['save','discard','cancel'][choice.response] || 'cancel';
});
ipcMain.on('project:close-result', (event, approved) => {
  try { checkSender(event); } catch { return; }
  closePending=false;
  if(!approved || closing) return;
  closing=true; shutdownHost().finally(() => { if(win&&!win.isDestroyed()) win.destroy(); app.quit(); });
});

function killHostTree() {
  if (!host || host.exitCode !== null || !host.pid) return;
  const killer = spawn('taskkill', ['/pid', String(host.pid), '/t', '/f'], {windowsHide:true, stdio:'ignore'});
  killer.on('error', () => host.kill());
}
async function shutdownHost() {
  voices.cancel();
  const hostDone=new Promise(resolve => {
    if (!host || host.exitCode !== null) return resolve();
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
    host.once('exit', finish);
    const timer = setTimeout(() => { killHostTree(); finish(); }, 5000);
    if (!sessionUrl) { killHostTree(); return; }
    const url = new URL(sessionUrl);
    const token = url.pathname.split('/')[1];
    const req = http.request({hostname:'127.0.0.1', port:url.port, path:`/${token}/shutdown`, method:'POST',
      headers:{'Origin':url.origin, 'Content-Type':'application/json', 'Content-Length':'2'}}, res => res.resume());
    req.on('error', () => { killHostTree(); finish(); });
    req.end('{}');
  });
  await Promise.allSettled([hostDone,costumeThumbnails.close(),motionThumbnails.close(),filmAudioPreview.close(),audioBuilder.close(),gameInventory.close(),...(pendingCostumeSave?[pendingCostumeSave]:[])]);
  if(host&&host.exitCode===null){await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve();};host.once('exit',finish);const timer=setTimeout(finish,10000);killHostTree();});}
  const retainLease=Boolean(host&&host.exitCode===null);if(retainLease)console.error('Player 宿主尚未退出，保留缓存占用标记');
  try{await assetCache.close({retainLease});}catch(error){console.error(error.message);if(win&&!win.isDestroyed())await dialog.showMessageBox(win,{type:'warning',title:'缓存清理未完成',message:error.message,detail:'未清理的文件已保留；下次打开该缓存目录时会重试。'});}
}

function launchHost(window, bundles, player, legacyListen, visual) {
  return new Promise((resolve, reject) => {
    const handle = window.getNativeWindowHandle();
    const hwnd = handle.length >= 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
    const args=['-u', path.join(root,'host.py'), '--catalog-root', visual.catalog, '--parent-hwnd', hwnd, '--no-browser'];
    if(player) args.push('--player',player);
    if(process.argv.includes('--no-cloth'))args.push('--no-cloth');
    if(legacyListen) args.push('--legacy-listen');
    host = spawn(process.env.CREATOR_PYTHON || (fs.existsSync(bundledPython)?bundledPython:'python'), args, {cwd:root, windowsHide:true, stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    let settled = false, connected = false, errors = '';
    const timer = setTimeout(() => fail(new Error('Player 启动超时')), 120000);
    function fail(error) { if (settled) return; settled = true; clearTimeout(timer); reject(error); }
    host.stderr.on('data', data => { errors = (errors + data.toString()).slice(-6000); });
    host.once('error', fail);
    host.once('exit', code => {
      if (!settled) fail(new Error(`Player 宿主退出 (${code})\n${errors}`));
      else if (connected && !closing && win && !win.isDestroyed()) dialog.showErrorBox('Unity 预览已退出', errors || `宿主退出 (${code})`);
    });
    readline.createInterface({input:host.stdout}).on('line', line => {
      if (!line.startsWith('Editor: ')) return;
      try {
        const url = new URL(line.slice(8));
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.searchParams.has('embedded')) throw Error('Unexpected host URL');
        if (settled) return;
        settled=true; connected=true; clearTimeout(timer); sessionUrl=url.toString(); resolve(sessionUrl);
      } catch (e) { fail(e); }
    });
  });
}

ipcMain.handle('assets:setup-status',event=>{checkSender(event);if(!setupMode)throw Error('不是资源准备窗口');return setupReason;});
ipcMain.handle('assets:setup-restart',async event=>{checkSender(event);if(!setupMode)throw Error('不是资源准备窗口');const info=await assetCache.info();if(wizard.busy()||assetCache.isBusy()||!info.visualNext)throw Error('请等待资源准备完成');closing=true;await shutdownHost();app.relaunch();app.quit();});

ipcMain.handle('setup:info',event=>{checkSender(event);return wizard.info();});
ipcMain.handle('setup:download',(event,ids,accepted)=>{checkSender(event);return wizard.start(ids,accepted);});
ipcMain.handle('setup:cancel',event=>{checkSender(event);wizard.cancel();});
ipcMain.handle('setup:finish',(event,engine)=>{checkSender(event);return wizard.finish(engine);});
ipcMain.handle('setup:data',async event=>{checkSender(event);if(!setupMode)throw Error('请在初始化向导选择');const target=await wizard.chooseData();if(!target)return;const base=runtime.base;await writeGuard.assertWritable(base);await fs.promises.mkdir(base,{recursive:true});await fs.promises.writeFile(path.join(base,'location.json'),JSON.stringify({directory:target}));process.env.CREATOR_LIBRARY_DIR=target;closing=true;await shutdownHost();app.relaunch();app.quit();});

async function openAssetSetup(reason){
  setupMode=true;setupReason=reason;rendererReady=false;
  if(!win)win=new BrowserWindow({width:1000,height:850,minWidth:800,minHeight:600,title:'演出工作台 · 资产准备',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'preload.js')}});
  win.setMenu(null);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  const file=path.join(runtime.ui,'asset-setup.html');sessionUrl=require('node:url').pathToFileURL(file).toString();
  win.webContents.on('will-navigate',(event,url)=>{if(url!==sessionUrl)event.preventDefault();});
  await win.loadURL(sessionUrl);
}

async function start() {
  if (process.platform !== 'win32') throw Error('此窗口嵌入实验仅支持 Windows');
  await assetCache.initialise();
  if(!(await wizard.read()).completed){await openAssetSetup('欢迎使用 GSS，请完成初始化向导。');return;}
  let visual;
  try{visual=await assetCache.pinVisual();}
  catch(error){await openAssetSetup(error.message);return;}
  if(!visual){const info=await assetCache.info();await openAssetSetup(info.warning||'尚无可用的解包资源，请选择游戏目录并准备资源。');return;}
  const playerArg = process.argv.indexOf('--player');
  const player = playerArg >= 0 && process.argv[playerArg+1] ? path.resolve(process.argv[playerArg+1]) : null;
  const bundles=path.join(visual.view,'characters');previewCatalog=visual.catalog;
  previewBundles=bundles;previewPlayer=player||runtime.player;
  win = new BrowserWindow({width:1440,height:900,minWidth:900,minHeight:650,autoHideMenuBar:false,
    title:'演出工作台 · Electron 原型', backgroundColor:'#202226', show:process.env.CREATOR_CONTROL_HIDDEN!=='1',
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,preload:path.join(__dirname,'preload.js')}});
  const command = name => {if(win && !win.isDestroyed() && rendererReady)win.webContents.send('app:menu',name);};
  win.setMenu(Menu.buildFromTemplate([
    {label:'文件',submenu:[{label:'新建工程',accelerator:'CmdOrCtrl+N',click:()=>command('new')},{label:'打开工程…',accelerator:'CmdOrCtrl+O',click:()=>command('open')},{type:'separator'},{label:'保存工程',accelerator:'CmdOrCtrl+S',click:()=>command('save')},{label:'工程另存为…',accelerator:'CmdOrCtrl+Shift+S',click:()=>command('save-as')},{type:'separator'},{label:'导出视频…',click:()=>command('export-video')},{type:'separator'},{label:'退出',click:()=>win.close()}]},
    {label:'编辑',submenu:[{label:'撤销',accelerator:'CmdOrCtrl+Z',click:()=>command('undo')},{label:'重做',accelerator:'CmdOrCtrl+Shift+Z',click:()=>command('redo')},{type:'separator'},{role:'cut',label:'剪切'},{label:'复制',accelerator:'CmdOrCtrl+C',click:()=>command('copy')},{label:'粘贴',accelerator:'CmdOrCtrl+V',click:()=>command('paste')},{role:'selectAll',label:'全选'}]},
    {label:'素材',submenu:[{label:'选择游戏目录…',click:()=>{chooseGameDirectory().catch(error=>dialog.showErrorBox('游戏目录',error.message));}},{label:'检查本地游戏素材…',click:()=>command('game-inventory')}]},
    {label:'视图',submenu:[{label:'重置布局',click:()=>command('reset-layout')}]},
    {label:'设置',submenu:[{label:'编辑器设置…',click:()=>command('editor-settings')},{label:'工程设置…',click:()=>command('project-settings')}]},
    {label:'剧本',submenu:[{label:'翻译全部对白…',click:()=>command('translate-script')}]}
  ]));
  win.setMenuBarVisibility(true);
  if(process.env.CREATOR_TEST_INSTANCE) win.webContents.on('page-title-updated', event => {event.preventDefault();win.setTitle(process.env.CREATOR_TEST_TITLE || '演出工作台 · 工程测试');});
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  win.webContents.on('will-navigate', (event, url) => { if (sessionUrl && url !== sessionUrl) event.preventDefault(); });
  win.webContents.once('did-finish-load', () => { rendererReady=true; });
  win.on('close', event => {
    if (closing) return;
    event.preventDefault();
    if(setupMode||!rendererReady) { closing=true; shutdownHost().finally(() => { if (!win.isDestroyed()) win.destroy(); app.quit(); }); return; }
    if(!closePending) { closePending=true; win.webContents.send('project:request-close'); }
  });
  let url;
  try{url=await launchHost(win,bundles,player,process.argv.includes('--legacy-listen'),visual);}
  catch(error){
    const failedHost=host;
    if(failedHost&&failedHost.exitCode===null){await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve();};failedHost.once('exit',finish);const timer=setTimeout(finish,10000);killHostTree();});if(failedHost.exitCode===null)throw Error('预览进程尚未退出：'+error.message);}
    assetCache.rejectVisual(error.message);previewCatalog=null;previewBundles=null;previewPlayer=null;
    await openAssetSetup('解包资源预览启动失败：'+error.message);return;
  }
  if (!closing && !win.isDestroyed()) await win.loadURL(url);
  if(!process.env.CREATOR_TEST_INSTANCE&&!closing&&!win.isDestroyed()){
    await gameDialogs.promptOnStartup();
    try{await require('./translation-startup').offer({translation,dialog,window:()=>win,openSettings:()=>command('editor-settings'),active:()=>!closing&&!win.isDestroyed()});}catch(error){dialog.showErrorBox('翻译设置',error.message);}
  }
  if(controlToken){const raw=process.env.CREATOR_CONTROL_PORT||'0';if(!/^\d{1,5}$/.test(raw)||Number(raw)>65535)throw Error('控制端口无效');controlServer=require('./control-server').create({token:controlToken,dispatch:dispatchControl});const address=await controlServer.listen(Number(raw));process.stdout.write('CREATOR_CONTROL_READY '+JSON.stringify({host:'127.0.0.1',port:address.port})+'\n');}

}
app.whenReady().then(async()=>{await require('./bundled-resources').install(runtime.common,runtime.data(),writeGuard.assertWritable);await start();}).catch(async error => {
  if(process.env.CREATOR_TEST_INSTANCE&&process.env.CREATOR_CONTROL_HIDDEN==='1')console.error('CREATOR_TEST_START_ERROR '+error.stack);
  else dialog.showErrorBox('创作器启动失败', error.message);
  closing=true; await shutdownHost(); app.quit();
});
app.on('window-all-closed', () => { if (!closing) { closing=true; shutdownHost().finally(() => app.quit()); } });

app.on('will-quit',()=>{wizard.cancel();require('./visual-media').close();});



