'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const store = require('../project-store');
function sample() {
 return {format:store.FORMAT,version:1,resources:{character:'ttmr-casl-0002-prepared'},state:{version:1,selected:'cam',selectedClip:null,current:1,fov:35,
  objects:[{id:'scene',name:'场景',type:'场景',icon:'box',parent:null,components:[]},{id:'ttmr',name:'手毬',type:'角色',icon:'user',parent:'scene',components:[]},{id:'cam',name:'相机',type:'相机',icon:'camera',parent:'scene',components:['camera'],transform:{position:[0,1,3],rotation:[0,180,0]},fov:35}],
  tracks:[{id:'camera',name:'镜头',type:'camera',target:'cam',clips:[{id:'clip',name:'镜头',start:0,len:10,propertyKeys:{fov:[{time:0,value:35},{time:4,value:60}]}}]}],assets:[],dialogues:[]}};
}
test('导出分辨率可随工程保存，旧工程兼容并拒绝无效选项',()=>{
 const doc=sample();doc.state.globalSettings={outlineEnabled:true,outlineWidth:.15,physicsEnabled:false};assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
 for(const quality of ['720','1080']){doc.state.globalSettings.exportQuality=quality;assert.deepEqual(store.parse(JSON.stringify(doc)),doc);}
 doc.state.globalSettings.exportQuality='2160';assert.throws(()=>store.validate(doc),/导出分辨率/);
});
test('角色服装引用随工程往返并拒绝无效对象或标识', () => {
 const doc=sample(),actor=doc.state.objects.find(o=>o.id==='ttmr');actor.costumeAssetId='asset-costume-0123456789abcdef01234567';assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
 actor.costumeAssetId='asset-costume-../invalid';assert.throws(()=>store.validate(doc),/角色服装/);delete actor.costumeAssetId;
 doc.state.objects.find(o=>o.id==='cam').costumeAssetId='asset-costume-0123456789abcdef01234567';assert.throws(()=>store.validate(doc),/角色服装/);
});
test('教室椅子引用和变换可保存，拒绝重复或未知椅子',()=>{
 const doc=sample(),chair={id:'chair',name:'教室折叠椅',type:'道具',icon:'box',parent:'scene',components:[],propId:'classroom-chair-4',transform:{position:[.2,0,.2],rotation:[0,90,0]}};
 doc.state.objects.push(chair);assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
 chair.propId='classroom-chair-9';assert.throws(()=>store.validate(doc),/场景椅子/);chair.propId='classroom-chair-4';
 doc.state.objects.push({...chair,id:'chair2'});assert.throws(()=>store.validate(doc),/场景椅子/);doc.state.objects.pop();
 delete chair.transform;assert.throws(()=>store.validate(doc),/场景椅子/);
});
test('动作和表情渐变可保存，拒绝负数与重叠并兼容旧片段',()=>{
 const doc=sample();for(const type of ['animation','expression']){
  const clip={id:type+'-clip',name:type,start:0,len:2};doc.state.tracks.push({id:type+'-track',name:type,type,target:'ttmr',clips:[clip]});
  assert.deepEqual(store.parse(JSON.stringify(doc)),doc);clip.fadeIn=.4;clip.fadeOut=.5;assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
  clip.fadeIn=-.1;assert.throws(()=>store.validate(doc),/淡入淡出/);clip.fadeIn=1.6;assert.throws(()=>store.validate(doc),/渐变/);clip.fadeIn=.4;
 }
});
test('普通音频循环可保存，拒绝对白、其他轨道及无效值',()=>{
 const doc=sample(),clip={id:'music',name:'音乐',start:0,len:3,audioLoop:true};doc.state.tracks.push({id:'music-track',name:'音乐',type:'audio',target:'scene',clips:[clip]});
 assert.deepEqual(store.parse(JSON.stringify(doc)),doc);clip.audioLoop=false;assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
 clip.audioLoop='yes';assert.throws(()=>store.validate(doc),/音频循环/);clip.audioLoop=true;clip.dialogue='dialogue';assert.throws(()=>store.validate(doc),/音频循环/);
 delete clip.dialogue;doc.state.tracks.at(-1).type='animation';assert.throws(()=>store.validate(doc),/音频循环/);
});
test('原始音频循环范围随片段保存，拒绝损坏数据和非循环片段',()=>{
 const doc=sample(),clip={id:'original',name:'音效',start:0,len:3,audioLoop:true,originalLoop:{start:2,end:100,sampleRate:48000,frames:120,sha256:'a'.repeat(64)}};doc.state.tracks.push({id:'original-track',name:'音效',type:'audio',target:'scene',clips:[clip]});assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
 clip.originalLoop.end=121;assert.throws(()=>store.validate(doc),/原始循环点/);clip.originalLoop.end=100;clip.audioLoop=false;assert.throws(()=>store.validate(doc),/原始循环点/);
});
test('本地音频来源可随工程往返且拒绝无效来源',()=>{
 const doc=sample(),projectId='11111111-1111-4111-8111-111111111111';doc.state.projectId=projectId;
 const asset={id:'22222222-2222-4222-8222-222222222222',type:'音效',source:'cue',alias:'',scope:'project',projectId,extension:'.wav',filmAudio:{catalogId:'bank:'+'a'.repeat(64),name:'bank #1',source:'ACB 音频',streamName:'cue'}};doc.state.assets.push(asset);
 assert.deepEqual(store.parse(JSON.stringify(doc)),doc);asset.filmAudio.catalogId='../../bad';assert.throws(()=>store.validate(doc),/本地音频来源/);delete asset.filmAudio;assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
});
test('大量关键帧可紧凑保存并在保留大小上限时重开', async () => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'creator-project-large-')),file=path.join(dir,'project.json');
 try {
  const doc=sample();for(let i=0;i<240;i++)doc.state.tracks.push({id:'large-'+i,name:'表情',type:'expression',target:'ttmr',clips:[{id:'large-clip-'+i,name:'表情',start:0,len:60,propertyKeys:{weight:Array.from({length:1000},(_,j)=>({time:j/20,value:j%100}))}}]});
  assert.ok(Buffer.byteLength(JSON.stringify(doc,null,2))>5*1024*1024);
  await store.writeNew(file,doc);assert.ok((await fs.stat(file)).size>5*1024*1024);assert.ok((await fs.stat(file)).size<32*1024*1024);assert.deepEqual((await store.read(file)).doc,doc);
 } finally {await fs.unlink(file).catch(()=>{});await fs.rmdir(dir);}
});
test('自动口型来源能往返，旧工程保持兼容', () => {
 const doc=sample();doc.state.tracks.push({id:'mouth',name:'口型',type:'expression',target:'ttmr',clips:[{id:'lip',name:'口型',start:0,len:2,lipSyncSource:{audioClipId:'audio-clip',signature:'example'}}]});
 assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
 doc.state.tracks.at(-1).clips[0].lipSyncSource.audioClipId=42;assert.throws(()=>store.validate(doc),/口型来源/);
});
test('音素时间与五元音口型能够保存并拒绝越界数据', () => {
 const doc=sample(),pid='11111111-1111-4111-8111-111111111111';doc.state.projectId=pid;
 doc.state.assets.push({id:'22222222-2222-4222-8222-222222222222',type:'音效',source:'voice',alias:'',scope:'project',projectId:pid,extension:'.wav',voiceTiming:{frameRate:93.75,frameCount:100,phonemes:[{phoneme:'a',startFrame:10,endFrame:20}]}});
 doc.state.tracks.push({id:'phoneme',name:'音素',type:'expression',target:'ttmr',clips:[{id:'viseme',name:'口型',start:0,len:2,lipSyncSource:{audioClipId:'voice',signature:'example'},lipVisemes:{a:'b_mouth.mouth_003',i:'b_mouth.mouth_004',u:'b_mouth.mouth_010',e:'b_mouth.mouth_012',o:'b_mouth.mouth_008'},propertyKeys:{viseme_a:[{time:.1,value:85}]}}]});
 assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
 doc.state.tracks.at(-1).clips[0].lipVisemes.i='b_mouth.mouth_003';assert.throws(()=>store.validate(doc),/音素嘴形/);doc.state.tracks.at(-1).clips[0].lipVisemes.i='b_mouth.mouth_004';
 doc.state.assets[0].voiceTiming.phonemes[0].endFrame=101;assert.throws(()=>store.validate(doc),/音素时间/);
});
test('工程往返保存并拒绝覆盖外部修改', async () => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'creator-project-test-')), file=path.join(dir,'project.json');
 try {
  const document=sample(), first=await store.write(file,document,null), loaded=await store.read(file);
  assert.equal(loaded.hash,first); assert.deepEqual(loaded.doc,document);
  document.state.tracks[0].clips[0].propertyKeys.fov[1].value=55;
  const second=await store.write(file,document,first);
  assert.deepEqual((await store.read(file)).doc,document);
  await fs.writeFile(file,'external changes','utf8');
  await assert.rejects(store.write(file,document,second),/外部修改/);
  assert.equal(await fs.readFile(file,'utf8'),'external changes');
 } finally { await fs.unlink(file).catch(()=>{}); await fs.rmdir(dir); }
});
test('拒绝错误版本、缺失对象和无效关键帧', () => {
 const wrong=sample(); wrong.version=2; assert.throws(()=>store.validate(wrong),/版本/);
 const missing=sample(); missing.state.objects=missing.state.objects.filter(x=>x.id!=='cam'); assert.throws(()=>store.validate(missing),/轨道/);
 const invalid=sample(); invalid.state.tracks[0].clips[0].propertyKeys.fov[0].value=200; assert.throws(()=>store.validate(invalid),/关键帧/);
 assert.throws(()=>store.parse('{broken'),/JSON/);
});

test('动作片段的源偏移和衣物开关可保存，并拒绝无效值', async () => {
 const document=sample();
 document.state.objects.find(o=>o.id==='ttmr').physicsEnabled=true;
 document.state.tracks.push({id:'motion',name:'动作',type:'animation',target:'ttmr',clips:[{id:'motion-clip',name:'本地动作',assetId:'asset-local-shy',start:2,len:1,sourceOffset:0.5}]});
 assert.deepEqual(store.parse(JSON.stringify(document)),document);
 document.state.tracks[1].clips[0].sourceOffset=-1;
 assert.throws(()=>store.validate(document),/源偏移/);
 document.state.tracks[1].clips[0].sourceOffset=0;
 document.state.objects.find(o=>o.id==='ttmr').physicsEnabled='yes';
 assert.throws(()=>store.validate(document),/衣物物理/);
});

test('全局设置和独立选择状态能够往返，旧工程继续有效', () => {
 const legacy=sample(); assert.deepEqual(store.parse(JSON.stringify(legacy)),legacy);
 const doc=sample(); doc.state.selected=null; doc.state.selectedClip='clip';
 doc.state.globalSettings={outlineEnabled:false,outlineWidth:0.24,physicsEnabled:true};
 assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
 doc.state.selected='ttmr'; assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
 doc.state.globalSettings.outlineWidth=0.31; assert.throws(()=>store.validate(doc),/全局属性/);
});

test('工程内媒体、场景和角色实例可保存并恢复', () => {
 const doc=sample();doc.state.projectId='123e4567-e89b-42d3-a456-426614174000';doc.state.sceneId='classroom';
 doc.state.assets.push({id:'123e4567-e89b-42d3-a456-426614174001',type:'贴图',alias:'',source:'sample.png',scope:'project',projectId:doc.state.projectId,extension:'.png'});
 doc.state.objects.push({id:'actor-instance',assetId:'asset-actor-1',name:'月村手毬 2',type:'角色',icon:'user',parent:'scene',components:[],transform:{position:[1,0,0],rotation:[0,0,0]}});
 assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
 doc.state.assets[0].projectId='123e4567-e89b-42d3-a456-426614174999';assert.throws(()=>store.validate(doc),/工程素材/);
});

test('演出设置和可见性、表情关键帧能够保存，缩短演出不会丢弃片段', () => {
 const doc=sample();
 doc.state.globalSettings={outlineEnabled:true,outlineWidth:0.15,physicsEnabled:false,duration:5,fps:25,aspect:'9:16'};
 doc.state.current=4;
 doc.state.objects.find(o=>o.id==='cam').visible=true;
 doc.state.tracks[0].clips[0].propertyKeys.visible=[{time:0,value:true},{time:6,value:false}];
 doc.state.tracks.push({id:'face',name:'表情',type:'expression',target:'ttmr',clips:[{id:'face-clip',name:'嘴部',start:8,len:2,weight:80,propertyKeys:{weight:[{time:0,value:0},{time:1,value:100}]}}]});
 assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
 doc.state.globalSettings.fps=29;assert.throws(()=>store.validate(doc),/演出设置/);
 doc.state.globalSettings.fps=25;doc.state.tracks[0].clips[0].propertyKeys.visible[1].value=1;assert.throws(()=>store.validate(doc),/关键帧/);
});

test('多个研究动作片段和编辑后的关键帧能够往返保存', () => {
 const doc=sample();
 doc.state.globalSettings={outlineEnabled:true,outlineWidth:0.15,physicsEnabled:false,duration:12,fps:30,aspect:'16:9'};
 doc.state.tracks[0].clips[0].propertyKeys.fov[1].time=3.5;
 doc.state.tracks.push({id:'motion',name:'动作编排',type:'animation',target:'ttmr',clips:[
  {id:'idle',name:'待机',assetId:'asset-local-idle',start:0,len:1},
  {id:'angry',name:'生气',assetId:'asset-local-angry',start:1,len:1.9,loop:true},
  {id:'yes',name:'肯定',assetId:'asset-local-yes',start:3,len:1.5}
 ]});
 assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
});

test('对白保存合成音源、语气和已有音频，缺失音源仍能恢复引用', () => {
 const doc=sample();
 const selection={id:'voicevox:388f246b-8c41-4ac1-8e2d-5d79f3ff56d9',provider:'voicevox',name:'ずんだもん',styleId:3,styleName:'ノーマル',model:'0.vvm',modelId:'7cb1e0dd-718f-41d7-889b-1b1307dc4727',version:'0.17.0'};
 doc.state.dialogues.push({id:'dialogue',speaker:'月村手毬',text:'こんにちは',voice:'local-audio-reference',voiceSource:selection,linked:true});
 assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
 doc.state.dialogues[0].voiceSource.styleId='3';assert.throws(()=>store.validate(doc),/合成音源/);
 doc.state.dialogues[0].voiceSource={id:'sovits:manbo',provider:'sovits',name:'曼波讲故事',styleId:'default',styleName:'默认',model:'',modelId:'',version:'v2'};
 assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
});

test('对白样式、逐字效果、语音生成记录与关联片段可往返',()=>{
 const doc=sample(),reference={id:'voicevox:388f246b-8c41-4ac1-8e2d-5d79f3ff56d9',provider:'voicevox',name:'ずんだもん',styleId:3,styleName:'普通',model:'0.vvm',modelId:'model',version:'v1'};
 doc.state.dialogues.push({id:'d1',speaker:'月村手毬',text:'こんにちは',voice:'audio',linked:true,uiStyle:'subtitle',typewriter:true,revealRate:12,language:'all_ja',voiceSource:reference,cookedFor:{text:'こんにちは',reference,language:'all_ja'}});
 doc.state.tracks.push({id:'ui-dialogue',name:'UI（对话）',type:'dialogue',target:'ttmr',clips:[{id:'ui-clip',name:'对白',start:0,len:5,dialogue:'d1'}]},{id:'audio-dialogue',name:'音效（对话）',type:'audio',target:'ttmr',clips:[{id:'audio-clip',name:'语音',start:0,len:5,dialogue:'d1'}]});
 assert.deepEqual(store.parse(JSON.stringify(doc)),doc);doc.state.dialogues[0].revealRate=0;assert.throws(()=>store.validate(doc),/逐字显示速度/);
});


test('独立眉眼和嘴部形变轨道可保存并恢复',()=>{
 const doc=sample();
 doc.state.tracks.push({id:'brow-track',name:'眉',type:'expression',target:'ttmr',clips:[{id:'brow-clip',name:'眉形变',assetId:'asset-face-b_brow.brow_001',start:0,len:2,weight:60,propertyKeys:{weight:[{time:0,value:0},{time:1,value:60}]}}]}, {id:'mouth-track',name:'口型',type:'expression',target:'ttmr',clips:[{id:'mouth-clip',name:'嘴形变',assetId:'asset-face-b_mouth.mouth_002',start:0,len:2,weight:80}]});
 assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
});


test('第二角色及独立动作和面部轨道可保存并恢复',()=>{
 const doc=sample();doc.state.objects.push({id:'kotone-1',assetId:'asset-actor-fktn',name:'藤田ことね',type:'角色',icon:'user',parent:'scene',components:['animation','expression'],transform:{position:[0,0,0],rotation:[0,0,0]}});
 doc.state.tracks.push({id:'kotone-motion',name:'动作',type:'animation',target:'kotone-1',clips:[{id:'kotone-motion-clip',name:'害羞',assetId:'asset-local-shy',start:0,len:2}]},{id:'kotone-face',name:'表情',type:'expression',target:'kotone-1',clips:[{id:'kotone-face-clip',name:'嘴形',assetId:'asset-face-b_mouth.mouth_002',start:0,len:2,weight:60}]});
 assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
});


test('控制接口新建工程不覆盖已有文件',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'creator-new-project-')),file=path.join(dir,'project.json');
 try{await store.writeNew(file,sample());const original=await fs.readFile(file,'utf8');await assert.rejects(store.writeNew(file,sample()),/EEXIST/);assert.equal(await fs.readFile(file,'utf8'),original);}
 finally{await fs.unlink(file).catch(()=>{});await fs.rmdir(dir);}
});


test('角色待机素材标识随工程往返并拒绝无效类型',()=>{
 const doc=sample();const actor=doc.state.objects.find(o=>o.id==='ttmr');actor.idleAssetId='asset-film-1234567890abcdef12345678';assert.deepEqual(store.parse(JSON.stringify(doc)),doc);actor.idleAssetId=12;assert.throws(()=>store.validate(doc),/待机动画/);
});


test('可选界面布局随工程往返；旧工程兼容，损坏布局拒绝',()=>{
 const doc=sample();assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
 doc.uiLayout={version:1,root:{type:'split',direction:'horizontal',ratio:.3,first:{type:'group',tabs:['hierarchy','inspector'],active:'hierarchy'},second:{type:'group',tabs:['preview','timeline','assets'],active:'preview'}}};
 assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
 doc.uiLayout.root.second.tabs.push('hierarchy');assert.throws(()=>store.validate(doc),/界面布局/);doc.uiLayout.root.second.tabs.pop();
 doc.uiLayout.root.ratio=0;assert.throws(()=>store.validate(doc),/界面布局/);doc.uiLayout.root.ratio=.3;
 doc.uiLayout.root.first.active='preview';assert.throws(()=>store.validate(doc),/界面布局/);
});


test('对白姓名条渐变颜色往返并拒绝无效值',()=>{const doc=sample();doc.state.dialogues.push({id:'color-d',speaker:'燐羽',text:'你好',voice:'',linked:true,nameColor:'#54566c',nameColorEnd:'#778899'});assert.deepEqual(store.parse(JSON.stringify(doc)),doc);doc.state.dialogues[0].nameColorEnd='#bad';assert.throws(()=>store.validate(doc),/对白姓名条颜色/);delete doc.state.dialogues[0].nameColorEnd;assert.throws(()=>store.validate(doc),/对白姓名条颜色/);});


test('对象缩放与缩放关键帧往返并拒绝非法范围',()=>{const doc=sample(),actor=doc.state.objects.find(o=>o.id==='ttmr');actor.transform={position:[0,0,0],rotation:[0,0,0],scale:[1,2,.5]};doc.state.tracks.push({id:'scale-t',name:'变换',type:'transform',target:'ttmr',clips:[{id:'scale-c',name:'缩放',start:0,len:5,propertyKeys:{scale:[{time:0,value:[1,1,1]},{time:4,value:[1,2,.5]}]}}]});assert.deepEqual(store.parse(JSON.stringify(doc)),doc);actor.transform.scale[0]=0;assert.throws(()=>store.validate(doc),/对象变换/);actor.transform.scale[0]=1;doc.state.tracks.at(-1).clips[0].propertyKeys.scale[0].value[0]=101;assert.throws(()=>store.validate(doc),/关键帧值/);doc.state.tracks.at(-1).clips[0].propertyKeys.scale[0].value[0]=1;doc.state.tracks.at(-1).type='camera';assert.throws(()=>store.validate(doc),/关键帧属性/);});

test('缓存 2D 和 3D 场景 ID 可保存，拒绝路径注入',()=>{for(const id of ['2d-env_2d_adv_dormitory-amaoroom-00-noon','2d-env_2d_all_classroom-00-01-noon_c00','3d-env_3d_adv_classroom-00-00-night']){const d=sample();d.state.sceneId=id;store.validate(d);}const d=sample();d.state.sceneId='2d-../../outside';assert.throws(()=>store.validate(d));});
