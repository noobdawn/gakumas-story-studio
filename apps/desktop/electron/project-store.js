const postEffects=require('../ui/post-effects.js');
'use strict';
const screenMedia=require('../ui/screen-media');
const composition=require('../ui/composition');
const timelineEdit=require('../ui/timeline-edit');
const story=require('../ui/story-timeline');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const originalLoop=require('./original-loop');
const layoutSchema=require('../ui/layout-schema');
const animationLayers=require('../ui/animation-layers');
const renderSettings=require('../ui/render-settings');
const characterColors=require('../ui/character-colors');
const FORMAT = 'gakumas-creator-project';
const MAX_BYTES = 32 * 1024 * 1024;
const PRETTY_MAX_BYTES = 1024 * 1024;
const text = x => typeof x === 'string' && x.length <= 4096;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const vector = x => Array.isArray(x) && x.length === 3 && x.every(finite);
const list = x => Array.isArray(x) && x.length <= 10000;
const obj = x => x && typeof x === 'object' && !Array.isArray(x);
function requireValid(ok, message) { if (!ok) throw new Error('工程格式无效：' + message); }

function validate(doc) {
  requireValid(obj(doc) && doc.format === FORMAT && doc.version === 1 && obj(doc.state), '不支持的格式或版本');
  if(doc.uiLayout!==undefined) requireValid(layoutSchema.valid(doc.uiLayout), '界面布局');
  const s=doc.state;
  requireValid(s.version===1 && list(s.objects) && list(s.tracks) && list(s.assets) && list(s.dialogues), '缺少对象、轨道、素材或对话');
  if(s.globalSettings?.render!==undefined)renderSettings.normalize(s.globalSettings.render);
  const duration=s.globalSettings?.duration??30, fps=s.globalSettings?.fps??30, aspect=s.globalSettings?.aspect??'16:9';
  requireValid(finite(duration)&&duration>=1&&duration<=3600&&[24,25,30,60].includes(fps)&&['16:9','9:16','1:1','4:3'].includes(aspect), '演出设置');
  if(s.globalSettings?.exportQuality!==undefined)requireValid(['720','1080'].includes(s.globalSettings.exportQuality),'导出分辨率');
  if(s.globalSettings?.exportSupersampling!==undefined)requireValid([1,2].includes(s.globalSettings.exportSupersampling),'导出超采样');
  requireValid(finite(s.current) && s.current>=0 && s.current<=duration && finite(s.fov), '播放时间或 FOV');
  if(s.projectId!==undefined) requireValid(typeof s.projectId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.projectId), '工程标识');
  if(s.sceneId!==undefined) requireValid(s.sceneId===null||(typeof s.sceneId==='string'&&/^(?:2d-env_2d_|3d-env_3d_)[A-Za-z0-9_-]{1,160}$/.test(s.sceneId))||['trainingroom','classroom','courtyard','dormitory','rooftop'].includes(s.sceneId), '场景素材');
  if(s.globalSettings!==undefined) { const g=s.globalSettings; requireValid(obj(g)&&typeof g.outlineEnabled==='boolean'&&finite(g.outlineWidth)&&g.outlineWidth>=0&&g.outlineWidth<=0.3&&typeof g.physicsEnabled==='boolean', '全局属性'); }
  if(s.hiddenAssetIds!==undefined)requireValid(list(s.hiddenAssetIds)&&s.hiddenAssetIds.every(x=>text(x)&&x.length>0)&&new Set(s.hiddenAssetIds).size===s.hiddenAssetIds.length,'已移除素材');
  if(s.hiddenSceneProps!==undefined)requireValid(list(s.hiddenSceneProps)&&s.hiddenSceneProps.every(x=>/^(?:classroom-chair-[0-5]|classroom-prop-\d{1,2}-\d{1,2})$/.test(x))&&new Set(s.hiddenSceneProps).size===s.hiddenSceneProps.length,'已删除道具');
  const objectIds=new Set(), trackIds=new Set(), clipIds=new Set(), assetIds=new Set(), dialogueIds=new Set();
  for (const o of s.objects) {
    if(o?.mediaLayout!==undefined)screenMedia.validateLayout(o.mediaLayout);
    requireValid(obj(o)&&text(o.id)&&o.id.length>0&&!objectIds.has(o.id)&&text(o.name)&&text(o.type)&&text(o.icon)&&list(o.components)&&o.components.every(text), '场景对象');
    requireValid(o.parent===null||text(o.parent), '对象父级');
    if(o.transform!==undefined) requireValid(obj(o.transform)&&vector(o.transform.position)&&vector(o.transform.rotation)&&(o.transform.scale===undefined||['角色','道具'].includes(o.type)&&vector(o.transform.scale)&&o.transform.scale.every(v=>v>=0.01&&v<=100)), '对象变换');
    if(o.propId!==undefined) requireValid(o.type==='道具'&&o.parent==='scene'&&obj(o.transform)&&/^(?:classroom-chair-[0-5]|classroom-prop-\d{1,2}-\d{1,2})$/.test(o.propId)&&!s.objects.some(other=>other!==o&&other?.propId===o.propId), '场景椅子');
    if(o.idleAssetId!==undefined) requireValid(text(o.idleAssetId)&&o.idleAssetId.length>0, '待机动画素材');
    if(o.costumeAssetId!==undefined) requireValid(o.type==='角色'&&typeof o.costumeAssetId==='string'&&/^asset-costume-[0-9a-f]{24}$/.test(o.costumeAssetId), '角色服装素材');
    if(o.residentLayers!==undefined)requireValid(o.type==='角色'&&Array.isArray(o.residentLayers)&&o.residentLayers.length<=32&&o.residentLayers.every(animationLayers.validateResident)&&new Set(o.residentLayers.map(x=>x.id)).size===o.residentLayers.length,'常驻叠加');
    if(o.inheritBodyFace!==undefined)requireValid(typeof o.inheritBodyFace==='boolean','继承动作表情');
    if(o.visible!==undefined) requireValid(typeof o.visible==='boolean', '对象显示状态');
    if(o.physicsEnabled!==undefined) requireValid(typeof o.physicsEnabled==='boolean', '衣物物理设置');
    if(o.fov!==undefined) requireValid(finite(o.fov)&&o.fov>=15&&o.fov<=90, '相机 FOV');
    objectIds.add(o.id);
  }
  requireValid(objectIds.has('scene'), '缺少场景容器');
  for(const o of s.objects) requireValid(o.parent===null||objectIds.has(o.parent), '对象父级不存在');
  for(const a of s.assets) { if(a?.nameColor!==undefined||a?.nameColorEnd!==undefined)requireValid(a.type==='角色'&&characterColors.custom(a),'角色姓名条颜色'); if(a?.visual!==undefined)screenMedia.validateInfo(a.visual); requireValid(obj(a)&&text(a.id)&&!assetIds.has(a.id)&&text(a.type)&&text(a.source)&&text(a.alias), '素材'); if(a.scope!==undefined)requireValid(a.scope==='project'&&a.projectId===s.projectId&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(a.id)&&['.png','.jpg','.jpeg','.webp','.gif','.mp4','.mov','.webm','.mkv','.wav','.mp3','.ogg','.m4a'].includes(a.extension), '工程素材'); if(a.filmAudio!==undefined){const v=a.filmAudio;requireValid(a.extension==='.wav'&&['音乐','音效'].includes(a.type)&&obj(v)&&typeof v.catalogId==='string'&&/^(bank|unity):[0-9a-f]{64}$/.test(v.catalogId)&&typeof v.name==='string'&&v.name.length<=500&&typeof v.source==='string'&&v.source.length<=100&&(v.streamName===undefined||typeof v.streamName==='string'&&v.streamName.length<=500)&&(v.originalLoop===undefined||originalLoop.valid(v.originalLoop,true)),'本地音频来源');} if(a.voiceTiming!==undefined){const v=a.voiceTiming;requireValid(a.extension==='.wav'&&obj(v)&&finite(v.frameRate)&&v.frameRate>0&&v.frameRate<=1000&&Number.isSafeInteger(v.frameCount)&&v.frameCount>0&&v.frameCount<=1000000&&list(v.phonemes)&&v.phonemes.every((p,i,all)=>obj(p)&&typeof p.phoneme==='string'&&/^[A-Za-z]{1,10}$/.test(p.phoneme)&&Number.isSafeInteger(p.startFrame)&&Number.isSafeInteger(p.endFrame)&&p.startFrame>=0&&p.startFrame<p.endFrame&&p.endFrame<=v.frameCount&&(i===0||p.startFrame>=all[i-1].endFrame)),'语音音素时间');} assetIds.add(a.id); }
  for(const d of s.dialogues) {
    requireValid(obj(d)&&text(d.id)&&!dialogueIds.has(d.id)&&text(d.speaker)&&text(d.text)&&text(d.voice)&&typeof d.linked==='boolean', '对话');
    if(d.voiceSource!==undefined&&d.voiceSource!==null){const v=d.voiceSource;requireValid(obj(v)&&text(v.id)&&text(v.name)&&text(v.styleName)&&text(v.model)&&text(v.modelId)&&text(v.version)&&((v.provider==='voicevox'&&/^voicevox:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.id)&&Number.isSafeInteger(v.styleId)&&v.styleId>=0)||(v.provider==='sovits'&&/^sovits:[a-z0-9_-]+$/i.test(v.id)&&text(v.styleId)&&v.styleId.length>0)),'合成音源');}
    if(d.uiStyle!==undefined)requireValid(['box','subtitle','game'].includes(d.uiStyle),'对话 UI');
    if(d.nameColor!==undefined||d.nameColorEnd!==undefined)requireValid(typeof d.nameColor==='string'&&/^#[0-9a-f]{6}$/i.test(d.nameColor)&&typeof d.nameColorEnd==='string'&&/^#[0-9a-f]{6}$/i.test(d.nameColorEnd),'对白姓名条颜色');
    if(d.typewriter!==undefined)requireValid(typeof d.typewriter==='boolean','逐字显示');
    if(d.revealRate!==undefined)requireValid(finite(d.revealRate)&&d.revealRate>=1&&d.revealRate<=60,'逐字显示速度');
    if(d.language!==undefined)requireValid(['all_ja','zh'].includes(d.language),'对白语言');
    if(d.translation!==undefined)requireValid(obj(d.translation)&&typeof d.translation.text==='string'&&d.translation.text.length<=1000&&typeof d.translation.sourceText==='string'&&d.translation.sourceText.length<=500&&typeof d.translation.sourceSpeaker==='string'&&d.translation.sourceSpeaker.length<=100,'对白译文');
    if(d.cookedFor!==undefined)requireValid(obj(d.cookedFor)&&text(d.cookedFor.text)&&obj(d.cookedFor.reference)&&text(d.cookedFor.reference.id)&&['all_ja','zh'].includes(d.cookedFor.language)&&(d.cookedFor.spokenText===undefined||typeof d.cookedFor.spokenText==='string'&&d.cookedFor.spokenText.length<=1000)&&(d.cookedFor.synthesisText===undefined||typeof d.cookedFor.synthesisText==='string'&&d.cookedFor.synthesisText.length<=1000),'语音生成记录');
    if(d.pendingVoice!==undefined)requireValid(obj(d.pendingVoice)&&text(d.pendingVoice.assetId)&&assetIds.has(d.pendingVoice.assetId)&&text(d.pendingVoice.reason)&&(d.pendingVoice.request===undefined||obj(d.pendingVoice.request)&&text(d.pendingVoice.request.text)&&obj(d.pendingVoice.request.reference)), '待处理语音');
    dialogueIds.add(d.id);
  }
  for(const t of s.tracks) {
    requireValid(obj(t)&&text(t.id)&&!trackIds.has(t.id)&&text(t.name)&&text(t.type)&&text(t.target)&&objectIds.has(t.target)&&list(t.clips), '轨道'); trackIds.add(t.id);
    if(t.type==='media')requireValid(s.objects.find(o=>o.id===t.target)?.type==='画面'&&!s.tracks.some(other=>other!==t&&other.type==='media'&&other.target===t.target),'画面图层轨道');
    if(t.uiLayer!==undefined)requireValid(t.type==='ui'&&typeof t.uiLayer==='boolean','UI 子轨道');
    if(t.layerRole!==undefined)requireValid(['animation','expression'].includes(t.type)&&['base','overlay','legacy'].includes(t.layerRole),'动画层类型');
    if(t.layerRole==='base')requireValid(!s.tracks.some(other=>other!==t&&other.layerRole==='base'&&other.type===t.type&&other.target===t.target),'重复基础轨道');
    if(t.enabled!==undefined) requireValid(typeof t.enabled==='boolean', '轨道开关');
    if(t.locked!==undefined) requireValid(typeof t.locked==='boolean', '轨道锁定');
    for(const c of t.clips) {
      requireValid(obj(c)&&text(c.id)&&!clipIds.has(c.id)&&text(c.name)&&finite(c.start)&&finite(c.len)&&c.start>=0&&c.len>0&&c.start+c.len<=3600.001, '片段'); clipIds.add(c.id);
      if(c.uiKind!==undefined)requireValid(t.type==='ui'&&(c.uiKind==='transition'&&text(c.assetId)||c.uiKind==='code')&&(c.targetSceneId===undefined||typeof c.targetSceneId==='string'&&c.targetSceneId.length<=160&&/^[a-zA-Z0-9_-]*$/.test(c.targetSceneId)),'UI 转场片段');
      if(c.uiKind==='code')require('../ui/code-ui').validate(c.codeUI);
      if(c.codeUI!==undefined)requireValid(t.type==='ui'&&c.uiKind==='code','代码 UI 片段');
      if(c.loop!==undefined) requireValid(typeof c.loop==='boolean', '动作循环');
      if(c.layerPlayback!==undefined)requireValid(t.type==='animation'&&typeof c.layerPlayback==='boolean','分层动作播放');
      if(c.blendMode!==undefined)requireValid(t.type==='animation'&&t.layerRole==='overlay'&&['additive','override'].includes(c.blendMode),'动画混合方式');
      if(c.scope!==undefined)requireValid(t.type==='animation'&&animationLayers.scopes.includes(c.scope),'动画作用范围');
      if(c.playback!==undefined)requireValid(t.type==='expression'&&['hold','loop'].includes(c.playback),'表情播放方式');
      if(c.audioLoop!==undefined) requireValid(t.type==='audio'&&!c.dialogue&&typeof c.audioLoop==='boolean', '音频循环');
      if(c.originalLoop!==undefined) requireValid(t.type==='audio'&&!c.dialogue&&c.audioLoop===true&&originalLoop.valid(c.originalLoop,true),'原始循环点');
      if(c.weight!==undefined) requireValid(finite(c.weight)&&c.weight>=0&&c.weight<=100, '表情权重');
      for(const key of ['fadeIn','fadeOut'])if(c[key]!==undefined)requireValid(finite(c[key])&&c[key]>=0&&c[key]<=3600, '音频淡入淡出');
      if(['animation','expression'].includes(t.type)&&(c.fadeIn!==undefined||c.fadeOut!==undefined))requireValid((c.fadeIn??0)+(c.fadeOut??0)<=c.len+0.001,'动作或表情渐变');
      if(c.volume!==undefined) requireValid(finite(c.volume)&&c.volume>=0&&c.volume<=1, '片段音量');
      if(c.sourceOffset!==undefined) requireValid(finite(c.sourceOffset)&&c.sourceOffset>=0&&c.sourceOffset<=3600, '片段源偏移');
      if(c.lipSyncSource!==undefined)requireValid(t.type==='expression'&&obj(c.lipSyncSource)&&text(c.lipSyncSource.audioClipId)&&c.lipSyncSource.audioClipId.length>0&&text(c.lipSyncSource.signature)&&c.lipSyncSource.signature.length>0,'口型来源');
      if(c.lipVisemes!==undefined)requireValid(t.type==='expression'&&obj(c.lipSyncSource)&&obj(c.lipVisemes)&&Object.keys(c.lipVisemes).length===5&&['a','i','u','e','o'].every(v=>typeof c.lipVisemes[v]==='string'&&/^b_mouth\.mouth_\d{3}$/.test(c.lipVisemes[v]))&&new Set(Object.values(c.lipVisemes)).size===5,'音素嘴形');
      if(c.lipEdited!==undefined)requireValid(typeof c.lipEdited==='boolean','手工口型标记');
      if(c.lipGeneration!==undefined)requireValid(text(c.lipGeneration)&&c.lipGeneration.length>0,'口型生成标识');
      if(c.lipMode!==undefined)requireValid(obj(c.lipSyncSource)&&['amplitude','phoneme','manual'].includes(c.lipMode)&&((c.lipMode==='amplitude')===(c.lipVisemes===undefined)),'口型模式');
      if(c.dialogue!==undefined) requireValid(text(c.dialogue)&&dialogueIds.has(c.dialogue), '对话引用');
      screenMedia.validateClip(c);if(t.type==='media')screenMedia.layout(s.objects.find(o=>o.id===t.target),c,0);
      if(c.propertyKeys!==undefined) {
        requireValid(obj(c.propertyKeys), '关键帧');
        for(const [property,keys] of Object.entries(c.propertyKeys)) {
          requireValid((['position','rotation','scale','fov','visible','weight'].includes(property)||(c.lipVisemes&&/^viseme_[aiueo]$/.test(property)))&&(property!=='scale'||t.type==='transform'&&['角色','道具'].includes(s.objects.find(o=>o.id===t.target)?.type))&&list(keys), '关键帧属性');
          for(const key of keys) requireValid(obj(key)&&finite(key.time)&&key.time>=0&&key.time<=c.len+0.001&&(property==='visible' ? typeof key.value==='boolean' : property==='weight'||property.startsWith('viseme_') ? finite(key.value)&&key.value>=0&&key.value<=100 : property==='fov' ? finite(key.value)&&key.value>=15&&key.value<=90 : property==='scale'?vector(key.value)&&key.value.every(v=>v>=0.01&&v<=100):vector(key.value)), '关键帧值');
        }
      }
    }
  }
  requireValid((s.selected===null||text(s.selected)&&objectIds.has(s.selected))&&(s.selectedClip===null||text(s.selectedClip)&&clipIds.has(s.selectedClip)), '选择状态');
  requireValid(obj(doc.resources)&&doc.resources.character==='ttmr-casl-0002-prepared', '当前原型只能打开手毬资源工程');
  timelineEdit.validate(s);story.validateLayout(s);postEffects.validate(s);composition.validate(s);
  return doc;
}
function parse(raw) {
  requireValid(Buffer.byteLength(raw,'utf8')<=MAX_BYTES, '文件超过 32 MB');
  try { return validate(JSON.parse(raw)); } catch(e) { if(e instanceof SyntaxError) throw new Error('工程不是有效的 JSON'); throw e; }
}
function hash(raw) { return crypto.createHash('sha256').update(raw).digest('hex'); }
function serialize(doc) {
  const pretty=JSON.stringify(doc,null,2)+'\n';
  const raw=Buffer.byteLength(pretty,'utf8')<=PRETTY_MAX_BYTES ? pretty : JSON.stringify(doc)+'\n';
  if(Buffer.byteLength(raw,'utf8')>MAX_BYTES) throw Error('工程超过 32 MB');
  return raw;
}
async function read(file) {
  const stat=await fs.stat(file); if(!stat.isFile()||stat.size>MAX_BYTES) throw new Error('工程文件不存在或超过 32 MB');
  const raw=await fs.readFile(file,'utf8'); return {doc:parse(raw),hash:hash(raw)};
}
async function assertSafeDestination(file) {
  await require('./write-guard').create(require('./runtime-paths').data()).assertWritable(file);
}
async function write(file, doc, expectedHash, assertWritable=async()=>{}) {
  validate(doc); await assertSafeDestination(file);await assertWritable(path.dirname(file));
  const raw=serialize(doc);
  if(expectedHash!==null) {
    let existing;
    try { existing=await fs.readFile(file,'utf8'); } catch(e) { if(e.code==='ENOENT') throw new Error('工程文件已被移走，请另存为'); throw e; }
    if(hash(existing)!==expectedHash) throw new Error('工程文件已被外部修改，请另存为以保留两份内容');
  }
  const temp=path.join(path.dirname(file),'.'+path.basename(file)+'.'+crypto.randomUUID()+'.tmp');
  try { await fs.writeFile(temp,raw,{encoding:'utf8',flag:'wx'}); await fs.rename(temp,file); }
  catch(e) { await fs.unlink(temp).catch(()=>{}); throw e; }
  return hash(raw);
}
async function writeNew(file,doc,assertWritable=async()=>{}){
 validate(doc);await assertSafeDestination(file);await assertWritable(path.dirname(file));const raw=serialize(doc);
 const temp=path.join(path.dirname(file),'.'+path.basename(file)+'.'+crypto.randomUUID()+'.tmp');
 try{await fs.writeFile(temp,raw,{encoding:'utf8',flag:'wx'});await fs.link(temp,file);}finally{await fs.unlink(temp).catch(()=>{});}
 return hash(raw);
}
module.exports={FORMAT,validate,parse,read,write,writeNew};
