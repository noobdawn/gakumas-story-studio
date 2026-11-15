'use strict';
const {contextBridge, ipcRenderer, webUtils} = require('electron');
contextBridge.exposeInMainWorld('projectAPI', Object.freeze({
  open: () => ipcRenderer.invoke('project:open'),
  startup: () => ipcRenderer.invoke('project:startup'),
  startupDone: applied => ipcRenderer.invoke('project:startup-done',Boolean(applied)),
  chooseVideo: () => ipcRenderer.invoke('video:choose'),
  windowMetrics: () => ipcRenderer.invoke('window:metrics'),
  edit: name => ipcRenderer.send('app:edit', name),
  onMenu: callback => ipcRenderer.on('app:menu', (_event, name) => callback(name)),
  save: (document, saveAs) => ipcRenderer.invoke('project:save', document, Boolean(saveAs)),
  forget: () => ipcRenderer.invoke('project:forget'),
  confirmUnsaved: () => ipcRenderer.invoke('project:confirm-unsaved'),
  onCloseRequest: callback => ipcRenderer.on('project:request-close', () => callback()),
  closeResult: approved => ipcRenderer.send('project:close-result', Boolean(approved))
}));

contextBridge.exposeInMainWorld('assetAPI',Object.freeze({
 onImportProgress:callback=>ipcRenderer.on('assets:import-progress',(_event,info)=>callback(info)),
 listShared:()=>ipcRenderer.invoke('assets:list-shared'),
 deleteFile:asset=>ipcRenderer.invoke('assets:delete-file',asset),
 reveal:asset=>ipcRenderer.invoke('assets:reveal',asset),
 filmList:()=>ipcRenderer.invoke('assets:film-list'),
 filmPrepare:()=>ipcRenderer.invoke('assets:film-prepare'),
 filmPrepareStatus:()=>ipcRenderer.invoke('assets:film-prepare-status'),
 inventoryStart:()=>ipcRenderer.invoke('assets:inventory-start'),
 inventoryStatus:()=>ipcRenderer.invoke('assets:inventory-status'),
 inventoryCancel:()=>ipcRenderer.invoke('assets:inventory-cancel'),
 setupStatus:()=>ipcRenderer.invoke('assets:setup-status'),setupRestart:()=>ipcRenderer.invoke('assets:setup-restart'),
 settingsVisualDisable:()=>ipcRenderer.invoke('assets:settings-visual-disable'),settingsInfo:()=>ipcRenderer.invoke('assets:settings-info'),
 settingsStats:()=>ipcRenderer.invoke('assets:settings-stats'),
 settingsGame:()=>ipcRenderer.invoke('assets:settings-game'),
 settingsCache:()=>ipcRenderer.invoke('assets:settings-cache'),
 settingsClear:()=>ipcRenderer.invoke('assets:settings-clear'),
 settingsPartialAudio:()=>ipcRenderer.invoke('assets:settings-partial-audio'),settingsStart:options=>ipcRenderer.invoke('assets:settings-start',options),
 settingsCancel:()=>ipcRenderer.invoke('assets:settings-cancel'),
 settingsReview:options=>ipcRenderer.invoke('assets:settings-review',options),
 filmPreview:id=>ipcRenderer.invoke('assets:film-preview',id),
 filmImport:(ids,projectId)=>ipcRenderer.invoke('assets:film-import',ids,projectId),
 motionPreview:id=>ipcRenderer.invoke('assets:motion-preview',id),
 motionThumbnails:ids=>ipcRenderer.invoke('assets:motion-thumbnails',ids),
 thumbnails:()=>ipcRenderer.invoke('assets:thumbnails'),
 costumeThumbnails:ids=>ipcRenderer.invoke('assets:costume-thumbnails',ids),
 costumeThumbnail:assetId=>ipcRenderer.invoke('assets:costume-thumbnail',assetId),
 saveThumbnail:(assetId,dataUrl)=>ipcRenderer.invoke('assets:save-thumbnail',assetId,dataUrl),
 visualInfo:asset=>ipcRenderer.invoke('assets:visual-info',asset),
 preview:asset=>ipcRenderer.invoke('assets:preview',asset),
 audioStatus:asset=>ipcRenderer.invoke('assets:audio-status',asset),
 originalLoop:asset=>ipcRenderer.invoke('assets:original-loop',asset),
 restoreAudio:asset=>ipcRenderer.invoke('assets:restore-audio',asset),
 pathForFile:file=>webUtils.getPathForFile(file),
 importDropped:(paths,projectId)=>ipcRenderer.invoke('assets:drop',paths,projectId),
 choose:projectId=>ipcRenderer.invoke('assets:choose',projectId)
}));

contextBridge.exposeInMainWorld('voiceAPI',Object.freeze({
 list:()=>ipcRenderer.invoke('voices:list'),
 rename:(id,alias)=>ipcRenderer.invoke('voices:rename',id,alias),
 preview:(id,styleId)=>ipcRenderer.invoke('voices:preview',id,styleId),
 pronunciationRead:()=>ipcRenderer.invoke('voices:pronunciation-read'),
 pronunciationSave:(rules,revision)=>ipcRenderer.invoke('voices:pronunciation-save',rules,revision),
 cook:(projectId,reference,text,language)=>ipcRenderer.invoke('voices:cook',projectId,reference,text,language)
}));

contextBridge.exposeInMainWorld('translationAPI',Object.freeze({
 read:()=>ipcRenderer.invoke('translation:read'),
 save:settings=>ipcRenderer.invoke('translation:save',settings),
 translate:lines=>ipcRenderer.invoke('translation:run',lines)
}));

if (process.env.CREATOR_CONTROL_TOKEN) contextBridge.exposeInMainWorld('controlAPI',Object.freeze({
 onCommand:handler=>ipcRenderer.on('control:command',async (_event,seq,command,args)=>{try{const result=await handler(command,args);ipcRenderer.send('control:result',seq,{ok:true,result});}catch(error){ipcRenderer.send('control:result',seq,{ok:false,error:String(error?.message||error)});}}),
 saveNew:(file,doc)=>ipcRenderer.invoke('control:save-new',file,doc),
 load:file=>ipcRenderer.invoke('control:load',file),
 checkOutput:file=>ipcRenderer.invoke('control:output',file),
 filmAudioList:()=>ipcRenderer.invoke('control:film-audio-list'),
 importFilmAudio:(ids,projectId)=>ipcRenderer.invoke('control:film-audio-import',ids,projectId),
 close:()=>ipcRenderer.send('control:close')
}));

contextBridge.exposeInMainWorld('setupAPI',Object.freeze({info:()=>ipcRenderer.invoke('setup:info'),data:()=>ipcRenderer.invoke('setup:data'),download:(ids,accepted)=>ipcRenderer.invoke('setup:download',ids,accepted),cancel:()=>ipcRenderer.invoke('setup:cancel'),finish:engine=>ipcRenderer.invoke('setup:finish',engine)}));
