(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const gameAliasRows=globalThis.CreatorGameAliasRows||{};
  const defaultGameAlias=a=>CreatorGameAliases.lookup(gameAliasRows,a)??a.alias;
  let draggedAssetId=null,assetDragRefreshPending=false;
  // One query can match words across an asset's alias, original name and other searchable fields.
  const searchTerms = value => value.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  function matchesSearch(value,terms){if(!terms.length)return true;const text=value.toLocaleLowerCase();return terms.every(term=>text.includes(term));}
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const id = () => (globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  let duration=30, fps=30, frame=1/30;
  const components = [
    {key:'world',name:'演出画面',icon:'camera',desc:'相机拍摄的实时演出输出',color:'#7faec7'},
    {key:'visualFilter',name:'滤镜',icon:'sliders',desc:'颜色风格与独立持续区间',color:'#9385cc'},
    {key:'media',name:'画面（图片 / 视频）',icon:'image',desc:'固定在画布上的图片与视频图层',color:'#7faec7'},
    {key:'expression', name:'表情', icon:'spark', desc:'选择完整表情、形变或特效，插入当前时间', color:'#e69c85'},
    {key:'animation', name:'身体动画', icon:'film', desc:'为对象添加动作片段', color:'#91aa93'},
    {key:'transform', name:'位移／旋转／缩放', icon:'box', desc:'记录对象变换关键帧', color:'#99afce'},
    {key:'camera', name:'相机', icon:'camera', desc:'位置、旋转与 FOV', color:'#a7a6ca'},
    {key:'scene', name:'场景切换', icon:'box', desc:'在时间轴安排场景', color:'#b8ad8c'},
    {key:'visualEffect',name:'特效',icon:'sliders',desc:'独立效果片段，按作用范围串联',color:'#c6a4d5'},
    {key:'post', name:'渲染设置', icon:'sliders', desc:'调整光照、反射及后处理', color:'#cead80'},
    {key:'ui', name:'UI 叠加', icon:'spark', desc:'添加覆盖画面的 UI', color:'#c49ac4'},
    {key:'dialogue', name:'对话', icon:'chat', desc:'关联对话框与语音', color:'#d6a38c'},
    {key:'audio', name:'音效 / 音乐', icon:'music', desc:'添加音频片段', color:'#8cbcb2'}
  ];
  const initial = () => ({
    version:1, story:CreatorStory.blank(), selected:null, selectedClip:null, current:0, fov:35, globalSettings:{outlineEnabled:true,outlineWidth:0.15,physicsMode:'hybrid',physicsEnabled:true,duration:30,fps:30,aspect:'16:9'},
    objects:[{id:'scene',name:'空白场景',type:'场景',icon:'box',parent:null,components:[]},{id:'ttmr',name:'月村手毬',type:'角色',icon:'user',parent:'scene',components:['animation','expression']},{id:'kotone',name:'藤田琴音',type:'角色',icon:'user',parent:'scene',components:[]},{id:'cam',name:'主相机',type:'相机',icon:'camera',parent:'scene',components:['camera'],transform:{position:[0,1,3],rotation:[0,180,0]},fov:35},{id:'light',name:'场景光照',type:'灯光',icon:'spark',parent:'scene',components:['post']}],
    assets:[{id:'asset-actor-1',type:'角色',alias:'月村',source:'月村手毬'},{id:'asset-actor-2',type:'角色',alias:'藤田琴音',source:'藤田琴音'},{id:'asset-voice-1',type:'音源',alias:'月村',source:'演示音源 A'},{id:'asset-voice-2',type:'音源',alias:'琴音',source:'演示音源 B'},{id:'asset-motion-1',type:'动作',alias:'待机',source:'身体动画'},{id:'asset-motion-2',type:'动作',alias:'微笑',source:'表情数据'},{id:'asset-audio-1',type:'音效',alias:'午后 BGM',source:'演示音频'},{id:'asset-ui-1',type:'UI',alias:'普通对话框',source:'演示样式'}],
    dialogues:[{id:'dialogue-1',speaker:'月村手毬',text:'……今天也要加油。',voice:'asset-voice-1',linked:true}],
    tracks:[
      {id:'t-cam',name:'主相机',type:'camera',target:'cam',clips:[{id:'c-cam',name:'镜头 01',start:0,len:13}]},
      {id:'t-motion',name:'月村 · 身体动画',type:'animation',target:'ttmr',clips:[{id:'c-motion',name:'待机',start:1,len:13}]},
      {id:'t-expression',name:'月村 · 表情',type:'expression',target:'ttmr',clips:[{id:'c-expression',name:'微笑',start:6,len:5,weight:80}]},
      {id:'t-ui',name:'UI 叠加',type:'ui',target:'scene',clips:[{id:'c-ui',name:'淡入',start:0,len:2}]},
      {id:'t-dialogue-ui',name:'对话 UI',type:'dialogue',target:'ttmr',clips:[{id:'c-dialogue-ui',name:'月村手毬',start:4,len:6,dialogue:'dialogue-1'}]},
      {id:'t-dialogue-audio',name:'对话音频',type:'audio',target:'ttmr',clips:[{id:'c-dialogue-audio',name:'月村 · 语音',start:4,len:6,dialogue:'dialogue-1'}]},
      {id:'t-bgm',name:'音效 / 音乐',type:'audio',target:'scene',clips:[{id:'c-bgm',name:'午后 BGM',start:0,len:23}]},
      {id:'t-post',name:'后处理',type:'post',target:'light',clips:[{id:'c-post',name:'暖色调',start:0,len:20}]}
    ]
  });
  const performance = new URLSearchParams(location.search).get('performance')==='1';
  const faces = new URLSearchParams(location.search).get('faces')==='1';
  const idleSupported = new URLSearchParams(location.search).get('idle')==='1';
  const uiTransitionsSupported=new URLSearchParams(location.search).get('uiTransitions')==='2';
  let uiCatalog={entries:[]},uiCatalogError='',uiSceneGate=null;
  const animationLayersSupported = new URLSearchParams(location.search).get('animationLayers')==='1';
  let motionKindFilter='all';
  const motionBlendSupported = new URLSearchParams(location.search).get('motionBlend')==='1';
  const classroomChairsSupported = new URLSearchParams(location.search).get('classroomChairs')==='1';
  const classroomPropsSupported = new URLSearchParams(location.search).get('classroomProps')==='1';
  const classroomCatalog=(globalThis.CreatorClassroomProps||[]).map(p=>({...p,name:CreatorGameAliases.lookup(gameAliasRows,p)||p.name}));
  const faceShapeAssets=(new URLSearchParams(location.search).get('faceNames')||'').split(',').filter(x=>/^b_(brow|eye|iris|mouth)\.[a-z]+_\d{3}$/.test(x)).map(name=>({id:name==='b_mouth.mouth_001'?'asset-local-mouth':'asset-face-'+name,type:'表情',alias:'',source:name}));
  if(new URLSearchParams(location.search).get('faceDecals')==='1')for(const [name,label] of Object.entries({Shadow:'脸部阴影',Pale:'脸色苍白',LeftCheek:'左脸红',RightCheek:'右脸红',CheekWhole:'双颊脸红',LeftCheekLine:'左脸红线',RightCheekLine:'右脸红线',CheekLineWhole:'双颊脸红线'}))faceShapeAssets.push({id:'asset-face-decal.'+name,type:'表情',alias:label,source:'decal.'+name});
  if(new URLSearchParams(location.search).get('roundEyes')==='1')faceShapeAssets.push({id:'asset-face-effect.RoundEyes',type:'表情',alias:'圆眼惊讶',source:'effect.RoundEyes'});
  if(new URLSearchParams(location.search).get('headEffects')==='1')for(const [name,label] of Object.entries({Gloom:'惊讶阴影线',Drool:'口水贴片'}))faceShapeAssets.push({id:'asset-face-effect.'+name,type:'表情',alias:label,source:'effect.'+name});
  if(new URLSearchParams(location.search).get('eyeMaterials')==='1')for(const [name,label] of Object.entries({NoHighlight:'眼睛无高光',Sparkle:'眼睛闪闪',SparkleSmall:'眼睛细闪',Kiran:'眼睛闪光',Move:'眼睛移动图案',Heart:'爱心眼'}))faceShapeAssets.push({id:'asset-face-eyeMaterial.'+name,type:'表情',alias:label,source:'eyeMaterial.'+name});
  if(new URLSearchParams(location.search).get('eyeBones')==='1')for(const [name,label] of Object.entries({EyesLeft:'眼球向左（实验）',EyesRight:'眼球向右（实验）',EyesUp:'眼球向上（实验）',EyesDown:'眼球向下（实验）'}))faceShapeAssets.push({id:'asset-face-bone.'+name,type:'表情',alias:label,source:'bone.'+name});
  const actorNames={hski:'花海咲季',fktn:'藤田ことね',amao:'有村麻央',kllj:'葛城リーリヤ',kcna:'倉本千奈',ssmk:'紫雲清夏',shro:'篠澤広',hrnm:'姫崎莉波',hume:'花海佑芽',jsna:'十王星南',hmsz:'秦谷美鈴',atbm:'雨夜燕',nasr:'根緒亜紗里',krnh:'賀陽燐羽'};
  const availableActors=new Set((new URLSearchParams(location.search).get('actors')||'').split(',').filter(code=>Object.hasOwn(actorNames,code)));
  const missingActorShapes=new Set((new URLSearchParams(location.search).get('missingShapes')||'').split(','));
  const actorAssets=Object.entries(actorNames).filter(([code])=>availableActors.has(code)).map(([code,source])=>({id:'asset-actor-'+code,type:'角色',alias:'',source}));
  const actorCode=o=>o.id==='ttmr'||o.assetId==='asset-actor-1'?'ttmr':Object.hasOwn(actorNames,(o.assetId||'').replace(/^asset-actor-/,''))?(o.assetId||'').slice('asset-actor-'.length):null;
  const supportedActor=o=>o.type==='角色'&&Boolean(actorCode(o));
  const classroomChairs=[{position:[.709,0,1.591],rotation:[0,182.28,0]},{position:[1.734,0,.909],rotation:[0,0,0]},{position:[1.758,0,-.204],rotation:[0,9.67,0]},{position:[2.927,0,-.738],rotation:[0,184.23,0]},{position:[.462,0,.16],rotation:[0,178.2,0]},{position:[.442,0,.853],rotation:[0,197.01,0]}];
  const supportedProp=o=>o?.type==='道具'&&classroomCatalog.some(x=>x.id===o.propId);
  const missingProps=()=>state.objects.some(o=>o.type==='道具'&&o.propId&&(!supportedProp(o)||!classroomChairsSupported||(!/^classroom-chair-[0-5]$/.test(o.propId)&&!classroomPropsSupported)));
  function addClassroomChair(propId){
    const spec=classroomCatalog.find(x=>x.id===propId);if(!spec||!classroomChairsSupported||sceneAt()!=='classroom'||(!classroomPropsSupported&&!/^classroom-chair-[0-5]$/.test(propId)))throw Error('当前场景或 Player 不支持此道具');if(state.objects.some(o=>o.propId===propId))throw Error('该道具已添加');const before=copyState(),object={id:id(),name:spec.name,type:'道具',icon:'box',parent:'scene',components:[],propId,transform:{position:structuredClone(spec.position),rotation:structuredClone(spec.rotation)}};state.objects.push(object);state.hiddenSceneProps=(state.hiddenSceneProps||[]).filter(key=>key!==propId);state.selected=object.id;state.selectedClip=null;selectedAsset=null;remember(before);render();return object;
  }
  function removeClassroomChair(object){if(!supportedProp(object))throw Error('请选择教室道具');removeHierarchyObject(object.id);}

  const actorUnavailable=()=>state.objects.find(o=>o.type==='角色'&&(!actorCode(o)||(actorCode(o)!=='ttmr'&&!availableActors.has(actorCode(o)))));
  const shapeForActor=(object,assetId)=>{const shape=faceShapeDefinition(assetId);return shape&&!missingActorShapes.has(actorCode(object)+':'+shape.source)?shape:null;};
  const costumeSupported=new URLSearchParams(location.search).get('costumes')==='1';
  const costumePhysics=new URLSearchParams(location.search).get('costumePhysics')==='1';
  const hairPhysics=new URLSearchParams(location.search).get('hairPhysics')==='1';
  const pendingCostume=()=>state.objects.find(o=>supportedActor(o)&&o.costumeAssetId&&(!costumeSupported||!costumeDefinitions.find(a=>a.id===o.costumeAssetId)?.playerAvailable));
  function refreshCostumeStatus(){const el=document.querySelector('#bridge-status');if(!el||!el.textContent.startsWith('Unity 已应用'))return;const suffix=' · 所选服装尚未应用，预览为基础服';const current=el.textContent.replace(suffix,'');el.textContent=current+(pendingCostume()?suffix:'');}
  function setActorCostume(objectId,assetId){
    const actor=state.objects.find(o=>o.id===objectId);if(!actor||!supportedActor(actor))throw Error('请将服装放到已接入的角色上');
    const asset=assetId?costumeDefinitions.find(x=>x.id===assetId):null;
    if(assetId&&(!asset||!asset.bodyAvailable||!asset.dependenciesAvailable))throw Error('服装资源或依赖不可用');
    if(asset&&(!asset.knownCharacter||asset.character!==actorCode(actor)))throw Error('服装不属于此角色');
    const before=copyState(),next=asset&&!asset.currentDefault?asset.id:'';
    if(next)actor.costumeAssetId=next;else delete actor.costumeAssetId;
    if(JSON.stringify(before)!==JSON.stringify(state))remember(before);
    state.selected=actor.id;state.selectedClip=null;selectedAsset=null;render();
    notify(next?(costumeSupported&&asset.playerAvailable?'已记录服装，正在更新预览':'已记录服装；当前 Player 无法应用'): '已恢复基础服装');
  }
  const faceShapeDefinition=id=>faceShapeAssets.find(a=>a.id===id) || (faces&&id==='asset-local-mouth'?{id,source:'b_mouth.mouth_001'}:null);
  const faceIdForName=name=>name==='b_mouth.mouth_001'?'asset-local-mouth':'asset-face-'+name;
  const faceAvailability=asset=>{const shape=faceShapeDefinition(asset?.id);if(!shape)return null;const codes=['ttmr',...availableActors];return {supported:codes.filter(code=>!missingActorShapes.has(code+':'+shape.source)),total:codes.length};};

  const arrangement = new URLSearchParams(location.search).get('arrangement')==='1';
  const motionDefinitions=[
    {id:'asset-local-shy',motionId:'shy',alias:'害羞（本地样本）',source:'mot_all_chr_ttmr_tereru-002_in_b',length:3.5333335399627686},
    {id:'asset-local-idle',motionId:'idle',alias:'待机进入（本地样本）',source:'mot_all_chr_ttmr_idle-001_in_b',length:1},
    {id:'asset-local-angry',motionId:'angry',alias:'生气（本地样本）',source:'mot_all_chr_ttmr_angry-001_in_b',length:1.933333396911621},
    {id:'asset-local-yes',motionId:'yes',alias:'肯定（本地样本）',source:'mot_all_chr_cmmn_yes-003_in_b',length:1.5666667222976685}
  ];
  for(const definition of motionDefinitions)Object.assign(definition,{isPose:false,isAdditive:false,isLoop:false,overlayReady:false});
  const availableMotions=new Set((new URLSearchParams(location.search).get('motions')||(performance?'shy':'')).split(','));
  let filmMotionDefinitions=[],duplicateMotionIds=new Set(),filmMotionReady=Promise.resolve(),costumeDefinitions=[],costumeReady=Promise.resolve(),costumeError='',costumeThumbnailBusy=false,costumeBatch=false,costumeBatchRunning=false;
  const checkedCostumeThumbnails=new Set();
  let faceMotionDefinitions=[],faceMotionReady=Promise.resolve();
  let motionIndexSource=null,motionIndex=new Map();
  const motionDefinition=id=>{if(motionIndexSource!==filmMotionDefinitions){motionIndexSource=filmMotionDefinitions;motionIndex=new Map(filmMotionDefinitions.map(x=>[x.id,x]));}return motionDefinitions.find(x=>x.id===id&&availableMotions.has(x.motionId))||motionIndex.get(id);};
  let faceIndexSource=null,faceIndex=new Map();
  const faceMotionById=id=>{if(faceIndexSource!==faceMotionDefinitions){faceIndexSource=faceMotionDefinitions;faceIndex=new Map(faceMotionDefinitions.map(x=>[x.id,x]));}return faceIndex.get(id);};
  const dialogueStyles = new URLSearchParams(location.search).get('dialogueStyles')==='1';
  const gameDialogue = new URLSearchParams(location.search).get('gameDialogue')==='1';
  const editorGizmoSupported = new URLSearchParams(location.search).get('editorGizmo')==='1';
  const gizmoTrsSupported = new URLSearchParams(location.search).get('gizmoTrs')==='1';
  const editorGizmoTest = new URLSearchParams(location.search).get('editorGizmoTest')==='1';
  const dialogueColorsSupported = new URLSearchParams(location.search).get('dialogueColors')==='1';
  const defaultDialogueStyle=()=>gameDialogue?'game':'box';
  const videoExport = new URLSearchParams(location.search).get('export')==='1';
  const assetFeatures = new URLSearchParams(location.search).get('assets')==='1';
  const renderSettingsSupported = new URLSearchParams(location.search).get('renderSettings')==='1';
  const physicsAvailable = performance && new URLSearchParams(location.search).get('physicsAvailable')!=='0';
  const physicsModesSupported = new URLSearchParams(location.search).get('physicsModes')==='1';
  const globalSettingsSupported = new URLSearchParams(location.search).get('settings')==='1';
  function newProjectState() {
    const s=initial();
    if(animationLayersSupported)s.layerSchema=1;
    s.projectId=id(); s.sceneId=performance?'trainingroom':null;
    s.objects=s.objects.filter(o=>['scene','ttmr','cam'].includes(o.id));
    s.objects.find(o=>o.id==='ttmr').components=[];
    s.assets=s.assets.filter(a=>a.id==='asset-actor-1'); s.assets[0].alias='';
    s.dialogues=[]; s.tracks=s.tracks.filter(t=>t.id==='t-cam'); s.tracks[0].clips[0].len=1;s.tracks[0].clips[0].storyTiming={start:{unitId:'@story',edge:'start',offset:0},end:{unitId:'@story',edge:'end',offset:0},keys:'keep'};
    if(performance) {
      s.objects.find(o=>o.id==='scene').name='练习室（研究）';
      const actor=s.objects.find(o=>o.id==='ttmr'); actor.components=['animation']; actor.transform={position:[-1,0,0],rotation:[0,0,0]};
      s.objects.find(o=>o.id==='cam').transform.position=[-1,1,3];
      if(faces)s.assets.push({id:'asset-local-mouth',type:'表情',alias:'嘴部张合（研究）',source:'b_mouth.mouth_001'});
      s.assets.push({id:'asset-local-shy',type:'动作',alias:'害羞（本地样本）',source:'mot_all_chr_ttmr_tereru-002_in_b'});
    }
    CreatorComposition.initialize(s,id);return s;
  }
  const desktop=Boolean(window.projectAPI);
  if(desktop)document.body.classList.add('desktop-app');
  let assetCatalogRevision=0;
  let state = desktop ? newProjectState() : initial(), playing = false, lastTick = 0, assetFilter='全部', assetSourceFilter='all', selectedAsset=null, treeExpanded=true, snapEnabled=true, zoom=1, projectLabelTimer=0;
  const assetSelection=CreatorPanelSelection.create(),hierarchySelection=CreatorPanelSelection.create();
  // Multi-selection is a transient UI state; the project format retains its existing single selection.
  let selectedClipIds=new Set(), multiGroup='', trackLabelWidth=188;
  let storyUI,storyVoice;
  let timelineMode='select',editingScope='timeline',soloClipId=null,timelineEditBusy=false;
  const undoStack=[],redoStack=[];
  if(!desktop) try { const saved=JSON.parse(localStorage.getItem('creator-bridge-prototype-v1')); if(saved?.version===1 && Array.isArray(saved.objects) && Array.isArray(saved.tracks)) state=saved; } catch (_) {}
  if(!Array.isArray(state.dialogues)) state.dialogues=state.dialogue?[state.dialogue]:[];
  for(const track of state.tracks)if(track.type==='camera')for(const clip of track.clips){if(clip.keyframes?.length){clip.propertyKeys ||= {};clip.propertyKeys.fov ||= clip.keyframes;delete clip.keyframes;}}
  const exampleAssets=[{id:'demo-scene-room',type:'场景',alias:'',source:'练习室'},{id:'demo-texture-face',type:'贴图',alias:'手毬 · 脸部',source:'t_chr_ttmr-base-0000_fce_col',thumbnail:'../three-probe/local-assets/lookdev/t_chr_ttmr-base-0000_fce_col.png'},{id:'demo-texture-hair',type:'贴图',alias:'',source:'t_chr_ttmr-base-0000_hir_col_alp',thumbnail:'../three-probe/local-assets/lookdev/t_chr_ttmr-base-0000_hir_col_alp.png'}];
  if(!desktop)for(const a of exampleAssets)if(!state.assets.some(x=>x.id===a.id))state.assets.push(a);
  function normalizeState(s) { s.story ||=CreatorStory.blank();CreatorStory.validate(s); if(!s.projectId)s.projectId=id(); if(s.sceneId===undefined)s.sceneId=performance?'trainingroom':null; if(!s.globalSettings) s.globalSettings={outlineEnabled:true,outlineWidth:0.15,physicsEnabled:s.objects.find(o=>o.id==='ttmr')?.physicsEnabled===true}; Object.assign(s.globalSettings,CreatorRenderSettings.physicsSettings(CreatorRenderSettings.physicsMode(s.globalSettings))); s.globalSettings.duration ??=30;s.globalSettings.fps ??=30;s.globalSettings.aspect ??='16:9';s.globalSettings.render=CreatorRenderSettings.normalize(s.globalSettings.render); if(animationLayersSupported)CreatorAnimationLayers.normalize(s,id);CreatorUITransitions.migrate(s,id);CreatorTimelineEdit.prune(s);CreatorPostEffects.validate(s);CreatorComposition.validate(s);return s; }
  function syncTiming(){duration=state.globalSettings.duration;fps=state.globalSettings.fps;frame=1/fps;$('.viewport').style.aspectRatio=state.globalSettings.aspect.replace(':',' / ');$('.time-total').textContent='/ '+time(duration);}
  normalizeState(state);
  const layerUI=CreatorAnimationLayerUI({state:()=>state,id,esc,assets:()=>allAssets(),name:key=>assetDisplay(assetById(key)||motionDefinition(key)||faceMotionById(key)||faceShapeDefinition(key)||{source:'素材缺失：'+key}),motion:motionDefinition,face:faceMotionById,shape:faceShapeDefinition,layered:animationLayersSupported,actorSupported:supportedActor,prepare:prepareFaceMotion,supports:(o,name)=>!!shapeForActor(o,faceIdForName(name)),remember,render,notify:message=>notify(message),showModal,closeModal,manageResident,revealClip:revealExpressionClip,fps:()=>fps,duration:()=>duration,selectClip:key=>{state.selected=null;state.selectedClip=key;selectedAsset=null;}});
  const layerFacePending=new Map(),layerFaceErrors=new Map();
  function bodyFaceFor(actor){
    const action=actionFor(actor),motion=action?motionDefinition(action.assetId):idleDefinition(actor),pair=matchingFaceMotion(motion);if(!pair)return null;
    const t=CreatorAnimationLayers.motionTime(motion,action?state.current-action.start+(action.sourceOffset||0):state.current,!action||action.loop===true);
    const segment=pair.segments.find(x=>t>=(x.originalName?x.sourceOffset:0)&&t<(x.originalName?x.sourceOffset:0)+x.length)||pair.segments.at(-1);
    return {item:{assetId:segment.id,weight:100},time:Math.max(0,t-(segment.originalName?segment.sourceOffset:0))};
  }
  function layerFaceReferences(){
    const refs=new Map();
    for(const actor of state.objects.filter(supportedActor)){
      const add=key=>{if(String(key||'').startsWith('asset-face-motion-'))refs.set(key,actor);};
      for(const layer of actor.residentLayers||[])if(layer.enabled&&['expression','decal'].includes(layer.kind))add(layer.assetId);
      for(const track of state.tracks.filter(t=>t.target===actor.id&&t.enabled!==false)){if(track.type==='expression')for(const c of track.clips)add(c.assetId);if(actor.inheritBodyFace&&track.type==='animation'&&track.layerRole!=='overlay')for(const c of track.clips)for(const segment of matchingFaceMotion(motionDefinition(c.assetId))?.segments||[])add(segment.id);}
      if(actor.inheritBodyFace)for(const segment of matchingFaceMotion(idleDefinition(actor))?.segments||[])add(segment.id);
    }return refs;
  }
  function prepareLayerFaces(){
    if(!animationLayersSupported)return [];
    const promises=[];for(const [key,actor] of layerFaceReferences()){
      const def=faceMotionById(key);if(!def)throw Error('表情素材不可用：'+key);if(def.channels)continue;if(layerFaceErrors.has(key))throw Error(layerFaceErrors.get(key));
      if(!layerFacePending.has(key)){const promise=prepareFaceMotion(actor,key,0).catch(error=>{layerFaceErrors.set(key,error.message);throw error;}).finally(()=>{layerFacePending.delete(key);bridgeLast='';});layerFacePending.set(key,promise);promise.then(()=>syncPlayer(),()=>syncPlayer());}
      promises.push(layerFacePending.get(key));
    }return promises;
  }
  function layeredFaceShapes(actor){return CreatorAnimationLayers.faceLayers(state,actor,{face:faceMotionById,shape:faceShapeDefinition,sample:sampleKeys,supports:name=>!!shapeForActor(actor,faceIdForName(name)),bodyFace:()=>bodyFaceFor(actor)});}
  function layeredBody(actor){return CreatorAnimationLayers.bodyLayers(state,actor,{motion:motionDefinition,hasBaseAction:!!actionFor(actor)});}
  const uiEditor=CreatorUITransitionEditor({state:()=>state,id,esc,notify:(...args)=>notify(...args),entries:()=>uiCatalog.entries,scenes:()=>sceneAssets,supported:()=>uiTransitionsSupported,error:()=>uiCatalogError,ready:()=>uiReady,pause:()=>setPlaying(false),duration:()=>duration,fps:()=>fps,remember,render,showModal,closeModal,reveal:revealExpressionClip,select:key=>{state.selected=null;state.selectedClip=key;selectedAsset=null;}});
  const uiReady=Promise.resolve().then(async()=>{if(!uiTransitionsSupported)return;try{const response=await fetch('/'+location.pathname.split('/')[1]+'/ui-transitions');if(!response.ok)throw Error('转场清单读取失败');uiCatalog=await response.json();uiCatalogError=uiCatalog.issues?.map(x=>x.error).join('；')||'';assetCatalogRevision++;renderAssetBrowser();renderTimeline();renderInspector();updateClock();}catch(x){uiCatalogError=x.message;}});
  function uiPlan(){if(!uiTransitionsSupported&&state.tracks.some(t=>t.type==='ui'&&t.enabled!==false&&t.clips.length))throw Error('此工程使用 UI / 转场，请重启到新版 Player');return CreatorUITransitions.plan(state,uiCatalog.entries,sceneAssets);}
  function uiCoverMarkup(c){const original=uiCatalog.entries.find(a=>a.id===c.assetId);if(c.uiKind!=='transition'||!original)return '';let asset;try{asset=CreatorUITransitions.layout(original,uiCatalog.entries,uiAspect());}catch{return '';}const v=CreatorUITransitions.covered(c,asset);return `<i class="ui-cover-window" style="left:${(v.start-c.start)/c.len*100}%;width:${(v.end-v.start)/c.len*100}%" title="遮挡参考区间"></i>`;}
  document.addEventListener('click',event=>{const layer=event.target.closest('[data-ui-layer-add]');if(layer){uiEditor.picker(null,null,state.current,true);return;}const add=event.target.closest('[data-ui-add]');if(add&&!add.disabled)uiEditor.picker(state.tracks.find(t=>t.id===add.dataset.uiAdd));});
  document.addEventListener('click',event=>{const button=event.target.closest('[data-layer-add]');if(!button)return;const [type,target]=button.dataset.layerAdd.split(':'),actor=state.objects.find(o=>o.id===target);if(actor)openLayerPicker(actor,null,type,true);});

  const effectsEditor=CreatorPostEffectsEditor({state:()=>state,id,esc,copy:()=>copyState(),restore:s=>{state=s;render();},remember,render,notify:msg=>notify(msg),modal:showModal,close:closeModal,duration:()=>duration,fps:()=>fps,found:()=>state.selectedClip&&getClip(state.selectedClip),select:key=>{state.selected=null;state.selectedClip=key;selectedAsset=null;collapsedTimelineGroups.set('visualEffect',false);}});
  document.addEventListener('click',e=>{const b=e.target.closest('[data-effect-add],[data-effect-layer-add]');if(!b)return;if(b.hasAttribute('data-effect-layer-add'))effectsEditor.picker('effect');else effectsEditor.picker('visual',state.tracks.find(t=>t.id===b.dataset.effectAdd));});
  const obj = () => state.objects.find(x=>x.id===state.selected) || null;
  const getClip = clipId => { for(const track of state.tracks){const clip=track.clips.find(c=>c.id===clipId);if(clip)return {track,clip};} return null; };
  const comp = type => components.find(c=>c.key===type) || components[0];
  const cameraProperties = {position:'位置',rotation:'旋转',scale:'缩放',fov:'FOV'};
  const keyNames={...cameraProperties,x:'水平偏移',y:'垂直偏移',width:'画面宽度',height:'画面高度',scaleX:'横向缩放',scaleY:'纵向缩放',opacity:'不透明度',visible:'显示状态',weight:'表情权重',viseme_a:'口型 A',viseme_i:'口型 I',viseme_u:'口型 U',viseme_e:'口型 E',viseme_o:'口型 O'};
  const time = t => {const f=Math.round(t*fps),s=Math.floor(f/fps);return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}:${String(f%fps).padStart(2,'0')}`;};
  const quantize = t => Math.round(t*fps)/fps;
  const motionClipLength = definition => Math.max(frame,Math.ceil(definition.length*fps-0.001)/fps);
  const defaultIdleDefinition = () => filmMotionDefinitions.find(x=>x.source==='mot_photo_chr_cmmn_stand-idle-001_lp_b')||motionDefinition('asset-local-idle');
  const idleDefinition = object => object.idleAssetId?motionDefinition(object.idleAssetId):defaultIdleDefinition();
  const missingIdle = () => idleSupported&&performance?state.objects.find(o=>supportedActor(o)&&!idleDefinition(o)):null;
  const clipActive = c => state.current>=c.start && (state.current<c.start+c.len || (state.current===duration && Math.abs(c.start+c.len-duration)<1e-6));
  const copyState = () => structuredClone(state);
  function remember(before,positioned=[]){CreatorStory.rebase(state,before);CreatorTimelineEdit.prune(state);CreatorComposition.reconcile(state,before,positioned);assetCatalogRevision++;undoStack.push(before);if(undoStack.length>50)undoStack.shift();redoStack.length=0;updateHistoryButtons();scheduleProjectLabel();}
  function updateHistoryButtons(){$('#undo').disabled=undoStack.length===0;$('#redo').disabled=redoStack.length===0;}
  function historyUndo(){finishGizmoEdit();if(!undoStack.length)return;redoStack.push(copyState());state=undoStack.pop();clearPanelSelections();selectedClipIds.clear();soloClipId=null;selectedAsset=null;render();updateHistoryButtons();scheduleProjectLabel();notify('已撤销时间轴编辑');}
  function historyRedo(){finishGizmoEdit();if(!redoStack.length)return;undoStack.push(copyState());state=redoStack.pop();clearPanelSelections();selectedClipIds.clear();soloClipId=null;selectedAsset=null;render();updateHistoryButtons();scheduleProjectLabel();notify('已重做时间轴编辑');}
  const notifications=CreatorNotifications({toast:$('#toast'),button:$('#notification-log')}),notify=(message,options)=>notifications.show(message,options);
  $('#notification-log').onclick=()=>{const text=notifications.history().reverse().map(r=>`[${r.time}] ${r.message}${r.detail?'\n'+r.detail:''}`).join('\n\n');showModal(`<div class="modal-head"><div><h2>消息记录</h2><p>保留本次会话最近 50 条，可选中并复制完整信息。</p></div><button class="icon-button" data-close aria-label="关闭">${icon('close')}</button></div><div class="modal-body"><textarea id="notification-history" aria-label="消息记录" readonly>${esc(text||'暂无消息')}</textarea></div>`);};
  function treeRow(o, cls='') {return `<div class="tree-row ${cls} ${hierarchySelection.ids.includes(hierarchyKey(o))?'selected':''}" data-object="${esc(o.id)}" data-selection-key="${esc(hierarchyKey(o))}"><span class="tree-toggle">${o.id==='scene'?icon(treeExpanded?'down':'chevron'):''}</span><span class="row-icon">${icon(o.icon)}</span><span class="row-name">${esc(o.name)}</span><span data-visibility-indicator="${esc(o.id)}" title="${evaluated(o,'visible')?'已启用':'已关闭'}" style="opacity:${evaluated(o,'visible')?'1':'.3'}">${icon('eye')}</span></div>`;}
  let lastHierarchyScene=null;const closedPropGroups=new Set();
  function renderHierarchy(){syncPanelSelections();const terms=searchTerms($('#hierarchy-search').value),q=terms.join(' '),rootObject=state.objects.find(o=>o.id==='scene'),root=rootObject&&{...rootObject,name:sceneAssets.find(a=>a.sceneId===sceneAt())?.alias|| (sceneAt()?rootObject.name:'空白场景')},catalog=classroomPropsSupported&&sceneAt()==='classroom'?classroomCatalog.filter(p=>!(state.hiddenSceneProps||[]).includes(p.id)):[],children=state.objects.filter(o=>o.parent==='scene'&&!(catalog.length&&supportedProp(o))&&matchesSearch(o.name,terms));let groups='';for(const group of [...new Set(catalog.map(x=>x.group))]){const rows=catalog.filter(x=>x.group===group&&matchesSearch(`${x.name} ${x.source} ${group}`,terms));if(!rows.length)continue;const open=q||!closedPropGroups.has(group);groups+=`<div class="tree-row prop-group" data-prop-group="${esc(group)}"><span>${open?'▾':'▸'}</span><span>${esc(group)} (${rows.length})</span></div>`;if(open)groups+=rows.map(x=>{const obj=state.objects.find(o=>o.propId===x.id);return `<div class="tree-row prop-row ${hierarchySelection.ids.includes('prop:'+x.id)?'selected':''}" data-scene-prop="${esc(x.id)}" data-selection-key="${esc('prop:'+x.id)}" title="${esc(x.source)}">${icon('box')}<span>${esc(obj?.name||x.name)}</span>${obj?' <span class="prop-edited">●</span>':''}</div>`;}).join('');}$('#hierarchy').innerHTML=(root&&(!q||matchesSearch(root.name,terms)||children.length||groups)?treeRow(root):'')+(treeExpanded||q?`<div class="tree-children">${children.map(x=>treeRow(x)).join('')}${groups}</div>`:'');const order=hierarchyOrder();CreatorPanelSelection.retain(hierarchySelection,order);state.selected=hierarchyObject(hierarchySelection.lead)?.id||null;$('#hierarchy').querySelectorAll('[data-selection-key]').forEach(el=>{const selected=hierarchySelection.ids.includes(el.dataset.selectionKey);el.classList.toggle('selected',selected);el.setAttribute('aria-selected',String(selected));});}
  const assetTypes=['全部','全部动画','角色','服装','动作','表情','场景','图片 / 视频','音乐','音源','音效','UI','画面效果','声音效果'];
  let sharedAssets=[],voiceSources=[],voiceWarnings=[],voiceLoading=false,filmAudioDefinitions=[],filmAudioError='',catalogAudioPlayer=null; const assetThumbs={}, assetIssues={}, originalLoopIds=new Set();
  const availableScenes=new Set((new URLSearchParams(location.search).get('scenes')||'').split(','));
  const sceneAssets=performance&&assetFeatures?[
    {id:'scene-trainingroom',sceneId:'trainingroom',type:'场景',alias:'练习室',source:'env_3d_adv_trainingroom-00-00-noon'},
    {id:'scene-classroom',sceneId:'classroom',type:'场景',alias:'教室',source:'env_3d_adv_classroom-00-00-noon'},
    {id:'scene-courtyard',sceneId:'courtyard',type:'场景',alias:'中庭',source:'env_3d_adv_courtyard-00-00-noon'},
    {id:'scene-dormitory',sceneId:'dormitory',type:'场景',alias:'宿舍',source:'env_3d_adv_dormitory-00-00-noon'},
    {id:'scene-rooftop',sceneId:'rooftop',type:'场景',alias:'屋顶',source:'env_3d_adv_rooftop-00-00-noon'}].filter(a=>availableScenes.has(a.sceneId)).concat(globalThis.CreatorSceneCatalog||[]).map(a=>({...a,alias:defaultGameAlias(a)||a.source})):[];
  const aliasFirst=items=>{const named=[],unnamed=[];for(const a of items)(a.alias?.trim()?named:unnamed).push(a);return named.concat(unnamed);};
  let cachedCatalog=null,cachedCatalogKey=null,cachedAssetsById=new Map();
  function allAssets(){const key=[state,state.assets,state.assets.length,assetCatalogRevision,filmMotionDefinitions,faceMotionDefinitions,costumeDefinitions,sharedAssets,sharedAssets.length,voiceSources,filmAudioDefinitions];if(cachedCatalogKey&&key.every((v,i)=>v===cachedCatalogKey[i]))return cachedCatalog;
    const stateIds=new Set(state.assets.map(x=>x.id)),fresh=a=>!stateIds.has(a.id),importedAudio=new Set([...state.assets,...sharedAssets].map(a=>a.filmAudio?.catalogId).filter(Boolean));
    const raw=[...CreatorPostEffects.assets,...state.assets,...CreatorUITransitions.choices(uiCatalog.entries).filter(fresh),...motionDefinitions.filter(a=>availableMotions.has(a.motionId)&&fresh(a)).map(a=>({...a,type:'动作'})),...filmMotionDefinitions.filter(fresh).map(a=>({...a,type:'动作'})),...sceneAssets.filter(fresh),...actorAssets.filter(fresh),...costumeDefinitions.filter(fresh),...faceShapeAssets.filter(fresh),...faceMotionDefinitions.filter(fresh),...sharedAssets.filter(fresh),...voiceSources,...filmAudioDefinitions.filter(a=>!importedAudio.has(a.filmCatalogId))];
    const visible=raw.filter(a=>!(state.hiddenAssetIds||[]).includes(a.id));
    const named=CreatorGameAliases.catalog(visible,stateIds,gameAliasRows,a=>{
      const generated=CreatorMotionNames.name(a.source);
      return generated && generated+((a.duplicateMotionName||duplicateMotionIds.has(a.id))?' · 资源 '+a.id.slice(-6):'');
    });
    cachedCatalog=aliasFirst(named);cachedAssetsById=new Map();for(const a of cachedCatalog)if(!cachedAssetsById.has(a.id))cachedAssetsById.set(a.id,a);cachedCatalogKey=key;return cachedCatalog;
  }
  const assetById=key=>{allAssets();return cachedAssetsById.get(key);};
  async function loadCostumes(){
    if(!desktop)return;
    try{const prefix=location.pathname.split('/')[1],response=await fetch('/'+prefix+'/costumes');if(!response.ok)throw Error('清单读取失败');const rows=await response.json();if(!Array.isArray(rows)||rows.length>10000)throw Error('服装清单无效');const seen=new Set(),kinds={casl:'日常',cstm:'服装',trng:'训练',schl:'校服',spcs:'特殊',othr:'其他'};costumeDefinitions=rows.map(r=>{if(!/^costume-[0-9a-f]{24}$/.test(r.id)||!/^mdl_chr_[a-z0-9]+-[a-z0-9]+-[a-z0-9]+_body$/.test(r.name)||!/^([a-z0-9]+)$/.test(r.character)||!/^([a-z0-9]+)$/.test(r.kind)||!/^([a-z0-9]+)$/.test(r.number)||seen.has(r.id)||['bodyAvailable','dependenciesAvailable','baseFaceAvailable','baseHairAvailable','specificFaceAvailable','specificHairAvailable','knownCharacter','currentDefault','playerAvailable','thumbnailAvailable'].some(k=>typeof r[k]!=='boolean')||!Array.isArray(r.missingDependencies)||r.missingDependencies.some(x=>!/^\d+$/.test(x)))throw Error('服装清单条目无效');seen.add(r.id);const person=r.character==='ttmr'?'月村手毬':actorNames[r.character]||('角色代码 '+r.character);return {...r,id:'asset-'+r.id,type:'服装',source:r.name,alias:`${person} · ${kinds[r.kind]||r.kind} ${r.number}`,catalogOnly:true};}).map(a=>({...a,alias:defaultGameAlias(a)}));costumeError='';renderAssetBrowser();if(!$('#inspector').contains(document.activeElement)&&(selectedAsset&&costumeDefinitions.some(x=>x.id===selectedAsset)||obj()?.costumeAssetId))renderInspector();}catch(error){costumeError=error.message;notify('本地服装清单不可用：'+error.message);}
  }
  async function loadVisibleCostumeThumbnails(assets){if(!window.assetAPI?.costumeThumbnails)return;const ids=assets.filter(a=>a.catalogOnly&&!assetThumbs[a.id]&&!checkedCostumeThumbnails.has(a.id)).map(a=>a.id);if(!ids.length)return;ids.forEach(id=>checkedCostumeThumbnails.add(id));try{const found=await window.assetAPI.costumeThumbnails(ids);Object.assign(assetThumbs,found);if(Object.keys(found).length)renderAssetBrowser();}catch(error){ids.forEach(id=>checkedCostumeThumbnails.delete(id));notify('服装缩略图读取失败：'+error.message);}}
  async function generateCostumeThumbnail(asset){if(!asset?.catalogOnly||!asset.knownCharacter||!asset.bodyAvailable||!asset.dependenciesAvailable)throw Error('此服装缺少可用角色或资源');if(!asset.thumbnailAvailable)throw Error('此服装需要额外身体资源，当前缩略图暂不支持');if(costumeThumbnailBusy)throw Error('正在生成另一张服装缩略图');if(!window.assetAPI?.costumeThumbnail)throw Error('服装缩略图不可用');costumeThumbnailBusy=true;try{const data=await window.assetAPI.costumeThumbnail(asset.id);assetThumbs[asset.id]=data;delete assetIssues[asset.id];checkedCostumeThumbnails.add(asset.id);renderAssetBrowser();return {assetId:asset.id};}finally{costumeThumbnailBusy=false;if(selectedAsset===asset.id&&!$('#inspector').contains(document.activeElement))renderInspector();}}
  async function loadFilmMotions(){
    if(!desktop)return;
    try{const prefix=location.pathname.split('/')[1],response=await fetch('/'+prefix+'/film-motions');if(!response.ok)throw Error('清单读取失败');const rows=await response.json();if(!Array.isArray(rows)||rows.length>5000)throw Error('动作清单无效');filmMotionDefinitions=rows.map(r=>{if(!/^film-[0-9a-f]{24}$/.test(r.id)||typeof r.name!=='string'||!Number.isFinite(r.length)||r.length<=0)throw Error('动作清单条目无效');return {...r,id:'asset-'+r.id,motionId:r.id,type:'动作',alias:r.builtin?'共通 待机律动 '+(r.name.includes('001')?'01':'02')+'（原生叠加）':'',source:r.name,length:r.length};});const duplicateNames=new Map();for(const item of filmMotionDefinitions)duplicateNames.set(item.source,(duplicateNames.get(item.source)||0)+1);for(const item of filmMotionDefinitions)if(duplicateNames.get(item.source)>1)item.duplicateMotionName=true;duplicateMotionIds=new Set(filmMotionDefinitions.filter(x=>x.duplicateMotionName).map(x=>x.id));bridgeLast='';renderAssetBrowser();if(!$('#inspector').contains(document.activeElement))renderInspector();updateClock();}catch(error){notify('本地动作清单不可用：'+error.message);}
  }
  function validateFaceChannels(channels,length){
    if(!Array.isArray(channels)||!channels.length||channels.length>96)throw Error('面部动画通道无效');
    const seen=new Set();for(const c of channels){if(!(/^(b_(brow|eye|iris|mouth)\.[a-z]+_\d{3}|decal\.(Shadow|Pale|CheekWhole|LeftCheek|RightCheek|LeftCheekLine|RightCheekLine|CheekLineWhole))$/.test(c.shape))||seen.has(c.shape)||!Array.isArray(c.keys)||!c.keys.length||c.keys.length>2000||c.keys.some((k,i)=>!Number.isFinite(k.time)||k.time<0||k.time>length+.001||!Number.isFinite(k.value)||k.value<0||k.value>100||(i>0&&k.time<=c.keys[i-1].time)))throw Error('面部动画关键帧无效');seen.add(c.shape);}
    return channels;
  }
  async function loadFaceMotions(){
    if(!desktop||!faces)return;
    try{const prefix=location.pathname.split('/')[1],response=await fetch('/'+prefix+'/face-motions');if(!response.ok)throw Error('清单读取失败');const rows=await response.json();if(!Array.isArray(rows)||rows.length>5000)throw Error('面部动画清单无效');const seen=new Set();faceMotionDefinitions=rows.map(r=>{if(!/^asset-face-motion-[A-Za-z0-9_-]+_f$/.test(r.id)||typeof r.name!=='string'||r.id!=='asset-face-motion-'+r.name||seen.has(r.id)||!Number.isFinite(r.length)||r.length<=0||r.length>60)throw Error('面部动画无效');seen.add(r.id);return {id:r.id,type:'表情',alias:'',source:r.name,length:r.length,...(typeof r.originalName==='string'&&Number.isFinite(r.sourceOffset)&&Number.isFinite(r.sourceLength)&&r.sourceOffset>=0&&r.sourceLength>r.sourceOffset?{originalName:r.originalName,sourceOffset:r.sourceOffset,sourceLength:r.sourceLength}:{}),...(r.channels?{channels:validateFaceChannels(r.channels,r.length)}:{})};});renderAssetBrowser();if((selectedAsset||getClip(state.selectedClip)?.track.type==='expression')&&!$('#inspector').contains(document.activeElement))renderInspector();}catch(error){notify('本地面部动画清单不可用：'+error.message);}
  }
  function matchingFaceMotion(motion){
    if(!motion||!/^[A-Za-z0-9_-]+_b$/.test(motion.source))return null;const name=motion.source.slice(0,-2)+'_f',single=faceMotionDefinitions.find(a=>a.source===name&&!a.originalName);
    if(single)return {segments:[single],length:single.length};
    const segments=faceMotionDefinitions.filter(a=>a.originalName===name).sort((a,b)=>a.sourceOffset-b.sourceOffset);if(!segments.length||segments.length>60)return null;
    const total=segments[0].sourceLength;let end=0;for(const segment of segments){if(Math.abs(segment.sourceLength-total)>1e-4||Math.abs(segment.sourceOffset-end)>1e-4)return null;end=segment.sourceOffset+segment.length;}
    return Math.abs(end-total)<=.001?{segments,length:total}:null;
  }
  async function prepareFaceMotion(target,assetId,start){
    const asset=faceMotionDefinitions.find(a=>a.id===assetId);if(!asset||!target||!supportedActor(target))throw Error('角色或面部动画不可用');
    const initialState=state,projectId=state.projectId,targetId=target.id;
    if(!asset.channels){const prefix=location.pathname.split('/')[1],response=await fetch('/'+prefix+'/face-motion/'+asset.id);if(!response.ok)throw Error('面部动画曲线不可读取');const row=await response.json();if(row.id!==asset.id||row.name!==asset.source||row.length!==asset.length)throw Error('面部动画数据与清单不一致');asset.channels=validateFaceChannels(row.channels,row.length);}
    return {initialState,projectId,targetId,asset};
  }
  function planFaceMotion(prepared,start,allowEmpty=false){
    const {initialState,projectId,targetId,asset}=prepared;if(state!==initialState||state.projectId!==projectId)throw Error('工程已切换，请重新添加面部动画');const target=state.objects.find(o=>o.id===targetId);if(!target||!supportedActor(target))throw Error('角色已移除');
    const len=Math.ceil((asset.length-1e-6)*fps)/fps;if(!Number.isFinite(start)||start<0||start+len>duration+1e-6)throw Error('演出剩余时长不足');
    const compatible=asset.channels.map(c=>({channel:c,shapeId:c.shape==='b_mouth.mouth_001'?'asset-local-mouth':'asset-face-'+c.shape})).filter(x=>shapeForActor(target,x.shapeId));if(!compatible.length&&!allowEmpty)throw Error('角色没有可用的面部形变');
    for(const item of compatible)if(state.tracks.some(t=>t.enabled!==false&&t.type==='expression'&&t.target===target.id&&t.clips.some(c=>c.assetId===item.shapeId&&start<c.start+c.len-1e-6&&start+len>c.start+1e-6)))throw Error('已有重叠的同名面部形变片段');
    return {target,asset,len,compatible};
  }
  function appendFaceMotion(plan,start){
    const {target,len,compatible}=plan,created=[];if(!target.components.includes('expression'))target.components.push('expression');
    for(const {channel,shapeId} of compatible){const trackId=id(),clipId=id(),keys=channel.keys.map(k=>({time:Math.min(len,k.time),value:k.value}));if(keys[keys.length-1].time<len-1e-6)keys.push({time:len,value:keys[keys.length-1].value});state.tracks.push({id:trackId,name:`${target.name} · ${channel.shape}`,type:'expression',target:target.id,clips:[{id:clipId,name:channel.shape,assetId:shapeId,start,len,weight:0,propertyKeys:{weight:keys}}]});created.push(clipId);}
    return created;
  }
  async function insertFaceMotion(target,assetId,start){
    if(animationLayersSupported)return layerUI.addClip(target,assetId,start);
    const prepared=await prepareFaceMotion(target,assetId,start),plan=planFaceMotion(prepared,start),before=copyState(),created=appendFaceMotion(plan,start);
    state.selected=null;state.selectedClip=created[0];selectedAsset=null;remember(before);render();return {clips:created,length:plan.len,skipped:plan.asset.channels.length-plan.compatible.length};
  }
  async function insertPairedMotion(target,motionId,start,stillWanted=()=>true){
    if(animationLayersSupported){
      const initialState=state,motion=motionDefinition(motionId),pair=matchingFaceMotion(motion);if(!target||!supportedActor(target)||!pair)throw Error('角色或配套表情不可用');
      if(!Number.isFinite(start)||start<0||start+Math.max(motionClipLength(motion),pair.length)>duration+1e-6)throw Error('演出剩余时长不足');
      for(const segment of pair.segments)await prepareFaceMotion(target,segment.id,start);
      if(state!==initialState||!state.objects.includes(target)||!stillWanted())throw Error('工程已改变或操作已取消');
      const before=copyState();try{const base=state.tracks.find(t=>t.type==='animation'&&t.target===target.id&&t.layerRole==='base'),body=await layerUI.addClip(target,motionId,start,base,{commit:false,length:motionClipLength(motion)}),faceClips=[];let skipped=0;
        for(const segment of pair.segments){const result=await layerUI.addClip(target,segment.id,start+(segment.originalName?segment.sourceOffset:0),undefined,{commit:false,length:segment.length});faceClips.push(...result.clips);skipped+=result.skipped;}
        state.selected=null;state.selectedClip=body.clips[0];selectedAsset=null;remember(before);render();return {motionClipId:body.clips[0],faceClips,length:body.length,faceLength:pair.length,segments:pair.segments.length,skipped};
      }catch(error){if(state===initialState){state=before;render();}throw error;}
    }
    const motion=motionDefinition(motionId),face=matchingFaceMotion(motion);if(!performance||!faces||!target||!supportedActor(target)||!motion||!face)throw Error('角色、动作或同名面部动画不可用');
    if(actorCode(target)!=='ttmr'&&!availableActors.has(actorCode(target)))throw Error('该角色的 Player 能力或本地资源不可用');
    if(!Number.isFinite(start)||start<0||start>=duration)throw Error('开始时间须在演出范围内');start=quantize(start);
    const initialState=state,initialFps=fps,initialDuration=duration,prepared=[];for(const segment of face.segments){if(!stillWanted())throw Error('操作已取消');prepared.push(await prepareFaceMotion(target,segment.id,start));if(state!==initialState)throw Error('工程已切换，请重新添加面部动画');if(fps!==initialFps||duration!==initialDuration)throw Error('演出设置已改变，请重试');}if(!stillWanted())throw Error('操作已取消');
    const plans=prepared.map((p,i)=>{const offset=face.segments.length===1?0:face.segments[i].sourceOffset;if(Math.abs(offset*fps-Math.round(offset*fps))>1e-5)throw Error('面部分段边界与工程帧率不对齐');const at=quantize(start+offset);return {start:at,plan:planFaceMotion(p,at,true)};}),length=motionClipLength(motion);target=plans[0].plan.target;
    if(start+length>duration+1e-6)throw Error('演出剩余时长不足');
    if(state.tracks.some(t=>t.enabled!==false&&t.type==='animation'&&t.target===target.id&&t.clips.some(c=>start<c.start+c.len-1e-6&&start+length>c.start+1e-6)))throw Error('已有重叠的身体动作片段');
    const intervals=new Map();let totalChannels=0,skipped=0;for(const part of plans){skipped+=part.plan.asset.channels.length-part.plan.compatible.length;for(const item of part.plan.compatible){totalChannels++;const previous=intervals.get(item.shapeId)||[];if(previous.some(x=>part.start<x.end-1e-6&&part.start+part.plan.len>x.start+1e-6))throw Error('面部分段在当前帧率下发生重叠');previous.push({start:part.start,end:part.start+part.plan.len});intervals.set(item.shapeId,previous);}}if(!totalChannels)throw Error('角色没有可用的面部形变');
    const before=copyState(),trackId=id(),clipId=id();if(!target.components.includes('animation'))target.components.push('animation');
    state.tracks.push({id:trackId,name:`${target.name} · 身体动画`,type:'animation',target:target.id,clips:[{id:clipId,name:assetDisplay(motion),assetId:motion.id,start,len:length,loop:false}]});
    const faceClips=plans.flatMap(part=>appendFaceMotion(part.plan,part.start));state.selected=null;state.selectedClip=clipId;selectedAsset=null;remember(before);render();
    return {motionClipId:clipId,faceClips,length,faceLength:face.length,segments:plans.length,skipped};
  }
  async function loadShared(){if(!window.assetAPI)return;try{sharedAssets=await window.assetAPI.listShared();renderAssetBrowser();if(state.selectedClip&&!$('#inspector').contains(document.activeElement))renderInspector();for(const a of sharedAssets)loadAssetPreview(a);}catch(error){notify('共享素材库读取失败：'+error.message);}}
  function setOriginalLoopCatalog(rows){filmAudioDefinitions=rows.filter(r=>['音乐','音效'].includes(r.type)&&/^(bank|unity):[0-9a-f]{64}$/.test(r.id)).map(r=>({id:CreatorGameAliases.audioId(r.id),filmCatalogId:r.id,type:r.type,source:r.name,alias:r.streamName||'',streamName:r.streamName,audioOrigin:r.source,duration:r.duration}));filmAudioError='';originalLoopIds.clear();for(const row of rows)if(row.hasLoopMetadata)originalLoopIds.add(row.id);renderAssetBrowser();if(state.selectedClip&&!$('#inspector').contains(document.activeElement))renderInspector();}
  async function loadOriginalLoopCatalog(){if(!window.assetAPI?.filmList)return;try{setOriginalLoopCatalog(await window.assetAPI.filmList());}catch(error){originalLoopIds.clear();filmAudioDefinitions=[];filmAudioError=error.message;renderAssetBrowser();}}
  async function loadVoiceLibrary(){if(!window.voiceAPI||voiceLoading)return;voiceLoading=true;renderAssetBrowser();try{const result=await window.voiceAPI.list();voiceSources=result.voices;voiceWarnings=result.warnings;renderAssetBrowser();if(!$('#inspector').contains(document.activeElement))renderInspector();}catch(error){voiceWarnings=['音源库读取失败：'+error.message];renderAssetBrowser();}finally{voiceLoading=false;renderAssetBrowser();}}
  let assetPreviewRefreshTimer=0;
  const updatedAssetPreviews=new Set();
  function scheduleAssetPreviewRefresh(id){
    updatedAssetPreviews.add(id);
    if(assetPreviewRefreshTimer)return;
    assetPreviewRefreshTimer=setTimeout(()=>{
      assetPreviewRefreshTimer=0;renderAssetBrowser();
      const c=state.selectedClip&&getClip(state.selectedClip)?.clip;
      const source=c&&(c.assetId||state.dialogues.find(d=>d.id===c.dialogue)?.voice);
      if((updatedAssetPreviews.has(selectedAsset)||updatedAssetPreviews.has(source))&&!$('#inspector').contains(document.activeElement))renderInspector();
      updatedAssetPreviews.clear();
    },50);
  }
  async function loadAssetPreview(a){if(!window.assetAPI||!a.scope)return;if(['音乐','音效'].includes(a.type)&&window.assetAPI.audioStatus){try{const result=await window.assetAPI.audioStatus(a);if(result.available){delete assetIssues[a.id];delete a.available;}else assetIssues[a.id]='音频文件缺失，可在属性中重新关联';}catch(error){assetIssues[a.id]=error.message;}scheduleAssetPreviewRefresh(a.id);return;}if(assetThumbs[a.id]||!CreatorScreenMedia.isVisual(a))return;try{a.visual=await window.assetAPI.visualInfo(a);assetThumbs[a.id]=await window.assetAPI.preview(a);delete assetIssues[a.id];}catch(error){assetIssues[a.id]=error.message;}scheduleAssetPreviewRefresh(a.id);}
  function attachAudioRecovery(asset){if(!asset?.scope||!['音乐','音效'].includes(asset.type)||!assetIssues[asset.id]||!window.assetAPI?.restoreAudio)return;const section=$('#inspector .inspector-section');if(!section)return;const hint=document.createElement('p');hint.className='hint';hint.textContent='请选择原音频的同格式副本；不会自动核对内容是否一致。';section.appendChild(hint);const button=document.createElement('button');button.className='add-component';button.textContent='重新关联缺失音频';button.onclick=async()=>{button.disabled=true;try{const result=await window.assetAPI.restoreAudio(asset);if(!result){button.disabled=false;return;}delete asset.available;delete assetIssues[asset.id];for(const [key,entry] of audioPlayers)if(entry.assetId===asset.id)retireAudioPlayer(key,entry);renderAssetBrowser();renderInspector();notify('音频已恢复，时间轴引用保持不变');}catch(error){button.disabled=false;notify('重新关联失败：'+error.message);}};section.appendChild(button);}
  window.assetAPI?.onImportProgress?.(info=>notify(`正在准备 ${info.index} / ${info.total}：${info.name}，视频可能需要几分钟…`));
  async function importResult(result){if(!result)return;const before=copyState();for(const a of result.assets){if(a.scope==='shared')sharedAssets.push(a);else state.assets.push(a);loadAssetPreview(a);}if(result.assets.some(a=>a.scope==='project'))remember(before);renderAssetBrowser();if(result.errors.length)notify(`导入 ${result.assets.length} 项，${result.errors.length} 项失败：${result.errors[0].name}（${result.errors[0].error}）`);else notify(`已导入 ${result.assets.length} 项素材`);}
  async function importFiles(files){
    const original=state;
    try{
      const paths=Array.from(files,file=>window.assetAPI.pathForFile(file));
      const result=await window.assetAPI.importDropped(paths,original.projectId);
      if(state!==original)throw Error('工程已切换，请在需要的工程中重新拖入');
      await importResult(result);return result?.assets||[];
    }catch(error){notify('导入失败：'+error.message);return [];}
  }
  async function bakeThumbnail(a){if(!assetFeatures||!a)return;const target=a.id==='asset-actor-1'?'actor':a.sceneId===state.sceneId?'scene':null;if(!target){notify('请先把该场景放入层级，再拍摄缩略图');return;}try{const prefix=location.pathname.split('/')[1],r=await fetch('/'+prefix+'/thumbnail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target,id:++bridgeId})}),data=await r.json();if(!r.ok||!data.ok)throw Error(data.error||'拍摄失败');await window.assetAPI.saveThumbnail(a.id,data.dataUrl);assetThumbs[a.id]=data.dataUrl;renderAssetBrowser();notify('已生成 Player 缩略图');}catch(error){notify('缩略图生成失败：'+error.message);}}

  const assetIcons={'角色':'user','服装':'user','动作':'film','表情':'spark','音源':'sound','音效':'music','音乐':'music','UI':'chat','场景':'box','贴图':'image','视频':'film'};
  const assetColors={'角色':'#8eaac6','服装':'#b6a7c7','动作':'#a5bd95','表情':'#e69c85','音源':'#c4a6d2','音效':'#91bdba','音乐':'#91bdba','UI':'#cea791','场景':'#b8ad8c','贴图':'#96b5c3'};
  const assetDisplay=a=>(assetById(a.id)||a).alias?.trim() || a.source || '未命名素材';
  function cameraContext(){const selectedObject=obj(), found=state.selectedClip&&getClip(state.selectedClip);if(selectedAsset)return null;const o=selectedObject||((found&&['camera','transform'].includes(found.track.type))?state.objects.find(x=>x.id===found.track.target):null);if(!o)return null;o.transform ||= {position:[0,0,0],rotation:[0,0,0]};if(o.type==='相机')o.fov ??= state.fov??35;const trackType=o.type==='相机'?'camera':'transform';const matching=found&&found.track.target===o.id&&found.track.type===trackType?found:null;const candidates=state.tracks.filter(t=>t.type===trackType&&t.target===o.id).flatMap(track=>track.clips.map(clip=>({track,clip}))),current=candidates.find(x=>clipActive(x.clip))||candidates.find(x=>Math.abs(state.current-(x.clip.start+x.clip.len))<1e-6),active=selectedObject?(current||matching):(matching||current);return {object:o,track:active?.track,clip:active?.clip,inRange:!!active&&state.current>=active.clip.start-1e-6&&state.current<=active.clip.start+active.clip.len+1e-6};}
  function cameraValue(ctx,property){const fallback=property==='fov'?ctx.object.fov:property==='scale'?(ctx.object.transform.scale||[1,1,1]):ctx.object.transform[property];const keys=ctx.inRange&&ctx.track.enabled!==false?ctx.clip.propertyKeys?.[property]:null;return keys?.length?sampleKeys(keys,state.current-ctx.clip.start):fallback;}
  // Editor owns the evaluated state; the Player applies snapshots on its main thread.
  let bridgeBusy=false, bridgePending=null, bridgeId=0, bridgeLast='', exporting=false;
  function activeTransformClip(object) {
    const type=object.type==='相机'?'camera':'transform';
    return state.tracks.filter(t=>t.type===type&&t.target===object.id&&t.enabled!==false)
      .flatMap(t=>t.clips).find(clipActive);
  }
  function evaluated(object, property) {
    const active=activeTransformClip(object);
    const keys=active?.propertyKeys?.[property];
    const fallback=property==='visible'?object.visible!==false:property==='fov'?(object.fov??35):(object.transform?.[property]??(property==='scale'?[1,1,1]:[0,0,0]));
    return keys?.length?sampleKeys(keys,state.current-active.start):fallback;
  }
  function actionFor(object){return performance&&state.tracks.filter(t=>t.type==='animation'&&t.target===object.id&&t.layerRole!=='overlay'&&t.enabled!==false).flatMap(t=>t.clips).find(c=>{const def=motionDefinition(c.assetId),elapsed=state.current-c.start+(c.sourceOffset||0);return def&&state.current>=c.start&&state.current<c.start+c.len&&elapsed>=0&&(animationLayersSupported&&(c.layerPlayback||c.loop)||elapsed<Math.max(0,def.length-0.0001));});}
  function fadeSpan(clip,type){const def=type==='animation'?motionDefinition(clip.assetId):null;return CreatorFades.span(clip,animationLayersSupported&&(clip.layerPlayback||clip.loop||clip.blendMode)?undefined:def?.length);}
  function blendsWithPhysics(){return !physicsAvailable || !state.globalSettings.physicsEnabled || state.globalSettings.physicsMode==='hybrid';}
  function motionStateFor(object){
    const a=actionFor(object);if(!a)return {motionId:'shy',motionActive:false,motionTime:0,...(outgoingMotionFor(object)||{})};
    const def=motionDefinition(a.assetId),elapsed=Math.max(0,state.current-a.start),motionTime=animationLayersSupported&&(a.layerPlayback||a.loop)?CreatorAnimationLayers.motionTime(def,elapsed+(a.sourceOffset||0),a.loop):Math.min(3600,elapsed+(a.sourceOffset||0));
    if(motionBlendSupported&&blendsWithPhysics()&&(a.fadeIn>0||a.fadeOut>0)){
      const weight=CreatorFades.factor(a,elapsed,fadeSpan(a,'animation'));if(weight<.999999)return {motionId:def.motionId,motionActive:false,motionTime:0,blendActive:true,blendMotionId:def.motionId,blendMotionTime:motionTime,blendWeight:weight};
    }
    return {motionId:def.motionId,motionActive:true,motionTime};
  }
  function outgoingMotionFor(object){
    if(!motionBlendSupported||!blendsWithPhysics()||actionFor(object))return null;
    const candidates=state.tracks.filter(t=>t.type==='animation'&&t.target===object.id&&t.layerRole!=='overlay'&&t.enabled!==false).flatMap(t=>t.clips).map(c=>{const d=motionDefinition(c.assetId),offset=c.sourceOffset||0;if(c.layerPlayback||c.loop||c.fadeOut!==undefined||!d||offset>=d.length-.0001)return null;const end=c.start+Math.min(c.len,Math.max(0,d.length-.0001-offset));return {c,d,offset,end};}).filter(x=>x&&state.current>=x.end&&state.current<x.end+.3).sort((a,b)=>b.end-a.end);
    if(!candidates.length)return null;const {c,d,offset,end}=candidates[0],u=Math.max(0,Math.min(1,(state.current-end)/.3)),weight=1-u*u*(3-2*u);return {blendMotionId:d.motionId,blendMotionTime:Math.max(0,Math.min(d.length-.0001,offset+end-c.start)),blendWeight:weight,blendActive:true};
  }
  function expressionFor(object){if(!faces)return 0;const c=state.tracks.filter(t=>t.type==='expression'&&t.target===object.id&&t.enabled!==false).flatMap(t=>t.clips).find(c=>c.assetId==='asset-local-mouth'&&clipActive(c));if(!c)return 0;const keys=c.propertyKeys?.weight;return Math.max(0,Math.min(1,(keys?.length?sampleKeys(keys,state.current-c.start):(c.weight??80))*CreatorFades.factor(c,state.current-c.start,fadeSpan(c,'expression'))/100));}
  function activeCamera(){const tracks=state.tracks.filter(t=>t.type==='camera'&&t.enabled!==false).slice().reverse();for(const t of tracks){const camera=state.objects.find(o=>o.id===t.target&&o.type==='相机'&&evaluated(o,'visible'));if(camera&&t.clips.some(clipActive))return camera;}return state.objects.find(o=>o.type==='相机'&&evaluated(o,'visible'))||null;}
  function sceneAt(time=state.current){return CreatorProjectRemoval.sceneAt(state,time,duration,assetById);}
  function uiAspect(){const [w,h]=state.globalSettings.aspect.split(':').map(Number);return w/h;}

  function missingScene(){const scene=sceneAt();return assetFeatures&&scene&&!sceneAssets.some(a=>a.sceneId===scene)?scene:null;}
  function dialogueColors(d){return CreatorCharacterColors.resolve(state,d);}
  const characterColorEditor=CreatorCharacterColorEditor({state:()=>state,remember,render,esc});
  function dialogueAt(t){const clip=state.tracks.filter(track=>track.type==='dialogue'&&track.enabled!==false).flatMap(track=>track.clips).find(x=>x.dialogue&&t>=x.start&&t<x.start+x.len),dialogue=clip&&state.dialogues.find(d=>d.id===clip.dialogue);return dialogue?{clip,dialogue}:null;}
  function displayedDialogue(entry,t){if(!entry)return '';const {clip,dialogue}=entry;if(!dialogue.typewriter)return dialogue.text;return Array.from(dialogue.text).slice(0,Math.max(0,Math.floor((t-clip.start)*(dialogue.revealRate||12))+1)).join('');}
  function currentDialogue(){return dialogueAt(state.current)?.dialogue;}
  function faceShapesFor(object){if(animationLayersSupported)return layeredFaceShapes(object);const layers=[],times=new Map();for(const track of state.tracks.filter(t=>t.type==='expression'&&t.target===object.id&&t.enabled!==false))for(const c of track.clips){const shape=faceShapeDefinition(c.assetId);if(!shape||!clipActive(c))continue;if(c.lipVisemes&&c.lipSyncSource){for(const [v,name] of Object.entries(c.lipVisemes)){const shapeId=faceIdForName(name),keys=c.propertyKeys?.['viseme_'+v];if(shapeForActor(object,shapeId)&&keys?.length)layers.push({name,weight:Math.max(0,Math.min(1,sampleKeys(keys,state.current-c.start)*CreatorFades.factor(c,state.current-c.start,fadeSpan(c,'expression'))/100)),mouthOverride:true});}continue;}const keys=c.propertyKeys?.weight;layers.push({name:shape.source,weight:Math.max(0,Math.min(1,(keys?.length?sampleKeys(keys,state.current-c.start):(c.weight??80))*CreatorFades.factor(c,state.current-c.start,fadeSpan(c,'expression'))/100)),mouthOverride:Boolean(c.lipSyncSource)});if(shape.source.startsWith('eyeMaterial.'))times.set(shape.source,Math.max(0,state.current-c.start+(c.sourceOffset||0)));}return CreatorLipSync.combineFaceLayers(layers).map(x=>times.has(x.name)?{...x,time:times.get(x.name)}:x);}
  function lipSourceSignature(track,clip,dialogue){return JSON.stringify([state.projectId,fps,track.target,clip.start,clip.len,clip.sourceOffset||0,clip.volume??1,clip.fadeIn||0,clip.fadeOut||0,dialogue.id,dialogue.voice]);}
  function lipSyncOutdated(clip){const ref=clip.lipSyncSource;if(!ref)return false;const found=getClip(ref.audioClipId),dialogue=state.dialogues.find(d=>d.id===found?.clip?.dialogue);return !found||found.track.type!=='audio'||found.track.enabled===false||!dialogue||clip.start!==found.clip.start||clip.len!==found.clip.len||lipSourceSignature(found.track,found.clip,dialogue)!==ref.signature;}
  let gizmoEdit=null,gizmoPollPaused=false,gizmoMode='move';
  function setGizmoMode(mode){if(!['move','rotate','scale'].includes(mode))return;if(mode!=='move'&&!gizmoTrsSupported){notify('当前 Player 不支持旋转或缩放手柄，请使用新版实验入口');return;}gizmoMode=mode;document.querySelectorAll('[data-gizmo-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.gizmoMode===mode)));bridgeLast='';syncPlayer();}
  const gizmoTools=$('#gizmo-tools');gizmoTools.hidden=!editorGizmoSupported;gizmoTools.querySelectorAll('[data-gizmo-mode]').forEach(b=>{if(b.dataset.gizmoMode!=='move'&&!gizmoTrsSupported)b.disabled=true;b.onclick=()=>setGizmoMode(b.dataset.gizmoMode);});
  function finishGizmoEdit(){if(!gizmoEdit)return;const before=gizmoEdit.before;gizmoEdit=null;if(JSON.stringify(before)!==JSON.stringify(state)){remember(before);updateProjectLabel();}}
  function selectedGizmo(){const o=obj();if(!editorGizmoSupported||!o||hierarchySelection.ids.length>1||selectedAsset||playing||exporting||!evaluated(o,'visible')||(!supportedActor(o)&&!supportedProp(o)))return null;const ctx=cameraContext();return {editorSelectedId:o.id,editorSelectedKind:supportedProp(o)?'prop':'actor',...(supportedProp(o)?{editorPropId:o.propId}:{}),...(gizmoTrsSupported?{editorToolMode:gizmoMode,editorSelectedScale:evaluated(o,'scale')} : {}),editorCanMove:!(ctx?.inRange&&ctx.track?.locked)};}
  function consumeGizmoEvent(e){const property=e?.property||'position',value=e?.[property];if(!e||typeof e.id!=='string'||!['position','rotation','scale'].includes(property)||!['begin','move','end'].includes(e.phase)||!Array.isArray(value)||value.length!==3||value.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>10000)||(property==='scale'&&value.some(v=>v<.01||v>100)))return;const ctx=cameraContext();if(!ctx||ctx.object.id!==e.id||state.selected!==e.id||playing||selectedAsset||(ctx.inRange&&ctx.track.locked)){finishGizmoEdit();return;}if(e.phase==='begin'){finishGizmoEdit();gizmoEdit={id:e.id,property,before:copyState()};return;}if(!gizmoEdit||gizmoEdit.id!==e.id||gizmoEdit.property!==property)return;const o=ctx.object,next=value.map(v=>Math.round(v*10000)/10000);o.transform ||= {position:[0,0,0],rotation:[0,0,0]};const keys=ctx.inRange&&ctx.track.enabled!==false?ctx.clip.propertyKeys?.[property]:null;if(keys?.length){const time=quantize(state.current-ctx.clip.start);let key=keys.find(k=>Math.abs(k.time-time)<frame/2);if(key)key.value=next;else keys.push({time,value:next});keys.sort((a,b)=>a.time-b.time);renderTimeline();}else o.transform[property]=next;if(e.phase==='end')finishGizmoEdit();updateClock();updateProjectLabel();}
  function unsupportedScale(){if(gizmoTrsSupported)return false;const changed=v=>Array.isArray(v)&&v.some(x=>Math.abs(x-1)>1e-6);return state.objects.some(o=>changed(o.transform?.scale))||state.tracks.some(t=>t.clips.some(c=>c.propertyKeys?.scale?.some(k=>changed(k.value))));}
  const mediaSupported=new URLSearchParams(location.search).get('screenMedia')==='1';
  const compositionEditor=CreatorCompositionEditor({state:()=>state,copy:copyState,remember,render,notify,esc,id,asset:assetById,modal:showModal,close:closeModal,found:()=>state.selectedClip&&getClip(state.selectedClip),fps:()=>fps,duration:()=>duration});
  const mediaEditor=CreatorScreenMediaEditor.create({supported:()=>mediaSupported,state:()=>state,restore:s=>{state=s;render();},copy:copyState,remember,render,inspector:renderInspector,sync:updateClock,notify,esc,id,asset:assetById,assets:allAssets,label:assetDisplay,rename:renameAsset,quantize,duration:()=>duration,frame:()=>frame,aspect:uiAspect,dimensions:()=>videoDimensions(state.globalSettings.exportQuality),playing:()=>playing,getClip,related:relatedClips,object:obj,found:()=>state.selectedClip&&getClip(state.selectedClip),pickSource:pickClipSource,selectClip:clipId=>{selectedClipIds.clear();state.selectedClip=clipId;state.selected=null;selectedAsset=null;},selectObject,modal:showModal,close:closeModal,timeline:trackId=>{revealTimelineTrack(trackId);setBottomTab('timeline');}});
  function playerSnapshot() {
    if(state.compositionVersion===1&&new URLSearchParams(location.search).get('composition')!=='1')throw Error('图层合成需要新版 Player，请保存并重启');
    if(CreatorPostEffects.packet(state,state.current).enabled&&new URLSearchParams(location.search).get('postEffects')!=='1')throw Error('画面效果需要新版 Player，请保存并重启创作器');
    if(state.layerSchema===1&&!animationLayersSupported)throw Error('此工程使用动画分层，请重启到新版 Player');
    const actor=state.objects.find(o=>o.id==='ttmr')||{id:'__absent_actor',type:'角色',components:[],visible:false}, cam=activeCamera(), fallback=state.objects.find(o=>o.id==='cam')||{id:'__absent_camera',type:'相机',transform:{position:[0,1,3],rotation:[0,180,0]},fov:35};
    const view=cam||fallback, action=actionFor(actor), entry=dialogueAt(state.current),dialogue=entry?.dialogue;
    const actorInstances=assetFeatures?state.objects.filter(supportedActor).map(o=>{const a=actionFor(o);return {id:o.id,characterId:actorCode(o),placementId:activeTransformClip(o)?.id||'',...(costumeSupported&&o.costumeAssetId&&costumeDefinitions.find(x=>x.id===o.costumeAssetId)?.playerAvailable?{costumeId:o.costumeAssetId}:{}),position:evaluated(o,'position'),rotation:evaluated(o,'rotation'),...(gizmoTrsSupported?{scale:evaluated(o,'scale')}:{}),...(arrangement?{visible:evaluated(o,'visible'),faceWeight:expressionFor(o),...(faceShapeAssets.length?{faceShapes:faceShapesFor(o)}:{}),...motionStateFor(o),...(animationLayersSupported?{motionLayers:layeredBody(o)}:{}),motionLoop:false,...(idleSupported?{idleMotionId:idleDefinition(o)?.motionId||'',idleMotionTime:state.current}:{})}:{})};}):null;
    const sceneProps=classroomChairsSupported?[...state.objects.filter(supportedProp),...(state.hiddenSceneProps||[]).map(key=>{const spec=classroomCatalog.find(p=>p.id===key);return spec&&{id:'hidden-'+key,type:'道具',propId:key,visible:false,transform:{position:spec.position,rotation:spec.rotation}};}).filter(Boolean)].map(o=>({id:o.propId,position:evaluated(o,'position'),rotation:evaluated(o,'rotation'),...(gizmoTrsSupported?{scale:evaluated(o,'scale')}:{}),visible:evaluated(o,'visible')})):undefined;
    const snapshot={...(state.compositionVersion===1?{composition:CreatorComposition.packet(state,state.current,{text:(d,c)=>displayedDialogue({dialogue:d,clip:c},state.current),ui:c=>CreatorUITransitions.evaluate(uiPlan().filter(x=>x.id===c.id),state.current,uiAspect())})}:{}),postEffects:CreatorPostEffects.packet(state,state.current),...(mediaSupported?{mediaDraws:mediaEditor.draws(),...mediaEditor.selection()}:{}),...(renderSettingsSupported?{renderSettings:CreatorRenderSettings.normalize(state.globalSettings.render)}:{}),...(uiTransitionsSupported?{uiDraws:CreatorUITransitions.evaluate(uiPlan(),state.current,uiAspect())}:{}),...(editorGizmoSupported?(selectedGizmo()||{editorSelectedId:'',editorSelectedKind:'',editorCanMove:false}):{}),...(assetFeatures?{actorInstances,sceneId:sceneAt()}:{}),...(sceneProps?{sceneProps}:{}),...(arrangement?{hasArrangement:true,cameraEnabled:Boolean(cam),sceneVisible:Boolean(sceneAt())&&evaluated(state.objects.find(o=>o.id==='scene'),'visible'),subtitleSpeaker:dialogue?.speaker?.slice(0,100)||'',subtitleText:displayedDialogue(entry,state.current).slice(0,500).replace(/[\uD800-\uDBFF]$/,''),subtitleStyle:dialogue?.uiStyle||'box',subtitleColor:dialogueColors(dialogue)[0],subtitleColorEnd:dialogueColors(dialogue)[1],subtitleNameTextColor:CreatorCharacterColors.label(state,dialogue)}:{}),actorPlacementId:activeTransformClip(actor)?.id||'',actorPosition:evaluated(actor,'position'),actorRotation:evaluated(actor,'rotation'),...(gizmoTrsSupported?{actorScale:evaluated(actor,'scale')}:{}),cameraPosition:evaluated(view,'position'),cameraRotation:evaluated(view,'rotation'),fov:evaluated(view,'fov'),...motionStateFor(actor),...(animationLayersSupported?{motionLayers:layeredBody(actor)}:{}),motionLoop:false,...(idleSupported?{idleMotionId:idleDefinition(actor)?.motionId||'',idleMotionTime:state.current}:{}),...CreatorRenderSettings.physicsPacket(state.globalSettings,physicsAvailable,physicsModesSupported),...(globalSettingsSupported?{hasOutlineSettings:true,outlineWidth:state.globalSettings.outlineEnabled?state.globalSettings.outlineWidth:0}:{})};
    return snapshot;
  }
  function stopForPreviewError(reason){const active=playing||audioEffectsPreview.isWaiting();if(active)setPlaying(false);uiSceneGate=null;bridgeLast='';$('#bridge-status').textContent=reason;if(active)notify('播放已暂停',{kind:'error',sticky:true,detail:reason+'\n请检查对应场景或转场片段的素材引用，再重新播放。'});}
  function syncPlayer() {
    if(uiSceneGate&&Math.abs(state.current-uiSceneGate.time)>1e-6)uiSceneGate=null;
    if(exporting)return;try{uiPlan();}catch(error){stopForPreviewError(error.message);return;} if(missingScene()){stopForPreviewError('场景素材不可用：'+missingScene());return;} if(unsupportedScale()){document.querySelector('#bridge-status').textContent='当前 Player 不支持工程缩放，请使用新版三轴实验入口';bridgeLast='';return;} if(missingProps()){document.querySelector('#bridge-status').textContent='当前 Player 不支持工程中的教室道具';bridgeLast='';return;} if(missingIdle()){document.querySelector('#bridge-status').textContent='常驻动画不可用：'+missingIdle().name;bridgeLast='';return;} const missingMotion=state.tracks.filter(t=>t.type==='animation'&&t.enabled!==false).flatMap(t=>t.clips).find(c=>clipActive(c)&&String(c.assetId||'').startsWith('asset-film-')&&!motionDefinition(c.assetId));if(missingMotion){document.querySelector('#bridge-status').textContent='动作素材不可用：'+missingMotion.name;bridgeLast='';return;} if(actorUnavailable()){document.querySelector('#bridge-status').textContent=actorUnavailable().name+' 的本地资源或 Player 能力不可用';bridgeLast='';return;} let snapshot;try{const pending=prepareLayerFaces();if(pending.length){document.querySelector('#bridge-status').textContent='正在读取常驻表情与面部曲线…';return;}snapshot=playerSnapshot();}catch(error){document.querySelector('#bridge-status').textContent=error.message;bridgeLast='';return;}if(!snapshot)return;
    const key=JSON.stringify(snapshot); if(key===bridgeLast){refreshCostumeStatus();return;} bridgeLast=key;
    bridgePending={...snapshot,id:++bridgeId}; sendPlayer();
  }
  let lastBridgeFailure='';
  async function sendPlayer() {
    if(bridgeBusy||!bridgePending)return;
    bridgeBusy=true; const message=bridgePending; bridgePending=null;
    const status=document.querySelector('#bridge-status');
    try { await prepareCodeUI(message);const prefix=location.pathname.split('/')[1]; const response=await fetch('/'+prefix+'/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message)}); const raw=await response.text();let reply;try{reply=JSON.parse(raw);}catch{throw Error('预览接口返回异常内容（HTTP '+response.status+'），请重启创作器后重试');}if(!response.ok||!reply.ok||reply.id!==message.id)throw Error(reply.error||'预览请求失败（HTTP '+response.status+'）');lastBridgeFailure='';if(uiSceneGate&&message.sceneId===uiSceneGate.sceneId&&Math.abs(state.current-uiSceneGate.time)<1e-6){if(reply.sceneReady)uiSceneGate=null;else{bridgeLast='';status.textContent='正在加载场景轨道指定的场景…';}}consumeGizmoEvent(reply.gizmoEvent);mediaEditor.consume(reply.mediaEvent);if(gizmoTrsSupported&&['move','rotate','scale'].includes(reply.gizmoToolMode)&&reply.gizmoToolMode!==gizmoMode)setGizmoMode(reply.gizmoToolMode); status.textContent=uiSceneGate?'正在加载场景轨道指定的场景…':(new URLSearchParams(location.search).get('embedded')==='1'?'Unity 已应用':'Unity 已应用 · 独立窗口')+(pendingCostume()?' · 所选服装尚未应用，预览为基础服':'')+(message.subtitleStyle==='game'&&!gameDialogue?' · 游戏对白素材不可用，已回退标准样式':'')+(performance?(idleSupported?'':' · 旧版 Player 不支持待机'):' · 动作、衣物和场景样本未加载'); }
    catch(error) { const reason='画面同步失败：'+error.message;bridgeLast='';uiSceneGate=null;if(lastBridgeFailure!==reason){lastBridgeFailure=reason;notify('画面同步失败',{kind:'error',sticky:true,detail:reason+'\n字幕、场景和滤镜尚未应用；请解决该错误后重新播放。'});}if(playing)setPlaying(false);status.textContent=reason; }
    finally { bridgeBusy=false; if(bridgePending)sendPlayer(); }
  }
  setInterval(()=>{if(editorGizmoSupported&&(!document.hidden||editorGizmoTest)&&!exporting&&!gizmoPollPaused&&!bridgeBusy&&!bridgePending&&(selectedGizmo()||mediaEditor.selected())){bridgeLast='';syncPlayer();}},120);
  function syncCameraInspector(){const ctx=cameraContext();if(!ctx||!$('#camera-properties'))return;for(const property of Object.keys(cameraProperties)){const inputs=document.querySelectorAll(`[data-camera-field="${property}"]`);if(!inputs.length)continue;const value=cameraValue(ctx,property);inputs.forEach(input=>{if(document.activeElement!==input)input.value=String(Number((Array.isArray(value)?value[Number(input.dataset.axis)]:value).toFixed(2)));});const button=document.querySelector(`[data-camera-key="${property}"]`);if(button){const has=ctx.inRange&&ctx.clip.propertyKeys?.[property]?.some(k=>Math.abs(k.time-(state.current-ctx.clip.start))<frame/2);button.textContent=has?'◆':'◇';button.classList.toggle('has-key',Boolean(has));button.disabled=!ctx.inRange||ctx.track.locked;button.title=ctx.track?.locked?'轨道已锁定':!ctx.inRange?'将播放头移到对应轨道片段内':has?'删除当前帧的关键帧':'添加当前帧的关键帧';}}const note=$('#camera-key-note');if(note)note.textContent=ctx.track?.locked?'轨道已锁定':ctx.inRange?'◇ 添加关键帧；已有关键帧后，修改数值会自动记录':ctx.object.type==='相机'?'将播放头移至相机片段内，以设置关键帧':'添加变换轨道并将播放头移入片段，以设置关键帧';}
  const checkedMotionThumbnails=new Set();
  async function loadVisibleMotionThumbnails(assets){if(!window.assetAPI?.motionThumbnails)return;const ids=assets.filter(a=>(motionDefinition(a.id)||Boolean(faceMotionById(a.id)))&&!assetThumbs[a.id]&&!checkedMotionThumbnails.has(a.id)).map(a=>a.id);if(!ids.length)return;ids.forEach(id=>checkedMotionThumbnails.add(id));try{const found=await window.assetAPI.motionThumbnails(ids);for(const [id,data] of Object.entries(found))if(!assetThumbs[id])assetThumbs[id]=data;if(Object.keys(found).length)renderAssetBrowser();}catch(error){ids.forEach(id=>checkedMotionThumbnails.delete(id));}}
  const assetPageSize=100;let assetPage=1,lastAssetView='',showPrefetchMusic=false;
  const isPrefetchMusic=a=>a.type==='音乐'&&(a.audioOrigin||a.source)==='预加载短段';
  $('#asset-motion-filter').onchange=event=>{motionKindFilter=event.target.value;renderAssetBrowser();};
  const sourceLabel=a=>({unpacked:'解包',project:'工程',shared:'通用'}[CreatorProjectRemoval.source(a)]);
  function browserAssets(){const hidden=new Set(state.hiddenAssetIds||[]);return allAssets().filter(a=>!hidden.has(a.id)&&(assetSourceFilter==='all'||CreatorProjectRemoval.source(a)===assetSourceFilter)&&(showPrefetchMusic||!a.filmCatalogId||!isPrefetchMusic(a)));}
  $('#asset-source-filter').onchange=e=>{assetSourceFilter=e.target.value;renderAssetBrowser();renderInspector();};
  let visualFilter='all';
  const matchesAssetCategory=(asset,type)=>type==='全部'||(type==='图片 / 视频'&&CreatorScreenMedia.isVisual(asset)&&(visualFilter==='all'||asset.type===visualFilter))||(type==='全部动画'?(asset.type==='动作'||String(asset.id||'').startsWith('asset-face-motion-')):asset.type===type);
  function matchesAssetSearch(a,terms){return !terms.length||matchesSearch(`${a.alias||''} ${a.source||''} ${a.streamName||a.filmAudio?.streamName||''} ${(Array.isArray(a.styles)?a.styles:[]).map(s=>s.name).join(' ')}`,terms);}
  function filteredBrowserAssets(){const terms=searchTerms($('#asset-browser-search').value);return browserAssets().filter(a=>matchesAssetCategory(a,assetFilter)&&matchesAssetSearch(a,terms)&&(!(animationLayersSupported&&assetFilter==='动作')||CreatorAnimationLayers.matchesFilter(motionDefinition(a.id),motionKindFilter)));}
  function renderAssetBrowser(){if(draggedAssetId){assetDragRefreshPending=true;return;}syncPanelSelections();
    let visualFilters=$('#asset-visual-filters');if(!visualFilters){visualFilters=document.createElement('div');visualFilters.id='asset-visual-filters';visualFilters.innerHTML='<select aria-label=图片视频筛选><option value=all>全部图片与视频</option><option value=贴图>仅图片</option><option value=视频>仅视频</option></select>';$('#asset-motion-filters').after(visualFilters);visualFilters.firstChild.onchange=e=>{visualFilter=e.target.value;renderAssetBrowser();};}visualFilters.hidden=assetFilter!=='图片 / 视频';
    $('#asset-motion-filters').hidden=!animationLayersSupported||assetFilter!=='动作';$('#asset-motion-filter').value=motionKindFilter;
    const catalog=browserAssets(),prefetchCount=allAssets().filter(a=>a.filmCatalogId&&isPrefetchMusic(a)).length;
    $('#asset-audio-filters').hidden=!['全部','音乐'].includes(assetFilter)||!prefetchCount;$('#asset-show-prefetch').checked=showPrefetchMusic;$('#asset-prefetch-count').textContent=showPrefetchMusic?`包含 ${prefetchCount} 条预加载音乐`:`已隐藏 ${prefetchCount} 条预加载音乐`;
    $('#asset-tree').innerHTML=`<div class="asset-root">${icon('down')}${icon('folder')} <span>素材库</span></div>`+assetTypes.map(t=>`<button class="asset-tree-item ${assetFilter===t?'active':''}" data-category="${t}">${icon('folder')}<span>${t==='全部'?'全部素材':t}</span><small>${t==='全部'?catalog.length:catalog.filter(a=>matchesAssetCategory(a,t)).length}</small></button>`).join('');
    $('#asset-breadcrumb').textContent=assetFilter==='全部'?'全部素材':assetFilter;
    const terms=searchTerms($('#asset-browser-search').value),view=JSON.stringify([assetFilter,assetSourceFilter,terms,showPrefetchMusic,motionKindFilter,visualFilter]);if(view!==lastAssetView){assetPage=1;lastAssetView=view;}
    const assets=catalog.filter(a=>matchesAssetCategory(a,assetFilter)&&matchesAssetSearch(a,terms)&&(!(animationLayersSupported&&assetFilter==='动作')||CreatorAnimationLayers.matchesFilter(motionDefinition(a.id),motionKindFilter)));
    CreatorPanelSelection.retain(assetSelection,assets.map(a=>a.id));selectedAsset=assetSelection.lead;
    const pageCount=Math.max(1,Math.ceil(assets.length/assetPageSize));assetPage=Math.max(1,Math.min(pageCount,assetPage));const pageStart=(assetPage-1)*assetPageSize,visibleAssets=assets.slice(pageStart,pageStart+assetPageSize);
    loadVisibleCostumeThumbnails(visibleAssets);loadVisibleMotionThumbnails(visibleAssets);
    $('#asset-grid').innerHTML=visibleAssets.map(a=>`<button class="asset-tile ${assetSelection.ids.includes(a.id)?'selected':''}" draggable="${a.filmCatalogId||a.voiceProvider||(a.catalogOnly&&(!a.knownCharacter||!a.bodyAvailable||!a.dependenciesAvailable))?'false':'true'}" data-asset="${esc(a.id)}" aria-selected="${assetSelection.ids.includes(a.id)}" title="${esc(assetDisplay(a))} · ${esc(a.type)} · 来源：${sourceLabel(a)}"><span class="asset-thumb" style="--asset-color:${assetColors[a.type]||'#aaa'}">${(assetThumbs[a.id]||a.thumbnail)?`<img src="${esc(assetThumbs[a.id]||a.thumbnail)}" alt="${esc(assetDisplay(a))} 缩略图" draggable="false">`:icon(assetIcons[a.type]||'box')}</span><span class="asset-tile-name">${esc(assetDisplay(a))}</span><span class="asset-tile-type">${a.voiceProvider&&Array.isArray(a.styles)?(a.voiceProvider==='voicevox'?'VOICEVOX':'GPT-SoVITS')+' · '+a.styles.length+' 种语气':esc(a.type)}${a.filmCatalogId?' · 已解包，未导入':''}${a.catalogOnly?(a.currentDefault?' · 当前基础服':a.playerAvailable?' · 可尝试换装':' · 待组装'):''}${a.available===false?' · 缺少文件':''}${a.id.startsWith('asset-film-')?' · 候选':''}${Boolean(faceMotionById(a.id))?' · 面部动画候选':''}${faceAvailability(a)&&faceAvailability(a).supported.length<faceAvailability(a).total?' · 部分角色':''}${assetIssues[a.id]?' · 无法预览':''} · ${sourceLabel(a)}</span></button>`).join('')||'<div class="asset-empty">此分类没有匹配的素材</div>';
    $('#asset-count').textContent=assets.length?`共 ${assets.length} 项 · 显示 ${pageStart+1}–${pageStart+visibleAssets.length}${assetSelection.ids.length?' · 已选 '+assetSelection.ids.length+' 项':''}`:'没有匹配素材';$('#asset-page').value=String(assetPage);$('#asset-page').max=String(pageCount);$('#asset-page-total').textContent=`/ ${pageCount}`;$('#asset-prev').disabled=assetPage<=1;$('#asset-next').disabled=assetPage>=pageCount;
    $('#refresh-voices').hidden=!desktop||assetFilter!=='音源';$('#refresh-voices').disabled=voiceLoading;$('#costume-thumbnails').hidden=!desktop||assetFilter!=='服装';$('#costume-thumbnails').disabled=costumeBatchRunning&&!costumeBatch;$('#costume-thumbnails').textContent=costumeBatch?'停止生成':costumeBatchRunning?'正在停止…':'生成本页前 20 项缩略图';
    $('#asset-detail').textContent=assetFilter==='音源'?(voiceLoading?'正在读取本地音源…':voiceWarnings.length?'部分音源不可用：'+voiceWarnings[0]:'点击查看语气和试听 · 右键或 F2 重命名'):['音乐','音效'].includes(assetFilter)?(filmAudioError?'音频清单读取失败：'+filmAudioError:'选中已解包音频可试听、导入 · 导入后拖到音频轨道'):assetFilter==='服装'?'将服装拖到对应角色上 · 使用基础脸部和头发':assetFilter==='动作'||assetFilter==='表情'||assetFilter==='全部动画'?'选中动画后自动生成预览 · 首次生成需要等待':'拖入文件可导入 · 将角色或场景拖到层级';
    $('#asset-detail').title=assetFilter==='音源'?voiceWarnings.join('\n'):'';
  }
  function clipTitle(track,clip){const d=track.type==='dialogue'&&clip.dialogue&&state.dialogues.find(x=>x.id===clip.dialogue);return d?`[${d.speaker}]:${d.text}`:clip.name;}
  function refreshDialogueTitles(dialogueId){for(const t of state.tracks)if(t.type==='dialogue')for(const c of t.clips)if(c.dialogue===dialogueId){const el=document.querySelector(`[data-clip="${CSS.escape(c.id)}"] .clip-title`);if(el){el.textContent=clipTitle(t,c);el.title=clipTitle(t,c);}}}
  // Only create interactive marks for the viewport; dense marks share screen pixels.
  function timelineView(){
    const scroller=$('.timeline-scroll'), scale=$('#ruler').getBoundingClientRect(), viewport=scroller.getBoundingClientRect(), tracks=$('#tracks').getBoundingClientRect();
    const width=Math.max(1,scale.width), pixelsPerSecond=width/duration, pad=120;
    return {start:Math.max(0,(viewport.left+trackLabelWidth-scale.left-pad)/pixelsPerSecond),end:Math.min(duration,(viewport.right-scale.left+pad)/pixelsPerSecond),pixelsPerSecond,top:viewport.top-tracks.top-68,bottom:viewport.bottom-tracks.top+68,rowHeight:desktop?34:37};
  }
  function timelineKeyMarks(keys,clip,view){
    const buckets=new Set(),marks=[];
    for(const k of keys){const t=clip.start+k.time;if(k.time<0||k.time>clip.len+1e-6||t>duration||t<view.start||t>view.end)continue;const bucket=Math.floor(t*view.pixelsPerSecond/6);if(buckets.has(bucket))continue;buckets.add(bucket);marks.push(k);}
    return marks;
  }
  function rulerLabel(seconds){const h=Math.floor(seconds/3600),m=Math.floor(seconds/60)%60,s=seconds%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${Math.floor(seconds/60)}:${String(s).padStart(2,'0')}`;}
  function renderRuler(view){
    const px=view.pixelsPerSecond, ticks=[], seconds=[1,2,5,10,15,30,60,120,300,600,900,1800,3600,7200,14400];
    const step=seconds.find(x=>x*px>=85)||Math.ceil(85/px/3600)*3600;
    for(let s=Math.max(0,Math.ceil(view.start/step)*step);s<=view.end+1e-7;s+=step)ticks.push(`<span class="ruler-tick" style="left:${s/duration*100}%">${rulerLabel(s)}</span>`);
    if(px/fps>=8){const frameSteps=[1,2,5,10,15,20,30,60],fstep=frameSteps.find(x=>x*px/fps>=34)||fps;const from=Math.max(0,Math.ceil(view.start*fps/fstep)*fstep),to=Math.min(Math.floor(duration*fps),Math.ceil(view.end*fps));for(let f=from;f<=to;f+=fstep){if(f%fps===0)continue;const s=f/fps;ticks.push(`<span class="ruler-frame-tick" style="left:${s/duration*100}%" title="${time(s)}">${f%fps}</span>`);}}
    $('#ruler').innerHTML=ticks.join('')+(state.markers||[]).filter(m=>m.time<=duration&&m.time>=view.start&&m.time<=view.end).map(m=>`<button type="button" class="timeline-marker" data-marker="${esc(m.id)}" style="left:${m.time/duration*100}%" title="${esc(m.name)} · ${time(m.time)}；单击定位，双击编辑" aria-label="${esc(m.name)}">◆</button>`).join('')+`<div class="ruler-playhead" style="left:${state.current/duration*100}%"></div>`;
  }
  function fadeMarkup(clip,track){
    if(!['animation','expression'].includes(track.type))return '';const available=fadeSpan(clip,track.type),a=CreatorFades.amounts(clip,available),visible=Math.max(frame,Math.min(clip.len,duration-clip.start)),inPct=Math.min(100,100*a.fadeIn/visible),endPct=Math.min(100,100*available/visible),outPct=Math.max(0,endPct-100*a.fadeOut/visible);
    const handle=(side,pct,value)=>`<button type="button" class="fade-handle" data-fade="${side}" style="left:clamp(6px,${pct}%,calc(100% - 6px))" aria-label="${side==='in'?'渐入':'渐出'}时长" title="${side==='in'?'渐入':'渐出'} ${value.toFixed(2)} 秒；拖动或按方向键调整" ${track.locked?'disabled':''}></button>`;
    return `<span class="fade-region in" style="width:${inPct}%"></span><span class="fade-region out" style="left:${outPct}%;width:${Math.max(0,endPct-outPct)}%"></span>${handle('in',inPct,a.fadeIn)}${handle('out',outPct,a.fadeOut)}<span class="fade-readout"></span>`;
  }
  function refreshFadeVisual(element,clip,track,side){const available=fadeSpan(clip,track.type),a=CreatorFades.amounts(clip,available),visible=Math.max(frame,Math.min(clip.len,duration-clip.start)),inPct=Math.min(100,100*a.fadeIn/visible),endPct=Math.min(100,100*available/visible),outPct=Math.max(0,endPct-100*a.fadeOut/visible);for(const [key,pct,value] of [['in',inPct,a.fadeIn],['out',outPct,a.fadeOut]]){const h=element.querySelector(`[data-fade="${key}"]`);if(h){h.style.left=`clamp(6px,${pct}%,calc(100% - 6px))`;h.title=`${key==='in'?'渐入':'渐出'} ${value.toFixed(2)} 秒；拖动或按方向键调整`;}}const z=element.querySelector('.fade-region.in'),r=element.querySelector('.fade-region.out');if(z)z.style.width=inPct+'%';if(r){r.style.left=outPct+'%';r.style.width=Math.max(0,endPct-outPct)+'%';}const label=element.querySelector('.fade-readout');if(label){label.style.left=`clamp(0px,${side==='in'?inPct:outPct}%,calc(100% - 35px))`;label.textContent=(side==='in'?a.fadeIn:a.fadeOut).toFixed(2)+'s';}}
  let timelinePlayheads=[],timelineRows=[],knownTimelineTracks=new Set(state.tracks.map(t=>t.id));
  const collapsedTimelineGroups=new Map();
  let timelineGrouping='type';
  try{if(localStorage.getItem('creator-timeline-grouping-v1')==='person')timelineGrouping='person';}catch(_){}
  function timelineGroups(){return CreatorTimelineGroups.build(state,timelineGrouping,o=>[actorNames[actorCode(o)]||'']);}
  function revealTimelineTrack(trackId){CreatorTimelineGroups.reveal(timelineGroups(),trackId,collapsedTimelineGroups);}
  function updateTimelineGroupingButton(){const button=$('#timeline-grouping'),current=timelineGrouping==='person'?'按人物':'按类别',next=timelineGrouping==='person'?'按类别':'按人物';button.textContent='分类：'+current;button.title='当前'+current+'分组；点击切换为'+next;button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(timelineGrouping==='person'));}
  $('#timeline-grouping').onclick=()=>{if(timelineEditBusy||drag||marquee||trackWidthDrag)return;timelineGrouping=timelineGrouping==='person'?'type':'person';try{localStorage.setItem('creator-timeline-grouping-v1',timelineGrouping);}catch(_){}renderTimeline();$('.timeline-scroll').scrollTop=0;updateClock();};
  function timelineTrackPeers(track){
    if(state.compositionVersion===1&&CreatorComposition.visual(track))return CreatorComposition.tracks(state);
    return CreatorTimelineGroups.peers(timelineGroups(),track.id).filter(t=>t.type===track.type);
  }
  function buildTimelineRows(){
    const rows=CreatorTimelineGroups.flatten(timelineGroups(),collapsedTimelineGroups,knownTimelineTracks);
    knownTimelineTracks=new Set(state.tracks.map(t=>t.id));return rows;
  }
  function groupRowMarkup(row){const title=row.title;return `<div class="track-row timeline-group ${row.children?'timeline-parent':''}" data-track-group="${esc(row.key)}" style="--timeline-depth:${row.depth}"><div class="track-name group-name"><button class="group-toggle" data-group-toggle="${esc(row.key)}" aria-expanded="${!row.collapsed}" aria-label="展开或折叠 ${esc(title)}">${row.collapsed?'▸':'▾'}</button><span class="group-title" title="${esc(title)}">${esc(title)}</span><span class="group-count">${row.tracks.length}</span>${row.layerAction&&animationLayersSupported?`<button class="track-control" data-layer-resident="${esc(row.layerAction)}" title="常驻设置" aria-label="常驻设置">⚙</button><button class="track-control" data-layer-add="${esc(row.layerAction)}" title="添加叠加片段" aria-label="添加叠加片段">＋</button>`:row.key==='ui'?'<button class="track-control" data-ui-layer-add title="添加 UI 子轨道">＋</button>':row.key==='visualEffect'?'<button class="track-control" data-effect-layer-add title="添加画面效果轨道">＋</button>':''}<span class="track-width-row-handle" data-track-resize aria-hidden="true"></span></div><div class="track-lane timeline-group-lane"><div class="playhead" style="left:${state.current/duration*100}%"></div></div></div>`;}
  var marquee=null,marqueeScrollFrame=0;
  function renderTimeline(preserveMarquee=false){
    if(!preserveMarquee)cancelMarquee();
    if(!soloClipId&&state.selectedClip&&!hasMultiSelection()){const group=CreatorTimelineEdit.select(state,[state.selectedClip]);if(group.length>1)selectedClipIds=new Set(group);}
    if(!hasMultiSelection()){if(!state.selectedClip||!selectedClipIds.has(state.selectedClip))selectedClipIds.clear();$('#split').disabled=false;$('#delete-clip').disabled=false;}
    updateTimelineGroupingButton();const view=timelineView();renderRuler(view);timelineRows=buildTimelineRows();
    $('#tracks').innerHTML=timelineRows.map((row,index)=>{if(row.group)return groupRowMarkup(row);const t=row.track,c=comp(t.type);return `<div class="track-row timeline-child ${t.enabled===false?'track-disabled':''}" data-track="${esc(t.id)}" style="--timeline-depth:${row.depth}"><div class="track-name" style="--track-color:${c.color}">${CreatorComposition.visual(t)&&state.compositionVersion===1?`<button class="track-control" draggable="true" data-fx-track-grip="${esc(t.id)}" title="拖动调整优先级；轨道菜单也可上移或下移" aria-label="调整画面层次">↕</button>`:icon(c.icon)}<span data-track-name="${esc(t.id)}" title="${esc(t.name)}">${t.layerRole==='base'?'基础 · ':t.layerRole==='overlay'?'↳ ':t.layerRole==='legacy'?'旧轨 · ':''}${esc(t.name)}</span>${['ui','expression','visualEffect','visualFilter'].includes(t.type)?`<button class="track-control" data-${t.type==='ui'?'ui-add':t.type==='expression'?'expression-add':'effect-add'}="${esc(t.id)}" title="添加片段" aria-label="添加片段" ${t.locked?'disabled':''}>＋</button>`:''}<button class="track-control ${t.enabled===false?'off':''}" data-track-enable="${esc(t.id)}" aria-label="${t.enabled===false?'启用':'禁用'} ${esc(t.name)}" title="${t.enabled===false?'启用轨道':'禁用轨道'}">${icon(t.type==='audio'?'sound':'eye')}</button><button class="track-control ${t.locked?'locked':''}" data-track-lock="${esc(t.id)}" aria-label="${t.locked?'解锁':'锁定'} ${esc(t.name)}" title="${t.locked?'解锁轨道':'锁定轨道'}">${icon('lock')}</button><button class="track-control" data-track-menu="${esc(t.id)}" aria-label="${esc(t.name)}轨道选项" title="轨道选项">⋯</button><span class="track-width-row-handle" data-track-resize aria-hidden="true" title="拖动调整轨道名宽度"></span></div><div class="track-lane" data-lane="${esc(t.id)}">${(index*view.rowHeight<=view.bottom&&(index+1)*view.rowHeight>=view.top?t.clips.filter(x=>x.start<view.end&&x.start+x.len>=view.start):[]).map(x=>`<div class="clip ${isSelectedClip(x.id)?'selected':''} ${t.locked?'clip-locked':''} ${x.groupId?'clip-grouped':''}" data-clip="${esc(x.id)}" data-lip-source="${x.lipSyncSource?'1':'0'}" style="left:${x.start/duration*100}%;width:${Math.max(0,Math.min(x.len,duration-x.start))/duration*100}%;display:${x.start>=duration?'none':'flex'};--clip-color:${c.color}" title="拖动片段移动；拖动左右边缘裁剪。密集关键帧按屏幕密度显示；放大可查看细节，实际数据完整。"><span class="trim-handle left" data-trim="left"></span>${fadeMarkup(x,t)}${uiCoverMarkup(x)}${icon(c.icon)}<span class="clip-title" title="${esc(clipTitle(t,x))}">${x.groupId?'<span class="clip-group-badge" title="'+esc(state.clipGroups?.find(g=>g.id===x.groupId)?.name||'片段组')+'">▣</span> ':''}${esc(clipTitle(t,x))}${t.type==='audio'&&x.audioLoop?' · 循环':''}${lipSyncOutdated(x)?' · 需重新生成':''}</span>${effectsEditor.badges(t,x)}${t.type==='audio'?'<span class="clip-wave">▂▅▃▇▂▅▃▆▃▅</span>':''}${(x.len*view.pixelsPerSecond<6?[]:Object.entries({...x.propertyKeys,...x.mediaKeys})).flatMap(([property,keys])=>timelineKeyMarks(keys,x,view).map(k=>`<span class="keyframe-mark" data-key-time="${k.time}" data-key-property="${property}" style="left:${Math.max(0,Math.min(100,k.time/Math.min(x.len,duration-x.start)*100))}%" title="${esc(keyNames[property]||property)}：${esc(Array.isArray(k.value)?k.value.join(', '):k.value)}"></span>`)).join('')}<span class="trim-handle right" data-trim="right"></span></div>`).join('')}<div class="playhead" style="left:${state.current/duration*100}%"></div></div></div>`;}).join('');
    compositionEditor.decorate();storyUI?.lane();timelinePlayheads=[...$('#story-lane').querySelectorAll('.playhead'),...$('#tracks').querySelectorAll('.playhead'),$('#ruler').querySelector('.ruler-playhead')].filter(Boolean);
  }
  function updateClock(){if(classroomPropsSupported&&lastHierarchyScene!==sceneAt()){lastHierarchyScene=sceneAt();renderHierarchy();} $('#time-display').textContent=time(state.current);$('#hierarchy').querySelectorAll('[data-visibility-indicator]').forEach(el=>{const o=state.objects.find(x=>x.id===el.dataset.visibilityIndicator),visible=o&&evaluated(o,'visible');el.style.opacity=visible?'1':'.3';el.title=visible?'已启用':'已关闭';}); timelinePlayheads.forEach(e=>e.style.left=`${state.current/duration*100}%`);const clip=state.tracks.filter(t=>t.type==='dialogue'&&t.enabled!==false).flatMap(t=>t.clips).find(c=>c.dialogue&&state.current>=c.start&&state.current<c.start+c.len);const dialogue=clip&&state.dialogues.find(d=>d.id===clip.dialogue);$('#dialogue-preview').classList.toggle('hidden',!dialogue);if(dialogue){$('#dialogue-speaker').textContent=dialogue.speaker;$('#dialogue-text').textContent=displayedDialogue({clip,dialogue},state.current);}const cameraObject=activeCamera(),scene=sceneAssets.find(a=>a.sceneId===sceneAt());$('#active-preview').textContent=(cameraObject?.name||'无启用相机')+(scene?' · '+assetDisplay(scene):'');const value=cameraObject?evaluated(cameraObject,'fov'):state.fov;$('#preview-fov').textContent=Number(value).toFixed(1);syncCameraInspector();syncVisibilityInspector();syncExpressionInspector();syncVisemeInspector();effectsEditor.status();syncPlayer();syncAudio(); }
  function cameraFields(){const ctx=cameraContext(),isCamera=ctx?.object.type==='相机';const vector=property=>['X','Y','Z'].map((axis,i)=>`<label>${axis}<input type="number" step="0.1" data-camera-field="${property}" data-axis="${i}" aria-label="${cameraProperties[property]} ${axis}" ${property==='scale'&&!gizmoTrsSupported?'disabled':''}></label>`).join('');const head=property=>`<label class="camera-prop-label">${cameraProperties[property]}<button class="camera-key" data-camera-key="${property}" aria-label="${cameraProperties[property]}关键帧">◇</button></label>`;return `<div class="inspector-section" id="camera-properties"><div class="section-title">${icon(isCamera?'camera':'box')} ${isCamera?'相机属性':'变换属性'}</div><div class="field">${head('position')}<div class="vector">${vector('position')}</div></div><div class="field">${head('rotation')}<div class="vector">${vector('rotation')}</div></div>${!isCamera&&(supportedActor(ctx?.object||{})||supportedProp(ctx?.object))?`<div class="field">${head('scale')}<div class="vector">${vector('scale')}</div></div>`:''}${isCamera?`<div class="field">${head('fov')}<input class="input" type="number" min="15" max="90" step="1" data-camera-field="fov" aria-label="相机 FOV"></div>`:''}<p id="camera-key-note" class="hint"></p><p class="hint">数值线性插值；${new URLSearchParams(location.search).get('embedded')==='1'?'Unity 画面显示在预览面板。':'Unity 画面在独立窗口显示。'}</p></div>`;}
  function bindCameraFields(){let beforeEdit=null;const commit=()=>{if(beforeEdit&&JSON.stringify(beforeEdit)!==JSON.stringify(state))remember(beforeEdit);beforeEdit=null;syncCameraInspector();};document.querySelectorAll('[data-camera-field]').forEach(input=>{input.onfocus=()=>beforeEdit=copyState();input.oninput=()=>{const ctx=cameraContext();if(!ctx||input.value===''||!Number.isFinite(Number(input.value)))return;if(!beforeEdit)beforeEdit=copyState();if(ctx.track?.locked&&ctx.inRange){notify('轨道已锁定');return;}const property=input.dataset.cameraField,raw=Number(input.value),number=property==='fov'?Math.max(15,Math.min(90,raw)):property==='scale'?Math.max(.01,Math.min(100,raw)):raw;if(property==='scale'&&!gizmoTrsSupported){notify('当前 Player 不支持缩放');return;}let value=structuredClone(cameraValue(ctx,property));if(Array.isArray(value))value[Number(input.dataset.axis)]=number;else value=number;const keys=ctx.inRange?ctx.clip.propertyKeys?.[property]:null;if(keys?.length){const t=quantize(state.current-ctx.clip.start);let key=keys.find(k=>Math.abs(k.time-t)<frame/2);if(key)key.value=value;else keys.push({time:t,value});keys.sort((a,b)=>a.time-b.time);renderTimeline();}else if(property==='fov')ctx.object.fov=value;else ctx.object.transform[property]=value;updateClock();};input.onchange=commit;input.onblur=commit;});document.querySelectorAll('[data-camera-key]').forEach(button=>button.onclick=()=>{const ctx=cameraContext();if(!ctx?.inRange||ctx.track.locked)return;const property=button.dataset.cameraKey,before=copyState(),value=structuredClone(cameraValue(ctx,property)),t=quantize(state.current-ctx.clip.start);ctx.clip.propertyKeys ||= {};const keys=ctx.clip.propertyKeys[property] ||= [],index=keys.findIndex(k=>Math.abs(k.time-t)<frame/2);if(index>=0){keys.splice(index,1);if(!keys.length){if(property==='fov')ctx.object.fov=value;else ctx.object.transform[property]=value;}}else{keys.push({time:t,value});keys.sort((a,b)=>a.time-b.time);}remember(before);renderTimeline();updateClock();notify(index>=0?'已删除关键帧':'已添加关键帧');});syncCameraInspector();}
  function syncVisibilityInspector(){const input=$('#object-visible'),button=$('#visibility-key'),ctx=cameraContext();if(!input||!button||!ctx)return;const keys=ctx.inRange&&ctx.track.enabled!==false?ctx.clip.propertyKeys?.visible:null;input.checked=keys?.length?sampleKeys(keys,state.current-ctx.clip.start):ctx.object.visible!==false;input.disabled=input.dataset.supported!=='1'||Boolean(ctx.track?.locked&&(ctx.inRange||state.selectedClip));const has=ctx.inRange&&ctx.clip.propertyKeys?.visible?.some(k=>Math.abs(k.time-(state.current-ctx.clip.start))<frame/2);button.textContent=has?'◆':'◇';button.classList.toggle('has-key',Boolean(has));button.disabled=input.disabled||!ctx.inRange||ctx.track.locked;button.title=button.disabled?'在未锁定的对应轨道片段内设置关键帧':has?'删除当前帧关键帧':'添加当前帧关键帧';}
  function syncExpressionInspector(){const input=$('#expression-weight'),button=$('#expression-key'),found=state.selectedClip&&getClip(state.selectedClip);if(!input||!button||!found||found.track.type!=='expression')return;const c=found.clip,inRange=state.current>=c.start&&state.current<=c.start+c.len,keys=inRange&&found.track.enabled!==false?c.propertyKeys?.weight:null,value=keys?.length?sampleKeys(keys,state.current-c.start):expressionWeight(c);if(document.activeElement!==input)input.value=value;$('#expression-value').textContent=Math.round(value)+'%';const has=keys?.some(k=>Math.abs(k.time-(state.current-c.start))<frame/2);button.textContent=has?'◆':'◇';button.disabled=!inRange||found.track.locked;button.classList.toggle('has-key',Boolean(has));}
  function syncVisemeInspector(){const found=state.selectedClip&&getClip(state.selectedClip);if(!found?.clip?.lipVisemes)return;const clip=found.clip,inRange=state.current>=clip.start&&state.current<=clip.start+clip.len;document.querySelectorAll('[data-viseme-slider]').forEach(el=>{const keys=clip.propertyKeys?.['viseme_'+el.dataset.visemeSlider];el.disabled=found.track.locked||!inRange;if(document.activeElement!==el)el.value=inRange&&keys?.length?sampleKeys(keys,state.current-clip.start):0;const label=document.querySelector(`[data-viseme-output="${el.dataset.visemeSlider}"]`);if(label)label.textContent=Math.round(Number(el.value))+'%';});}
  function keyframeList(clip,track){const rows=Object.entries(clip.propertyKeys||{}).flatMap(([property,keys])=>keys.map((key,i)=>`<div class="keyframe-entry ${property.startsWith('viseme_')?'has-value':''}"><button class="keyframe-jump" data-key-jump="${esc(property)}" data-index="${i}" title="跳到关键帧">◆ ${esc(keyNames[property]||property)}</button><input type="number" min="0" max="${clip.len}" step="${frame}" value="${Number(key.time.toFixed(4))}" data-key-edit="${esc(property)}" data-index="${i}" aria-label="${esc(keyNames[property]||property)}关键帧片内时间（秒）" ${track.locked?'disabled':''}>${property.startsWith('viseme_')?`<input type="number" min="0" max="100" step="1" value="${key.value}" data-key-value="${esc(property)}" data-index="${i}" aria-label="口型权重百分比" ${track.locked?'disabled':''}>`:''}<button class="keyframe-delete" data-key-delete="${esc(property)}" data-index="${i}" title="删除关键帧" aria-label="删除${esc(keyNames[property]||property)}关键帧" ${track.locked?'disabled':''}>×</button></div>`));return rows.length?`<div class="inspector-section"><div class="section-title">关键帧 <span class="section-meta">${rows.length} 个</span></div><p class="hint">时间为片段内秒数；点击名称跳转。</p>${rows.join('')}</div>`:'';}
  function setVisemeKeyValue(clipId,property,index,value){const found=getClip(clipId),keys=found?.clip?.propertyKeys?.[property],key=keys?.[index];if(!found||found.track.locked||!found.clip.lipVisemes||!/^viseme_[aiueo]$/.test(property)||!Number.isInteger(index)||!key||!Number.isFinite(value)||value<0||value>100)throw Error('口型关键帧或权重无效');const before=copyState();key.value=value;remember(before);renderTimeline();renderInspector();updateClock();}
  function setVisemeShape(clipId,vowel,name){const found=getClip(clipId),actor=state.objects.find(o=>o.id===found?.track.target);if(!found||found.track.locked||!found.clip.lipVisemes||!['a','i','u','e','o'].includes(vowel)||!/^b_mouth\.mouth_\d{3}$/.test(name)||!shapeForActor(actor||{},faceIdForName(name)))throw Error('角色不支持该嘴形');if(Object.entries(found.clip.lipVisemes).some(([v,n])=>v!==vowel&&n===name))throw Error('每个元音需要不同的嘴形');const before=copyState();found.clip.lipVisemes[vowel]=name;remember(before);renderInspector();updateClock();}
  function bindKeyframeList(clip,track){
    const target=state.objects.find(o=>o.id===track.target);
    document.querySelectorAll('[data-key-jump]').forEach(el=>el.onclick=()=>{const key=clip.propertyKeys?.[el.dataset.keyJump]?.[Number(el.dataset.index)];if(!key)return;state.current=Math.min(duration,quantize(clip.start+key.time));updateClock();});
    document.querySelectorAll('[data-key-edit]').forEach(el=>el.onchange=()=>{if(track.locked)return;const keys=clip.propertyKeys?.[el.dataset.keyEdit],index=Number(el.dataset.index),key=keys?.[index],value=Number(el.value);if(!key||!Number.isFinite(value)||value<0||value>clip.len){renderInspector();notify('关键帧时间必须在片段内');return;}const next=Math.min(clip.len,quantize(value));if(keys.some((other,i)=>i!==index&&Math.abs(other.time-next)<frame/2)){renderInspector();notify('同一属性的关键帧不能重合');return;}const before=copyState();key.time=next;keys.sort((a,b)=>a.time-b.time);remember(before);renderTimeline();renderInspector();updateClock();});
    document.querySelectorAll('[data-key-value]').forEach(el=>el.onchange=()=>{try{setVisemeKeyValue(clip.id,el.dataset.keyValue,Number(el.dataset.index),Number(el.value));}catch(error){renderInspector();notify(error.message);}});
    document.querySelectorAll('[data-key-delete]').forEach(el=>el.onclick=()=>{if(track.locked)return;const property=el.dataset.keyDelete,keys=clip.propertyKeys?.[property],index=Number(el.dataset.index),key=keys?.[index];if(!key)return;const before=copyState();keys.splice(index,1);if(!keys.length){if(property==='weight')clip.weight=key.value;else if(target&&property==='visible')target.visible=key.value;else if(target&&property==='fov')target.fov=key.value;else if(target&&['position','rotation','scale'].includes(property)){target.transform ||= {position:[0,0,0],rotation:[0,0,0]};target.transform[property]=structuredClone(key.value);}}remember(before);renderTimeline();renderInspector();updateClock();});
  }
  async function auditionVoice(sourceId,styleId,audio,button){try{button.disabled=true;const url=await window.voiceAPI.preview(sourceId,styleId);if(!audio.isConnected)return;audio.src=url;audio.hidden=false;await audio.play();}catch(error){notify('试听失败：'+error.message);}finally{if(button.isConnected)button.disabled=false;}}
  function hasMultiSelection(){return selectedClipIds.size>1&&selectedClipIds.has(state.selectedClip)&&!state.selected&&!selectedAsset;}
  function isSelectedClip(clipId){return hasMultiSelection()?selectedClipIds.has(clipId):state.selectedClip===clipId;}
  function selectedClipRows(){const rows=[];for(const track of state.tracks)for(const clip of track.clips)if(selectedClipIds.has(clip.id))rows.push({track,clip});return rows;}
  function setTimelineSelection(ids){clearPanelSelections();
    const requested=new Set(soloClipId?[...ids]:CreatorTimelineEdit.select(state,ids)),existing=[];for(const track of state.tracks)for(const clip of track.clips)if(requested.has(clip.id))existing.push(clip.id);
    selectedClipIds=new Set(existing);state.selectedClip=existing[0]||null;state.selected=null;selectedAsset=null;
    $('#split').disabled=false;$('#delete-clip').disabled=false;
    renderTimeline();renderHierarchy();renderInspector();
  }
  function renderBatchInspector(){
    const rows=selectedClipRows();if(rows.length<2){selectedClipIds=new Set(rows.map(x=>x.clip.id));state.selectedClip=rows[0]?.clip.id||null;$('#split').disabled=false;$('#delete-clip').disabled=false;renderInspector();return;}
    const types=[...new Set(rows.map(x=>x.track.type))];if(!types.includes(multiGroup))multiGroup=types.includes('dialogue')?'dialogue':types[0];
    const group=rows.filter(x=>x.track.type===multiGroup),lockedDialogues=new Set(state.tracks.filter(t=>t.type==='dialogue'&&t.locked).flatMap(t=>t.clips.map(c=>c.dialogue).filter(Boolean)));
    const eligible=group.filter(({track,clip})=>!track.locked&&(multiGroup!=='dialogue'||(clip.dialogue&&!lockedDialogues.has(clip.dialogue)))&&(multiGroup!=='expression'||(!clip.lipVisemes&&!clip.propertyKeys?.weight?.length)));
    const dialogueMap=new Map(state.dialogues.map(d=>[d.id,d])),dialogues=[...new Set(eligible.map(x=>x.clip.dialogue).filter(Boolean))].map(id=>dialogueMap.get(id)).filter(Boolean);
    const mixed=values=>values.length&&values.every(x=>x===values[0])?values[0]:null;
    const typeName=t=>t==='dialogue'?'字幕 / 对话 UI':comp(t).name;
    const skip=group.length-eligible.length,disabled=eligible.length?'':'disabled';
    let fields='';
    if(multiGroup==='dialogue'){
      const style=mixed(dialogues.map(d=>d.uiStyle||'box')),writer=mixed(dialogues.map(d=>Boolean(d.typewriter))),rate=mixed(dialogues.map(d=>d.revealRate||12)),left=mixed(dialogues.map(d=>dialogueColors(d)[0])),right=mixed(dialogues.map(d=>dialogueColors(d)[1]));
      fields=`<p class="hint">涉及 ${dialogues.length} 条不同对白；同一对白的字幕片段共享设置。姓名条颜色仅用于游戏素材对话框。</p><div class="field"><label for="batch-dialogue-style">对话 UI 样式</label><select id="batch-dialogue-style" ${disabled}>${style===null?'<option value="" selected>多种样式</option>':''}<option value="box" ${style==='box'?'selected':''}>标准对话框</option><option value="subtitle" ${style==='subtitle'?'selected':''} ${dialogueStyles?'':'disabled'}>简洁字幕${dialogueStyles?'':'（当前 Player 不支持）'}</option><option value="game" ${style==='game'?'selected':''} ${gameDialogue?'':'disabled'}>游戏素材对话框${gameDialogue?'':'（本地素材不可用）'}</option></select></div><div class="field"><label for="batch-typewriter">逐字显示</label><select id="batch-typewriter" ${disabled}>${writer===null?'<option value="" selected>多种设置</option>':''}<option value="on" ${writer===true?'selected':''}>开启</option><option value="off" ${writer===false?'selected':''}>关闭</option></select></div><div class="field"><label for="batch-reveal-rate">显现速度（字 / 秒）</label><input class="input" id="batch-reveal-rate" type="number" min="1" max="60" step="any" ${rate===null?'placeholder="多种速度"':`value="${rate}"`} ${disabled}></div><div class="field"><label>姓名条颜色（左 / 右）${left===null||right===null?' · 多种颜色':''}</label><div class="slider-line"><input type="color" id="batch-color-left" value="${left||'#808080'}" ${disabled}><input type="color" id="batch-color-right" value="${right||'#808080'}" ${disabled}></div><button class="add-component" id="batch-color-apply" ${disabled}>应用两端颜色</button><button class="add-component" id="batch-color-reset" ${disabled}>恢复自动颜色</button><p class="hint">${dialogueColorsSupported?'':'当前 Player 的预览可能不支持姓名条颜色；导出使用所选颜色。'}</p></div>`;
    }else if(multiGroup==='audio'){
      const volume=mixed(eligible.map(x=>x.clip.volume??1));fields=`<div class="field"><label for="batch-volume">音量（%）</label><input class="input" id="batch-volume" type="number" min="0" max="100" step="any" ${volume===null?'placeholder="多种音量"':`value="${Number((volume*100).toFixed(3))}"`} ${disabled}></div><p class="hint">只更改音量，不替换音频、不改变片段时间。</p>`;
    }else if(multiGroup==='expression'){
      const weight=mixed(eligible.map(x=>expressionWeight(x.clip)));fields=`<div class="field"><label for="batch-weight">固定表情权重（%）</label><input class="input" id="batch-weight" type="number" min="0" max="100" step="any" ${weight===null?'placeholder="多种权重"':`value="${weight}"`} ${disabled}></div><p class="hint">自动跳过口型和已有权重关键帧的片段。</p>`;
    }else fields='<p class="hint">此类片段暂不提供批量属性；可选择字幕、音频或固定表情片段。</p>';
    $('#inspector').innerHTML=`<div class="selection-tag"><div class="selection-icon">${icon('sliders')}</div><div><strong>已选 ${rows.length} 个片段</strong><small>框选或 Ctrl / Shift 单击可调整选择</small></div></div><div class="inspector-section"><div class="section-title">批量修改</div><div class="field"><label for="batch-type">片段类型</label><select id="batch-type">${types.map(t=>`<option value="${esc(t)}" ${t===multiGroup?'selected':''}>${esc(typeName(t))}（${rows.filter(x=>x.track.type===t).length}）</option>`).join('')}</select></div><p class="hint">当前类型 ${group.length} 个，可编辑 ${eligible.length} 个${skip?`；跳过 ${skip} 个锁定或不适用的片段`:''}。</p>${fields}<div class="field"><label for="batch-member">查看单个片段的完整属性</label><select id="batch-member"><option value="">选择片段…</option>${group.map(({clip})=>{const a=assetById(clip.assetId);return `<option value="${esc(clip.id)}">${esc(clip.name)}${a?' · '+esc(assetDisplay(a)):''} · ${clip.start.toFixed(2)} 秒</option>`;}).join('')}</select></div></div>`;
    $('#batch-member').onchange=e=>{if(e.target.value)inspectRelatedClip(e.target.value);};
    $('#batch-type').onchange=e=>{multiGroup=e.target.value;renderInspector();};
    function change(apply){if(!hasMultiSelection())return;const before=copyState();if(!apply())return;remember(before);renderInspector();updateClock();}
    const style=$('#batch-dialogue-style');if(style)style.onchange=e=>{const value=e.target.value;if(!['box','subtitle','game'].includes(value)||(value==='subtitle'&&!dialogueStyles)||(value==='game'&&!gameDialogue))return;change(()=>{let changed=false;for(const d of dialogues)if((d.uiStyle||'box')!==value){d.uiStyle=value;changed=true;}return changed;});};
    const writer=$('#batch-typewriter');if(writer)writer.onchange=e=>{if(!['on','off'].includes(e.target.value))return;const value=e.target.value==='on';change(()=>{let changed=false;for(const d of dialogues)if(Boolean(d.typewriter)!==value){d.typewriter=value;changed=true;}return changed;});};
    const rate=$('#batch-reveal-rate');if(rate)rate.onchange=e=>{const raw=e.target.value,value=Number(raw);if(!raw.trim()||!Number.isFinite(value)||value<1||value>60){notify('显现速度须在 1–60 字 / 秒之间');renderInspector();return;}change(()=>{let changed=false;for(const d of dialogues)if((d.revealRate||12)!==value){d.revealRate=value;changed=true;}return changed;});};
    const colors=$('#batch-color-apply');if(colors)colors.onclick=()=>{const a=$('#batch-color-left').value,b=$('#batch-color-right').value;change(()=>{let changed=false;for(const d of dialogues)if(d.nameColor!==a||d.nameColorEnd!==b){d.nameColor=a;d.nameColorEnd=b;changed=true;}return changed;});};
    const reset=$('#batch-color-reset');if(reset)reset.onclick=()=>change(()=>{let changed=false;for(const d of dialogues)if(d.nameColor!==undefined||d.nameColorEnd!==undefined){delete d.nameColor;delete d.nameColorEnd;changed=true;}return changed;});
    const volume=$('#batch-volume');if(volume)volume.onchange=e=>{const raw=e.target.value,value=Number(raw);if(!raw.trim()||!Number.isFinite(value)||value<0||value>100){notify('音量须在 0–100% 之间');renderInspector();return;}change(()=>{let changed=false;for(const {clip} of eligible)if((clip.volume??1)!==value/100){clip.volume=value/100;changed=true;}return changed;});};
    const weight=$('#batch-weight');if(weight)weight.onchange=e=>{const raw=e.target.value,value=Number(raw);if(!raw.trim()||!Number.isFinite(value)||value<0||value>100){notify('表情权重须在 0–100% 之间');renderInspector();return;}change(()=>{let changed=false;for(const {clip} of eligible)if(expressionWeight(clip)!==value){clip.weight=value;changed=true;}return changed;});};
  }
  const expressionWeight=clip=>CreatorAnimationLayers.faceWeight(clip,faceMotionById);
  function pickClipSource(track,clip,options){
    CreatorClipSources.picker({state:()=>state,esc,name:key=>assetDisplay(assetById(key)||{source:key}),showModal,closeModal,remember,render,notify},track,clip,options);
  }
  function isAudioSource(asset){
    return !!asset?.scope&&(['音乐','音效','音源'].includes(asset.type)||asset.type==='视频'&&asset.visual?.hasAudio===true);
  }
  function inspectRelatedClip(clipId){
    if(!getClip(clipId))return;
    soloClipId=clipId;
    setTimelineSelection([clipId]);
    revealExpressionClip(clipId);
  }
  function sourceLink(clipId,label){
    return `<button class="add-component" data-inspect-related="${esc(clipId)}">${esc(label)}</button>`;
  }
  function lipSourceFields(clip){
    const ref=clip.lipSyncSource,source=getClip(ref.audioClipId);
    const dialogue=state.dialogues.find(d=>d.id===source?.clip.dialogue);
    const voice=assetById(source?.clip.assetId||dialogue?.voice);
    const mode=clip.lipMode||(clip.lipVisemes?'phoneme':'amplitude');
    return CreatorClipSources.card(esc,{
      title:'对白口型',name:{amplitude:'音量张合',phoneme:'日语五元音',manual:'手工五元音'}[mode],
      detail:[dialogue?`${dialogue.speaker} · ${dialogue.text}`:source?.clip.name,voice&&'音频 '+assetDisplay(voice)].filter(Boolean).join(' · '),
      error:source?'':'关联的对白音频片段已缺失',
      controls:source?sourceLink(ref.audioClipId,'编辑关联的对白音频…'):''
    });
  }
  function clipSourceFields(track,clip){
    if(track.type==='animation')return layerUI.motionFields(track,clip);
    if(track.type==='expression')return (clip.lipSyncSource?lipSourceFields(clip):'')+layerUI.expressionFields(track,clip)+'<button class="add-component" data-clip-locate>定位到片段中点</button>';
    if(track.type==='post')return '<p class="hint">旧版后处理片段，当前 Player 无法播放或导出。基础光照与后处理位于工程渲染设置，按时间变化的效果使用滤镜或特效轨道。</p><button id="clip-render-settings" class="add-component">打开工程渲染设置…</button>';
    if(!['scene','media','audio'].includes(track.type))return '';
    const dialogue=clip.dialogue&&state.dialogues.find(d=>d.id===clip.dialogue);
    const id=clip.assetId||dialogue?.voice,asset=assetById(id);
    const visual=asset?.visual,detail=[asset?.type],linked=clip.mediaLink&&relatedClips(clip).find(c=>c!==clip&&getClip(c.id)?.track.type===(track.type==='media'?'audio':'media'));
    if(visual)detail.push(`${visual.width} × ${visual.height}`);
    if(visual?.duration)detail.push('源时长 '+Number(visual.duration.toFixed(3))+' 秒');
    if(asset?.filmAudio?.streamName)detail.push(asset.filmAudio.streamName);
    const scene=track.type==='scene',media=track.type==='media';
    const usable=scene?asset?.sceneId&&sceneAssets.some(a=>a.sceneId===asset.sceneId):media?asset?.scope&&CreatorScreenMedia.isVisual(asset)&&visual:isAudioSource(asset);
    let controls='';
    if(scene)controls='<button class="add-component" id="clip-scene-replace">更换场景…</button>';
    else if(media){
      controls='<button class="add-component" data-media-replace>替换图片 / 视频…</button>';
      if(linked){
        detail.push('关联声音 '+Math.round((linked.volume??1)*100)+'%');
        controls+=sourceLink(linked.id,'编辑关联声音…');
      }
    }
    else if(linked)controls=sourceLink(linked.id,'编辑关联的视频片段…');
    else if(!dialogue&&!clip.mediaLink)controls='<button class="add-component" id="clip-audio-replace">更换音频…</button>';
    return CreatorClipSources.card(esc,{
      title:scene?'场景素材':media?'画面素材':clip.mediaLink?'视频声音来源':'音频素材',
      name:asset?assetDisplay(asset):id||'未指定素材',source:asset?.filmAudio?.name||asset?.source,detail:detail.filter(Boolean).join(' · '),
      error:clip.mediaLink&&track.type==='audio'&&!linked?'关联的视频片段已缺失':id&&(!usable||assetIssues[id])?assetIssues[id]||'素材缺失或不可用':'',controls
    });
  }
  function samplingOffsetFields(track,clip){
    const timed=track.type==='animation'||track.type==='expression'&&!clip.lipSyncSource&&
      (faceMotionById(clip.assetId)||faceShapeDefinition(clip.assetId)?.source.startsWith('eyeMaterial.'))||
      track.type==='ui'&&clip.uiKind==='code';
    return timed?`<div class="field"><label for="clip-source-offset">源起点（秒）</label><input id="clip-source-offset" class="input" type="number" min="0" max="3600" step="any" value="${clip.sourceOffset??0}"></div>`:'';
  }
  function bindClipSources(track,clip){
    layerUI.bindSources(track,clip);
    $('#inspector').querySelectorAll('[data-inspect-related]').forEach(b=>b.onclick=()=>inspectRelatedClip(b.dataset.inspectRelated));
    const locate=$('[data-clip-locate]');
    if(locate)locate.onclick=()=>seekFrame(Math.min(Math.ceil((clip.start+clip.len)*fps-1e-7)-1,Math.round((clip.start+clip.len/2)*fps)));
    const scene=$('#clip-scene-replace'),audio=$('#clip-audio-replace');
    if(scene)scene.onclick=()=>pickClipSource(track,clip,{
      key:'scene',title:'更换场景',followSourceName:true,hint:'新场景使用这个片段的起止时间。',describe:()=> '场景',
      items:()=>{const ids=new Set(sceneAssets.map(a=>a.sceneId));return allAssets().filter(a=>ids.has(a.sceneId));},
      apply:asset=>{clip.assetId=asset.id;}
    });
    if(audio)audio.onclick=()=>pickClipSource(track,clip,{
      key:'audio',title:'更换音频',followSourceName:true,hint:'新音频从头播放，沿用片段时长、音量、淡入淡出和声音效果。原始循环点可按新素材重新选择。',
      items:()=>allAssets().filter(a=>isAudioSource(a)&&a.available!==false&&!assetIssues[a.id]),describe:a=>a.type,
      prepare:readAudioDuration,
      apply:asset=>{
        if(clip.dialogue||clip.mediaLink)throw Error('请在关联的对白或视频中更换声音');
        clip.assetId=asset.id;clip.sourceOffset=0;delete clip.originalLoop;
      }
    });
    const offset=$('#clip-source-offset');
    if(offset)offset.onchange=()=>{
      const value=offset.valueAsNumber;
      if(track.locked||!Number.isFinite(value)||value<0||value>3600){offset.value=clip.sourceOffset??0;notify('源起点须在 0–3600 秒之间');return;}
      if(value===(clip.sourceOffset??0))return;
      const before=copyState();clip.sourceOffset=value;remember(before);render();
    };
    const settings=$('#clip-render-settings');
    if(settings)settings.onclick=()=>{openProjectSettings();selectSettingsPage('render');};
  }
  function renderInspector(){if(catalogAudioPlayer){catalogAudioPlayer.pause();catalogAudioPlayer=null;}
    const panel=$('#inspector'),selection=!selectedAsset&&!hasMultiSelection()?state.selectedClip||'':'';
    if(panel.dataset.clipId!==selection){panel.dataset.clipId=selection;panel.scrollTop=0;}
    const asset=assetById(selectedAsset);
    $('#inspector-add').disabled=!obj() || Boolean(asset);
    if(renderPanelSelectionInspector())return;
    if(hasMultiSelection()){renderBatchInspector();return;}
    if(asset?.effectKind){effectsEditor.assetInspector(asset);return;}
    if(CreatorScreenMedia.isVisual(asset)){mediaEditor.assetInspector(asset);return;}
    if(asset?.filmCatalogId){
      $('#inspector').innerHTML=`<div class="selection-tag"><div class="selection-icon">${icon('music')}</div><div><strong>${esc(assetDisplay(asset))}</strong><small>${esc(asset.type)} · 已解包音频</small></div></div><div class="inspector-section"><div class="section-title">音频信息</div><div class="asset-property"><span>原始名称</span><b>${esc(asset.source)}</b></div><div class="asset-property"><span>来源</span><b>${esc(asset.audioOrigin)}</b></div>${Number.isFinite(asset.duration)?`<p class="hint">时长 ${asset.duration.toFixed(2)} 秒</p>`:''}<button class="add-component" id="catalog-audio-preview">试听音频</button><audio id="catalog-audio-player" controls preload="none" style="width:100%;margin-top:8px" hidden></audio><button class="add-component" id="catalog-audio-import">导入素材库…</button><p class="hint">导入后可拖到音频轨道；导入的副本随工程保存，不受解包缓存清理影响。</p><p class="error" id="catalog-audio-error"></p></div>`;
      const player=$('#catalog-audio-player'),preview=$('#catalog-audio-preview'),button=$('#catalog-audio-import'),error=$('#catalog-audio-error');catalogAudioPlayer=player;player.onerror=()=>{error.textContent='试听失败：音频文件无法读取';};
      preview.onclick=async()=>{preview.disabled=true;error.textContent='';try{const url=await window.assetAPI.filmPreview(asset.filmCatalogId);if(!player.isConnected)return;player.src=url;player.hidden=false;await player.play();}catch(e){if(error.isConnected)error.textContent='试听失败：'+e.message;}finally{if(preview.isConnected)preview.disabled=false;}};
      button.onclick=async()=>{button.disabled=true;error.textContent='';const projectId=state.projectId;try{const result=await window.assetAPI.filmImport([asset.filmCatalogId],projectId);if(state.projectId!==projectId)throw Error('工程已切换，导入结果未加入当前工程');if(result){await importResult(result);if(result.assets.length){player.pause();selectedAsset=result.assets[0].id;renderAssetBrowser();renderInspector();}}}catch(e){if(error.isConnected)error.textContent='导入失败：'+e.message;}finally{if(button.isConnected)button.disabled=false;}};return;
    }
    if(asset?.catalogOnly){const yes=v=>v?'已找到':'未找到';$('#inspector').innerHTML=`<div class="selection-tag"><div class="selection-icon">${icon('user')}</div><div><strong>${esc(assetDisplay(asset))}</strong><small>服装 · 本地候选</small></div></div><div class="inspector-section"><div class="section-title">资源信息</div><div class="asset-property"><span>原始名称</span><b>${esc(asset.source)}</b></div><div class="asset-property"><span>角色代码</span><b>${esc(asset.character)}</b></div><div class="asset-property"><span>身体资源</span><b>${yes(asset.bodyAvailable)}</b></div><div class="asset-property"><span>清单直接依赖</span><b>${asset.dependenciesAvailable?'已找到':'未找到：'+esc(asset.missingDependencies.join('、'))}</b></div><div class="asset-property"><span>基础脸部 / 头发</span><b>${yes(asset.baseFaceAvailable)} / ${yes(asset.baseHairAvailable)}</b></div><div class="asset-property"><span>同编号脸部 / 头发</span><b>${yes(asset.specificFaceAvailable)} / ${yes(asset.specificHairAvailable)}</b></div><button class="add-component" id="costume-thumbnail" ${costumeThumbnailBusy||!asset.knownCharacter||!asset.bodyAvailable||!asset.dependenciesAvailable?'disabled':''}>${assetThumbs[asset.id]?'重新生成缩略图':'生成缩略图'}</button><p class="hint">缩略图使用基础脸部和头发，关闭衣物物理；可能不是服装最终搭配。</p><p class="hint">${asset.currentDefault?'这是该角色当前 Player 使用的基础服装。':asset.playerAvailable?'可拖到对应角色尝试换装，使用基础脸部与头发，不包含此服装的衣物物理。':'可拖到对应角色记录选择；当前 Player 尚不能显示该服装。资源存在不代表角色组装和渲染已验证。'}</p>${asset.knownCharacter?'':'<p class="hint">角色代码尚未在创作器角色列表中识别。</p>'}<p class="hint">服装资源只从本机研究副本读取，不随发布包分发。</p></div>`;const button=$('#costume-thumbnail');button.onclick=async()=>{button.disabled=true;try{await generateCostumeThumbnail(asset);notify('服装缩略图已生成');if(button.isConnected){button.disabled=false;button.textContent='重新生成缩略图';}}catch(error){notify('缩略图生成失败：'+error.message);if(button.isConnected)button.disabled=false;}};return;}
    if(asset?.voiceProvider&&Array.isArray(asset.styles)){const label=asset.voiceProvider==='voicevox'?'VOICEVOX':'GPT-SoVITS',initial=asset.styles.find(s=>s.name==='ノーマル')||asset.styles[0];$('#inspector').innerHTML=`<div class="selection-tag"><div class="selection-icon">${icon('sound')}</div><div><strong>${esc(assetDisplay(asset))}</strong><small>${label} · 本地合成音源</small></div></div><div class="inspector-section"><div class="section-title">音源信息</div><div class="asset-property"><span>原始名称</span><b>${esc(asset.source)}</b></div><div class="asset-property"><span>别名</span><b>${asset.alias?esc(asset.alias):'未设置'}</b></div><button class="add-component" id="rename-selected">修改别名</button><p class="hint">别名在全部工程中可用；留空恢复原名。</p><div class="asset-property"><span>引擎</span><b>${label}</b></div><div class="asset-property"><span>语气数</span><b>${asset.styles.length}</b></div><div class="field"><label for="library-voice-style">试听语气</label><select id="library-voice-style">${asset.styles.map(s=>`<option value="${esc(s.id)}" ${s===initial?'selected':''}>${esc(s.name)}${s.previewAvailable?'':' · 无试听'}</option>`).join('')}</select></div><p id="library-voice-info" class="hint"></p><button class="add-component" id="library-voice-preview">试听样本</button><audio id="library-voice-audio" controls style="width:100%;margin-top:8px" hidden></audio><p class="hint">试听是既有研究录音。此处选择语气不会生成新的对白。</p>${asset.available===false?'<p class="error">本地模型或运行时缺失。</p>':''}</div>`;$('#rename-selected').onclick=()=>renameAsset(asset.id);const select=$('#library-voice-style'),button=$('#library-voice-preview'),audio=$('#library-voice-audio');const update=()=>{const s=asset.styles.find(x=>String(x.id)===select.value);button.disabled=!s?.previewAvailable;$('#library-voice-info').textContent=s?.model?`模型 ${s.model} · 风格 ID ${s.id}`:`配置 ${asset.version||'未知版本'} · 参考研究样本`;audio.pause();audio.hidden=true;};select.onchange=update;button.onclick=()=>auditionVoice(asset.id,select.value,audio,button);update();return;}
    if(asset&&uiCatalog.entries.some(a=>a.id===asset.id)){$('#inspector').innerHTML=`<div class="inspector-section"><h3>${esc(asset.alias)}</h3><p>来自本机游戏资源的 UI 转场。此素材只叠加画面；场景请在场景轨道安排。</p><button class="add-component" id="insert-ui-asset">添加到时间轴…</button><p class="hint">${esc(asset.source)}</p></div>`;$('#insert-ui-asset').onclick=()=>uiEditor.picker(undefined,asset.id);return;}
    if(asset){const support=faceAvailability(asset),faceHint=support&&support.supported.length<support.total?`<p class="hint">可用角色：${esc(support.supported.map(code=>code==='ttmr'?'月村手毬':actorNames[code]).join('、'))}。其他角色缺少此形变。</p>`:'';$('#inspector').innerHTML=`<div class="selection-tag"><div class="selection-icon" style="color:${assetColors[asset.type]||'#aaa'}">${icon(assetIcons[asset.type]||'box')}</div><div><strong>${esc(assetDisplay(asset))}</strong><small>${esc(asset.type)} · 素材</small></div></div><div class="inspector-section"><div class="section-title">素材信息</div><div class="asset-property"><span>类型</span><b>${esc(asset.type)}</b></div><div class="asset-property"><span>原始名称</span><b>${esc(asset.source)}</b></div><div class="asset-property"><span>别名</span><b>${asset.alias?esc(asset.alias):'未设置'}</b></div>${asset.priorAlias&&asset.priorAlias!==asset.alias?`<div class="asset-property"><span>原有别名</span><b>${esc(asset.priorAlias)}</b></div>`:''}${motionDefinition(asset.id)||Boolean(faceMotionById(asset.id))?'<p class="hint">按文件名生成的名称仅供检索；选中时自动生成并播放手毬样本预览。</p>':''}${asset.scope==='shared'?'<p class="hint">全部工程可用</p>':'<button class="add-component" id="rename-selected">修改别名</button>'}${['音乐','音效'].includes(asset.type)&&asset.scope?'<button class="add-component" id="listen-asset">试听音频</button><audio id="audio-preview" controls style="width:100%;margin-top:8px" hidden></audio><p class="hint">可拖入音频轨道，与时间轴同步播放。</p>':''}${assetFeatures&&(asset.id==='asset-actor-1'||actorAssets.some(a=>a.id===asset.id)||asset.sceneId)?`<button class="add-component" id="place-asset">添加到场景</button>${actorAssets.some(a=>a.id===asset.id)?'<p class="hint">本地研究样本；动作与面部效果需逐项核验。</p>':'<button class="add-component" id="bake-thumbnail">生成 Player 缩略图</button><p class="hint">场景缩略图需先将场景放入层级。</p>'}`:''}${assetIssues[asset.id]?`<p class="error">素材预览不可用：${esc(assetIssues[asset.id])}</p>`:''}${asset.id.startsWith('asset-film-')?'<p class="hint">从本地清单识别的候选身体动作，尚未逐条验证角色适配。</p>':''}${Boolean(faceMotionById(asset.id))?'<p class="hint">本地面部动画候选，尚未逐条验证；拖入角色表情轨道后展开为多条可编辑的形变轨道。贴花等通道尚未接入。</p>':''}${faceHint}${asset.originalName?`<p class="hint">原始片段 ${esc(asset.originalName)} · 原片 ${Number(asset.sourceOffset).toFixed(2)} 秒起，原长 ${Number(asset.sourceLength).toFixed(2)} 秒；相邻分段需依次排列。</p>`:''}<p class="hint">${asset.scope==='project'?'仅本工程可用':asset.sceneId||asset.id==='asset-actor-1'?'本地研究样本，拖到场景层级使用。新增手毬实例可分别设置动作。':'别名在同类型中唯一；留空时显示原始名称。'}</p>${asset.type==='贴图'?'<p class="hint">贴图缩略图取自本地素材副本。</p>':''}</div>`;attachAudioRecovery(asset);characterColorEditor.mount(asset);if(performance&&faces&&matchingFaceMotion(motionDefinition(asset.id))){const button=document.createElement('button');button.className='add-component';button.id='add-paired-motion';button.textContent='添加动作及同名面部';button.onclick=()=>openPairedMotionModal(asset.id);$('#inspector .inspector-section').appendChild(button);}const rename=$('#rename-selected');if(rename)rename.onclick=()=>renameAsset(asset.id);const place=$('#place-asset');if(place)place.onclick=()=>addAssetToScene(asset);const bake=$('#bake-thumbnail');if(bake)bake.onclick=()=>bakeThumbnail(asset);const listen=$('#listen-asset');if(listen)listen.onclick=async()=>{try{const player=$('#audio-preview');player.src=mediaUrl(asset);player.hidden=false;await player.play();}catch(error){notify('试听失败：'+error.message);}};return;}
    const found=state.selectedClip&&getClip(state.selectedClip);
    if(found){const {track,clip}=found,c=comp(track.type),target=state.objects.find(o=>o.id===track.target);let fields=clipSourceFields(track,clip)+`<div class="field"><label for="clip-name">片段名称</label><input class="input" id="clip-name" value="${esc(clip.name)}"></div><div class="vector clip-timing"><label>起<input id="clip-start" type="number" min="0" max="${duration}" step="${frame}" value="${clip.start.toFixed(3)}"></label><label>长<input id="clip-length" type="number" min="${frame}" max="${duration}" step="${frame}" value="${clip.len.toFixed(3)}"></label></div><p class="hint">时间单位：秒（${fps} 帧 / 秒）</p>`;
      fields+=samplingOffsetFields(track,clip);
      const dialogue=clip.dialogue&&state.dialogues.find(d=>d.id===clip.dialogue);
      if(dialogue){if(track.type==='dialogue')fields+=`<div class="field"><label for="dialogue-speaker-choice">说话人</label><select id="dialogue-speaker-choice"><option value="">自定义</option>${state.objects.filter(o=>o.type==='角色').map(o=>`<option value="${esc(o.name)}" ${dialogue.speaker===o.name?'selected':''}>${esc(o.name)}</option>`).join('')}</select><input class="input" id="dialogue-speaker-edit" maxlength="100" value="${esc(dialogue.speaker)}" aria-label="说话人名称"></div><div class="field"><label for="dialogue-ui-style">对话 UI</label><select id="dialogue-ui-style"><option value="box" ${(dialogue.uiStyle||'box')==='box'?'selected':''}>标准对话框</option><option value="subtitle" ${dialogue.uiStyle==='subtitle'?'selected':''} ${!dialogueStyles?'disabled':''}>简洁字幕${dialogueStyles?'':'（当前 Player 不支持）'}</option><option value="game" ${dialogue.uiStyle==='game'?'selected':''} ${!gameDialogue?'disabled':''}>游戏素材对话框（实验）${gameDialogue?'':' · 本地素材缺失'}</option></select>${dialogue.uiStyle==='game'&&!gameDialogue?'<p class="error">游戏对白 UI 不可用，预览将回退标准样式；请准备素材或更换样式。</p>':''}</div><div class="field"><label>姓名条颜色（左 / 右）</label><div class="slider-line"><input id="dialogue-name-color" type="color" value="${dialogueColors(dialogue)[0]}"><input id="dialogue-name-color-end" type="color" value="${dialogueColors(dialogue)[1]}"><button type="button" id="dialogue-color-reset">恢复自动</button></div><p class="hint">仅游戏素材对话框生效；手毬和燐羽颜色依据参考图近似，其他角色可手动设置。${dialogueColorsSupported?'':'当前 Player 的预览尚不支持姓名条颜色；导出使用所选颜色。'}</p></div><label class="dialogue-link"><input type="checkbox" id="dialogue-typewriter" ${dialogue.typewriter?'checked':''}> 逐字显示</label><div class="field"><label for="dialogue-reveal-rate">显现速度（字 / 秒）</label><input class="input" id="dialogue-reveal-rate" type="number" min="1" max="60" value="${dialogue.revealRate||12}" ${dialogue.typewriter?'':'disabled'}></div>`;fields+=`<div class="field"><label>对话文本</label><textarea id="dialogue-edit" maxlength="500">${esc(dialogue.text)}</textarea></div>${dialogue.translation?`<div class="field"><label for="dialogue-translation-edit">日语译文（VOICEVOX）</label><textarea id="dialogue-translation-edit" maxlength="1000">${esc(dialogue.translation.text)}</textarea><p class="hint">${dialogue.translation.sourceText===dialogue.text&&dialogue.translation.sourceSpeaker===dialogue.speaker?"生成 VOICEVOX 时使用译文；字幕仍使用原文。":"原文或说话人已变化；请重新翻译或修改译文确认。"}</p></div>`:""}<div class="field"><label for="voice-search">搜索已有音频</label><input class="input" id="voice-search" placeholder="按别名或原名搜索，空格分隔关键词"><p class="hint">筛选时保留当前选择。</p><label>已有音频</label><select id="voice-select"><option value="">无音频</option>${dialogue.voice&&!allAssets().some(a=>a.scope&&a.id===dialogue.voice)?`<option value="${esc(dialogue.voice)}" selected>音频缺失：${esc(dialogue.voice)}</option>`:''}${allAssets().filter(a=>a.scope&&['音乐','音效','音源'].includes(a.type)).map(a=>`<option data-search="${esc((a.alias||'')+' '+(a.source||''))}" value="${esc(a.id)}" ${dialogue.voice===a.id?'selected':''}>${esc(assetDisplay(a))}</option>`).join('')}</select></div><label class="dialogue-link"><input type="checkbox" id="dialogue-linked" ${dialogue.linked?'checked':''}> 对话 UI 与语音联动移动</label>`;if(track.type==='audio'){const chosen=dialogue.voiceSource,source=voiceSources.find(v=>v.id===chosen?.id),style=source?.styles.find(s=>String(s.id)===String(chosen?.styleId)),changed=Boolean(style&&chosen&&((chosen.modelId&&style.modelId&&chosen.modelId!==style.modelId)||(chosen.provider==='sovits'&&chosen.version&&source.version&&chosen.version!==source.version)));fields+=`<div class="field"><label for="synth-search">搜索合成音源</label><input class="input" id="synth-search" placeholder="按别名或原名搜索，空格分隔关键词"><p class="hint">筛选时保留当前选择。</p><label for="synth-source">合成音源</label><select id="synth-source"><option value="">未选择</option>${chosen&&!source?`<option value="${esc(chosen.id)}" selected>${esc(chosen.name)} · 已缺失</option>`:''}${aliasFirst(voiceSources).map(v=>`<option data-search="${esc((v.alias||'')+' '+(v.source||''))}" value="${esc(v.id)}" ${chosen?.id===v.id?'selected':''}>${esc(assetDisplay(v))}${v.alias?'（'+esc(v.source)+'）':''} · ${v.voiceProvider==='voicevox'?'VOICEVOX':'GPT-SoVITS'}${v.available===false?' · 缺少文件':''}</option>`).join('')}</select></div><div class="field"><label for="synth-style">语气</label><select id="synth-style" ${!source?'disabled':''}>${chosen&&!style?`<option value="${esc(chosen.styleId)}" selected>${esc(chosen.styleName)} · 已缺失</option>`:''}${(source?.styles||[]).map(s=>`<option value="${esc(s.id)}" ${style===s?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div>${changed?'<p class="error">此音源的本地模型版本已变化，请确认后更新引用。</p><button class="add-component" id="synth-confirm-version">确认当前音源版本</button>':''}${source?.available===false?'<p class="error">本地模型或运行时缺失。</p>':''}<div class="field"><label for="synth-language">对白语言</label><select id="synth-language"><option value="all_ja" ${(dialogue.language||'all_ja')==='all_ja'?'selected':''}>日语</option><option value="zh" ${dialogue.language==='zh'?'selected':''}>中文（GPT-SoVITS）</option></select></div><button class="add-component" id="translate-script-shortcut" ${window.translationAPI?'':'disabled'}>翻译全部对白…</button><p class="hint">日语译文经确认后用于 VOICEVOX；没有译文时使用原文。</p><button class="add-component" id="synth-cook" ${!source||!style||changed||source.available===false||!window.voiceAPI?'disabled':''}>生成 / 重新 Cook</button><p id="synth-cook-status" class="hint">${dialogue.cookedFor?(cookedCurrent(dialogue)?'当前对白已生成语音':'对白、音源或语音文本处理规则已更改，需要重新 Cook'):'尚未生成本句语音'}</p><button class="add-component" id="synth-audition" ${!style?.previewAvailable?'disabled':''}>试听语气样本</button><audio id="synth-preview" controls style="width:100%;margin-top:8px" hidden></audio><div class="field"><label for="lip-mode">口型模式</label><select id="lip-mode"><option value="amplitude" ${lipSyncMatches(clip.id)[0]&&(lipSyncMatches(clip.id)[0].clip.lipMode||(!lipSyncMatches(clip.id)[0].clip.lipVisemes?'amplitude':'phoneme'))==='amplitude'?'selected':''}>音量张合</option><option value="phoneme" ${!assetById(dialogue.voice)?.voiceTiming?'disabled':(!lipSyncMatches(clip.id)[0]||(lipSyncMatches(clip.id)[0].clip.lipMode||'phoneme')==='phoneme'?'selected':'')}>日语五元音（实验）${!assetById(dialogue.voice)?.voiceTiming?' · 需重新生成 VOICEVOX 语音':''}</option><option value="manual" ${lipSyncMatches(clip.id)[0]?.clip.lipMode==='manual'?'selected':''}>手工五元音</option></select></div><button class="add-component" id="generate-lipsync" ${!dialogue.voice?'disabled':''}>${lipSyncMatches(clip.id).length?'更新口型':'从对白生成口型'}</button><p class="hint">五元音嘴形是实验近似；音量模式适用其他 WAV。口型随对齐的对白平移；更新会替换关键帧，可撤销。</p>`;}else{const voices=state.tracks.filter(t=>t.type==='audio').flatMap(t=>t.clips).filter(c=>c.dialogue===clip.dialogue),voice=voices.find(c=>c.start===clip.start)||voices[0];if(voice)fields+=sourceLink(voice.id,'编辑对白音源与口型…');}}
      if(track.type==='audio')fields+=`<div class="field"><label for="clip-audio-offset">音频源偏移（秒）</label><input id="clip-audio-offset" class="input" type="number" min="0" max="3600" step="any" value="${clip.sourceOffset??0}"><p class="hint">单次播放时，偏移达到音频末尾后为静音；循环时按文件长度取相位。</p></div><div class="field"><label>音量</label><div class="slider-line"><input id="clip-volume" type="range" min="0" max="1" step="0.01" value="${clip.volume??1}"><output id="clip-volume-value">${Math.round((clip.volume??1)*100)}%</output></div></div><div class="vector clip-timing"><label>淡入<input id="clip-fade-in" type="number" min="0" max="${clip.len}" step="${frame}" value="${clip.fadeIn??0}"></label><label>淡出<input id="clip-fade-out" type="number" min="0" max="${clip.len}" step="${frame}" value="${clip.fadeOut??0}"></label></div><p class="hint">淡入与淡出以秒为单位。</p>${clip.dialogue?'':`<label class="dialogue-link"><input id="clip-audio-loop" type="checkbox" ${clip.audioLoop?'checked':''}> 在片段内循环音频</label>${assetById(clip.assetId)?.filmAudio?.originalLoop||originalLoopIds.has(assetById(clip.assetId)?.filmAudio?.catalogId)||clip.originalLoop?`<label class="dialogue-link"><input id="clip-original-loop" type="checkbox" ${clip.originalLoop?'checked':''}> 使用音频库原始循环点</label>`:''}<p class="hint">${clip.originalLoop?`首遍包含前奏，之后循环 ${(clip.originalLoop.start/clip.originalLoop.sampleRate).toFixed(3)} 至 ${(clip.originalLoop.end/clip.originalLoop.sampleRate).toFixed(3)} 秒。`:'从音频末尾回到开头；可拉长片段以重复播放。'}</p>`}`;
      if(track.type==='audio'&&!clip.dialogue)fields+=`<div class="field"><label for="clip-audio-rate">播放速度（倍）</label><input class="input" id="clip-audio-rate" type="number" min=".25" max="4" step="any" value="${clip.mediaRate??1}" ${clip.mediaLink?'disabled':''}></div>`;
      if(['animation','expression'].includes(track.type)){const a=CreatorFades.amounts(clip,fadeSpan(clip,track.type));fields+=`<div class="vector clip-timing"><label>渐入（秒）<input id="clip-visual-fade-in" type="number" min="0" step="${frame}" value="${a.fadeIn}"></label><label>渐出（秒）<input id="clip-visual-fade-out" type="number" min="0" step="${frame}" value="${a.fadeOut}"></label></div><p class="hint">拖动片段顶部的圆点调整；渐入和渐出不能重叠。${track.type==='animation'?(motionBlendSupported?'基础动作渐变支持关闭物理或 Hybrid 模式；叠加层通过权重渐变。旧片段未设置渐出时保留片外 0.3 秒过渡。':'当前 Player 不支持动作渐变。'):''}</p>`;}
      if(track.type==='expression'&&clip.lipVisemes){const actor=state.objects.find(o=>o.id===track.target),choices=faceShapeAssets.filter(a=>a.source.startsWith('b_mouth.')&&shapeForActor(actor||{},a.id));fields+='<p class="hint">五元音嘴形为实验近似，可按别名或原名搜索，筛选时保留当前选择。</p>'+['a','i','u','e','o'].map(v=>`<div class="field"><label>${v.toUpperCase()} 嘴形</label><input class="input" data-viseme-search="${v}" placeholder="按别名或原名搜索，空格分隔关键词" aria-label="搜索 ${v.toUpperCase()} 嘴形"><select data-viseme-map="${v}">${choices.some(a=>a.source===clip.lipVisemes[v])?'':`<option selected value="${esc(clip.lipVisemes[v])}">缺失嘴形 · ${esc(clip.lipVisemes[v])}</option>`}${choices.map(a=>{const x=assetById(a.id)||a;return `<option data-search="${esc((x.alias||'')+' '+x.source)}" value="${esc(a.source)}" ${clip.lipVisemes[v]===a.source?'selected':''}>${esc(assetDisplay(x))}${x.alias?' · '+esc(a.source):''}</option>`;}).join('')}</select><div class="slider-line"><input type="range" min="0" max="100" value="0" data-viseme-slider="${v}" aria-label="${v.toUpperCase()} 口型权重"><output data-viseme-output="${v}">0%</output></div></div>`).join('');}
      if(animationLayersSupported)fields+=layerUI.clipFields(track,clip);
      if(track.type==='ui')fields+=uiEditor.fields(clip);
      fields+=effectsEditor.fields(track,clip);
      if(track.type==='media')fields+=mediaEditor.fields(track,clip);
      fields+=compositionEditor.fields(track,clip);
      if(track.type==='expression'&&!clip.lipVisemes)fields+=`<div class="field"><label>表情权重 <button class="camera-key" id="expression-key" aria-label="表情权重关键帧">◇</button></label><div class="slider-line"><input id="expression-weight" type="range" min="0" max="100" value="${expressionWeight(clip)}"><output id="expression-value">${expressionWeight(clip)}%</output></div></div><p class="hint">${faceShapeDefinition(clip.assetId)?'研究用面部形变，可为权重添加关键帧；不同形变可通过多条轨道叠加。':faceMotionById(clip.assetId)?'完整表情曲线，片段结束后恢复常驻表情。':'此表情尚未接入 Player。'}</p>`;
      if(clip.assetId==='asset-face-effect.RoundEyes')fields+='<p class="hint">权重达到 50% 时显示白圆眼并暂时隐藏原眼眶，低于 50% 时恢复；圆眼显示时普通眼部形变和视线控制暂不显示。</p>';
      if(['asset-face-effect.Gloom','asset-face-effect.Drool'].includes(clip.assetId))fields+='<p class="hint">本地原始头部效果；权重达到 50% 显示，低于 50% 隐藏。不同角色的素材覆盖不同。</p>';
      if(clip.assetId?.startsWith('asset-face-eyeMaterial.'))fields+='<p class="hint">权重达到 50% 时替换眼睛材质，结束后恢复；多个眼睛材质同时生效时使用最后一条轨道。动画图集按片段时间采样，排列为实验性重建。</p>';
      if(clip.assetId?.startsWith('asset-face-bone.'))fields+='<p class="hint">使用角色原始眼骨绑定姿势和顶点权重；转动范围为实验设置，未还原原游戏视线控制器。</p>';
      if(clip.lipSyncSource)fields+=lipSyncOutdated(clip)?'<p class="error">关联的对白音频、时间或设置已变化，请选中对应对白音频并点击“更新口型”。</p>':'<p class="hint">对白口型播放时优先控制嘴部，眉眼表情仍保留；对齐的口型随对白平移，裁剪或更换语音后需更新。</p>';
      $('#inspector').innerHTML=`<div class="selection-tag"><div class="selection-icon">${icon(c.icon)}</div><div><strong>${esc(clip.name)}</strong><small>${esc(c.name)} · ${esc(target?.name||track.target)} · ${esc(track.name)}</small></div></div><div class="inspector-section"><div class="section-title">${icon('sliders')} 片段属性</div>${fields}</div>${['camera','transform'].includes(track.type)&&target?visibilityFields(target)+cameraFields():''}<div id="clip-story-properties"></div>${keyframeList(clip,track)}`;bindClipFields(clip);bindClipSources(track,clip);compositionEditor.bind(track,clip);effectsEditor.bind(track,clip);if(track.type==='media')mediaEditor.bind(track,clip);if(track.type==='audio'&&clip.mediaLink){$('#clip-audio-offset').disabled=true;$('#clip-audio-loop').disabled=true;const note=document.createElement('p');note.className='hint';note.textContent='此声音与画面联动；源起点、速度和循环请在画面片段中修改。';$('#inspector').appendChild(note);}if(animationLayersSupported)layerUI.bindClip(track,clip);if(track.type==='ui')uiEditor.bind(clip);if(['camera','transform'].includes(track.type)&&target){bindVisibilityFields(target);bindCameraFields();}bindKeyframeList(clip,track);storyUI?.attach(track,clip);if(track.locked)$('#inspector').querySelectorAll('input,textarea,select,button:not(.keyframe-jump,[data-clip-locate],[data-inspect-related])').forEach(el=>el.disabled=true);return;
    }
    const o=obj(); if(!o){$('#inspector').innerHTML='<p class="hint">请选择场景对象、时间轴片段或素材查看属性。</p>';return;}let section='';o.transform ||= {position:[0,0,0],rotation:[0,0,0]};
    if(o.type==='画面'&&mediaEditor.objectInspector(o))return;
    section=`<div class="inspector-section"><div class="field"><label for="object-name">名称</label><input class="input" id="object-name" value="${esc(o.name)}"></div></div>`+visibilityFields(o)+cameraFields();
    if(editorGizmoSupported&&(supportedActor(o)||supportedProp(o)))section+='<div class="inspector-section"><div class="section-title">三轴变换（实验）</div><p class="hint">暂停时使用 W 平移、R 旋转、S 缩放。手柄显示在几何中心，旋转与缩放围绕对象原点；已有对应关键帧时修改当前帧，锁定轨道不可编辑。</p></div>';
    if(supportedProp(o))section+='<div class="inspector-section"><button class="add-component" id="remove-scene-prop">删除道具</button><p class="hint">同时移除该道具的轨道；可撤销。</p></div>';
    if(supportedActor(o))section+=`<div class="inspector-section"><div class="section-title">常驻动画</div><div class="field"><label for="idle-search">搜索动作</label><input class="input" id="idle-search" placeholder="按原名或别名搜索，空格分隔关键词" ${idleSupported&&performance?'':'disabled'}></div><div class="field"><label for="idle-motion">常驻姿势 / 动画</label><select id="idle-motion" ${idleSupported&&performance?'':'disabled'}></select></div><p class="hint">别名含当前角色名称的动作优先显示；动画循环、姿势保持，基础动作片段结束后恢复。${idleSupported?'默认使用共通站立待机候选，请按角色检查或更换。':'当前 Player 不支持常驻动画。'}</p></div>`;
    if(supportedActor(o)){const chosen=o.costumeAssetId&&costumeDefinitions.find(a=>a.id===o.costumeAssetId);section+=`<div class="inspector-section"><div class="section-title">服装</div><div class="asset-property"><span>已选</span><b>${esc(o.costumeAssetId?(chosen?assetDisplay(chosen):'素材缺失：'+o.costumeAssetId):'基础服装')}</b></div><button class="add-component" id="costume-choose">选择服装</button>${o.costumeAssetId?`${chosen?.playerAvailable&&costumeSupported?`<p class="hint">使用基础脸部与头发；${costumePhysics?'身体动态为实验近似，可在渲染设置中选择物理方式；不同服装尚需验收。':'此服装的衣物物理未启用。'}请检查预览连接状态。</p>`:'<p class="error">所选服装尚未应用，预览仍为基础服，暂不能导出。</p>'}<button class="add-component" id="costume-reset">恢复基础服装</button>`:'<p class="hint">也可将对应角色的服装素材拖到层级中的角色上。</p>'}</div>`;}
    if(animationLayersSupported&&supportedActor(o))section+=layerUI.residentMarkup(o);
    const all=o.components.map(key=>comp(key));
    $('#inspector').innerHTML=`<div class="selection-tag"><div class="selection-icon">${icon(o.icon)}</div><div><strong>${esc(o.name)}</strong><small>${esc(o.type)} · 场景对象</small></div></div>${section}<div class="inspector-section"><div class="section-title">${icon('spark')} 组件 <span class="section-meta">${all.length} 个</span></div>${all.map(x=>`<div class="component-chip">${icon(x.icon)} ${esc(x.name)}<span>已添加</span></div>`).join('')||'<p class="hint">还没有添加组件</p>'}<button class="add-component" id="add-component">＋ 添加组件 &nbsp; <kbd>Tab</kbd></button><p class="hint">选中场景对象后，按 Tab 可快速搜索和添加组件。</p></div>`;
    $('#add-component').onclick=openComponentModal;if(animationLayersSupported&&supportedActor(o))layerUI.bindResident(o);
    const removeProp=$('#remove-scene-prop');if(removeProp)removeProp.onclick=()=>{try{removeClassroomChair(o);}catch(error){notify(error.message);}};
    const costumeChoose=$('#costume-choose');if(costumeChoose)costumeChoose.onclick=()=>openCostumePicker(o.id);
    const costumeReset=$('#costume-reset');if(costumeReset)costumeReset.onclick=()=>setActorCostume(o.id,'');
    const idleSelect=$('#idle-motion'),idleSearch=$('#idle-search');
    if(idleSelect&&idleSearch){const chosen=()=>o.idleAssetId||defaultIdleDefinition()?.id||'asset-local-idle',code=actorCode(o),names=[...CreatorMotionNames.actorNames(code),code==='ttmr'?'月村手毬':actorNames[code],o.name.replace(/\s+\d+$/, '')],all=CreatorMotionNames.prioritize(allAssets().filter(x=>x.type==='动作'&&motionDefinition(x.id)&&!motionDefinition(x.id).isAdditive),names);const draw=()=>{const terms=searchTerms(idleSearch.value),chosenId=chosen(),current=all.find(x=>x.id===chosenId)||motionDefinition(chosenId);const matches=all.filter(x=>x.id===chosenId||matchesSearch(`${x.source} ${x.alias}`,terms));if(current&&!matches.some(x=>x.id===current.id))matches.push(current);idleSelect.innerHTML=(!current?`<option value="${esc(chosenId)}">待机素材缺失：${esc(chosenId)}</option>`:'')+matches.map(x=>`<option value="${esc(x.id)}" ${x.id===chosenId?'selected':''}>${esc(assetDisplay(x))}</option>`).join('');};draw();idleSearch.oninput=draw;idleSelect.onchange=e=>{if(!motionDefinition(e.target.value)){notify('常驻动画不可用');draw();return;}const before=copyState();o.idleAssetId=e.target.value;remember(before);bridgeLast='';updateClock();notify('常驻动画已更新');};}
    $('#object-name').onchange=e=>{const value=e.target.value.trim();if(!value){e.target.value=o.name;return;}const before=copyState(),old=o.name;o.name=value;for(const t of state.tracks.filter(t=>t.target===o.id)){if(t.name===old)t.name=value;else if(t.name.startsWith(old+' · '))t.name=value+t.name.slice(old.length);}remember(before);render();};
    bindVisibilityFields(o);
    bindCameraFields();
  }
  function visibilitySupported(o){return arrangement&&(['场景','相机'].includes(o.type)||supportedActor(o)||supportedProp(o));}
  function visibilityFields(o){
    const supported=visibilitySupported(o);
    return `<div class="inspector-section"><div class="section-title">对象状态 <button id="visibility-key" class="camera-key" aria-label="显示状态关键帧">◇</button></div><label class="dialogue-link"><input id="object-visible" type="checkbox" data-supported="${supported?'1':'0'}" ${o.visible===false?'':'checked'} ${supported?'':'disabled'}> ${o.type==='相机'?'启用相机':'显示对象'}</label></div>`;
  }
  function bindVisibilityFields(o){
    const supported=visibilitySupported(o);
    const visibility=$('#object-visible');if(visibility)visibility.onchange=e=>{const ctx=cameraContext();if(ctx?.inRange&&ctx.track.locked){syncVisibilityInspector();notify('轨道已锁定');return;}const before=copyState(),keys=ctx?.inRange&&ctx.track.enabled!==false?ctx.clip.propertyKeys?.visible:null;if(keys?.length){const t=quantize(state.current-ctx.clip.start);let key=keys.find(k=>Math.abs(k.time-t)<frame/2);if(key)key.value=e.target.checked;else keys.push({time:t,value:e.target.checked});keys.sort((a,b)=>a.time-b.time);renderTimeline();}else o.visible=e.target.checked;remember(before);renderHierarchy();updateClock();};
    $('#visibility-key').onclick=()=>{const ctx=cameraContext();if(!supported||!ctx?.inRange||ctx.track.locked)return;const before=copyState(),value=visibility.checked,t=quantize(state.current-ctx.clip.start);ctx.clip.propertyKeys ||= {};const keys=ctx.clip.propertyKeys.visible ||= [],index=keys.findIndex(k=>Math.abs(k.time-t)<frame/2);if(index>=0){keys.splice(index,1);if(!keys.length)o.visible=value;}else{keys.push({time:t,value});keys.sort((a,b)=>a.time-b.time);}remember(before);renderTimeline();updateClock();};syncVisibilityInspector();
  }
  function selectSettingsPage(id){const modal=$('#modal');for(const button of modal.querySelectorAll('[data-settings-nav]')){const active=button.dataset.settingsNav===id;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}for(const page of modal.querySelectorAll('[data-settings-page]'))page.hidden=page.dataset.settingsPage!==id;modal.dataset.settingsCurrent=id;const content=modal.querySelector('.settings-content');if(content)content.scrollTop=0;}
  function bindSettingsNavigation(initial){const modal=$('#modal');for(const button of modal.querySelectorAll('[data-settings-nav]'))button.onclick=()=>selectSettingsPage(button.dataset.settingsNav);selectSettingsPage(initial);}
  function renderGlobalProperties(){
    const g=state.globalSettings;
    const container=$('#project-settings-content');if(!container)return;
    const scroll=container.scrollTop, focusId=container.contains(document.activeElement)?document.activeElement.id:'';
    const renderPage=CreatorRenderSettings.fields(g.render,{global:g,tab:container.dataset.renderTab,performance:physicsAvailable,
      physicsModes:physicsModesSupported,outline:globalSettingsSupported,render:renderSettingsSupported});
    container.innerHTML=`<div class="inspector-section" data-settings-page="general"><div class="section-title">一般</div><div class="field"><label for="global-duration">演出时长（秒）</label><input class="input" id="global-duration" type="number" min="1" max="3600" step="1" value="${g.duration}"></div><div class="field"><label for="global-aspect">画面比例</label><select id="global-aspect">${['16:9','9:16','1:1','4:3'].map(v=>`<option value="${v}" ${g.aspect===v?'selected':''}>${v}</option>`).join('')}</select></div><p class="hint">缩短时长后，范围外的片段保留，重新延长即可恢复。</p></div><section class="inspector-section render-page" data-settings-page="render">${renderPage}</section><div class="inspector-section" data-settings-page="export"><div class="section-title">导出</div><div class="field"><label for="global-fps">帧率</label><select id="global-fps">${[24,25,30,60].map(v=>`<option value="${v}" ${g.fps===v?'selected':''}>${v} fps</option>`).join('')}</select></div><p class="hint">同时决定时间轴帧网格和导出帧率。</p><div class="field"><label for="global-quality">分辨率</label><select id="global-quality"><option value="720" ${(g.exportQuality||'720')==='720'?'selected':''}>720p</option><option value="1080" ${g.exportQuality==='1080'?'selected':''}>1080p</option></select></div><p class="hint">实际宽高随画面比例变化。</p><div class="field"><label for="global-supersampling">超采样</label><select id="global-supersampling"><option value="1" ${(g.exportSupersampling??1)===1?'selected':''}>关闭</option><option value="2" ${g.exportSupersampling===2?'selected':''}>2×（宽高各两倍）</option></select></div><p class="hint">提高世界画面的边缘稳定性，会增加显存占用与导出耗时；成片分辨率不变。</p></div>`;
    selectSettingsPage($('#modal').dataset.settingsCurrent||'general');
    CreatorRenderSettings.bindTabs(container);
    for(const radio of container.querySelectorAll('input[name="physics-method"]')){
      radio.onchange=()=>{
        if(!radio.checked || radio.value===CreatorRenderSettings.physicsMode(g))return;
        const before=copyState();Object.assign(g,CreatorRenderSettings.physicsSettings(radio.value));remember(before);
        renderGlobalProperties();syncPlayer();
      };
    }
    for(const input of container.querySelectorAll('[data-render-key]')){
      const key=input.dataset.renderKey;
      input.disabled=!renderSettingsSupported||CreatorRenderSettings.disabled(g.render,key);
      input.onchange=e=>{
        try{
          const next=CreatorRenderSettings.change(g.render,key,e.target.type==='checkbox'?e.target.checked:e.target.value);
          if(JSON.stringify(next)===JSON.stringify(g.render))return;
          const before=copyState();g.render=next;remember(before);renderGlobalProperties();syncPlayer();
        }catch(error){notify(error.message);renderGlobalProperties();}
      };
    }
    $('#reset-render-settings').onclick=()=>{const next=CreatorRenderSettings.normalize();if(JSON.stringify(next)===JSON.stringify(g.render))return;const before=copyState();g.render=next;remember(before);renderGlobalProperties();syncPlayer();};
    $('#global-duration').onchange=e=>{const value=Number(e.target.value),end=Math.max(0,...state.tracks.flatMap(t=>t.clips.map(c=>c.start+c.len)));if(!Number.isFinite(value)||value<1||value>3600){e.target.value=g.duration;notify('时长需在 1–3600 秒之间');return;}const before=copyState();g.duration=value;state.current=Math.min(state.current,value);remember(before);render();resizeTimeline();if(end>value)notify('时长外片段已保留，延长时可恢复');};
    const automatic=CreatorStory.units(state).length>0;$('#global-duration').disabled=automatic;if(automatic){const hint=document.createElement('p');hint.className='hint';hint.textContent='演出时长由剧情和固定片段自动计算；请在剧情主线设置结束留白。';$('#global-duration').closest('.field').after(hint);}
    $('#global-fps').onchange=e=>{const value=Number(e.target.value);if(automatic){storyTransaction(s=>{s.globalSettings.fps=value;},'已按新帧率重新排时');}else{const before=copyState();g.fps=value;remember(before);render();resizeTimeline();}};
    $('#global-quality').onchange=e=>{const before=copyState();g.exportQuality=e.target.value;remember(before);};
    $('#global-supersampling').onchange=e=>{const before=copyState();g.exportSupersampling=Number(e.target.value);remember(before);};
    $('#global-aspect').onchange=e=>{const before=copyState();g.aspect=e.target.value;remember(before);render();};
    const toggle=(key,e)=>{const before=copyState();g[key]=e.target.checked;remember(before);renderGlobalProperties();syncPlayer();};
    $('#outline-enabled').onchange=e=>toggle('outlineEnabled',e);
    let beforeWidth=null;const slider=$('#outline-width');slider.oninput=e=>{beforeWidth ||= copyState();g.outlineWidth=Number(e.target.value);$('#outline-value').textContent=g.outlineWidth.toFixed(2);syncPlayer();};
    const finish=()=>{if(beforeWidth){if(JSON.stringify(beforeWidth)!==JSON.stringify(state))remember(beforeWidth);beforeWidth=null;}}; slider.onchange=finish;slider.onblur=finish;
    container.scrollTop=scroll;
    if(focusId){const next=document.getElementById(focusId);if(next && container.contains(next))next.focus({preventScroll:true});}
  }
  function openProjectSettings(){
    showModal(`<header class="preferences-titlebar"><h2>${icon('sliders')}工程设置</h2><span>${esc(projectName)}</span><button class="icon-button" data-close aria-label="关闭工程设置">${icon('close')}</button></header>
      <div class="settings-shell"><aside class="settings-sidebar"><nav aria-label="工程设置分类">
        <button data-settings-nav="general">${icon('folder')}一般</button>
        <button data-settings-nav="render">${icon('eye')}渲染设置</button>
        <button data-settings-nav="export">${icon('film')}导出</button>
      </nav></aside><div class="settings-main"><div class="settings-content" id="project-settings-content"></div></div></div>`,'settings-modal project-settings-modal');
    renderGlobalProperties();bindSettingsNavigation('general');
  }
  window.addEventListener('creator-color-error',e=>notify('取色失败：'+e.detail));
  let pronunciationRules=null;
  async function loadPronunciation(){if(!window.voiceAPI?.pronunciationRead)return;try{const data=await window.voiceAPI.pronunciationRead();pronunciationRules=data.rules;renderInspector();}catch(e){pronunciationRules=null;notify('发音替换词读取失败：'+e.message);}}
  function translationOutdated(d,reference=d.voiceSource){const t=d.translation;return reference?.provider==='voicevox'&&Boolean(t)&&(t.sourceText!==d.text||t.sourceSpeaker!==d.speaker);}
  function voiceText(d,reference=d.voiceSource){const t=d.translation;return reference?.provider==='voicevox'&&t?.text&&t.sourceText===d.text&&t.sourceSpeaker===d.speaker?t.text:d.text;}
  function cookedCurrent(d){const c=d.cookedFor;if(!c||JSON.stringify({text:c.text,reference:c.reference,language:c.language})!==JSON.stringify({text:d.text,reference:d.voiceSource,language:d.language||'all_ja'}))return false;const text=voiceText(d);if((c.synthesisText??c.text)!==text)return false;if(d.voiceSource?.provider!=='voicevox')return true;if(!pronunciationRules)return false;return (c.spokenText??c.text)===CreatorPronunciation.voicevox(text,pronunciationRules);}
  function bindAssetSettings(){window.creatorAssetSettings.bind({api:window.assetAPI,refreshCatalog:loadOriginalLoopCatalog});}
  async function openEditorSettings(){
    const [settingResult,rulesResult]=await Promise.allSettled([Promise.resolve().then(()=>{if(!window.translationAPI?.read)throw Error('翻译设置不可用');return window.translationAPI.read();}),Promise.resolve().then(()=>{if(!window.voiceAPI?.pronunciationRead)throw Error('发音设置不可用');return window.voiceAPI.pronunciationRead();})]);
    let settings=settingResult.status==='fulfilled'?settingResult.value:{hasKey:false,prompt:''};let data=rulesResult.status==='fulfilled'?rulesResult.value:{rules:[],revision:null};
    if(rulesResult.status==='fulfilled')pronunciationRules=data.rules;renderInspector();
    showModal(`<div class="settings-shell"><aside class="settings-sidebar"><h2>编辑器设置</h2><p>应用于此计算机上的全部工程</p><nav aria-label="编辑器设置分类"><button data-settings-nav="assets">资产</button><span class="settings-group-label">翻译</span><button data-settings-nav="connection">DeepSeek 与提示词</button><button data-settings-nav="pronunciation">发音替换</button></nav></aside><div class="settings-main"><div class="settings-top"><span>编辑器设置</span><button class="icon-button" data-close aria-label="关闭">×</button></div><div class="settings-content">${window.creatorAssetSettings.html}<section data-settings-page="connection"><div class="section-title">DeepSeek 连接与提示词</div><div class="field"><label for="translation-key">DeepSeek API Key</label><input type="password" autocomplete="off" class="input" id="translation-key" placeholder="${settings.keyStatus==='unavailable'?'已保存的密钥无法解密，请重新填写':settings.hasKey?'已保存；留空保留原密钥':'输入 API Key'}"></div><label class="dialogue-link"><input type="checkbox" id="translation-clear-key"> 删除已保存的密钥</label><div class="field"><label for="translation-prompt">翻译提示词（可加入角色口癖、称呼和术语）</label><textarea id="translation-prompt" maxlength="12000" rows="9">${esc(settings.prompt)}</textarea></div><p class="hint">密钥由系统加密保存在创作器数据目录，不保存在工程中。翻译时，剧本对白、说话人和本提示词会发送给 DeepSeek，可能产生 API 费用。</p><button class="add-component" id="translation-defaults">恢复随版本提供的提示词</button><p class="hint">恢复默认只修改当前输入，点击保存后生效。</p><p id="translation-settings-error" class="error"></p><button class="add-component" id="translation-settings-save">保存连接和提示词</button></section><section data-settings-page="pronunciation"><div class="section-title">发音替换</div><p class="hint">应用于 VOICEVOX 语音生成，不改变对白、字幕和已有音频；最长原词优先，英文不区分大小写。省略号在开头和结尾会移除，中间默认换为逗号；纯省略号保留为静默。已生成语音需重新生成。</p><div id="pronunciation-rows"></div><button class="add-component" id="pronunciation-add">＋ 添加替换词</button><button class="add-component" id="pronunciation-defaults">恢复默认词表</button><p id="pronunciation-error" class="error"></p><button class="add-component" id="pronunciation-save">保存发音替换词</button></section></div></div></div>`,'settings-modal editor-settings-modal');
    bindSettingsNavigation(settingResult.status==='fulfilled'?'connection':'assets');bindAssetSettings();
    if(settingResult.status!=='fulfilled'){$('#translation-settings-error').textContent='翻译设置读取失败：'+settingResult.reason.message;$('#modal [data-settings-page=connection]').querySelectorAll('input,textarea,button').forEach(el=>el.disabled=true);}
    if(rulesResult.status!=='fulfilled'){$('#pronunciation-error').textContent='发音设置读取失败：'+rulesResult.reason.message;for(const selector of ['#pronunciation-add','#pronunciation-defaults','#pronunciation-save'])$(selector).disabled=true;}
    $('#translation-defaults').onclick=()=>{$('#translation-prompt').value=settings.defaultPrompt;};
    $('#translation-settings-save').onclick=async e=>{const button=e.currentTarget;button.disabled=true;try{const saved=await window.translationAPI.save({key:$('#translation-key').value,clearKey:$('#translation-clear-key').checked,prompt:$('#translation-prompt').value,revision:settings.revision});settings.revision=saved.revision;if(button.isConnected){$('#translation-key').value='';$('#translation-key').placeholder=saved.hasKey?'已保存；留空保留原密钥':'输入 API Key';$('#translation-clear-key').checked=false;$('#translation-settings-error').textContent='';}notify('DeepSeek 设置已保存');}catch(error){if(button.isConnected)$('#translation-settings-error').textContent=error.message;else notify('DeepSeek 设置保存失败：'+error.message);}finally{button.disabled=false;}};
    const rows=$('#pronunciation-rows');
    function add(r={from:'',to:''}){const row=document.createElement('div');row.className='inspector-section';row.innerHTML=`<div class="field"><label>原词</label><input class="input pronunciation-from" maxlength="100" value="${esc(r.from)}" placeholder="例如 制作人"></div><div class="field"><label>发音文本</label><input class="input pronunciation-to" maxlength="100" value="${esc(r.to)}" placeholder="例如 プロデューサー"></div><button type="button" class="pronunciation-remove">删除</button>`;row.querySelector('.pronunciation-remove').onclick=()=>row.remove();rows.append(row);}
    data.rules.forEach(add);$('#pronunciation-add').onclick=()=>add();$('#pronunciation-defaults').onclick=()=>{rows.replaceChildren();data.defaults.forEach(add);};
    $('#pronunciation-save').onclick=async e=>{const button=e.currentTarget;try{const rules=Array.from(rows.children,row=>({from:row.querySelector('.pronunciation-from').value,to:row.querySelector('.pronunciation-to').value}));CreatorPronunciation.validate(rules);button.disabled=true;const result=await window.voiceAPI.pronunciationSave(rules,data.revision);data=result;pronunciationRules=result.rules;if(button.isConnected)$('#pronunciation-error').textContent='';renderInspector();notify('全局发音替换词已保存');}catch(error){if(button.isConnected)$('#pronunciation-error').textContent=error.message;else notify('发音替换词保存失败：'+error.message);}finally{button.disabled=false;}};
    await CreatorSettingsFileLinks.mount({api:window.settingsFileAPI,connection:$('#modal [data-settings-page=connection]'),pronunciation:$('#modal [data-settings-page=pronunciation]'),reloadPrompt:async()=>{const next=await window.translationAPI.read();if(!rows.isConnected)return;settings=next;$('#translation-prompt').value=next.prompt;$('#translation-settings-error').textContent='';$('#modal [data-settings-page=connection]').querySelectorAll('input,textarea,button').forEach(el=>el.disabled=false);},reloadRules:async()=>{const next=await window.voiceAPI.pronunciationRead();if(!rows.isConnected)return;data=next;rows.replaceChildren();next.rules.forEach(add);pronunciationRules=next.rules;$('#pronunciation-error').textContent='';for(const selector of ['#pronunciation-add','#pronunciation-defaults','#pronunciation-save'])$(selector).disabled=false;renderInspector();}}).catch(error=>notify('配置文件指引加载失败：'+error.message));
  }
  function scriptLines(){const times=new Map();for(const t of state.tracks)if(t.type==='dialogue'||t.type==='audio')for(const c of t.clips||[])if(c.dialogue)times.set(c.dialogue,Math.min(times.get(c.dialogue)??Infinity,c.start));return state.dialogues.filter(d=>times.has(d.id)).map((d,index)=>({id:d.id,speaker:d.speaker,text:d.text,index,time:times.get(d.id)??Infinity})).sort((a,b)=>a.time-b.time||a.index-b.index).map(({id,speaker,text})=>({id,speaker,text}));}
  async function recookTranslatedDialogue(lines,projectId){
    const identity=state,stamp=JSON.stringify(state),entries=[],issues=[];let cancelled=false,applied=0,visited=0;
    setPlaying(false);translationCooking=true;projectBusy=true;
    showModal(`<div class="modal-head"><div><h2>正在重新生成语音</h2><p id="translation-cook-progress">正在准备…</p></div></div><div class="modal-body"><progress id="translation-cook-bar" max="${lines.length}" value="0" style="width:100%"></progress><p class="hint">完成本批生成后统一排时，字幕、口型和绑定片段一起更新。</p><button class="add-component" id="translation-cook-stop">停止后续生成</button></div>`);
    $('#translation-cook-stop').onclick=e=>{cancelled=true;e.currentTarget.disabled=true;e.currentTarget.textContent='等待当前句完成…';};
    try{
      for(let i=0;i<lines.length&&!cancelled;i++){
        const d=identity.dialogues.find(d=>d.id===lines[i].id);visited=i+1;$('#translation-cook-progress').textContent=`${visited} / ${lines.length} · ${d?.speaker||'对白'}`;
        try{
          if(!d?.voiceSource||d.voiceSource.provider!=='voicevox')throw Error('未选择 VOICEVOX 音源，保留现有语音');
          const request={text:d.text,reference:structuredClone(d.voiceSource),language:d.language||'all_ja',synthesisText:voiceText(d)},expected=JSON.stringify(d);
          const result=await window.voiceAPI.cook(projectId,request.reference,request.synthesisText,request.language);request.spokenText=result.spokenText??request.synthesisText;entries.push({dialogueId:d.id,asset:result.asset||result,request,expected});
        }catch(error){issues.push(`${visited}. ${d?.speaker||'对白'}：${error.message}`);}
        $('#translation-cook-bar').value=visited;
      }
      if(entries.length){$('#translation-cook-progress').textContent='正在统一调整剧情与口型…';try{const result=await storyVoice.apply(entries,identity,stamp);applied=result.applied;}catch(error){issues.push('本批排时未应用：'+error.message);}}
    }finally{translationCooking=false;projectBusy=false;void loadPronunciation();render();}
    showModal(`<div class="modal-head"><div><h2>翻译与语音生成完成</h2><p>已生成 ${entries.length} 句，已应用 ${applied} 句${cancelled?' · 已停止后续生成':''}</p></div><button data-close class="icon-button">×</button></div><div class="modal-body"><p>语音按真实长度排时，后续剧情及已绑定的片段一起调整；自动口型同步重建。${visited<lines.length?`还有 ${lines.length-visited} 句未处理。`:''}</p><p class="hint">固定时间、锁定轨道或手工口型发生冲突时，保留原排布。新声音保留为待处理结果，解决冲突后可重新应用。</p>${issues.length?`<div class="translation-cook-issues">${issues.map(x=>`<p>${esc(x)}</p>`).join('')}</div>`:''}<button class="add-component" id="translation-cook-done">完成</button></div>`);$('#translation-cook-done').onclick=closeModal;
  }
  function openScriptTranslation(){
    if(!window.translationAPI){notify('当前会话不支持 DeepSeek 翻译');return;}const lines=scriptLines(),projectId=state.projectId,signature=JSON.stringify(lines);if(!lines.length){notify('请先添加对白');return;}
    showModal(`<div class="modal-head"><div><h2>翻译全部对白</h2><p>按时间顺序提供完整上下文</p></div><button class="icon-button" data-close aria-label="关闭">×</button></div><div class="modal-body"><p>将发送本工程 ${lines.length} 句对白、说话人和全局翻译提示词至 DeepSeek，可能产生 API 费用。</p><p class="hint">结果会先逐句展示，确认后才写入工程。现有中文字幕不会改变；重新翻译会替换已有译文。发送后关闭窗口不会中止请求，仍可能计费。</p><p id="translate-error" class="error"></p><button class="add-component" id="translate-run">开始翻译</button></div>`);
    $('#translate-run').onclick=async e=>{const button=e.currentTarget;button.disabled=true;button.textContent='正在翻译…';try{const result=await window.translationAPI.translate(lines);if(!button.isConnected)return;if(state.projectId!==projectId||JSON.stringify(scriptLines())!==signature)throw Error('翻译期间工程或对白已变化，请重新翻译');
      showModal(`<div class="modal-head"><div><h2>检查日语译文</h2><p>修改后确认，原文和字幕保留</p></div><button class="icon-button" data-close aria-label="关闭">×</button></div><div class="modal-body"><p class="hint">确认后自动使用已选 VOICEVOX 音源重新生成语音。生成后统一调整剧情顺序、字幕、口型和绑定片段；固定时间或锁定冲突时保留原排布。</p><div id="translation-review"></div><p id="translation-review-error" class="error"></p><button class="add-component" id="translation-apply">确认译文并重新生成语音</button></div>`);
      const container=$('#translation-review');lines.forEach((line,i)=>{const row=document.createElement('div');row.className='inspector-section';row.innerHTML=`<div class="section-title">${esc(line.speaker||'未命名')} · ${i+1}</div><p>${esc(line.text)}</p><div class="field"><label>日语译文</label><textarea maxlength="1000" data-translation-id="${esc(line.id)}">${esc(result.lines[i].text)}</textarea></div>`;container.append(row);});
      $('#translation-apply').onclick=()=>{try{if(projectBusy||translationCooking)throw Error('工作台正忙，请稍后重试');if(state.projectId!==projectId||JSON.stringify(scriptLines())!==signature)throw Error('剧本已变化，请重新翻译');const edited=Array.from(container.querySelectorAll('[data-translation-id]'),el=>({id:el.dataset.translationId,text:el.value.trim()}));if(edited.some(x=>!x.text||x.text.length>1000))throw Error('每句译文都须填写，最多 1000 字');const before=copyState();for(let i=0;i<lines.length;i++){const d=state.dialogues.find(x=>x.id===lines[i].id);d.translation={text:edited[i].text,sourceText:lines[i].text,sourceSpeaker:lines[i].speaker};}remember(before);renderInspector();void recookTranslatedDialogue(lines,projectId);}catch(error){$('#translation-review-error').textContent=error.message;}};
    }catch(error){if(button.isConnected){button.disabled=false;button.textContent='开始翻译';$('#translate-error').textContent=error.message;}}};
  }
  function storyTransaction(action,message){
    if(projectBusy||translationCooking||timelineEditBusy||exporting){notify('工作台正忙，请完成当前操作');return false;}
    finishGizmoEdit();commitInspectorInput();setPlaying(false);const before=copyState(),next=structuredClone(before);
    try{action(next);const result=CreatorStory.reflow(next,before);state=next;remember(before);uiSceneGate=null;bridgeLast='';render();resizeTimeline();notify(message+(Math.abs(result.delta)>.001?` · 演出时长 ${result.delta>0?'+':''}${result.delta.toFixed(2)} 秒`:''));return true;}
    catch(error){const box=$('#story-error')||$('#story-bind-error');if(box)box.textContent=error.message;notify(error.message);return false;}
  }
  function removeStoryUnit(s,unitId){const ids=[...CreatorStory.owned(s,[unitId])];if(ids.length)CreatorProjectRemoval.clips(s,ids,assetById,false);if(CreatorStory.units(s).some(u=>u.id===unitId))CreatorStory.removeUnits(s,[unitId]);CreatorTimelineEdit.prune(s);}
  function addStoryDialogue(objectId,speaker,text,length,style,index){
    if(projectBusy||translationCooking||exporting)throw Error('工作台正忙');
    const before=copyState(),next=structuredClone(before),target=next.objects.find(o=>o.id===objectId);if(!target)throw Error('说话对象不存在');
    if(!['game','box','subtitle'].includes(style)||(style==='game'&&!gameDialogue)||(style==='subtitle'&&!dialogueStyles))throw Error('所选对白样式不可用');
    if(!Number.isFinite(length)||length<frame||length>3600||!Number.isInteger(index)||index<0||index>CreatorStory.units(next).length)throw Error('对白长度或插入位置无效');
    const dialogueId=id(),uiId=id(),audioId=id();next.dialogues.push({id:dialogueId,speaker,text,voice:'',linked:true,uiStyle:style,typewriter:false,revealRate:12,language:'all_ja'});
    for(const [type,name,clipId] of [['dialogue','UI（对话）',uiId],['audio','音效（对话）',audioId]])next.tracks.push({id:id(),name:`${target.name} · ${name}`,type,target:target.id,clips:[{id:clipId,name:speaker,start:0,len:CreatorStory.ceil(next,length),dialogue:dialogueId}]});
    CreatorStory.insertDialogue(next,dialogueId,index,id());CreatorStory.reflow(next,before);state=next;remember(before);selectedAsset=null;render();resizeTimeline();notify('已插入对白，后续剧情已顺延');return {dialogueId,uiClipId:uiId,audioClipId:audioId};
  }
  function commitStoryVoice(next,before,result){state=next;remember(before);uiSceneGate=null;bridgeLast='';render();resizeTimeline();notify(`语音与剧情排时已更新，可一次撤销 · 演出时长 ${result.delta>=0?'+':''}${result.delta.toFixed(2)} 秒`);}
  function retainStoryVoice(entries,reason){
    const before=copyState();for(const e of entries){if(!state.assets.some(a=>a.id===e.asset.id))state.assets.push({...e.asset,alias:(e.asset.alias||e.asset.source||'语音')+'（待排时）'});const d=state.dialogues.find(d=>d.id===e.dialogueId);if(d&&(!e.expected||JSON.stringify(d)===e.expected))d.pendingVoice={assetId:e.asset.id,originalAlias:d.pendingVoice?.assetId===e.asset.id?d.pendingVoice.originalAlias:e.asset.alias||'',...(e.request?{request:e.request}:{}),reason};}
    remember(before);render();notify('新语音已保留为待处理结果，现有声音与排布保留：'+reason,{persistent:true});
  }
  async function applyPendingVoices(){
    if(projectBusy||translationCooking||exporting)return;commitInspectorInput();setPlaying(false);const entries=state.dialogues.filter(d=>d.pendingVoice).map(d=>({dialogueId:d.id,asset:assetById(d.pendingVoice.assetId),request:d.pendingVoice.request,expected:JSON.stringify(d)}));if(!entries.length)return notify('没有待处理语音');
    projectBusy=true;try{if(entries.some(e=>!e.asset))throw Error('待处理的语音素材已缺失');for(const entry of entries){const d=state.dialogues.find(d=>d.id===entry.dialogueId),r=entry.request;if(r&&(r.text!==d.text||r.synthesisText!==voiceText(d,r.reference)))throw Error('台词或译文已改变，请重新生成语音');}await storyVoice.apply(entries);}catch(error){notify(error.message);}finally{projectBusy=false;render();}
  }
  async function cookOneDialogue(dialogueId,reference,language){
    if(projectBusy||translationCooking||exporting)throw Error('工作台正忙');commitInspectorInput();setPlaying(false);
    const d=state.dialogues.find(d=>d.id===dialogueId);if(!d||!reference)throw Error('请选择台词和音源');if(!d.text.trim())throw Error('台词不能为空');if(translationOutdated(d,reference))throw Error('台词已修改，请先更新译文');
    const identity=state,stamp=JSON.stringify(state),expected=JSON.stringify(d),request={text:d.text,reference:structuredClone(reference),language:language||'all_ja',synthesisText:voiceText(d,reference)};projectBusy=true;
    try{const result=await window.voiceAPI.cook(state.projectId,reference,request.synthesisText,request.language),asset=result.asset||result;request.spokenText=result.spokenText??request.synthesisText;await storyVoice.apply([{dialogueId,asset,request,expected}],identity,stamp);void loadPronunciation();return {assetId:asset.id,dialogueId};}
    finally{projectBusy=false;render();}
  }
  async function assignDialogueVoice(dialogueId,assetId){
    if(projectBusy||translationCooking||exporting)return;setPlaying(false);const d=state.dialogues.find(d=>d.id===dialogueId);if(!d)return;
    if(!assetId){const before=copyState(),next=structuredClone(before),target=next.dialogues.find(x=>x.id===dialogueId),audioIds=new Set(CreatorStory.rows(next).filter(r=>r.track.type==='audio'&&r.clip.dialogue===dialogueId).map(r=>r.clip.id));try{if(next.tracks.some(t=>t.locked&&t.clips.some(c=>c.dialogue===dialogueId)))throw Error('对白轨道已锁定');for(const t of next.tracks){const lips=t.clips.filter(c=>audioIds.has(c.lipSyncSource?.audioClipId));if(lips.some(c=>t.locked||c.lipEdited||c.lipMode==='manual'))throw Error('关联口型已锁定或经过手工调整，请先整理');t.clips=t.clips.filter(c=>!audioIds.has(c.lipSyncSource?.audioClipId));}target.voice='';delete target.cookedFor;delete target.pendingVoice;state=next;remember(before);render();}catch(error){notify(error.message);render();}return;}
    const asset=assetById(assetId);if(!asset)return notify('音频素材不存在');projectBusy=true;
    try{await storyVoice.apply([{dialogueId,asset,expected:JSON.stringify(d)}]);}catch(error){notify(error.message);}finally{projectBusy=false;render();}
  }

  function bindClipFields(clip){
    const track=getClip(clip.id)?.track;
    $('#clip-name').onchange=e=>{
      const name=e.target.value.trim();
      if(!name||name===clip.name){e.target.value=clip.name;return;}
      const before=copyState();clip.name=name;clip.nameEdited=true;remember(before);renderTimeline();renderInspector();
    };
    let beforeTiming=null;const timing=(finish=false)=>{const startEl=$('#clip-start'),lenEl=$('#clip-length');if(!startEl.value||!lenEl.value)return;const start=quantize(Math.max(0,Math.min(duration-frame,Number(startEl.value)))),len=quantize(Math.max(frame,Math.min(duration-start,Number(lenEl.value))));if(canEdit(clip,start,len)){beforeTiming ||= copyState();setClipTiming(clip,start,len);renderTimeline();updateClock();}else if(finish)notify('片段重叠或轨道已锁定');if(finish){if(beforeTiming){const original=beforeTiming.tracks.flatMap(t=>t.clips).find(c=>c.id===clip.id);for(const item of relatedClips(clip)){const prior=beforeTiming.tracks.flatMap(t=>t.clips).find(c=>c.id===item.id);if(prior?.mediaKeys&&item.len<prior.len-frame/2)item.mediaKeys=CreatorScreenMedia.slice(prior.mediaKeys,0,item.len);}if(original&&clip.len<original.len-frame/2)for(const [property,keys] of Object.entries(clip.propertyKeys||{}))if(keys.length){const boundary=sampleKeys(keys,clip.len);clip.propertyKeys[property]=keys.filter(k=>k.time<clip.len-frame/2).concat({time:clip.len,value:boundary});}for(const c of relatedClips(clip)){const f=getClip(c.id);if(f&&['animation','expression'].includes(f.track.type))CreatorFades.clampStored(c,fadeSpan(c,f.track.type));}remember(beforeTiming);beforeTiming=null;renderTimeline();}renderInspector();}};
    $('#clip-start').oninput=()=>timing();$('#clip-length').oninput=()=>timing();$('#clip-start').onchange=()=>timing(true);$('#clip-length').onchange=()=>timing(true);
    const dialogue=state.dialogues.find(x=>x.id===clip.dialogue);
    const speakerChoice=$('#dialogue-speaker-choice'),speakerEdit=$('#dialogue-speaker-edit');if(speakerEdit&&dialogue){speakerChoice.onchange=e=>{if(!e.target.value)return;const before=copyState();dialogue.speaker=e.target.value;remember(before);renderTimeline();renderInspector();updateClock();};speakerEdit.onchange=e=>{const value=e.target.value.trim();if(!value){e.target.value=dialogue.speaker;return;}const before=copyState();dialogue.speaker=value;remember(before);renderTimeline();renderInspector();updateClock();};}
    const colorA=$('#dialogue-name-color'),colorB=$('#dialogue-name-color-end'),colorReset=$('#dialogue-color-reset');if(dialogue&&colorA&&colorB){const change=()=>{const before=copyState();dialogue.nameColor=colorA.value;dialogue.nameColorEnd=colorB.value;remember(before);updateClock();};colorA.onchange=change;colorB.onchange=change;colorReset.onclick=()=>{const before=copyState();delete dialogue.nameColor;delete dialogue.nameColorEnd;remember(before);renderInspector();updateClock();};}
    const uiStyle=$('#dialogue-ui-style'),typewriter=$('#dialogue-typewriter'),rate=$('#dialogue-reveal-rate');if(uiStyle&&dialogue){uiStyle.onchange=e=>{const before=copyState();dialogue.uiStyle=e.target.value;remember(before);updateClock();};typewriter.onchange=e=>{const before=copyState();dialogue.typewriter=e.target.checked;remember(before);rate.disabled=!e.target.checked;updateClock();};rate.onchange=e=>{const value=Number(e.target.value);if(!Number.isFinite(value)||value<1||value>60){e.target.value=dialogue.revealRate||12;return;}const before=copyState();dialogue.revealRate=value;remember(before);updateClock();};}
    const translationEdit=$('#dialogue-translation-edit');if(translationEdit&&dialogue)translationEdit.onchange=e=>{const value=e.target.value.trim();if(!value){e.target.value=dialogue.translation.text;notify('译文不能为空');return;}const before=copyState();dialogue.translation={text:value,sourceText:dialogue.text,sourceSpeaker:dialogue.speaker};remember(before);renderInspector();};
    const d=$('#dialogue-edit');if(d&&dialogue){let beforeText=null;d.onfocus=()=>beforeText=copyState();d.oninput=e=>{beforeText ||=copyState();dialogue.text=e.target.value;refreshDialogueTitles(dialogue.id);updateClock();};const finishText=()=>{if(beforeText&&JSON.stringify(beforeText)!==JSON.stringify(state)){remember(beforeText);renderTimeline();const status=$('#synth-cook-status');if(status)status.textContent='台词已修改，需要重新生成语音';}beforeText=null;};d.onchange=finishText;d.onblur=finishText;}
    function bindOptionSearch(input,select){if(!input||!select)return;const options=[...select.options].map(option=>({option,text:(option.dataset.search||'').toLocaleLowerCase()}));input.oninput=()=>{const terms=searchTerms(input.value);for(const row of options)row.option.hidden=Boolean(terms.length&&row.text&&!matchesSearch(row.text,terms)&&row.option.value!==select.value);};}
    bindOptionSearch($('#voice-search'),$('#voice-select'));bindOptionSearch($('#synth-search'),$('#synth-source'));document.querySelectorAll('[data-viseme-search]').forEach(input=>bindOptionSearch(input,document.querySelector(`[data-viseme-map="${input.dataset.visemeSearch}"]`)));
    const v=$('#voice-select');if(v&&dialogue)v.onchange=e=>void assignDialogueVoice(dialogue.id,e.target.value);
    const sourceSelect=$('#synth-source'),styleSelect=$('#synth-style');
    function setVoiceSource(source,style){const before=copyState();dialogue.voiceSource=source&&style?{id:source.id,provider:source.voiceProvider,name:source.source,styleId:style.id,styleName:style.name,model:style.model||'',modelId:style.modelId||'',version:style.version||source.version||''}:null;remember(before);renderInspector();}
    if(sourceSelect&&dialogue)sourceSelect.onchange=e=>{const source=voiceSources.find(v=>v.id===e.target.value);setVoiceSource(source,source&&(source.styles.find(s=>s.name==='ノーマル')||source.styles[0]));};
    if(styleSelect&&dialogue)styleSelect.onchange=e=>{const source=voiceSources.find(v=>v.id===dialogue.voiceSource?.id),style=source?.styles.find(s=>String(s.id)===e.target.value);if(style)setVoiceSource(source,style);};
    const confirmVersion=$('#synth-confirm-version');if(confirmVersion&&dialogue)confirmVersion.onclick=()=>{const source=voiceSources.find(v=>v.id===dialogue.voiceSource?.id),style=source?.styles.find(s=>String(s.id)===String(dialogue.voiceSource?.styleId));if(style)setVoiceSource(source,style);};
    const audition=$('#synth-audition');if(audition&&dialogue)audition.onclick=()=>{const selected=dialogue.voiceSource;if(selected)auditionVoice(selected.id,selected.styleId,$('#synth-preview'),audition);};
    const language=$('#synth-language');if(language&&dialogue)language.onchange=e=>{const before=copyState();dialogue.language=e.target.value;remember(before);renderInspector();};
    const translateShortcut=$('#translate-script-shortcut');if(translateShortcut)translateShortcut.onclick=openScriptTranslation;
    const cook=$('#synth-cook');if(cook&&dialogue)cook.onclick=async()=>{cook.disabled=true;$('#synth-cook-status').textContent='正在生成语音与调整剧情…';try{await cookOneDialogue(dialogue.id,dialogue.voiceSource,dialogue.language);}catch(error){notify(error.message);if(cook.isConnected){cook.disabled=false;$('#synth-cook-status').textContent=error.message;}}};
    const lip=$('#generate-lipsync');if(lip&&dialogue)lip.onclick=async()=>{lip.disabled=true;try{const result=await generateLipSync(clip.id,lipSyncMatches(clip.id).length>0,$('#lip-mode')?.value||'amplitude');notify(result.replaced?'已更新口型，可撤销':'已生成可编辑的口型片段');}catch(error){notify('口型生成失败：'+error.message);if(lip.isConnected)lip.disabled=false;}};
    const l=$('#dialogue-linked');if(l&&dialogue)l.onchange=e=>{if(!setDialogueLinked(clip,e.target.checked))e.target.checked=dialogue.linked;};
    const offset=$('#clip-audio-offset');if(offset)offset.onchange=e=>{const value=Number(e.target.value);if(track.locked||e.target.value.trim()===''||!Number.isFinite(value)||value<0||value>3600){e.target.value=clip.sourceOffset??0;notify('音频源偏移须在 0–3600 秒之间');return;}if(value===(clip.sourceOffset??0))return;const before=copyState();clip.sourceOffset=value;remember(before);syncAudio();};
    for(const [selector,side] of [['#clip-visual-fade-in','in'],['#clip-visual-fade-out','out']]){const input=$(selector);if(input)input.onchange=e=>{const value=Number(e.target.value),available=fadeSpan(clip,track.type);if(e.target.value.trim()===''||!Number.isFinite(value)||value<0){renderInspector();notify('渐变时长须为非负数');return;}const before=copyState();CreatorFades.set(clip,side,value,available,fps);remember(before);renderTimeline();renderInspector();updateClock();};}
    for(const [selector,key] of [['#clip-fade-in','fadeIn'],['#clip-fade-out','fadeOut']]){const input=$(selector);if(input)input.onchange=e=>{const value=Number(e.target.value);if(!Number.isFinite(value)||value<0||value>clip.len){e.target.value=clip[key]??0;notify('淡入淡出不能超过片段长度');return;}const before=copyState();clip[key]=value;remember(before);syncAudio();};}
    const loop=$('#clip-audio-loop');if(loop)loop.onchange=e=>{try{setAudioLoop(clip.id,e.target.checked);}catch(error){e.target.checked=Boolean(clip.audioLoop);notify(error.message);}};
    const original=$('#clip-original-loop');if(original)original.onchange=async e=>{original.disabled=true;try{await setOriginalAudioLoop(clip.id,e.target.checked);}catch(error){notify(error.message);if(original.isConnected){original.checked=Boolean(getClip(clip.id)?.clip.originalLoop);original.disabled=false;}}};
    const audioRate=$('#clip-audio-rate');
    if(audioRate)audioRate.onchange=()=>{
      const value=audioRate.valueAsNumber;
      if(track.locked||clip.mediaLink||!Number.isFinite(value)||value<.25||value>4){audioRate.value=clip.mediaRate??1;notify('音频速度须在 0.25–4 倍之间');return;}
      if(value===(clip.mediaRate??1))return;
      const before=copyState();clip.mediaRate=value;remember(before);updateClock();
    };
    const gain=$('#clip-volume');if(gain){let beforeGain=null;gain.oninput=e=>{beforeGain ||=copyState();clip.volume=Number(e.target.value);$('#clip-volume-value').textContent=Math.round(clip.volume*100)+'%';syncAudio();};const finishGain=()=>{if(beforeGain&&JSON.stringify(beforeGain)!==JSON.stringify(state))remember(beforeGain);beforeGain=null;};gain.onchange=finishGain;gain.onblur=finishGain;}
    document.querySelectorAll('[data-viseme-slider]').forEach(el=>{let before=null;const v=el.dataset.visemeSlider,keys=clip.propertyKeys?.['viseme_'+v],inRange=state.current>=clip.start&&state.current<=clip.start+clip.len;if(keys?.length&&inRange){el.value=sampleKeys(keys,state.current-clip.start);const label=document.querySelector(`[data-viseme-output="${v}"]`);if(label)label.textContent=Math.round(Number(el.value))+'%';}el.disabled=track.locked||!inRange;el.oninput=()=>{if(track.locked||state.current<clip.start||state.current>clip.start+clip.len)return;before ||=copyState();clip.propertyKeys||={};const keys=clip.propertyKeys['viseme_'+v]||=[];const t=Math.min(clip.len,quantize(state.current-clip.start)),value=Number(el.value);let key=keys.find(k=>Math.abs(k.time-t)<frame/2);if(key)key.value=value;else keys.push({time:t,value});keys.sort((a,b)=>a.time-b.time);const label=document.querySelector(`[data-viseme-output="${v}"]`);if(label)label.textContent=Math.round(value)+'%';renderTimeline();updateClock();};const finish=()=>{if(before&&JSON.stringify(before)!==JSON.stringify(state))remember(before);before=null;};el.onchange=finish;el.onblur=finish;});
    document.querySelectorAll('[data-viseme-map]').forEach(el=>el.onchange=()=>{try{setVisemeShape(clip.id,el.dataset.visemeMap,el.value);}catch(error){notify(error.message);renderInspector();}});
    const weight=$('#expression-weight');if(weight){let beforeWeight=null;weight.oninput=e=>{beforeWeight ||=copyState();const found=getClip(clip.id),keys=found?.track.enabled!==false&&state.current>=clip.start&&state.current<=clip.start+clip.len?clip.propertyKeys?.weight:null,value=Number(e.target.value);if(keys?.length){const t=quantize(state.current-clip.start);let key=keys.find(k=>Math.abs(k.time-t)<frame/2);if(key)key.value=value;else keys.push({time:t,value});keys.sort((a,b)=>a.time-b.time);renderTimeline();}else clip.weight=value;$('#expression-value').textContent=value+'%';syncPlayer();};const finish=()=>{if(beforeWeight&&JSON.stringify(beforeWeight)!==JSON.stringify(state))remember(beforeWeight);beforeWeight=null;};weight.onchange=finish;weight.onblur=finish;$('#expression-key').onclick=()=>{const found=getClip(clip.id);if(!found||found.track.locked||state.current<clip.start||state.current>clip.start+clip.len)return;const before=copyState(),t=quantize(state.current-clip.start),value=clip.propertyKeys?.weight?.length?sampleKeys(clip.propertyKeys.weight,t):expressionWeight(clip);clip.propertyKeys ||= {};const keys=clip.propertyKeys.weight ||= [],i=keys.findIndex(k=>Math.abs(k.time-t)<frame/2);if(i>=0){keys.splice(i,1);if(!keys.length)clip.weight=value;}else keys.push({time:t,value});keys.sort((a,b)=>a.time-b.time);remember(before);renderTimeline();updateClock();};syncExpressionInspector();}
  }
  function setClipTiming(clip,start,len){const followers=Math.abs(len-clip.len)<1e-6?movingLipFollowers(clip):[];clip.start=start;clip.len=len;if(clip.mediaLink)for(const other of relatedClips(clip)){other.start=start;other.len=len;}if(clip.dialogue&&state.dialogues.find(d=>d.id===clip.dialogue)?.linked)for(const t of state.tracks)for(const other of t.clips)if(other!==clip&&other.dialogue===clip.dialogue){other.start=start;other.len=len;}for(const lip of followers){lip.start=start;const found=getClip(lip.lipSyncSource.audioClipId),dialogue=state.dialogues.find(d=>d.id===found?.clip?.dialogue);if(found&&dialogue)lip.lipSyncSource.signature=lipSourceSignature(found.track,found.clip,dialogue);}}
  function render(){syncPanelSelections();if(animationLayersSupported)CreatorAnimationLayers.normalize(state,id);if(gizmoEdit&&state.selected!==gizmoEdit.id)finishGizmoEdit();syncTiming();renderHierarchy();renderAssetBrowser();renderTimeline();renderInspector();renderGlobalProperties();$('#preview-selection').textContent=obj()?.name||'场景';$('#preview-fov').textContent=state.fov;updateClock();}

  function hierarchyKey(o){return o?.propId?'prop:'+o.propId:o?.id||null;}
  function hierarchyObject(key,s=state){return key?.startsWith('prop:')?s.objects.find(o=>o.propId===key.slice(5)):s.objects.find(o=>o.id===key);}
  function hierarchyOrder(){return [...$('#hierarchy').querySelectorAll('[data-selection-key]')].map(el=>el.dataset.selectionKey);}
  function clearPanelSelections(){CreatorPanelSelection.reset(assetSelection);CreatorPanelSelection.reset(hierarchySelection);}
  function syncPanelSelections(){
    if(state.selectedClip){clearPanelSelections();return;}
    if(selectedAsset){if(assetSelection.lead!==selectedAsset)CreatorPanelSelection.reset(assetSelection,selectedAsset);CreatorPanelSelection.reset(hierarchySelection);}
    else{CreatorPanelSelection.reset(assetSelection);const key=hierarchyKey(obj());if(key&&hierarchySelection.lead!==key)CreatorPanelSelection.reset(hierarchySelection,key);else if(!key&&!hierarchySelection.lead?.startsWith('prop:'))CreatorPanelSelection.reset(hierarchySelection);}
  }
  function selectBrowserAsset(key,event={},context=false){
    finishGizmoEdit();commitInspectorInput();const order=filteredBrowserAssets().map(a=>a.id);(context?CreatorPanelSelection.context:CreatorPanelSelection.click)(assetSelection,key,order,event);CreatorPanelSelection.reset(hierarchySelection);selectedClipIds.clear();state.selected=null;state.selectedClip=null;selectedAsset=assetSelection.lead;editingScope='assets';render();window.CreatorPanelLayout?.activate('inspector');requestMotionPreview(assetSelection.ids.length===1?assetById(selectedAsset):null);
  }
  function selectHierarchyRow(key,event={},context=false){
    finishGizmoEdit();commitInspectorInput();const order=hierarchyOrder();(context?CreatorPanelSelection.context:CreatorPanelSelection.click)(hierarchySelection,key,order,event);CreatorPanelSelection.reset(assetSelection);selectedClipIds.clear();selectedAsset=null;state.selectedClip=null;
    if(!context&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&key.startsWith('prop:')&&!hierarchyObject(key)){const chosen=structuredClone(hierarchySelection);try{addClassroomChair(key.slice(5));Object.assign(hierarchySelection,chosen);}catch(error){notify(error.message);}}
    state.selected=hierarchyObject(hierarchySelection.lead)?.id||null;editingScope='hierarchy';render();window.CreatorPanelLayout?.activate('inspector');
  }
  function selectAllPanel(panel){finishGizmoEdit();commitInspectorInput();const selection=panel==='assets'?assetSelection:hierarchySelection,order=panel==='assets'?filteredBrowserAssets().map(a=>a.id):hierarchyOrder();clearPanelSelections();selection.ids=order;selection.lead=order.at(-1)||null;selection.anchor=order[0]||null;selectedClipIds.clear();state.selectedClip=null;selectedAsset=panel==='assets'?selection.lead:null;state.selected=panel==='hierarchy'?hierarchyObject(selection.lead)?.id||null:null;render();}
  function renderPanelSelectionInspector(){
    const assets=assetSelection.ids.length>1,selection=assets?assetSelection:hierarchySelection;if(selection.ids.length<2)return false;
    $('#inspector-add').disabled=true;const names=selection.ids.map(key=>assets?assetDisplay(assetById(key)||{source:key}):hierarchyObject(key)?.name||classroomCatalog.find(p=>'prop:'+p.id===key)?.name||key);
    $('#inspector').innerHTML='<div class="inspector-section"><div class="section-title">已选择 '+selection.ids.length+' 个'+(assets?'素材':'对象')+'</div><p class="hint">Ctrl 增减单项 · Shift 连续选择。支持批量删除；编辑属性或添加素材时请单选。</p><p>'+names.slice(0,15).map(esc).join('<br>')+(names.length>15?'<br>…':'')+'</p><button class="add-component" id="delete-panel-selection">删除所选'+(assets?'素材…':'对象及关联片段')+'</button></div>';
    $('#delete-panel-selection').onclick=()=>assets?deleteAssetDialog([...selection.ids]):removeHierarchyObjects([...selection.ids]);return true;
  }
  async function revealAsset(asset){try{if(!window.assetAPI?.reveal)throw Error('当前会话不支持打开文件位置');await window.assetAPI.reveal(asset);}catch(error){notify('打开文件位置失败：'+error.message);}}
  function selectObject(objectId){if(!state.objects.some(o=>o.id===objectId))return;clearPanelSelections();CreatorPanelSelection.reset(hierarchySelection,hierarchyKey(state.objects.find(o=>o.id===objectId)));selectedClipIds.clear();finishGizmoEdit();commitInspectorInput();state.selected=objectId;state.selectedClip=null;selectedAsset=null;render();window.CreatorPanelLayout?.activate('inspector');}
  function stopModalAudio(){for(const audio of $('#modal').querySelectorAll('audio')){audio.pause();audio.removeAttribute('src');audio.load();}}
  function showModal(html,kind=''){const m=$('#modal');stopModalAudio();m.className='modal '+kind;m.innerHTML=html;$('#overlay').classList.remove('hidden');m.querySelector('[data-close]')?.addEventListener('click',closeModal);}
  let pendingLayoutChoice=null;
  function closeModal(){if(assetDeletionBusy)return;stopModalAudio();$('#overlay').classList.add('hidden');$('#modal').innerHTML='';if(pendingLayoutChoice){const resolve=pendingLayoutChoice;pendingLayoutChoice=null;resolve('cancel');}}
  function chooseLayout(title,detail,choices){return new Promise(resolve=>{showModal(`<div class="modal-head"><div><h2>${esc(title)}</h2><p>${esc(detail)}</p></div></div><div class="modal-body"><div class="alias-form">${choices.map((c,i)=>`<button class="top-button" data-layout-choice="${i}">${esc(c.label)}</button>`).join('')}</div></div>`);pendingLayoutChoice=resolve;$('#modal').querySelectorAll('[data-layout-choice]').forEach(b=>b.onclick=()=>{const value=choices[Number(b.dataset.layoutChoice)].value;pendingLayoutChoice=null;closeModal();resolve(value);});});}
  function openPairedMotionModal(motionId){
    const motion=motionDefinition(motionId),face=matchingFaceMotion(motion),actors=state.objects.filter(o=>supportedActor(o)&&(actorCode(o)==='ttmr'||availableActors.has(actorCode(o))));
    if(!performance||!faces||!motion||!face||!actors.length){notify('角色、动作或同名面部动画不可用');return;}
    showModal(`<div class="modal-head"><div><h2>添加动作与同名面部</h2><p>${esc(motion.source)}</p></div><button class="icon-button" data-close aria-label="关闭">${icon('close')}</button></div><div class="modal-body"><div class="field"><label for="paired-motion-target">角色</label><select id="paired-motion-target">${actors.map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></div><div class="field"><label for="paired-motion-start">开始时间（秒）</label><input class="input" id="paired-motion-start" type="number" min="0" max="${duration}" step="${frame}" value="${Number(state.current.toFixed(4))}"></div><p class="hint">按资源名配对，身体 ${motion.length.toFixed(2)} 秒，面部 ${face.length.toFixed(2)} 秒${face.segments.length>1?'（'+face.segments.length+' 段）':''}；角色兼容性和动作对应关系需检查。插入后各轨道可分别编辑。</p><p class="error" id="paired-motion-error" role="alert"></p><button class="solid-button" id="paired-motion-add">添加到时间轴</button></div>`);
    const button=$('#paired-motion-add');button.onclick=async()=>{const raw=$('#paired-motion-start').value,seconds=Number(raw),target=state.objects.find(o=>o.id===$('#paired-motion-target').value);if(!raw||!Number.isFinite(seconds)||seconds<0||seconds>=duration){$('#paired-motion-error').textContent='开始时间须在演出范围内。';return;}button.disabled=true;try{const result=await insertPairedMotion(target,motionId,quantize(seconds),()=>button.isConnected&&!$('#overlay').classList.contains('hidden'));if(!button.isConnected)return;closeModal();setBottomTab('timeline');notify(`已添加身体动作及 ${result.faceClips.length} 个表情片段${result.skipped?'，跳过 '+result.skipped+' 条不可用形变':''}`);}catch(error){if(button.isConnected){button.disabled=false;$('#paired-motion-error').textContent=error.message;}}};
  }
  async function openCostumePicker(objectId){
    await costumeReady;
    const actor=state.objects.find(o=>o.id===objectId);if(!actor||!supportedActor(actor)){notify('角色已不可用');return;}
    if(costumeError){notify('本地服装清单不可用：'+costumeError);return;}
    const code=actorCode(actor),candidates=costumeDefinitions.filter(a=>a.knownCharacter&&a.character===code&&!a.currentDefault).map(a=>assetById(a.id)||a);
    showModal(`<div class="modal-head"><div><h2>选择服装</h2><p>${esc(actor.name)} · 只显示该角色的本地候选</p></div><button class="icon-button" data-close aria-label="关闭">${icon('close')}</button></div><div class="modal-body"><div class="field"><label for="costume-picker-search">搜索服装</label><input class="input" id="costume-picker-search" placeholder="按编号、类型或资源名搜索，空格分隔关键词" autocomplete="off"></div><p class="hint">可记录暂不能预览的服装；基础脸部、头发和衣物物理仍以当前 Player 能力为准。</p><p class="hint" id="costume-picker-count" aria-live="polite"></p><div class="costume-picker-list" id="costume-picker-list"></div></div>`);
    const search=$('#costume-picker-search'),list=$('#costume-picker-list');
    const draw=()=>{const terms=searchTerms(search.value),matches=candidates.filter(a=>matchesSearch(`${a.alias} ${a.source} ${a.kind} ${a.number}`,terms));
      $('#costume-picker-count').textContent=`找到 ${matches.length} 套服装`;
      list.innerHTML=`<button class="costume-picker-row" data-costume-pick="" ${!actor.costumeAssetId?'aria-current="true"':''}><span>基础服装</span><small>${!actor.costumeAssetId?'当前选择':'恢复基础服装'}</small></button>`+matches.map(a=>{const usable=a.bodyAvailable&&a.dependenciesAvailable,current=actor.costumeAssetId===a.id,status=!usable?'资源或依赖缺失':current?'当前选择':costumeSupported&&a.playerAvailable?'可尝试预览':'可记录，暂不能预览';return `<button class="costume-picker-row" data-costume-pick="${esc(a.id)}" ${current?'aria-current="true"':''} ${usable?'':'disabled'}><span>${esc(assetDisplay(a))}<small>${esc(a.source)}</small></span><small>${status}</small></button>`;}).join('')+(!matches.length?'<p class="hint">没有匹配的服装。</p>':'');};
    search.oninput=draw;list.onclick=e=>{const button=e.target.closest('[data-costume-pick]');if(!button||button.disabled)return;try{setActorCostume(objectId,button.dataset.costumePick);closeModal();}catch(error){notify(error.message);}};draw();search.focus();
  }
  function componentTarget(){const direct=obj();if(direct)return direct;const selected=state.selectedClip&&getClip(state.selectedClip);if(selected)return state.objects.find(o=>o.id===selected.track.target)||null;const actors=state.objects.filter(supportedActor);return actors.length===1?actors[0]:null;}
  function manageResident(actor){if(!state.objects.includes(actor))return;selectObject(actor.id);$('#resident-add')?.scrollIntoView({block:'center'});}
  function revealExpressionClip(clipId){const found=getClip(clipId);if(!found)return;revealTimelineTrack(found.track.id);setBottomTab('timeline');renderTimeline();const row=$(`#tracks [data-track="${CSS.escape(found.track.id)}"]`);row?.scrollIntoView({block:'center'});window.CreatorPanelLayout?.activate('inspector');}
  async function openLayerPicker(actor,track,type='expression',newLayer=false){
    if(!supportedActor(actor)){notify('请先选择要添加片段的角色');return;}
    setPlaying(false);const initial=state;await (type==='animation'?filmMotionReady:faceMotionReady);
    if(initial!==state||!state.objects.includes(actor)){notify('工程或角色已改变，请重新添加片段');return;}
    if(track&&(track.locked||track.enabled===false)){notify('请先启用并解锁目标轨道');return;}
    layerUI.openClipPicker(actor,track,type,newLayer);
  }
  document.addEventListener('click',event=>{
    const resident=event.target.closest('[data-layer-resident]');if(resident){const actor=state.objects.find(o=>o.id===resident.dataset.layerResident.split(':')[1]);if(actor)manageResident(actor);return;}
    const add=event.target.closest('[data-expression-add]');if(add&&!add.disabled){const track=state.tracks.find(t=>t.id===add.dataset.expressionAdd),actor=track&&state.objects.find(o=>o.id===track.target);if(actor)openLayerPicker(actor,track);}
  });
  function openComponentModal(){const o=componentTarget();showModal(`<div class="modal-head"><div><h2>添加内容</h2><p>${o?'为 '+esc(o.name)+' 添加演出内容':'选择要添加的演出内容'}</p></div><button class="icon-button" data-close aria-label="关闭">${icon('close')}</button></div><div class="modal-body"><div class="search-box modal-search">${icon('search')}<input id="component-search" placeholder="搜索组件类型" aria-label="搜索组件类型"><kbd>ESC</kbd></div><div class="component-list" id="component-list"></div><p class="hint">动作、表情和场景使用当前解包资源；换景使用场景轨道，剧情画面效果使用独立轨道；基础渲染在工程设置中调整。</p></div>`);const input=$('#component-search');const draw=()=>{$('#component-list').innerHTML=components.filter(x=>(o||['dialogue','ui','post','media','visualFilter','visualEffect'].includes(x.key))&&(x.name+x.desc).includes(input.value.trim())).map(x=>`<button class="component-option" data-component="${x.key}">${icon(x.icon)}<span><strong>${esc(x.name)}</strong><small>${esc(x.desc)}</small></span></button>`).join('')||'<p class="empty">没有找到对应组件</p>';};input.oninput=draw;draw();input.focus();}
  function pickFirstTrackClip(object,type){
    const component=comp(type),start=quantize(state.current),originalFps=fps,originalDuration=duration;
    const scenes=new Set(sceneAssets.map(a=>a.sceneId));
    const sources={
      audio:{accept:a=>isAudioSource(a)&&a.available!==false&&!assetIssues[a.id],length:async a=>(await audioClipLength(a,start)).length},
      scene:{accept:a=>scenes.has(a.sceneId),length:()=>3},
      animation:{accept:a=>!!motionDefinition(a.id),length:a=>motionClipLength(motionDefinition(a.id))}
    };
    const source=sources[type];
    pickClipSource(null,null,{key:'track-source',title:'添加'+component.name+'片段',context:object.name,
      hint:'选择素材后，从 '+start.toFixed(2)+' 秒开始创建轨道和片段。',items:()=>allAssets().filter(source.accept),describe:a=>a.type,
      prepare:source.length,apply:(a,length)=>{
        if(!state.objects.includes(object)||fps!==originalFps||duration!==originalDuration)throw Error('对象或演出设置已改变，请重新添加');
        const len=quantize(Math.min(length,duration-start));if(len<frame)throw Error('播放头之后没有足够的时间');
        const clip={id:id(),name:assetDisplay(a),assetId:a.id,start,len};
        const track={id:id(),name:object.name+' · '+component.name,type,target:object.id,clips:[clip]};
        if(!object.components.includes(type))object.components.push(type);
        state.tracks.push(track);state.selectedClip=clip.id;state.selected=null;selectedAsset=null;selectedClipIds.clear();
        revealTimelineTrack(track.id);setBottomTab('timeline');
      }});
  }
  function addComponent(key){if(key==='visualFilter'){effectsEditor.picker('filter');return;}if(key==='visualEffect'){effectsEditor.picker('effect');return;}if(key==='world'){if(state.tracks.some(t=>t.type==='world')){notify('演出画面已存在');return;}const before=copyState();state.tracks.push({id:id(),type:'world',name:'演出画面',target:'scene',clips:[]});remember(before);closeModal();render();return;}if(key==='media'){mediaEditor.picker();return;}if(key==='post'){openProjectSettings();selectSettingsPage('render');return;}if(key==='ui'){uiEditor.picker();return;}if(key==='dialogue'){openDialogueModal();return;}const o=componentTarget();if(!o)return;if(animationLayersSupported&&supportedActor(o)&&['animation','expression'].includes(key)){openLayerPicker(o,null,key);return;}if(key==='scene'&&o.id!=='scene'){notify('请先选择场景对象');return;}if(['audio','scene','animation'].includes(key)){pickFirstTrackClip(o,key);return;}const before=copyState(),c=comp(key);if(key==='expression'&&faces&&!state.assets.some(a=>a.id==='asset-local-mouth'))state.assets.push({id:'asset-local-mouth',type:'表情',alias:'嘴部张合（研究）',source:'b_mouth.mouth_001'});const len=Math.min(5,duration),start=Math.min(state.current,Math.max(0,duration-len));if(!o.components.includes(key))o.components.push(key);const clip={id:id(),name:key==='expression'?'微笑':c.name,start,len,...(key==='expression'?{weight:80,...(faces?{assetId:'asset-local-mouth',name:'嘴部张合（研究）'}:{})}:{})},trackId=id();state.tracks.push({id:trackId,name:`${o.name} · ${c.name}`,type:key,target:o.id,clips:[clip]});
    remember(before);closeModal();selectedAsset=null;setBottomTab('timeline');render();notify(`已为 ${o.name} 添加${c.name}轨道`);const scroller=$('.timeline-scroll'),row=$(`#tracks [data-track="${CSS.escape(trackId)}"]`);if(row){const r=row.getBoundingClientRect(),view=scroller.getBoundingClientRect();if(r.bottom>view.bottom)scroller.scrollTop+=r.bottom-view.bottom;else if(r.top<view.top)scroller.scrollTop+=r.top-view.top;}
  }
  function openDialogueModal(insertIndex=CreatorStory.insertionIndex(state,state.current)){
    const actors=state.objects.filter(o=>o.type==='角色'),selected=obj(),target=selected?.type==='角色'?selected:(actors[0]||state.objects.find(o=>o.id==='scene'));
    showModal(`<div class="modal-head"><div><h2>添加对白</h2><p>插入剧情主线，后续剧情自动顺延</p></div><button class="icon-button" data-close aria-label="关闭">${icon('close')}</button></div><div class="modal-body"><div class="field"><label for="dialogue-target">说话对象</label><select id="dialogue-target">${[...actors,...state.objects.filter(o=>o.id==='scene')].map(o=>`<option value="${esc(o.id)}" ${o.id===target.id?'selected':''}>${esc(o.name)}</option>`).join('')}</select></div><div class="field"><label for="dialogue-new-speaker">显示的说话人</label><input class="input" id="dialogue-new-speaker" maxlength="100" value="${esc(target.name)}"></div><div class="field"><label for="dialogue-new-text">对白文本</label><textarea id="dialogue-new-text" maxlength="500" placeholder="输入对白"></textarea></div><div class="field"><label for="dialogue-new-style">对话 UI</label><select id="dialogue-new-style"><option value="game" ${gameDialogue?'selected':'disabled'}>游戏素材对话框（实验）${gameDialogue?'':' · 本地素材缺失'}</option><option value="box" ${!gameDialogue?'selected':''}>标准对话框</option><option value="subtitle" ${!dialogueStyles?'disabled':''}>简洁字幕${dialogueStyles?'':' · Player 不支持'}</option></select>${gameDialogue?'<p class="hint">使用本地提取的游戏 UI 图片，布局为实验重建。</p>':'<p class="error">本地游戏对话 UI 素材或 Player 能力不可用，将使用标准对话框。</p>'}</div><div class="field"><label for="dialogue-insert-index">插入位置</label><select id="dialogue-insert-index">${storyUI.insertionOptions(insertIndex)}</select></div><div class="field"><label for="dialogue-new-length">暂定语音时长（秒）</label><input class="input" id="dialogue-new-length" type="number" min="${frame}" max="3600" step="${frame}" value="3.000"></div><p class="error" id="dialogue-new-error"></p><button class="solid-button" id="dialogue-create">添加对白</button></div>`);
    $('#dialogue-target').onchange=e=>{$('#dialogue-new-speaker').value=state.objects.find(o=>o.id===e.target.value)?.name||'';};
    $('#dialogue-create').onclick=()=>{try{const object=state.objects.find(o=>o.id===$('#dialogue-target').value),speaker=$('#dialogue-new-speaker').value.trim(),text=$('#dialogue-new-text').value.trim(),len=Number($('#dialogue-new-length').value),style=$('#dialogue-new-style').value,index=Number($('#dialogue-insert-index').value);if(!object||!speaker||!text||!Number.isFinite(len)||len<frame||len>3600)throw Error('请选择对象并填写对白和有效时长');const result=addStoryDialogue(object.id,speaker,text,len,style,index);closeModal();setBottomTab('timeline');setTimelineSelection([result.audioClipId]);}catch(error){$('#dialogue-new-error').textContent=error.message;}};$('#dialogue-new-text').focus();
  }
  const canonical = s => s.trim().normalize('NFKC').toLocaleLowerCase();
  function validAlias(type,alias,except){if(!alias.trim())return '';const voice=Boolean(assetById(except)?.voiceProvider),key=canonical(alias);if(allAssets().some(a=>a.type===type&&a.id!==except&&(canonical(a.alias||'')===key||(voice&&canonical(a.source||'')===key))))return `“${alias.trim()}”已被同类型的${type}素材使用。`;return '';}
  function renameAsset(assetId){
    const a=assetById(assetId);if(a?.filmCatalogId){notify('请先导入音频，再修改别名');return;}if(a?.scope==='shared'){notify('共享素材暂不支持重命名');return;}if(!a)return;
    showModal(`<div class="modal-head"><div><h2>修改别名</h2><p>${esc(a.type)} · ${esc(a.source)}</p></div><button class="icon-button" data-close aria-label="关闭">${icon('close')}</button></div><div class="modal-body"><div class="field"><label for="rename-input">别名（留空显示原始名称）</label><input class="input" id="rename-input" maxlength="100" value="${esc(a.alias)}" placeholder="${esc(a.source)}"></div><p class="error" id="rename-error"></p><div class="alias-form"><button class="solid-button" id="confirm-rename" style="height:30px">确定</button><button class="top-button" id="cancel-rename">取消</button></div></div>`);
    const input=$('#rename-input'),confirm=$('#confirm-rename');
    confirm.onclick=async()=>{const value=input.value.trim(),error=validAlias(a.type,value,a.id);if(error){$('#rename-error').textContent=error;return;}
      if(a.voiceProvider){confirm.disabled=true;try{const result=await window.voiceAPI.rename(a.id,value);voiceSources=voiceSources.map(v=>v.id===a.id?{...v,alias:result.alias}:v);if($('#rename-input')===input)closeModal();renderAssetBrowser();renderInspector();notify(value?'音源别名已更新':'已恢复音源原名');}catch(error){if($('#rename-input')===input)$('#rename-error').textContent=error.message;else notify('音源别名保存失败：'+error.message);}finally{if(confirm.isConnected)confirm.disabled=false;}return;}
      const before=copyState();let target=state.assets.find(x=>x.id===a.id);if(!target){target={...a};state.assets.push(target);}target.alias=value;if(CreatorGameAliases.lookup(gameAliasRows,a)!==undefined||a.filmAudio)target.gameAliasOverride=true;if(CreatorMotionNames.name(target.source))target.motionNameRevision=1;remember(before);closeModal();renderAssetBrowser();renderInspector();notify('别名已更新');
    };
    $('#cancel-rename').onclick=closeModal;input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();confirm.click();}};input.focus();input.select();
  }
  function addDemoAsset(){showModal(`<div class="modal-head"><div><h2>添加演示素材</h2><p>只创建一条演示记录，不导入真实文件。</p></div><button class="icon-button" data-close aria-label="关闭">${icon('close')}</button></div><div class="modal-body"><div class="field"><label>类型</label><select id="new-type">${assetTypes.filter(x=>x!=='全部'&&x!=='全部动画'&&x!=='服装').map(x=>`<option ${x===assetFilter?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>名称</label><input class="input" id="new-alias" placeholder="输入演示名称"></div><p class="error" id="alias-error"></p><button id="new-asset" class="solid-button" style="height:30px">添加</button></div>`);$('#new-asset').onclick=()=>{const type=$('#new-type').value,alias=$('#new-alias').value.trim(),error=alias?validAlias(type,alias):'请输入名称。';if(error){$('#alias-error').textContent=error;return;}const asset={id:id(),type,alias,source:'新建演示素材'};state.assets.push(asset);selectedAsset=asset.id;assetFilter=type;closeModal();renderAssetBrowser();renderInspector();notify('已添加演示素材');};$('#new-alias').focus();}
  $('#hierarchy').addEventListener('click',e=>{const group=e.target.closest('[data-prop-group]');if(group){const key=group.dataset.propGroup;closedPropGroups.has(key)?closedPropGroups.delete(key):closedPropGroups.add(key);renderHierarchy();renderInspector();return;}const row=e.target.closest('[data-selection-key]');if(!row){clearPanelSelections();state.selected=null;state.selectedClip=null;selectedAsset=null;render();return;}if(row.dataset.object==='scene'&&e.target.closest('.tree-toggle')){treeExpanded=!treeExpanded;renderHierarchy();renderInspector();return;}selectHierarchyRow(row.dataset.selectionKey,e);});
  $('#hierarchy-search').oninput=()=>{renderHierarchy();renderInspector();};$('#inspector-add').onclick=openComponentModal;$('#add-track').onclick=openComponentModal;
  $('#add-object').onclick=()=>{showModal(`<div class="modal-head"><div><h2>添加对象</h2><p>选择要加入层级的对象</p></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><button class="add-component" id="new-camera">添加相机</button><button class="add-component" id="new-demo-object">添加演示物体</button>${classroomChairsSupported&&sceneAt()==='classroom'?`<p class="hint">将场景中的折叠椅加入层级后，可编辑位置和旋转。</p>${classroomChairs.map((_,i)=>`<button class="add-component" data-add-chair="${i}" ${state.objects.some(o=>o.propId==='classroom-chair-'+i)?'disabled':''}>添加教室折叠椅 ${i+1}</button>`).join('')}`:''}</div>`);document.querySelectorAll('[data-add-chair]').forEach(button=>button.onclick=()=>{try{const object=addClassroomChair('classroom-chair-'+button.dataset.addChair);closeModal();selectObject(object.id);notify('已将教室椅子加入层级');}catch(error){notify(error.message);}});$('#new-camera').onclick=()=>{const before=copyState(),n=state.objects.filter(o=>o.type==='相机').length+1,base=activeCamera()||state.objects.find(o=>o.id==='cam')||{id:'__camera',type:'相机',fov:35,transform:{position:[0,1,3],rotation:[0,180,0]}},start=Math.min(duration-frame,quantize(state.current));const o={id:id(),name:`相机 ${n}`,type:'相机',icon:'camera',parent:'scene',components:['camera'],transform:{position:structuredClone(evaluated(base,'position')),rotation:structuredClone(evaluated(base,'rotation'))},fov:evaluated(base,'fov')};state.objects.push(o);state.tracks.push({id:id(),name:o.name,type:'camera',target:o.id,clips:[{id:id(),name:'镜头 '+n,start,len:quantize(duration-start)}]});remember(before);closeModal();selectObject(o.id);notify('已从当前播放头添加相机镜头');};$('#new-demo-object').onclick=()=>{const before=copyState(),n=state.objects.filter(x=>x.type==='物体').length+1;const o={id:id(),name:`演示物体 ${n}`,type:'物体',icon:'box',parent:'scene',components:[]};state.objects.push(o);remember(before);closeModal();treeExpanded=true;selectObject(o.id);notify('已添加演示物体');};};
  function setBottomTab(which){if(which==='timeline')editingScope='timeline';if(window.CreatorPanelLayout){window.CreatorPanelLayout.activate(which);if(which==='timeline')resizeTimeline();return;}const isAssets=which==='assets';$('#assets-panel').classList.toggle('hidden',!isAssets&&!window.CreatorPanelLayout?.isDetached('assets'));$('#timeline-panel').classList.toggle('hidden',isAssets&&!window.CreatorPanelLayout?.isDetached('timeline'));for(const [name,on] of [['assets',isAssets],['timeline',!isAssets]]){const b=$('#tab-'+name);b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));}if(!isAssets)resizeTimeline();}
  $('#tab-timeline').onclick=()=>setBottomTab('timeline');function openAssets(){setBottomTab('assets');loadShared();for(const asset of state.assets)if(['音乐','音效'].includes(asset.type))loadAssetPreview(asset);}$('#tab-assets').onclick=openAssets;$('#open-assets').onclick=openAssets;
  $('#asset-tree').onclick=e=>{const b=e.target.closest('[data-category]');if(b){assetFilter=b.dataset.category;renderAssetBrowser();renderInspector();}};
  function openGameInventory(){
    if(!window.assetAPI?.inventoryStart){notify('本机会话不支持素材检查');return;}
    showModal(`<div class="modal-head"><div><h2>检查本地游戏素材</h2><p>只读扫描已选择的游戏目录</p></div><button class="icon-button" data-close aria-label="关闭">×</button></div><div class="modal-body"><p class="hint">校验清单并按名称查找本地候选，不校验每个资源文件或依赖，也不会导入、转换素材。关闭窗口不会中止扫描；关闭工作台或点击取消可停止。</p><button class="solid-button" id="inventory-start">开始扫描</button> <button class="top-button" id="inventory-cancel" hidden>取消扫描</button><p class="hint" id="inventory-status"></p><div id="inventory-results"></div></div>`);
    const button=$('#inventory-start'),cancel=$('#inventory-cancel'),label=$('#inventory-status'),results=$('#inventory-results');let polling=false;
    async function poll(){if(polling)return;polling=true;try{while(label.isConnected){const s=await window.assetAPI.inventoryStatus();if(!label.isConnected)return;button.disabled=s.state==='running';cancel.hidden=s.state!=='running';label.textContent=s.message||({'idle':'尚未扫描','complete':'扫描完成：仅统计候选路径。','cancelled':'扫描已取消'}[s.state]||'');results.replaceChildren();if(s.state==='complete'){const meta=document.createElement('p');meta.className='hint';meta.textContent=`清单 SHA-256：${s.summary.manifestSha256}；扫描时间：${s.summary.scannedAt}；报告：${s.work}`;results.append(meta);for(const group of s.summary.groups){const p=document.createElement('p');p.textContent=`${group.label}：${group.total} 项，找到候选 ${group.found}，缺失 ${group.total-group.found}，多个候选 ${group.ambiguous}`;results.append(p);if(group.missing.length){const m=document.createElement('p');m.className='hint';m.textContent='缺失示例（最多 20 项）：'+group.missing.join('、');results.append(m);}}}if(s.state!=='running')break;await new Promise(resolve=>setTimeout(resolve,750));}}catch(error){if(label.isConnected)label.textContent='读取扫描状态失败：'+error.message;}finally{polling=false;}}
    button.onclick=async()=>{button.disabled=true;results.replaceChildren();try{while(polling)await new Promise(resolve=>setTimeout(resolve,25));if(!button.isConnected)return;const started=await window.assetAPI.inventoryStart();if(!started){button.disabled=false;return;}await poll();}catch(error){if(label.isConnected){button.disabled=false;label.textContent='扫描失败：'+error.message;}}};cancel.onclick=async()=>{cancel.disabled=true;try{await window.assetAPI.inventoryCancel();}catch(error){if(label.isConnected)label.textContent='取消失败：'+error.message;}finally{cancel.disabled=false;}};poll();
  }
  function openAudioPreparation(){if(!window.assetAPI?.filmPrepare){notify('本机会话不支持音频准备');return;}showModal(`<div class="modal-head"><div><h2>准备本地游戏音频</h2><p>使用已选游戏目录，从本机资源准备音乐和音效。</p></div><button class="icon-button" data-close aria-label="关闭">×</button></div><div class="modal-body"><p class="hint">游戏目录只读；可在「素材」菜单更改。解包结果写入创作器数据目录。准备可能需要较长时间和大量磁盘空间，保留至少 40 GiB 空闲。关闭工作台会停止任务。</p><button class="solid-button" id="film-prepare-start">准备音频</button><p class="hint" id="film-prepare-status"></p><button class="top-button" id="film-prepare-open" hidden>查看音频</button></div>`);const label=$('#film-prepare-status'),button=$('#film-prepare-start'),open=$('#film-prepare-open');let polling=false;open.onclick=openFilmAudio;async function poll(){if(polling)return;polling=true;try{while(label.isConnected){const status=await window.assetAPI.filmPrepareStatus();if(!label.isConnected)return;label.textContent=[status.phase,status.message].filter(Boolean).join('：');button.disabled=status.state==='running';open.hidden=status.state!=='complete';if(status.state!=='running')break;await new Promise(resolve=>setTimeout(resolve,1000));}}catch(error){if(label.isConnected)label.textContent='状态读取失败：'+error.message;}finally{polling=false;}}button.onclick=async()=>{button.disabled=true;try{const result=await window.assetAPI.filmPrepare();if(!result){button.disabled=false;return;}await poll();}catch(error){button.disabled=false;label.textContent='准备失败：'+error.message;}};poll();}
  async function openFilmAudio(){
    try {
      const rows=(await window.assetAPI.filmList()).map(r=>({...r,alias:CreatorGameAliases.lookup(gameAliasRows,{id:CreatorGameAliases.audioId(r.id),source:r.name})||''}));
      setOriginalLoopCatalog(rows);
      showModal(`<div class="modal-head"><div><h2>本地短片音频</h2><p>搜索和试听已解码的音乐、音效；导入时复制到创作器素材库。</p></div><button class="icon-button" data-close aria-label="关闭">×</button></div><div class="modal-body"><input class="input" id="film-query" placeholder="搜索资源名"><select id="film-type" aria-label="音频分类"><option value="">全部音频</option><option>音乐</option><option>音效</option></select><select id="film-source" aria-label="音频来源"><option value="">默认来源（隐藏预加载音乐）</option><option value="all">全部来源（含预加载短段）</option><option>预加载短段</option><option>AWB 音频</option><option>ACB 音频</option><option>MP3 音频</option><option>Unity 音频</option></select><p class="hint" id="film-count"></p><div id="film-results" class="film-results"></div><div class="film-preview"><p class="hint" id="film-preview-label">点击素材旁的试听按钮。</p><audio id="film-preview-player" controls preload="none" hidden></audio></div><button class="solid-button" id="film-import">导入所选</button><p class="hint">每次最多导入 100 项；预加载短段可能并非完整音频；有原始循环点的素材导入后可在时间轴启用。</p></div>`);
      if(window.assetAPI?.filmPrepare){const prepare=document.createElement('button');prepare.type='button';prepare.className='top-button';prepare.textContent='从游戏目录准备音频';prepare.onclick=openAudioPreparation;$('#film-import').before(prepare);}
      const selected=new Set(),modal=$('#modal'),player=$('#film-preview-player');let previewSequence=0;
      function draw(){const terms=searchTerms($('#film-query').value),type=$('#film-type').value,source=$('#film-source').value,filtered=rows.filter(r=>(!type||r.type===type)&&(source==='all'||(source?r.source===source:!isPrefetchMusic(r)))&&matchesSearch(`${r.alias} ${r.name} ${r.streamName||''} ${r.source||''} ${r.hasLoopMetadata?'循环元数据':''}`,terms));$('#film-count').textContent=`匹配 ${filtered.length} 项，显示前 100 项；已选择 ${selected.size} 项`;$('#film-results').innerHTML=filtered.slice(0,100).map(r=>`<div class="film-row"><label><input type="checkbox" data-film-id="${esc(r.id)}" ${selected.has(r.id)?'checked':''}><span>${esc(r.type)} · ${esc(r.alias||r.name)}<small>${r.alias?esc(r.name)+' · ':''}${r.streamName?esc(r.streamName)+' · ':''}${esc(r.source||'本地音频')}${Number.isFinite(r.duration)?' · '+r.duration.toFixed(2)+' 秒':''}${r.hasLoopMetadata?' · 含原始循环点（时间轴可启用）':''}</small></span></label><button type="button" class="top-button" data-film-preview="${esc(r.id)}" aria-label="试听 ${esc(r.alias||r.name)}">试听</button></div>`).join('');}
      $('#film-results').onchange=e=>{const el=e.target.closest('[data-film-id]');if(!el)return;if(el.checked&&selected.size>=100){el.checked=false;notify('每次最多选择 100 项');return;}el.checked?selected.add(el.dataset.filmId):selected.delete(el.dataset.filmId);draw();};
      $('#film-results').onclick=async e=>{const button=e.target.closest('[data-film-preview]');if(!button)return;const row=rows.find(r=>r.id===button.dataset.filmPreview);if(!row)return;const sequence=++previewSequence;player.pause();$('#film-preview-label').textContent='正在准备试听：'+(row.alias||row.name);try{const url=await window.assetAPI.filmPreview(row.id);if(!modal.isConnected||$('#film-preview-player')!==player||sequence!==previewSequence)return;player.pause();player.src=url;player.hidden=false;player.load();$('#film-preview-label').textContent='试听：'+(row.alias||row.name);try{await player.play();}catch(_){if(player.isConnected)$('#film-preview-label').textContent='试听已准备，请点击播放：'+(row.alias||row.name);}}catch(error){if(player.isConnected&&sequence===previewSequence)$('#film-preview-label').textContent='试听失败：'+error.message;}};
      player.onerror=()=>{if(player.isConnected)$('#film-preview-label').textContent='试听失败：本地音频无法读取';};
      $('#film-query').oninput=draw;$('#film-type').onchange=draw;$('#film-source').onchange=draw;$('#film-import').onclick=async()=>{if(!selected.size)return notify('请先选择音频');const projectId=state.projectId;try{const result=await window.assetAPI.filmImport([...selected],projectId);if(state.projectId!==projectId){notify('工程已切换，导入结果未加入当前工程');return;}if(result){if($('#film-preview-player')===player)closeModal();await importResult(result);}}catch(error){notify('导入失败：'+error.message);}};draw();
    } catch(error){if(window.assetAPI?.filmPrepare)openAudioPreparation();else notify('本地短片音频清单不可用：'+error.message);}
  }
  $('#asset-show-prefetch').onchange=e=>{showPrefetchMusic=e.target.checked;renderAssetBrowser();};
  if(desktop){$('#film-audio').hidden=false;$('#film-audio').onclick=openFilmAudio;}
  function changeAssetPage(page){if(!Number.isFinite(page))return;assetPage=Math.max(1,Math.floor(page));renderAssetBrowser();$('#asset-grid').scrollTop=0;}
  $('#asset-prev').onclick=()=>changeAssetPage(assetPage-1);$('#asset-next').onclick=()=>changeAssetPage(assetPage+1);$('#asset-page').onchange=e=>changeAssetPage(Number(e.target.value));$('#asset-page').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.target.blur();}};
  $('#asset-browser-search').oninput=()=>{renderAssetBrowser();renderInspector();};$('#add-demo-asset').onclick=addDemoAsset;
  let motionPreviewWanted=null,motionPreviewRunning=false,motionPreviewTimer=null;
  function requestMotionPreview(asset){
    clearInterval(motionPreviewTimer);motionPreviewTimer=null;
    const eligible=window.assetAPI?.motionPreview&&asset&&(motionDefinition(asset.id)||Boolean(faceMotionById(asset.id)));
    motionPreviewWanted=eligible?asset.id:null;if(!eligible||motionPreviewRunning)return;
    const wanted=motionPreviewWanted;motionPreviewRunning=true;
    window.assetAPI.motionPreview(wanted).then(data=>{assetThumbs[wanted]=data.frames[0];renderAssetBrowser();if(selectedAsset===wanted){let i=0;motionPreviewTimer=setInterval(()=>{if(selectedAsset!==wanted){clearInterval(motionPreviewTimer);motionPreviewTimer=null;return;}const el=document.querySelector(`#asset-grid [data-asset="${CSS.escape(wanted)}"] .asset-thumb img`);if(el)el.src=data.frames[i++%data.frames.length];},Math.max(80,data.duration*1000/data.frames.length));}}).catch(error=>{if(selectedAsset===wanted)notify('动画缩略图生成失败：'+error.message);}).finally(()=>{motionPreviewRunning=false;if(motionPreviewWanted&&motionPreviewWanted!==wanted&&selectedAsset===motionPreviewWanted)requestMotionPreview(assetById(motionPreviewWanted));});
  }
  $('#asset-grid').onclick=e=>{const b=e.target.closest('[data-asset]');if(b)selectBrowserAsset(b.dataset.asset,e);else{clearPanelSelections();selectedAsset=null;render();}};
  $('#asset-grid').ondblclick=e=>{const b=e.target.closest('[data-asset]');if(b){if(e.ctrlKey||e.metaKey||e.shiftKey||assetSelection.ids.length>1)return;if(assetById(b.dataset.asset)?.filmCatalogId){b.click();$('#catalog-audio-import')?.click();}else renameAsset(b.dataset.asset);}};
  let assetContextMenu=null,assetDeletionBusy=false;
  function closeAssetContextMenu(){assetContextMenu?.remove();assetContextMenu=null;}
  $('#asset-grid').oncontextmenu=e=>{const b=e.target.closest('[data-asset]'),asset=b&&assetById(b.dataset.asset);if(!asset)return;e.preventDefault();selectBrowserAsset(asset.id,{},true);const many=assetSelection.ids.length>1;contextMenu(e,[['打开文件位置',()=>revealAsset(asset)],...(!many?[['重命名',()=>renameAsset(asset.id)]]:[]),[many?'删除所选 '+assetSelection.ids.length+' 项…':'删除…',()=>deleteAssetDialog(assetSelection.ids)]]);};

  function contextMenu(e,actions){closeAssetContextMenu();const menu=document.createElement('div');menu.className='asset-context-menu';menu.setAttribute('role','menu');for(const [label,action] of actions){const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.textContent=label;button.onclick=()=>{closeAssetContextMenu();action();};menu.append(button);}document.body.append(menu);menu.style.left=Math.max(0,Math.min(e.clientX,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(0,Math.min(e.clientY,innerHeight-menu.offsetHeight-8))+'px';assetContextMenu=menu;menu.firstChild.focus();}
  function commitRemoval(next,before,message){clearPanelSelections();state=next;uiSceneGate=null;selectedAsset=null;selectedClipIds.clear();soloClipId=null;remember(before);bridgeLast='';render();notify(message);}
  function removeHierarchyObject(key,propId){return removeHierarchyObjects([propId?'prop:'+propId:hierarchyKey(state.objects.find(o=>o.id===key))]);}
  function removeHierarchyObjects(keys){
    if(projectBusy||timelineEditBusy||exporting||translationCooking)return notify('工作台正忙，请完成当前操作后再删除');
    finishGizmoEdit();commitInspectorInput();setPlaying(false);const before=copyState(),next=structuredClone(before);
    try{const currentScene=sceneAt()||state.sceneId;for(const key of new Set(keys)){if(!key)continue;const object=hierarchyObject(key,next);if(key==='scene')CreatorProjectRemoval.scene(next,currentScene,assetById);else if(object)CreatorProjectRemoval.object(next,object.id,assetById,currentScene);else if(key.startsWith('prop:')&&!keys.includes('scene'))next.hiddenSceneProps=[...new Set([...(next.hiddenSceneProps||[]),key.slice(5)])];}commitRemoval(next,before,'已删除所选对象及关联片段，可撤销');}catch(error){notify(error.message);}
  }
  $('#hierarchy').oncontextmenu=e=>{const row=e.target.closest('[data-selection-key]');if(!row)return;e.preventDefault();selectHierarchyRow(row.dataset.selectionKey,{},true);const keys=[...hierarchySelection.ids];contextMenu(e,[[keys.length>1?'删除所选 '+keys.length+' 个对象及关联片段':keys[0]==='scene'?'移除场景及自带道具':'删除对象及关联片段',()=>removeHierarchyObjects(keys)]]);};
  function deleteAssetDialog(keys){
    if(projectBusy||timelineEditBusy||exporting||translationCooking)return notify('工作台正忙，请完成当前操作后再删除');
    const assets=[...new Set(Array.isArray(keys)?keys:[keys])].map(assetById).filter(Boolean),asset=assets[0];if(!asset)return;finishGizmoEdit();commitInspectorInput();setPlaying(false);
    const identity=state,stamp=fingerprint(),before=copyState(),next=structuredClone(before);
    try{for(const a of assets)CreatorProjectRemoval.asset(next,a,assetById);}catch(error){notify(error.message);return;}
    const canDelete=assets.every(a=>['project','shared'].includes(a.scope))&&Boolean(window.assetAPI?.deleteFile);
    const objects=before.objects.length-next.objects.length,clips=before.tracks.reduce((n,t)=>n+t.clips.length,0)-next.tracks.reduce((n,t)=>n+t.clips.length,0);
    showModal(`<div class="modal-head"><h2>删除素材</h2><button class="icon-button" data-close>×</button></div><div class="modal-body"><p>${assets.length>1?'已选择 '+assets.length+' 项素材':esc(assetDisplay(asset))+' · '+sourceLabel(asset)}</p>${assets.length>1?'<p class=hint>'+assets.slice(0,8).map(a=>esc(assetDisplay(a))).join('、')+(assets.length>8?'…':'')+'</p>':''}<p>将从当前工程移除素材，清理 ${objects} 个对象、${clips} 个关联片段及常驻引用。</p><button class="add-component" id="asset-remove-only">仅从工程移除（可撤销）</button><p class="hint">保留素材文件和通用库，其他工程不受影响。</p><button class="add-component" id="asset-delete-file" ${canDelete?'':'disabled'}>彻底删除文件（不可撤销）</button><p class="hint">${canDelete?(assets.some(a=>a.scope==='shared')?'将删除通用素材文件，其他工程的引用也会失效。':'将删除导入／生成的素材副本；其他保存版本的引用也会失效。')+'不删除导入前的原文件。此次操作也会清空撤销／重做历史。':'所选含解包素材、内置预设或音源，仅支持从工程移除；需要删除文件时请只选择工程／通用文件素材。'}</p><p class="error" id="asset-delete-error"></p><button class="top-button" data-close>取消</button></div>`);
    const remove=async permanent=>{
      if(state!==identity||fingerprint()!==stamp){$('#asset-delete-error').textContent='工程已改变，请重新打开删除对话框';return;}
      const buttons=[...$('#overlay').querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);assetDeletionBusy=true;projectBusy=true;timelineEditBusy=true;
      try{
        let resultState=next,message='素材已从当前工程移除，可撤销',failures=[];
        if(permanent){const removed=[];for(const a of assets){try{for(const [id,entry] of audioPlayers)if(entry.assetId===a.id)retireAudioPlayer(id,entry);for(const [id,entry] of originalAudioPlayers)if(entry.assetId===a.id)removeOriginalPlayer(id);const result=await window.assetAPI.deleteFile(a);removed.push(a);sharedAssets=sharedAssets.filter(x=>x.id!==a.id);delete assetThumbs[a.id];if(result?.warnings?.length)failures.push(assetDisplay(a)+'：'+result.warnings.join('；'));}catch(error){failures.push(assetDisplay(a)+'：'+error.message);break;}}
          if(!removed.length)throw Error(failures.join('；'));resultState=structuredClone(before);for(const a of removed)CreatorProjectRemoval.asset(resultState,a,assetById);message='已彻底删除 '+removed.length+' / '+assets.length+' 项素材文件，无法撤销';if(removed.length<assets.length)message+='；未删除的素材仍保留';
        }
        assetDeletionBusy=false;closeModal();commitRemoval(resultState,before,message);if(permanent){undoStack.length=0;redoStack.length=0;updateHistoryButtons();render();}if(failures.length)notify(message,{kind:'error',sticky:true,detail:failures.join('；')});
      }catch(error){if($('#asset-delete-error'))$('#asset-delete-error').textContent='删除失败：'+error.message;buttons.forEach(b=>b.disabled=false);if(!canDelete)$('#asset-delete-file').disabled=true;}finally{assetDeletionBusy=false;projectBusy=false;timelineEditBusy=false;}

    };$('#asset-remove-only').onclick=()=>remove(false);$('#asset-delete-file').onclick=()=>remove(true);
  }
  document.addEventListener('pointerdown',e=>{if(assetContextMenu&&!assetContextMenu.contains(e.target))closeAssetContextMenu();});
  $('#refresh-voices').onclick=loadVoiceLibrary;
  $('#costume-thumbnails').onclick=async()=>{if(costumeBatchRunning){costumeBatch=false;renderAssetBrowser();return;}if(costumeThumbnailBusy)return notify('正在生成另一张服装缩略图');const items=filteredBrowserAssets().slice((assetPage-1)*assetPageSize,(assetPage-1)*assetPageSize+20).filter(a=>a.catalogOnly&&a.knownCharacter&&a.bodyAvailable&&a.dependenciesAvailable&&!assetThumbs[a.id]);if(!items.length)return notify('本页前 20 项没有需要生成的缩略图');costumeBatch=true;costumeBatchRunning=true;renderAssetBrowser();let completed=0,failed=0;try{for(const asset of items){if(!costumeBatch)break;try{await generateCostumeThumbnail(asset);completed++;}catch(error){failed++;assetIssues[asset.id]=error.message;}if(costumeBatch)notify(`缩略图：已生成 ${completed}，失败 ${failed}`);}}finally{costumeBatch=false;costumeBatchRunning=false;renderAssetBrowser();notify(`缩略图生成结束：成功 ${completed}，失败 ${failed}`);}};
  if(window.assetAPI){
    $('#add-demo-asset').textContent='导入文件';$('#add-demo-asset').onclick=async()=>{try{await importResult(await window.assetAPI.choose(state.projectId));}catch(error){notify('导入失败：'+error.message);}};
    window.addEventListener('dragover',e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
    window.addEventListener('drop',e=>{if(!e.dataTransfer?.files?.length)return;e.preventDefault();importFiles(e.dataTransfer.files);});
  }
  function addAssetToScene(asset){
    if(CreatorScreenMedia.isVisual(asset)){mediaEditor.add(asset).catch(e=>notify(e.message));return;}
    if(!assetFeatures)return notify('当前 Player 不支持放置素材');
    const code=asset.id==='asset-actor-1'?'ttmr':(asset.id||'').startsWith('asset-actor-')?asset.id.slice('asset-actor-'.length):null;
    if(code&&code!=='ttmr'&&!availableActors.has(code))return notify('角色的本地资源或 Player 能力不可用');
    const before=copyState();
    if(code==='ttmr'||(code&&availableActors.has(code))){
      const count=state.objects.filter(supportedActor).length;if(count>=10)return notify('当前原型最多支持 10 个角色');
      const object={id:id(),assetId:asset.id,name:`${code==='ttmr'?'月村手毬':actorNames[code]} ${count+1}`,type:'角色',icon:'user',parent:'scene',components:[],transform:{position:[-1+count*.7,0,0],rotation:[0,0,0]}};state.objects.push(object);state.selected=object.id;
    }else if(asset.sceneId){state.sceneId=asset.sceneId;state.objects.find(o=>o.id==='scene').name=asset.alias+'（研究）';state.selected='scene';}
    else return notify('请将角色或场景素材拖到这里');
    selectedAsset=null;remember(before);render();notify(asset.sceneId?'已切换场景':'已添加角色');
  }
  $('#hierarchy').addEventListener('dragover',e=>{if(Array.from(e.dataTransfer.types).includes('text/plain')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
  $('#hierarchy').addEventListener('drop',e=>{if(e.dataTransfer.files?.length)return;const a=assetById(e.dataTransfer.getData('text/plain'));if(a){e.preventDefault();if(a.catalogOnly){try{const row=e.target.closest('[data-object]');if(!row)throw Error('请将服装拖到对应的角色上');setActorCostume(row.dataset.object,a.id);}catch(error){notify(error.message);}return;}addAssetToScene(a);}});
  $('#asset-grid').ondragstart=e=>{const b=e.target.closest('[data-asset]');if(b){if(assetSelection.ids.length>1){e.preventDefault();notify('多选支持批量删除；添加到场景或时间轴时请单选素材');return;}if(assetById(b.dataset.asset)?.filmCatalogId){e.preventDefault();notify('请先在属性中导入此音频，再拖入时间轴');return;}draggedAssetId=b.dataset.asset;e.dataTransfer.setData('application/x-creator-asset',b.dataset.asset);e.dataTransfer.setData('text/plain',b.dataset.asset);e.dataTransfer.effectAllowed='copy';}};
  $('#tab-timeline').ondragenter=$('#tab-timeline').ondragover=e=>{if(!draggedAssetId&&!Array.from(e.dataTransfer?.types||[]).includes('text/plain'))return;e.preventDefault();if($('#tab-timeline').getAttribute('aria-selected')!=='true')setBottomTab('timeline');};
  $('#overlay').addEventListener('click',e=>{if(e.target.id==='overlay'&&!exporting&&!translationCooking)closeModal();const b=e.target.closest('[data-component]');if(b)addComponent(b.dataset.component);});
  function relatedClips(clip){if(clip.mediaLink)return state.tracks.flatMap(t=>t.clips).filter(c=>c.mediaLink===clip.mediaLink);if(!clip.dialogue||!state.dialogues.find(d=>d.id===clip.dialogue)?.linked)return [clip];return state.tracks.flatMap(t=>t.clips).filter(c=>c.dialogue===clip.dialogue);}
  function movingLipFollowers(clip){const audioIds=new Set(relatedClips(clip).filter(c=>getClip(c.id)?.track.type==='audio').map(c=>c.id));if(!audioIds.size)return [];return state.tracks.filter(t=>t.type==='expression').flatMap(t=>t.clips).filter(c=>c.lipSyncSource&&audioIds.has(c.lipSyncSource.audioClipId)&&!lipSyncOutdated(c));}
  function relatedForMove(clip){return [...relatedClips(clip),...movingLipFollowers(clip)];}
  function setDialogueLinked(clip,linked){if(CreatorStory.unitFor(state,clip.dialogue)){notify('剧情对白由主线统一排时');return false;}const dialogue=state.dialogues.find(d=>d.id===clip.dialogue),items=state.tracks.flatMap(t=>t.clips).filter(c=>c.dialogue===clip.dialogue);if(!dialogue)return false;if(linked){if(items.length!==2||items.some(c=>getClip(c.id)?.track.locked)){notify('关联片段缺失或轨道已锁定，无法耦合');return false;}for(const item of items){const track=getClip(item.id).track;if(track.clips.some(other=>!items.includes(other)&&clip.start<other.start+other.len-1e-6&&clip.start+clip.len>other.start+1e-6)){notify('对齐后片段会重叠，无法耦合');return false;}}}const before=copyState();dialogue.linked=linked;if(linked)for(const item of items){item.start=clip.start;item.len=clip.len;}remember(before);renderTimeline();renderInspector();updateClock();notify(linked?'已耦合并对齐片段':'已解除片段耦合');return true;}
  function canEdit(clip,start,len){try{CreatorStory.assertFree(state,relatedForMove(clip).map(c=>c.id));}catch(_){return false;}const related=Math.abs(len-clip.len)<1e-6?relatedForMove(clip):relatedClips(clip);if(start<0||len<frame-1e-6||start+len>duration+1e-6)return false;return related.every(item=>{const found=getClip(item.id);if(!found||found.track.locked)return false;if(!found.track.clips.every(other=>related.includes(other)||start+len<=other.start+1e-6||start>=other.start+other.len-1e-6))return false;if(item.lipSyncSource&&state.tracks.some(t=>t.enabled!==false&&t.type==='expression'&&t.target===found.track.target&&t.clips.some(c=>!related.includes(c)&&c.assetId===item.assetId&&start<c.start+c.len-1e-6&&start+len>c.start+1e-6)))return false;return true;});}
  function sampleKeys(keys,t){const sorted=[...keys].sort((a,b)=>a.time-b.time),left=[...sorted].reverse().find(k=>k.time<=t)||sorted[0],right=sorted.find(k=>k.time>=t)||sorted[sorted.length-1],u=left.time===right.time?0:(t-left.time)/(right.time-left.time);return typeof left.value==='boolean'?left.value:Array.isArray(left.value)?left.value.map((v,i)=>v+(right.value[i]-v)*u):left.value+(right.value-left.value)*u;}
  function snapTime(value,clip,laneWidth,edge='start'){if(!snapEnabled)return quantize(value);const related=edge==='move'?relatedForMove(clip):relatedClips(clip),points=[0,duration,state.current,...(state.markers||[]).map(m=>m.time),...state.tracks.flatMap(t=>t.clips.filter(c=>!related.includes(c)).flatMap(c=>[c.start,c.start+c.len]))];let result=value,best=7/laneWidth*duration;for(const point of points){for(const candidate of edge==='move'?[point,point-clip.len]:[point]){const dist=Math.abs(value-candidate);if(dist<best){result=candidate;best=dist;}}}return quantize(result);}
  function timelineIds(){return hasMultiSelection()?[...selectedClipIds]:state.selectedClip?[state.selectedClip]:[];}
  function timelineEnvironment(){return {id,q:quantize,duration,frame,signature:lipSourceSignature,
    offset:async(c,shift,track)=>{const info=assetById(c.assetId)?.visual;if(info)return CreatorScreenMedia.editedOffset(c,shift,info);const value=(c.sourceOffset||0)+shift*(c.mediaRate||1);if(c.audioLoop)return loopEditedOffset(c,value);if(value<0||value>3600)throw Error('源偏移超出 0–3600 秒');return track.type==='audio'?value:quantize(value);},
    clampFade:(c,t)=>{if(['animation','expression'].includes(t.type))CreatorFades.clampStored(c,fadeSpan(c,t.type));else for(const k of ['fadeIn','fadeOut'])if(c[k]!==undefined)c[k]=Math.min(c[k],c.len);},
    checkCut:(c,t,cut)=>{if(!['animation','expression'].includes(t.type))return;const span=fadeSpan(c,t.type),a=CreatorFades.amounts(c,span);if(cut<a.fadeIn-frame/2||a.fadeOut>0&&cut>span-a.fadeOut+frame/2&&cut<span+frame/2)throw Error('请在渐变范围之外分割片段');}
  };}
  async function timelineTransaction(action,message,positioned=[]){
    if(timelineEditBusy||drag||exporting)return;finishGizmoEdit();commitInspectorInput();setPlaying(false);
    const before=copyState(),identity=state,stamp=fingerprint(),next=structuredClone(before);timelineEditBusy=true;
    try{const selected=await action(next,timelineEnvironment());if(state!==identity||fingerprint()!==stamp)throw Error('工程已改变，请重试');state=next;remember(before,positioned);const all=selected||[],first=getClip(all[0])?.clip,strong=first&&CreatorTimelineEdit.expand(state,[first.id],false);setTimelineSelection(first&&!first.groupId&&strong.length===all.length&&strong.every(r=>all.includes(r.clip.id))?[first.id]:all);uiSceneGate=null;render();notify(message);}catch(error){notify(error.message);}finally{timelineEditBusy=false;}
  }
  function splitSelected(){return timelineTransaction((s,e)=>CreatorTimelineEdit.cut(s,timelineIds(),quantize(state.current),e),'已在播放头处分割');}
  function trimSelected(side){return timelineTransaction((s,e)=>CreatorTimelineEdit.cut(s,timelineIds(),quantize(state.current),e,side),'已裁掉播放头'+(side==='left'?'左':'右')+'侧内容，保留时间轴空隙');}
  let clipClipboard=null;
  function copySelectedClip(){try{clipClipboard=CreatorTimelineEdit.copy(state,timelineIds(),!soloClipId);notify('已复制 '+clipClipboard.items.length+' 个片段');}catch(error){notify(error.message);}}
  function pasteClip(){return timelineTransaction((s,e)=>CreatorTimelineEdit.paste(s,clipClipboard,state.current,e),'已粘贴片段',clipClipboard?.trackSettings?.map(t=>t.id));}
  function deleteSelected(){return timelineTransaction(s=>CreatorProjectRemoval.clips(s,timelineIds(),assetById,!soloClipId),'已删除所选片段');}
  function groupSelected(){return timelineTransaction((s,e)=>CreatorTimelineEdit.group(s,timelineIds(),e.id),'已组合片段');}
  function ungroupSelected(){return timelineTransaction(s=>CreatorTimelineEdit.ungroup(s,timelineIds()),'已取消组合，原音画关联保留');}
  function setTimelineMode(mode){cancelMarquee();timelineMode=mode;$('#tracks').classList.toggle('blade-mode',mode==='blade');$('#timeline-tool-status').textContent=mode==='blade'?'分割模式':'选择模式';for(const [key,value] of [['select-mode','select'],['blade-mode','blade']]){$('#'+key).classList.toggle('active',mode===value);$('#'+key).setAttribute('aria-pressed',String(mode===value));}document.querySelector('.blade-guide')?.remove();}
  function showTimelineHelp(){showModal(`<div class="modal-head"><h2>时间轴快捷键</h2><button class="icon-button" data-close>×</button></div><div class="modal-body"><p>A 选择 · B 连续分割 · Ctrl+B 播放头处分割</p><p>Ctrl / Shift 单击增减选择；空白处拖动框选；Alt 拖动可从片段上开始框选。</p><p>Ctrl+G 组合 · Ctrl+Shift+G 取消组合 · Ctrl+C / V 复制／粘贴 · Delete 删除</p><p>Q 裁左侧 · W 裁右侧（保留空隙）；整组不统一伸缩，右键可单独编辑成员。</p><p>N 吸附 · ← / → 逐帧 · Shift+← / → 跳 10 帧 · ↑ / ↓ 剪辑点 · Home / End 起止</p><p>Ctrl+滚轮或 Ctrl+＋ / － 缩放 · Alt+滚轮横移 · 普通滚轮上下滚动 · Shift+Z 显示全部</p><p>M 添加／编辑标记 · Shift+M 下一标记 · Alt+Shift+M 上一标记</p><p>快捷键作用于最后点击的时间轴或预览区；文字输入和中文组词期间不触发。预览区保留 W / R / S 变换工具。</p></div>`);}
  function editTimelineMarker(markerId){
    const existing=(state.markers||[]).find(m=>m.id===markerId)||(!markerId&&(state.markers||[]).find(m=>Math.abs(m.time-state.current)<frame/2)),at=existing?.time??quantize(state.current),identity=state;
    setPlaying(false);showModal(`<div class="modal-head"><h2>${existing?'编辑':'添加'}时间轴标记</h2><button class="icon-button" data-close>×</button></div><div class="modal-body"><p>${time(at)}</p><input class="input" id="marker-name" maxlength="100" aria-label="标记名称" value="${esc(existing?.name||'标记 '+((state.markers?.length||0)+1))}"><p class="error" id="marker-error"></p><button class="solid-button" id="save-marker">保存</button>${existing?'<button class="text-button" id="delete-marker">删除标记</button>':''}</div>`);
    const save=()=>{const name=$('#marker-name').value.trim();if(!name){$('#marker-error').textContent='请输入标记名称';return;}if(state!==identity)return closeModal();const before=copyState();state.markers||=[];if(existing)existing.name=name;else state.markers.push({id:id(),time:at,name});state.markers.sort((a,b)=>a.time-b.time);remember(before);closeModal();renderTimeline();updateClock();};
    $('#save-marker').onclick=save;$('#marker-name').onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing)save();};if(existing)$('#delete-marker').onclick=()=>{if(state!==identity)return closeModal();const before=copyState();state.markers=state.markers.filter(m=>m.id!==existing.id);remember(before);closeModal();renderTimeline();updateClock();};$('#marker-name').focus();$('#marker-name').select();
  }
  function seekMarker(direction){const times=(state.markers||[]).map(m=>m.time).filter(t=>t<=duration&&(direction<0?t<state.current-frame/2:t>state.current+frame/2));if(times.length)seekFrame(Math.round((direction<0?Math.max(...times):Math.min(...times))*fps));}
  // Browser layout has a finite maximum width; keep it below Chromium's limit.
  function zoomBounds(){const base=Math.max(1,Math.max(620,$('.timeline-scroll').clientWidth)-trackLabelWidth);return {base,min:1/base,max:16000000/base};}
  function resizeTimeline(draw=true){const scroller=$('.timeline-scroll');if(scroller.clientWidth>0)trackLabelWidth=Math.max(120,Math.min(trackLabelWidth,Math.max(120,scroller.clientWidth-80)));const bounds=zoomBounds();zoom=Math.max(bounds.min,Math.min(bounds.max,zoom));$('.timeline-inner').style.setProperty('--track-label-width',trackLabelWidth+'px');$('.timeline-inner').style.width=`${trackLabelWidth+bounds.base*zoom}px`;$('#track-width-handle').setAttribute('aria-valuenow',String(Math.round(trackLabelWidth)));const slider=$('#zoom');slider.min=Math.log2(bounds.min);slider.max=Math.log2(bounds.max);slider.value=Math.log2(zoom);slider.title=`时间轴缩放 ${Math.round(zoom*100)}%`;if(draw){renderTimeline();updateClock();}}
  function zoomAt(next,anchorX){const scroller=$('.timeline-scroll'),before=$('#ruler').getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(anchorX-before.left)/Math.max(1,before.width)));zoom=next;resizeTimeline(false);const after=$('#ruler').getBoundingClientRect();scroller.scrollLeft+=after.left+fraction*after.width-anchorX;renderTimeline();}
  function zoomCenter(next){const rect=$('.timeline-scroll').getBoundingClientRect();zoomAt(next,(rect.left+trackLabelWidth+rect.right)/2);}
  const trackWidthHandle=$('#track-width-handle');let trackWidthDrag=null;
  function setTrackLabelWidth(value){const scroller=$('.timeline-scroll'),r=scroller.getBoundingClientRect(),old=$('#ruler').getBoundingClientRect(),anchor=(r.left+trackLabelWidth+r.right)/2,fraction=Math.max(0,Math.min(1,(anchor-old.left)/Math.max(1,old.width)));trackLabelWidth=Math.max(120,Math.min(value,Math.max(120,scroller.clientWidth-80)));resizeTimeline(false);const next=$('#ruler').getBoundingClientRect();scroller.scrollLeft+=next.left+fraction*next.width-anchor;renderTimeline();}
  function beginTrackWidthDrag(e,receiver){if(e.button!==0)return;e.preventDefault();e.stopPropagation();trackWidthDrag={id:e.pointerId,startX:e.clientX,width:trackLabelWidth};receiver.setPointerCapture(e.pointerId);}
  function moveTrackWidthDrag(e){if(!trackWidthDrag||e.pointerId!==trackWidthDrag.id)return;e.stopPropagation();setTrackLabelWidth(trackWidthDrag.width+e.clientX-trackWidthDrag.startX);}
  function endTrackWidthDrag(e){if(!trackWidthDrag||e.pointerId!==trackWidthDrag.id)return;e.stopPropagation();trackWidthDrag=null;}
  trackWidthHandle.addEventListener('pointerdown',e=>beginTrackWidthDrag(e,trackWidthHandle));trackWidthHandle.addEventListener('pointermove',moveTrackWidthDrag);trackWidthHandle.addEventListener('pointerup',endTrackWidthDrag);trackWidthHandle.addEventListener('pointercancel',endTrackWidthDrag);
  $('#tracks').addEventListener('pointerdown',e=>{if(e.target.closest('[data-track-resize]'))beginTrackWidthDrag(e,$('#tracks'));},true);$('#tracks').addEventListener('pointermove',moveTrackWidthDrag,true);$('#tracks').addEventListener('pointerup',endTrackWidthDrag,true);$('#tracks').addEventListener('pointercancel',endTrackWidthDrag,true);
  trackWidthHandle.addEventListener('dblclick',e=>{e.preventDefault();setTrackLabelWidth(188);});
  trackWidthHandle.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();setTrackLabelWidth(trackLabelWidth+(e.key==='ArrowRight'?10:-10));}});
  $('#select-mode').onclick=()=>setTimelineMode('select');$('#blade-mode').onclick=()=>setTimelineMode('blade');$('#group-clips').onclick=groupSelected;$('#ungroup-clips').onclick=ungroupSelected;$('#add-marker').onclick=()=>editTimelineMarker();$('#timeline-help').onclick=showTimelineHelp;$('#fit-timeline').onclick=()=>{zoom=1;$('.timeline-scroll').scrollLeft=0;resizeTimeline();};
  function updateEditingScope(target,focusPanel=false){
    const panel=$('#timeline-panel'),tab=target.closest('[data-dock-tab],#tab-timeline');
    // Dock tabs are siblings of their panels after layout.js reparents them.
    if(target.closest('#timeline-panel')||tab?.dataset.dockTab==='timeline'||tab?.id==='tab-timeline'){
      editingScope='timeline';
      const control=target.closest('button,input,textarea,select,a,[tabindex],[contenteditable]:not([contenteditable="false"])');
      // Drag handlers (including the keyboard-accessible width separator) can
      // prevent default focus transfer. Focus the actual control, or the panel
      // for non-focusable content, before those handlers run.
      if(focusPanel)(control||panel).focus({preventScroll:true});
    }else if(target.closest('#assets-panel')||tab?.dataset.dockTab==='assets')editingScope='assets';else if(target.closest('#hierarchy')||tab?.dataset.dockTab==='hierarchy')editingScope='hierarchy';else if(target.closest('.creator-preview-panel,.preview-area,.viewport')||tab?.dataset.dockTab==='preview')editingScope='preview';
  }
  document.addEventListener('pointerdown',e=>{if(e.button===0)updateEditingScope(e.target,true);},true);
  document.addEventListener('focusin',e=>updateEditingScope(e.target),true);
  $('#undo').onclick=historyUndo;$('#redo').onclick=historyRedo;$('#split').onclick=splitSelected;$('#delete-clip').onclick=deleteSelected;
  $('#select-all-dialogue').onclick=()=>{finishGizmoEdit();commitInspectorInput();const ids=state.tracks.filter(t=>t.type==='dialogue').flatMap(t=>t.clips.filter(c=>c.dialogue).map(c=>c.id));if(!ids.length)return notify('工程中没有字幕片段');setTimelineSelection(ids);window.CreatorPanelLayout?.activate('inspector');};
  $('#snap').onclick=()=>{snapEnabled=!snapEnabled;$('#snap').classList.toggle('active',snapEnabled);$('#snap').setAttribute('aria-pressed',String(snapEnabled));};
  $('#zoom').oninput=e=>zoomCenter(2**Number(e.target.value));$('#zoom-in').onclick=()=>zoomCenter(zoom*1.4);$('#zoom-out').onclick=()=>zoomCenter(zoom/1.4);window.addEventListener('resize',resizeTimeline);
  let timelineScrollFrame=0;
  $('.timeline-scroll').addEventListener('scroll',()=>{if(timelineScrollFrame)return;timelineScrollFrame=requestAnimationFrame(()=>{timelineScrollFrame=0;if(!drag)renderTimeline(true);});},{passive:true});
  $('.timeline-scroll').addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();if(e.deltaY)zoomAt(zoom*(e.deltaY<0?1.4:1/1.4),e.clientX);}else if(e.altKey){e.preventDefault();$('.timeline-scroll').scrollLeft+=e.deltaY||e.deltaX;}},{passive:false});
  $('#tracks').addEventListener('click',e=>{const toggle=e.target.closest('[data-group-toggle]');if(toggle){const key=toggle.dataset.groupToggle;collapsedTimelineGroups.set(key,!collapsedTimelineGroups.get(key));renderTimeline();updateClock();return;}const enable=e.target.closest('[data-track-enable]'),lock=e.target.closest('[data-track-lock]');if(enable||lock){const t=state.tracks.find(x=>x.id===(enable?.dataset.trackEnable||lock?.dataset.trackLock));if(!t)return;const before=copyState();if(enable)t.enabled=t.enabled===false;else t.locked=!t.locked;remember(before);renderTimeline();renderInspector();updateClock();}});
  function trackRemovalPlan(track){
    const clips=new Set();for(const clip of track.clips)for(const related of relatedForMove(clip))clips.add(related);
    let external=0,locked=Boolean(track.locked);for(const clip of clips){const owner=getClip(clip.id)?.track;if(!owner){locked=true;continue;}if(owner!==track)external++;if(owner.locked)locked=true;}
    return {clips,external,locked};
  }
  function trackRemovalSignature(track,plan){return JSON.stringify([track.id,Boolean(track.locked),track.clips.map(c=>c.id),[...plan.clips].map(c=>[getClip(c.id)?.track.id,c])]);}
  $('#tracks').addEventListener('click',e=>{
    const button=e.target.closest('[data-track-menu]');if(!button)return;const track=state.tracks.find(t=>t.id===button.dataset.trackMenu);if(!track)return;const peers=timelineTrackPeers(track),index=peers.indexOf(track),plan=trackRemovalPlan(track),signature=trackRemovalSignature(track,plan);
    const detail=plan.locked?'请先解锁此轨道及其关联片段所在轨道。':`将删除此轨道的 ${track.clips.length} 个片段${plan.external?`及其他轨道的 ${plan.external} 个关联片段`:''}；操作可撤销，对象组件保留。`;
    showModal(`<div class="modal-head"><div><h2>轨道选项</h2><p>${esc(track.name)}</p></div><button class="icon-button" data-close aria-label="关闭">×</button></div><div class="modal-body"><p class="hint">画面合成轨道上层在前；滤镜／特效按所选范围处理。相机控制与场景切换保留各自的控制优先级。</p><button class="add-component" id="track-up" ${index===0||track.layerRole==='base'||peers[index-1]?.layerRole==='base'?'disabled':''}>上移轨道</button><button class="add-component" id="track-down" ${index===peers.length-1||track.layerRole==='base'?'disabled':''}>下移轨道</button><button class="add-component" id="track-remove" ${plan.locked||track.layerRole==='base'?'disabled':''}>删除轨道</button>${track.type==='world'?compositionEditor.fields(track,track):''}<p class="hint">${esc(detail)}</p></div>`);
    if(track.type==='world')compositionEditor.bind(track,track);
    for(const [selector,delta] of [['#track-up',-1],['#track-down',1]])$(selector).onclick=()=>{const members=timelineTrackPeers(track),at=members.indexOf(track),other=members[at+delta],from=state.tracks.indexOf(track),to=state.tracks.indexOf(other);if(from<0||to<0||track.layerRole==='base'||other.layerRole==='base')return;if(track.locked||other.locked){notify('请先解锁轨道');return;}const before=copyState();CreatorComposition.reorder(state,track,other,true);remember(before);closeModal();renderTimeline();updateClock();};
    $('#track-remove').onclick=()=>{if(track.layerRole==='base'){notify('固定基础轨道不能删除，可删除其中的片段');return;}const from=state.tracks.indexOf(track);if(from<0){notify('轨道已改变，请重试');return;}const current=trackRemovalPlan(track);if(current.locked){notify('相关轨道已锁定');return;}if(trackRemovalSignature(track,current)!==signature){notify('轨道或关联片段已改变，请重新打开选项');return;}closeModal();timelineTransaction(next=>CreatorProjectRemoval.track(next,track.id,assetById),'已删除轨道及关联片段');};
  });
  $('#tracks').addEventListener('click',e=>{const tn=e.target.closest('[data-track-name]');if(tn){const t=state.tracks.find(x=>x.id===tn.dataset.trackName);selectObject(t.target);}});
  $('#tracks').addEventListener('dragstart',e=>{const grip=e.target.closest('[data-fx-track-grip]');if(grip){e.dataTransfer.setData('application/x-creator-effect-track',grip.dataset.fxTrackGrip);e.dataTransfer.effectAllowed='move';}});
  $('#tracks').ondragover=e=>{if(e.target.closest('[data-lane]')||Array.from(e.dataTransfer.types).includes('application/x-creator-effect-track')){e.preventDefault();e.dataTransfer.dropEffect='copy';}};
  $('#tracks').oncontextmenu=e=>{
    const element=e.target.closest('[data-clip]'),found=element&&getClip(element.dataset.clip);if(!found)return;e.preventDefault();
    if(!isSelectedClip(found.clip.id)){soloClipId=null;setTimelineSelection([found.clip.id]);}
    closeAssetContextMenu();const menu=document.createElement('div');menu.className='asset-context-menu';menu.setAttribute('role','menu');
    const actions=[...(found.track.type==='audio'?[['添加声音效果…',()=>effectsEditor.picker('audio')]]:[]),['组合 (Ctrl+G)',groupSelected],['取消组合 (Ctrl+Shift+G)',ungroupSelected],['复制 (Ctrl+C)',copySelectedClip],['粘贴 (Ctrl+V)',pasteClip],['在播放头处分割 (Ctrl+B)',splitSelected],['裁掉播放头左侧 (Q)',()=>trimSelected('left')],['裁掉播放头右侧 (W)',()=>trimSelected('right')],['删除 (Delete)',deleteSelected]];
    if(found.clip.groupId){actions.unshift(['单独编辑此片段',()=>{soloClipId=found.clip.id;setTimelineSelection([found.clip.id]);}],['选择整个组',()=>{soloClipId=null;setTimelineSelection([found.clip.id]);}],['重命名组',()=>renameTimelineGroup(found.clip.groupId)]);}
    const dialogue=state.dialogues.find(d=>d.id===found.clip.dialogue);if(dialogue)actions.push([dialogue.linked?'解除对白联动':'重新联动对白',()=>setDialogueLinked(found.clip,!dialogue.linked)]);
    for(const [label,run] of actions){const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.textContent=label;button.onclick=()=>{closeAssetContextMenu();run();};menu.append(button);}document.body.append(menu);menu.style.left=Math.max(0,Math.min(e.clientX,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(0,Math.min(e.clientY,innerHeight-menu.offsetHeight-8))+'px';assetContextMenu=menu;menu.querySelector('button').focus();
  };
  function renameTimelineGroup(groupId){const group=state.clipGroups?.find(g=>g.id===groupId);if(!group)return;const identity=state;showModal(`<div class="modal-head"><h2>重命名片段组</h2><button class="icon-button" data-close>×</button></div><div class="modal-body"><input id="group-name" class="input" maxlength="100" aria-label="片段组名称" value="${esc(group.name)}"><button id="save-group-name" class="solid-button">保存</button></div>`);$('#save-group-name').onclick=()=>{const value=$('#group-name').value.trim();if(!value||state!==identity)return;const before=copyState();group.name=value;remember(before);closeModal();renderTimeline();};$('#group-name').focus();$('#group-name').select();}

  let timelineDropBusy=false,assetDropHint=null,assetDropRow=null;
  function clearAssetDropHint(){
    assetDropHint?.remove();assetDropHint=null;
    assetDropRow?.classList.remove('drop-media-above','drop-media-here');assetDropRow=null;
  }
  function endAssetDrag(){draggedAssetId=null;clearAssetDropHint();if(assetDragRefreshPending){assetDragRefreshPending=false;renderAssetBrowser();}}
  function timelineDropAsset(e){return assetById(e.dataTransfer?.getData('application/x-creator-asset')||e.dataTransfer?.getData('text/plain')||draggedAssetId);}
  function standaloneDropAsset(a){return a&&(CreatorScreenMedia.isVisual(a)||['音乐','音效'].includes(a.type)||a.effectKind==='visual');}
  function externalVisual(transfer){
    if(!window.assetAPI||!Array.from(transfer.types).includes('Files'))return null;
    const files=Array.from(transfer.files),items=Array.from(transfer.items||[]).filter(item=>item.kind==='file');
    if((files.length||items.length)!==1)return null;
    const file=files[0],mime=file?.type||items[0]?.type||'',name=file?.name||'';
    if(file){
      if(/\.(mp4|mov|webm|mkv)$/i.test(name))return {type:'视频'};
      if(/\.(png|jpe?g|webp|gif)$/i.test(name))return {type:'贴图'};
    }else if(/^(video|image)\//.test(mime))return {type:mime.startsWith('video/')?'视频':'贴图'};
    return null;
  }
  function assetDropTarget(e,a){
    const ruler=$('#ruler').getBoundingClientRect(),view=$('.timeline-scroll').getBoundingClientRect();
    if(!ruler.width||e.clientY<ruler.bottom)return null;
    const media=CreatorScreenMedia.isVisual(a);
    const row=e.target.closest('.track-row')||Array.from($('#tracks').children).find(r=>{
      const b=r.getBoundingClientRect();return e.clientY>=b.top&&e.clientY<b.bottom;
    });
    const onLabel=e.clientX<view.left+trackLabelWidth;
    if(onLabel&&(!row||!media))return null;
    const start=quantize(Math.max(0,Math.min(duration-frame,onLabel?state.current:(e.clientX-ruler.left)/ruler.width*duration)));
    const hover=row?.dataset.track?state.tracks.find(t=>t.id===row.dataset.track):null;
    const group=row?.dataset.trackGroup&&timelineRows.find(r=>r.group&&r.key===row.dataset.trackGroup);
    const anchor=hover||group?.tracks[0]||null;
    const type=media?'media':a.effectKind==='visual'?CreatorPostEffects.trackType(a.preset):'audio';
    const track=hover?.type===type&&!(type==='audio'&&hover.clips.some(c=>c.dialogue))?hover:null;
    const unknown=media&&a.type==='视频'&&!a.visual?.duration;
    const len=quantize(Math.min(duration-start,media?(a.type==='视频'?(a.visual?.duration||frame):5):a.effectKind==='visual'?4:3));
    const overlap=track?.clips.some(c=>start<c.start+c.len-1e-6&&start+len>c.start+1e-6);
    return {start,track,anchor,type,create:!track||overlap,unknown,ruler,view,row};
  }
  function showAssetDropHint(e,a,target){
    clearAssetDropHint();if(!target)return;
    const blocked=target.track?.locked||timelineDropBusy||projectBusy||timelineEditBusy||exporting||translationCooking;
    e.dataTransfer.dropEffect=blocked?'none':'copy';if(blocked)return;
    const {ruler,view,start,type,create,row}=target,box=document.createElement('div');box.className='timeline-asset-drop';box.setAttribute('aria-hidden','true');
    let action;
    if(type==='media'){
      action=create?(target.anchor?'在「'+target.anchor.name+'」正上方新建画面轨':'新建画面轨'):'添加到「'+target.track.name+'」';
      if(!create&&target.unknown)action+='（如有重叠则在上方建轨）';
      if(row){assetDropRow=row;row.classList.add(create?'drop-media-above':'drop-media-here');}
    }else action=create?'新建'+({audio:'声音轨道',visualFilter:'滤镜轨道',visualEffect:'特效轨道'}[type]):'添加到「'+target.track.name+'」';
    box.textContent=action+' · '+time(start);
    const x=Math.max(view.left+trackLabelWidth,Math.min(view.right-3,ruler.left+start/duration*ruler.width));
    Object.assign(box.style,{left:x+'px',top:Math.max(ruler.bottom,Math.min(view.bottom-30,row?.getBoundingClientRect().top??e.clientY))+'px',maxWidth:Math.max(150,view.right-view.left-20)+'px'});
    if(view.right-x<240)box.classList.add('label-left');document.body.appendChild(box);assetDropHint=box;
  }
  $('.timeline-scroll').addEventListener('dragover',e=>{
    if(Array.from(e.dataTransfer.types).includes('application/x-creator-effect-track'))return;
    const a=externalVisual(e.dataTransfer)||timelineDropAsset(e);if(!standaloneDropAsset(a)){clearAssetDropHint();return;}
    const target=assetDropTarget(e,a);if(!target){clearAssetDropHint();return;}e.preventDefault();e.stopPropagation();showAssetDropHint(e,a,target);
  },true);
  $('.timeline-scroll').addEventListener('dragleave',e=>{if(!e.currentTarget.contains(e.relatedTarget))clearAssetDropHint();});
  $('.timeline-scroll').addEventListener('drop',async e=>{
    if(e.dataTransfer?.getData('application/x-creator-effect-track'))return;
    const fileAsset=externalVisual(e.dataTransfer);
    let a=fileAsset||timelineDropAsset(e);if(!a)return;
    if(!standaloneDropAsset(a)){if(!e.target.closest('[data-lane]')){e.preventDefault();notify(a.effectKind==='audio'?'请把声音效果拖到声音片段上':'此素材需要匹配的目标轨道；角色动作和表情请放到对应角色轨道');}endAssetDrag();return;}
    const target=assetDropTarget(e,a);if(!target)return;e.preventDefault();e.stopImmediatePropagation();endAssetDrag();
    if(projectBusy||timelineEditBusy||timelineDropBusy||exporting||translationCooking)return notify('工作台正忙，请稍后拖入素材');
    if(target.track?.locked)return notify('目标轨道已锁定');
    cancelMarquee();finishGizmoEdit();commitInspectorInput();setPlaying(false);const original=state;timelineDropBusy=true;
    try{
      if(target.type==='media'){
        if(fileAsset){
          [a]=await importFiles(e.dataTransfer.files);
          if(!a)return;
          if(state!==original)throw Error('工程已切换，请重新拖入');
        }
        const added=await mediaEditor.add(a,target.track,target.start,{newTrackOnOverlap:true,anchor:target.anchor});
        if(added)notify('已添加至「'+added.track.name+'」 · '+time(added.clip.start));
        return;
      }
      if(a.effectKind==='visual'){effectsEditor.addVisual(a.preset,target.create?undefined:target.track,target.start);return;}
      if(a.filmCatalogId)throw Error('请先在素材属性中导入音频');
      const measured=a.scope?await audioClipLength(a,target.start):{length:Math.min(3,duration-target.start),truncated:false};
      if(state!==original||!assetById(a.id)||target.track&&!state.tracks.includes(target.track))throw Error('工程、素材或目标轨道已改变，请重新拖入');
      if(target.track?.locked)throw Error('目标轨道已锁定');
      const len=quantize(measured.length),start=target.start;if(len<frame||start+len>duration+1e-6)throw Error('演出剩余时间不足');
      let track=target.track;if(track?.clips.some(c=>c.dialogue||start<c.start+c.len-1e-6&&start+len>c.start+1e-6))track=null;
      const before=copyState();if(!track){track={id:id(),type:'audio',target:'scene',name:assetDisplay(a)+' · 声音',clips:[]};state.tracks.push(track);}
      const clip={id:id(),name:assetDisplay(a),assetId:a.id,start,len};track.clips.push(clip);track.clips.sort((a,b)=>a.start-b.start);selectedClipIds.clear();selectedAsset=null;state.selected=null;state.selectedClip=clip.id;remember(before);render();setBottomTab('timeline');notify(measured.truncated?'已添加声音，按演出结尾裁剪':'已添加声音片段');
    }catch(error){notify(error.message);}finally{timelineDropBusy=false;clearAssetDropHint();}
  },true);
  window.addEventListener('dragend',endAssetDrag,true);window.addEventListener('drop',endAssetDrag);
  window.addEventListener('blur',endAssetDrag);window.addEventListener('pagehide',endAssetDrag);
  window.addEventListener('keydown',e=>{if(e.key==='Escape')endAssetDrag();},true);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)endAssetDrag();});

  $('#tracks').ondrop=async e=>{
    const moving=e.dataTransfer.getData('application/x-creator-effect-track');if(moving){e.preventDefault();const from=state.tracks.find(t=>t.id===moving),to=state.tracks.find(t=>t.id===e.target.closest('[data-track]')?.dataset.track);if(!from||!to||from===to||(!CreatorComposition.visual(from)||!CreatorComposition.visual(to)))return;if(from.locked||to.locked){notify('请先解锁轨道');return;}const before=copyState();CreatorComposition.reorder(state,from,to);remember(before);render();return;}
    const lane=e.target.closest('[data-lane]'),asset=assetById(e.dataTransfer.getData('text/plain'));if(!lane||!asset)return;e.preventDefault();
    let track=state.tracks.find(t=>t.id===lane.dataset.lane);if(!track)return;
    if(asset.effectKind){if(asset.effectKind==='audio'){const element=e.target.closest('[data-clip]');effectsEditor.attach(asset.preset,element&&getClip(element.dataset.clip));}else{const rect=lane.getBoundingClientRect();effectsEditor.addVisual(asset.preset,track,quantize(Math.max(0,Math.min(duration-frame,(e.clientX-rect.left)/rect.width*duration))));}return;}
    const compatible=(CreatorScreenMedia.isVisual(asset)&&track.type==='media')||((asset.type==='动作'&&track.type==='animation')||(asset.type==='表情'&&track.type==='expression'))||(['音效','音乐'].includes(asset.type)&&track.type==='audio'&&!track.clips.some(c=>c.dialogue))||(asset.type==='场景'&&track.type==='scene')||(asset.type==='UI'&&track.type==='ui');
    if(!compatible){notify('请放到匹配类型的轨道');return;}if(track.locked){notify('目标轨道已锁定');return;}
    if(track.type==='animation'&&!motionDefinition(asset.id)){notify('动作素材不可用，无法确定片段长度');return;}
    const rect=lane.getBoundingClientRect();if(rect.width<=0){notify('无法确定放置位置');return;}
    const start=quantize(Math.max(0,Math.min(duration-frame,(e.clientX-rect.left)/rect.width*duration)));
    if(track.type==='media'){try{await mediaEditor.add(asset,track,start);}catch(error){notify(error.message);}return;}if(track.type==='ui'){uiEditor.picker(track,asset.id,start);return;}
    if(animationLayersSupported&&['animation','expression'].includes(track.type)){try{await layerUI.addClip(state.objects.find(o=>o.id===track.target),asset.id,start,track);notify('已添加片段；重叠内容使用独立叠加层');}catch(error){notify(error.message);}return;}
    if(track.type==='expression'&&Boolean(faceMotionById(asset.id))){try{const result=await insertFaceMotion(state.objects.find(o=>o.id===track.target),asset.id,start);notify(`已添加 ${result.clips.length} 条面部形变轨道${result.skipped?'，跳过 '+result.skipped+' 条无偏移形变':''}`);}catch(error){notify(error.message);}return;}
    if(track.type==='expression'&&!shapeForActor(state.objects.find(o=>o.id===track.target)||{},asset.id)){notify('此角色缺少该面部形变');return;}
    let len=motionDefinition(asset.id)?motionClipLength(motionDefinition(asset.id)):quantize(Math.min(3,duration-start)),truncated=false;
    if(track.type==='audio'&&asset.scope){try{notify('正在读取音频时长…');const measured=await audioClipLength(asset,start);len=measured.length;truncated=measured.truncated;}catch(error){notify(error.message);return;}}
    track=state.tracks.find(t=>t.id===lane.dataset.lane);if(!track){notify('目标轨道已不存在');return;}
    if(track.type==='audio'&&track.clips.some(c=>c.dialogue)){notify('目标轨道已用于对白，请重新选择');return;}
    const currentAsset=assetById(asset.id);if(!currentAsset){notify('素材已不存在');return;}
    if(start+len>duration+1e-6){notify('当前演出剩余时长不足，请延长演出或移动播放头');return;}
    if(track.locked||track.clips.some(c=>start<c.start+c.len-1e-6&&start+len>c.start+1e-6)){notify('目标轨道已锁定或片段重叠');return;}
    const clip={id:id(),name:assetDisplay(currentAsset),assetId:asset.id,start,len},before=copyState();track.clips.push(clip);state.selectedClip=clip.id;selectedAsset=null;remember(before);renderTimeline();renderInspector();updateClock();
    notify(truncated?'音频已按演出结尾裁剪，可延长演出后调整片段':motionDefinition(asset.id)?'已添加本地动作片段':asset.sceneId?'已添加场景片段':'已添加片段');
  };
  function commitInspectorInput(){const active=document.activeElement;if(active&&$('#inspector').contains(active)&&active.matches('input,textarea,select'))active.blur();}
  let drag=null;
  function marqueePoint(x,y){const scale=$('#ruler').getBoundingClientRect(),tracks=$('#tracks').getBoundingClientRect();return {time:Math.max(0,Math.min(duration,(x-scale.left)/Math.max(1,scale.width)*duration)),xOffset:x-scale.left,y:y-tracks.top};}
  function drawMarquee(){if(!marquee?.moved)return;const scroller=$('.timeline-scroll'),view=scroller.getBoundingClientRect(),scale=$('#ruler').getBoundingClientRect(),tracks=$('#tracks').getBoundingClientRect(),clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),x0=clamp(scale.left+marquee.start.xOffset,view.left+trackLabelWidth,view.right),y0=clamp(tracks.top+marquee.start.y,view.top+26,view.bottom),x1=clamp(marquee.x,view.left+trackLabelWidth,view.right),y1=clamp(marquee.y,view.top+26,view.bottom);Object.assign(marquee.box.style,{left:Math.min(x0,x1)+'px',top:Math.min(y0,y1)+'px',width:Math.abs(x1-x0)+'px',height:Math.abs(y1-y0)+'px'});marquee.box.hidden=false;}
  function scrollMarquee(){marqueeScrollFrame=0;if(!marquee?.moved)return;const scroller=$('.timeline-scroll'),r=scroller.getBoundingClientRect(),edge=30,speed=18,dx=marquee.x<r.left+trackLabelWidth+edge?-speed:marquee.x>r.right-edge?speed:0,dy=marquee.y<r.top+26+edge?-speed:marquee.y>r.bottom-edge?speed:0;if(!dx&&!dy)return;scroller.scrollLeft+=dx;scroller.scrollTop+=dy;drawMarquee();marqueeScrollFrame=requestAnimationFrame(scrollMarquee);}
  function clearMarquee(){const previous=marquee;marquee=null;if(marqueeScrollFrame)cancelAnimationFrame(marqueeScrollFrame);marqueeScrollFrame=0;document.querySelectorAll('.timeline-marquee').forEach(box=>box.remove());if(previous){try{if(previous.capture.hasPointerCapture(previous.pointerId))previous.capture.releasePointerCapture(previous.pointerId);}catch(_){}}return previous;}
  function cancelMarquee(){clearMarquee();}
  function beginMarquee(e,allowBlank=false){const lane=e.target.closest('.track-lane');if((!lane&&!allowBlank)||e.button!==0||timelineEditBusy||trackWidthDrag||drag||timelineMode!=='select')return false;cancelMarquee();finishGizmoEdit();commitInspectorInput();setPlaying(false);soloClipId=null;e.preventDefault();const base=hasMultiSelection()?new Set(selectedClipIds):new Set(state.selectedClip?[state.selectedClip]:[]),box=document.createElement('div'),capture=$('#tracks');box.className='timeline-marquee';box.hidden=true;document.body.appendChild(box);marquee={pointerId:e.pointerId,capture,start:marqueePoint(e.clientX,e.clientY),startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,moved:false,additive:e.ctrlKey||e.metaKey||e.shiftKey,base,box};try{capture.setPointerCapture(e.pointerId);}catch(_){cancelMarquee();return false;}return true;}
  function moveMarquee(e){if(!marquee||e.pointerId!==marquee.pointerId)return;if((e.buttons&1)===0){cancelMarquee();return;}marquee.x=e.clientX;marquee.y=e.clientY;if(Math.hypot(e.clientX-marquee.startX,e.clientY-marquee.startY)>=4)marquee.moved=true;drawMarquee();if(marquee.moved&&!marqueeScrollFrame)marqueeScrollFrame=requestAnimationFrame(scrollMarquee);}
  function finishMarquee(e,cancelled=false){if(!marquee||e.pointerId!==marquee.pointerId)return;const selection=clearMarquee();if(cancelled)return;if(!selection.moved){if(!selection.additive)setTimelineSelection([]);state.current=quantize(selection.start.time);updateClock();return;}const end=marqueePoint(selection.x,selection.y),from=Math.min(selection.start.time,end.time),to=Math.max(selection.start.time,end.time),top=Math.min(selection.start.y,end.y),bottom=Math.max(selection.start.y,end.y),rowHeight=desktop?34:37,ids=selection.additive?new Set(selection.base):new Set();for(let i=0;i<timelineRows.length;i++){if((i+1)*rowHeight<top||i*rowHeight>bottom||timelineRows[i].group)continue;for(const clip of timelineRows[i].track.clips)if(clip.start<to&&clip.start+clip.len>from&&clip.start<duration)ids.add(clip.id);}setTimelineSelection(ids);if(ids.size)window.CreatorPanelLayout?.activate('inspector');}
  $('#tracks').addEventListener('pointerdown',e=>{
    if(e.button!==0||e.target.closest('button,input,select,a')||timelineEditBusy||trackWidthDrag)return;cancelMarquee();
    finishGizmoEdit();commitInspectorInput();setPlaying(false);
    const element=e.target.closest('[data-clip]'),found=element&&getClip(element.dataset.clip);
    if(timelineMode==='blade'){
      if(!found)return;const lane=element.closest('.track-lane').getBoundingClientRect(),at=quantize(Math.max(0,Math.min(duration,(e.clientX-lane.left)/lane.width*duration)));
      e.preventDefault();soloClipId=found.clip.id;timelineTransaction((s,env)=>CreatorTimelineEdit.cut(s,[found.clip.id],at,env),'已在鼠标位置分割');return;
    }
    if(e.altKey){soloClipId=null;if(beginMarquee(e))return;}
    if(!found){soloClipId=null;beginMarquee(e);return;}
    if(e.ctrlKey||e.metaKey||e.shiftKey){soloClipId=null;const ids=new Set(timelineIds()),members=CreatorTimelineEdit.select(state,[found.clip.id]),remove=members.every(x=>ids.has(x));for(const key of members)remove?ids.delete(key):ids.add(key);setTimelineSelection(ids);window.CreatorPanelLayout?.activate('inspector');return;}
    const marker=e.target.closest('[data-key-time]'),fade=e.target.closest('[data-fade]')?.dataset.fade,trim=e.target.closest('[data-trim]')?.dataset.trim;
    if(soloClipId!==found.clip.id)soloClipId=null;
    const chosen=isSelectedClip(found.clip.id)?timelineIds():[found.clip.id];setTimelineSelection(chosen);
    if(marker){state.current=quantize(found.clip.start+Number(marker.dataset.keyTime));updateClock();return;}
    if(found.track.locked)return notify('轨道已锁定');
    if(!fade)try{CreatorStory.assertFree(state,CreatorTimelineEdit.expand(state,timelineIds(),!soloClipId).map(r=>r.clip.id));}catch(error){notify(error.message);return;}
    if((trim||fade)&&hasMultiSelection())return notify('请右键选择“单独编辑此片段”后裁剪；整组拖动保持相对时间');
    const lane=$('#tracks').querySelector(`[data-lane="${CSS.escape(found.track.id)}"]`),items=CreatorTimelineEdit.expand(state,timelineIds(),!soloClipId);
    drag={id:found.clip.id,startX:e.clientX,start:found.clip.start,len:found.clip.len,offset:found.clip.sourceOffset||0,width:lane.getBoundingClientRect().width,mode:fade?'fade-'+fade:trim||'move',ids:items.map(r=>r.clip.id),fadeStart:fade?(found.clip[fade==='in'?'fadeIn':'fadeOut']??0):0,fadeUndefined:fade?found.clip[fade==='in'?'fadeIn':'fadeOut']===undefined:false,before:copyState(),changed:false};
    if(fade){const el=$('#tracks').querySelector(`[data-clip="${CSS.escape(found.clip.id)}"]`);el.classList.add('fade-editing');refreshFadeVisual(el,found.clip,found.track,fade);}
    $('#tracks').setPointerCapture(e.pointerId);e.preventDefault();
  });
  $('#tracks').addEventListener('pointermove',e=>{
    if(timelineMode!=='blade')return;const lane=e.target.closest('.track-lane'),clip=e.target.closest('[data-clip]');document.querySelector('.blade-guide')?.remove();if(!lane||!clip)return;const r=lane.getBoundingClientRect(),at=quantize(Math.max(0,Math.min(duration,(e.clientX-r.left)/r.width*duration))),guide=document.createElement('span');guide.className='blade-guide';guide.style.left=at/duration*100+'%';guide.dataset.time=time(at);lane.append(guide);
  });
  $('#tracks').addEventListener('pointerleave',()=>document.querySelector('.blade-guide')?.remove());

  $('.timeline-scroll').addEventListener('pointerdown',e=>{if(e.button!==0||e.target!==e.currentTarget)return;const ruler=$('#ruler').getBoundingClientRect(),tracks=$('#tracks').getBoundingClientRect(),view=e.currentTarget.getBoundingClientRect();if(e.clientX>=ruler.right&&e.clientY>=tracks.top&&e.clientY<view.bottom){finishGizmoEdit();commitInspectorInput();beginMarquee(e,true);}});
  $('#tracks').addEventListener('pointermove',e=>{if(marquee){moveMarquee(e);return;}if(!drag)return;const found=getClip(drag.id);if(!found)return;const delta=(e.clientX-drag.startX)/drag.width*duration;if(drag.mode.startsWith('fade-')){const side=drag.mode.slice(5),value=drag.fadeStart+(side==='in'?delta:-delta),available=fadeSpan(found.clip,found.track.type);CreatorFades.set(found.clip,side,value,available,fps);drag.changed=drag.fadeUndefined||Math.abs(found.clip[side==='in'?'fadeIn':'fadeOut']-drag.fadeStart)>1e-6;const element=document.querySelector(`[data-clip="${CSS.escape(drag.id)}"]`);if(element)refreshFadeVisual(element,found.clip,found.track,side);updateClock();return;}let start=drag.start,len=drag.len;if(drag.mode==='move'){
      const members=CreatorTimelineEdit.rows(drag.before).filter(r=>drag.ids.includes(r.clip.id)),low=-Math.min(...members.map(r=>r.clip.start)),high=duration-Math.max(...members.map(r=>r.clip.start+r.clip.len));
      const excluded=new Set(drag.ids),points=[0,duration,state.current,...(state.markers||[]).map(m=>m.time),...CreatorTimelineEdit.rows(state).filter(r=>!excluded.has(r.clip.id)).flatMap(r=>[r.clip.start,r.clip.start+r.clip.len])];
      let amount=delta,best=7/drag.width*duration;if(snapEnabled&&!e.altKey)for(const r of members)for(const edge of [r.clip.start,r.clip.start+r.clip.len])for(const point of points){const candidate=point-edge,distance=Math.abs(candidate-delta);if(distance<best){best=distance;amount=candidate;}}
      amount=quantize(Math.max(low,Math.min(high,amount)));try{CreatorTimelineEdit.move(state,drag.ids,quantize(drag.start+amount-found.clip.start),timelineEnvironment(),false);drag.offsetLimitMessage='';}catch(error){drag.offsetLimitMessage=error.message;return;}
      drag.changed=Math.abs(amount)>1e-6;for(const key of drag.ids){const item=getClip(key)?.clip,el=document.querySelector(`[data-clip="${CSS.escape(key)}"]`);if(item&&el)el.style.left=item.start/duration*100+'%';}updateClock();return;
    }else if(drag.mode==='left'){start=Math.max(0,Math.min(drag.start+drag.len-frame,snapTime(drag.start+delta,found.clip,drag.width)));len=quantize(drag.start+drag.len-start);}else{const end=Math.max(start+frame,Math.min(duration,snapTime(drag.start+drag.len+delta,found.clip,drag.width)));len=quantize(end-start);}if(drag.mode==='left'&&relatedClips(found.clip).some(c=>{const offset=(c.sourceOffset||0)+(start-drag.start)*(c.mediaRate||1);return (getClip(c.id)?.track.type==='audio'||assetById(c.assetId)?.type==='视频')&&!c.audioLoop&&!c.loop&&(offset< -1e-7||offset>3600);})){drag.offsetLimitMessage='单次播放的源偏移不能超出 0–3600 秒';return;}drag.offsetLimitMessage='';if(!canEdit(found.clip,start,len))return;setClipTiming(found.clip,start,len);drag.changed=drag.changed||Math.abs(start-drag.start)>1e-6||Math.abs(len-drag.len)>1e-6;for(const c of (drag.mode==='move'?relatedForMove(found.clip):relatedClips(found.clip))){const el=document.querySelector(`[data-clip="${CSS.escape(c.id)}"]`);if(el){el.style.left=`${c.start/duration*100}%`;el.style.width=`${c.len/duration*100}%`;}}updateClock();});
  async function finishDrag(){if(!drag)return;const edit=drag;drag=null;const found=getClip(edit.id);if(found&&edit.changed){if(edit.mode==='move'){remember(edit.before);renderTimeline();renderInspector();updateClock();return;}if(edit.mode==='left'){const start=found.clip.start,len=found.clip.len,shift=start-edit.start;let loopOffset;if(found.clip.audioLoop&&!assetById(found.clip.assetId)?.visual){setClipTiming(found.clip,edit.start,edit.len);renderTimeline();renderInspector();updateClock();try{loopOffset=await loopEditedOffset(found.clip,edit.offset+shift*(found.clip.mediaRate||1));if(!canEdit(found.clip,start,len))throw Error('片段或轨道已改变，请重试');setClipTiming(found.clip,start,len);}catch(error){notify(error.message);return;}}for(const c of relatedClips(found.clip)){const info=assetById(c.assetId)?.visual;c.sourceOffset=info?CreatorScreenMedia.editedOffset(c,shift,info):c.audioLoop?loopOffset:getClip(c.id)?.track.type==='audio'?Math.max(0,(c.sourceOffset||0)+shift*(c.mediaRate||1)):quantize(Math.max(0,(c.sourceOffset||0)+shift));if(c.mediaKeys)c.mediaKeys=CreatorScreenMedia.slice(c.mediaKeys,shift,c.len);for(const [property,all] of Object.entries(c.propertyKeys||{}))if(all.length){const boundary=sampleKeys(all,shift);c.propertyKeys[property]=[{time:0,value:boundary},...all.map(k=>({...k,time:quantize(k.time-shift)})).filter(k=>k.time>frame/2&&k.time<=c.len)];}}}else if(edit.mode==='right'){for(const c of relatedClips(found.clip)){const original=edit.before.tracks.flatMap(t=>t.clips).find(x=>x.id===c.id);if(original?.mediaKeys)c.mediaKeys=CreatorScreenMedia.slice(original.mediaKeys,0,c.len);}}if(edit.mode==='right')for(const c of relatedClips(found.clip))for(const [property,all] of Object.entries(c.propertyKeys||{}))if(all.length){const boundary=sampleKeys(all,c.len);c.propertyKeys[property]=all.filter(k=>k.time<c.len-frame/2).concat({time:c.len,value:boundary});}for(const c of relatedClips(found.clip)){const f=getClip(c.id);if(f&&['animation','expression'].includes(f.track.type))CreatorFades.clampStored(c,fadeSpan(c,f.track.type));}remember(edit.before);}renderTimeline();renderInspector();updateClock();if(edit.offsetLimitMessage)notify(edit.offsetLimitMessage);}
  $('#tracks').addEventListener('keydown',e=>{const handle=e.target.closest('[data-fade]');if(!handle||!['ArrowLeft','ArrowRight'].includes(e.key))return;const element=handle.closest('[data-clip]'),found=element&&getClip(element.dataset.clip);if(!found||found.track.locked)return;e.preventDefault();e.stopPropagation();const side=handle.dataset.fade,before=copyState(),direction=(e.key==='ArrowRight'?1:-1)*(side==='in'?1:-1),current=found.clip[side==='in'?'fadeIn':'fadeOut']??0;CreatorFades.set(found.clip,side,current+direction*frame*(e.shiftKey?10:1),fadeSpan(found.clip,found.track.type),fps);remember(before);renderTimeline();renderInspector();updateClock();});
  $('#tracks').addEventListener('lostpointercapture',e=>{if(marquee?.pointerId===e.pointerId)cancelMarquee();});
  window.addEventListener('pointerup',e=>{if(marquee)finishMarquee(e);},true);
  window.addEventListener('pointercancel',e=>{if(marquee)finishMarquee(e,true);},true);
  window.addEventListener('blur',cancelMarquee);
  window.addEventListener('pagehide',cancelMarquee);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelMarquee();});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&marquee){cancelMarquee();e.preventDefault();e.stopImmediatePropagation();}},true);
  $('#tracks').addEventListener('pointerup',e=>{if(marquee){finishMarquee(e);return;}const isClip=Boolean(drag||e.target.closest('[data-clip]'));finishDrag();if(isClip)window.CreatorPanelLayout?.activate('inspector');});$('#tracks').addEventListener('pointercancel',e=>{if(marquee)finishMarquee(e,true);else if(drag){state=drag.before;drag=null;renderTimeline();renderInspector();updateClock();}});
  function seekRuler(e){const r=$('#ruler').getBoundingClientRect();state.current=quantize(Math.max(0,Math.min(duration,(e.clientX-r.left)/r.width*duration)));updateClock();}
  $('#ruler').ondblclick=e=>{const m=e.target.closest('[data-marker]');if(m)editTimelineMarker(m.dataset.marker);};
  $('#ruler').onpointerdown=e=>{if(e.button!==0)return;const m=e.target.closest('[data-marker]');if(m){const marker=state.markers?.find(x=>x.id===m.dataset.marker);if(marker)seekFrame(Math.round(marker.time*fps));return;}commitInspectorInput();$('#ruler').setPointerCapture(e.pointerId);seekRuler(e);};$('#ruler').onpointermove=e=>{if(e.buttons)seekRuler(e);};
  const audioPlayers=new Map();
  function retireAudioPlayer(key,entry){entry.retired=true;entry.audio.pause();audioPlayers.delete(key);}
  const originalAudioPlayers=new Map();let originalAudioContext=null;
  function originalPosition(loop,offset){const start=loop.start/loop.sampleRate,end=loop.end/loop.sampleRate,period=end-start;return offset<end?offset:start+((offset-start)%period+period)%period;}
  function removeOriginalPlayer(id){const entry=originalAudioPlayers.get(id);if(!entry)return;originalAudioPlayers.delete(id);entry.abort?.abort();if(entry.source)try{entry.source.stop();}catch(_){}try{entry.source?.disconnect();entry.gain?.disconnect();}catch(_){}}
  async function loadOriginalAudio(entry,asset,loop){
    const response=await fetch(mediaUrl(asset),{signal:entry.abort.signal,cache:'no-store'});if(!response.ok)throw Error('无法读取音频文件');const bytes=await response.arrayBuffer();if(bytes.byteLength<44||bytes.byteLength>100*1024*1024)throw Error('音频文件大小无效');
    const view=new DataView(bytes),tag=(i,n)=>String.fromCharCode(...new Uint8Array(bytes,i,n));if(tag(0,4)!=='RIFF'||tag(8,4)!=='WAVE')throw Error('原始循环需要 WAV 音频');let pos=12,channels=0,rate=0,align=0,dataBytes=null,encoding=0;
    while(pos+8<=bytes.byteLength){const type=tag(pos,4),size=view.getUint32(pos+4,true);pos+=8;if(size>bytes.byteLength-pos)throw Error('WAV 文件损坏');if(type==='fmt '&&size>=16){encoding=view.getUint16(pos,true);channels=view.getUint16(pos+2,true);rate=view.getUint32(pos+4,true);align=view.getUint16(pos+12,true);}if(type==='data')dataBytes=size;pos+=size+(size%2);}
    if(encoding!==1||!channels||channels>8||(loop.channels!==undefined&&channels!==loop.channels)||!align||rate!==loop.sampleRate||dataBytes===null||dataBytes%align||dataBytes/align!==loop.frames||loop.frames*channels*4>256*1024*1024)throw Error('音频与原始循环点不匹配或音频过大');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');if(digest!==loop.sha256)throw Error('原始循环音频文件已变化，请重新导入');
    const buffer=await originalAudioContext.decodeAudioData(bytes);if(buffer.duration+1/loop.sampleRate<loop.end/loop.sampleRate)throw Error('解码音频比循环范围短');return buffer;
  }
  function syncOriginalAudio(active){
    for(const [id,entry] of originalAudioPlayers){const item=active.get(id);if(!playing||!item||!item.clip.originalLoop||entry.assetId!==item.asset.id||entry.loopKey!==JSON.stringify(item.clip.originalLoop))removeOriginalPlayer(id);}
    if(!playing)return;
    for(const [id,{clip,asset}] of active){if(!clip.originalLoop||!clip.audioLoop)continue;const loop=clip.originalLoop;if(!validOriginalLoop(loop)){notify('原始循环点无效：'+clip.name);continue;}
      let entry=originalAudioPlayers.get(id);if(!entry){try{originalAudioContext ||=new AudioContext();const cost=Math.ceil(loop.frames*Math.max(1,originalAudioContext.sampleRate/loop.sampleRate))*(loop.channels||8)*4,total=[...originalAudioPlayers.values()].reduce((n,x)=>n+(x.cost||0),0);if(cost>256*1024*1024||total+cost>512*1024*1024){originalAudioPlayers.set(id,{assetId:asset.id,loopKey:JSON.stringify(loop),failed:true,cost:0});notify('原始循环音频过长或同时播放过多');continue;}if(originalAudioContext.state==='suspended')originalAudioContext.resume().catch(()=>{});entry={assetId:asset.id,loopKey:JSON.stringify(loop),abort:new AbortController(),loading:true,cost};originalAudioPlayers.set(id,entry);const current=entry;loadOriginalAudio(entry,asset,loop).then(buffer=>{if(originalAudioPlayers.get(id)!==current)return;current.buffer=buffer;current.loading=false;syncAudio();}).catch(error=>{if(originalAudioPlayers.get(id)!==current||error.name==='AbortError')return;current.loading=false;current.failed=true;current.cost=0;notify('原始循环播放失败：'+error.message);});}catch(error){notify('原始循环播放不可用：'+error.message);}continue;}
      if(entry.loading||entry.failed||!entry.buffer)continue;
      const context=originalAudioContext,drift=entry.source?Math.abs((entry.timelineAtStart+context.currentTime-entry.contextAtStart)-state.current):Infinity;
      if(drift>.15||entry.rate!==(clip.mediaRate||1)){if(entry.source){try{entry.source.stop();entry.source.disconnect();entry.gain.disconnect();}catch(_){}}const source=context.createBufferSource(),gain=context.createGain();source.buffer=entry.buffer;entry.rate=clip.mediaRate||1;source.playbackRate.value=entry.rate;source.loop=true;source.loopStart=loop.start/loop.sampleRate;source.loopEnd=loop.end/loop.sampleRate;source.connect(gain);gain.connect(context.destination);entry.source=source;entry.gain=gain;entry.timelineAtStart=state.current;entry.contextAtStart=context.currentTime;try{source.start(0,originalPosition(loop,Math.max(0,(state.current-clip.start)*(clip.mediaRate||1)+(clip.sourceOffset||0))));}catch(error){entry.failed=true;notify('原始循环播放失败：'+error.message);continue;}}
      const elapsed=state.current-clip.start,remaining=clip.start+clip.len-state.current,fadeIn=clip.fadeIn||0,fadeOut=clip.fadeOut||0;entry.gain.gain.setValueAtTime(Math.max(0,Math.min(1,(clip.volume??1)*(fadeIn?Math.min(1,elapsed/fadeIn):1)*(fadeOut?Math.min(1,remaining/fadeOut):1))),context.currentTime);
    }
  }
  function mediaUrl(asset){if(asset?.effectUrl)return asset.effectUrl;if(!asset?.scope||!(['音乐','音效','音源'].includes(asset.type)||asset.type==='视频'&&asset.visual?.kind==='video'&&asset.visual.hasAudio===true))throw Error('音频素材不可用');const folder=asset.scope==='project'?asset.projectId:'shared';return '/'+location.pathname.split('/')[1]+'/media/'+asset.scope+'/'+folder+'/'+asset.id+asset.extension;}
  const audioMetadataSession=id();let audioMetadataNonce=0;
  function readAudioDuration(asset){
    return new Promise((resolve,reject)=>{const audio=new Audio();let settled=false;const timer=setTimeout(()=>finish(new Error('读取音频时长超时')),15000);
      function finish(error){if(settled)return;settled=true;clearTimeout(timer);audio.onloadedmetadata=null;audio.onerror=null;const seconds=audio.duration;try{audio.removeAttribute('src');audio.load();}catch(_){}if(error)reject(error);else if(!Number.isFinite(seconds)||seconds<=0)reject(Error('音频时长不可用'));else resolve(seconds);}
      audio.preload='metadata';audio.onloadedmetadata=()=>finish();audio.onerror=()=>finish(Error('无法读取音频，请检查素材文件和格式'));
      try{audio.src=mediaUrl(asset)+'?probe='+encodeURIComponent(audioMetadataSession+'-'+(++audioMetadataNonce));audio.load();}catch(error){finish(error);}
    });
  }
  async function loopEditedOffset(clip,offset){
    if(clip.originalLoop){const loop=clip.originalLoop,start=loop.start/loop.sampleRate,end=loop.end/loop.sampleRate,period=end-start;if(offset<0&&(clip.sourceOffset||0)<start)throw Error('前奏不能向左延长到源音频起点之前');if(offset<0||offset>3600){const result=start+((offset-start)%period+period)%period;if(result>3600)throw Error('循环相位超过工程可保存的源偏移范围');return result;}return offset;}
    if(offset>=0&&offset<=3600)return offset;
    const asset=assetById(clip.assetId);if(!asset?.scope)throw Error('循环音频素材不可用，无法计算片段相位');
    const initialState=state,signature=JSON.stringify(state),assetSignature=JSON.stringify([asset.scope,asset.projectId,asset.extension]);
    const seconds=await readAudioDuration(asset),current=assetById(clip.assetId);
    if(state!==initialState||JSON.stringify(state)!==signature||drag||!current||JSON.stringify([current.scope,current.projectId,current.extension])!==assetSignature)throw Error('工程、片段或素材已改变，请重试');
    const wrapped=((offset%seconds)+seconds)%seconds;
    if(!Number.isFinite(wrapped)||wrapped>3600)throw Error('循环相位超过工程可保存的源偏移范围');
    return wrapped;
  }
  async function audioClipLength(asset,start,sourceOffset=0,loop=false){
    const startingState=state,projectId=state.projectId,oldFps=fps,oldDuration=duration,seconds=await readAudioDuration(asset);
    const current=assetById(asset.id);if(state!==startingState||state.projectId!==projectId||fps!==oldFps||duration!==oldDuration||!current||current.scope!==asset.scope||current.projectId!==asset.projectId||current.extension!==asset.extension)throw Error('工程、演出设置或音频素材已改变，请重试');
    if(!loop&&sourceOffset>=seconds)throw Error('音频源偏移已到达或超过音频末尾');
    const position=loop?sourceOffset%seconds:sourceOffset;
    const availableFrames=Math.floor((duration-start)*fps+1e-6);if(availableFrames<1)throw Error('当前演出剩余时长不足一帧');
    const sourceFrames=Math.max(1,Math.ceil((seconds-position)*fps-1e-7)),length=Math.min(sourceFrames,availableFrames)/fps;
    return {length,truncated:sourceFrames>availableFrames};
  }
  function setAudioLoop(clipId,enabled){
    const found=getClip(clipId);if(!found||found.track.type!=='audio'||found.clip.dialogue)throw Error('请选择普通音乐或音效片段');if(found.track.locked)throw Error('轨道已锁定');if(typeof enabled!=='boolean')throw Error('循环设置无效');
    if(Boolean(found.clip.audioLoop)===enabled)return;const before=copyState();if(enabled)found.clip.audioLoop=true;else{delete found.clip.audioLoop;delete found.clip.originalLoop;}remember(before);renderTimeline();renderInspector();updateClock();
  }
  function validOriginalLoop(loop){return Boolean(loop&&Number.isSafeInteger(loop.sampleRate)&&loop.sampleRate>=8000&&loop.sampleRate<=192000&&Number.isSafeInteger(loop.frames)&&loop.frames>0&&Number.isSafeInteger(loop.start)&&Number.isSafeInteger(loop.end)&&loop.start>=0&&loop.start<loop.end&&loop.end<=loop.frames&&(loop.channels===undefined||Number.isSafeInteger(loop.channels)&&loop.channels>=1&&loop.channels<=8)&&typeof loop.sha256==='string'&&/^[0-9a-f]{64}$/.test(loop.sha256));}
  async function setOriginalAudioLoop(clipId,enabled){
    const found=getClip(clipId);if(!found||found.track.type!=='audio'||found.clip.dialogue||found.track.locked)throw Error('请选择未锁定的普通音频片段');
    if(typeof enabled!=='boolean')throw Error('循环设置无效');if(Boolean(found.clip.originalLoop)===enabled)return;
    const initial=state,signature=JSON.stringify(state),asset=assetById(found.clip.assetId);let loop;
    if(enabled){if(validOriginalLoop(asset?.filmAudio?.originalLoop))loop=structuredClone(asset.filmAudio.originalLoop);else if(window.assetAPI?.originalLoop&&asset?.filmAudio?.catalogId)loop=await window.assetAPI.originalLoop(asset);else throw Error('此素材没有可用的原始循环点，请从本地目录重新导入');if(!validOriginalLoop(loop))throw Error('原始循环点无效');}
    if(state!==initial||JSON.stringify(state)!==signature||getClip(clipId)?.clip!==found.clip)throw Error('工程或片段已改变，请重试');
    const before=copyState();if(enabled){found.clip.audioLoop=true;found.clip.originalLoop=loop;}else delete found.clip.originalLoop;remember(before);renderTimeline();renderInspector();updateClock();
  }
  function lipSyncMatches(audioClipId){return state.tracks.filter(t=>t.type==='expression').flatMap(track=>track.clips.filter(clip=>clip.lipSyncSource?.audioClipId===audioClipId).map(clip=>({track,clip})));}
  let lipSyncBusy=false;
  async function generateLipSync(audioClipId,replace=false,mode='amplitude'){
    if(lipSyncBusy)throw Error('正在生成口型');
    if(!['amplitude','phoneme','manual'].includes(mode))throw Error('口型模式无效');
    function inspect(){
      const found=getClip(audioClipId),track=found?.track,clip=found?.clip;
      if(!found||track.type!=='audio'||!clip.dialogue||track.enabled===false)throw Error('请选择已启用的对话音频片段');
      const dialogue=state.dialogues.find(d=>d.id===clip.dialogue),actor=state.objects.find(o=>o.id===track.target),asset=assetById(dialogue?.voice);
      if(!actor||!supportedActor(actor)||!shapeForActor(actor,'asset-local-mouth'))throw Error('角色不支持嘴部张合形变');
      if(!asset?.scope||asset.extension!=='.wav')throw Error('请先为对白准备 WAV 音频');
      if(mode==='phoneme'&&!asset.voiceTiming)throw Error('此语音没有音素时间，请重新生成 VOICEVOX 语音');
      if(clip.len>60)throw Error('单次口型分析限 60 秒，请先裁剪对白');
      const matches=lipSyncMatches(audioClipId);if(matches.length>1)throw Error('该对白关联了多个口型片段，请先整理');
      const existing=matches[0];if(existing&&!replace)throw Error('已有口型，请使用更新口型');if(!existing&&replace)throw Error('原口型片段不存在');
      if(existing&&(existing.track.locked||existing.track.target!==actor.id))throw Error('口型轨道已锁定或不属于该角色');
      if(existing&&existing.track.clips.some(c=>c!==existing.clip&&clip.start<c.start+c.len-1e-6&&clip.start+clip.len>c.start+1e-6))throw Error('更新后口型轨道的片段会重叠');
      if(state.tracks.some(t=>t.enabled!==false&&t.type==='expression'&&t.target===actor.id&&t.clips.some(c=>c!==existing?.clip&&c.assetId==='asset-local-mouth'&&clip.start<c.start+c.len-1e-6&&clip.start+clip.len>c.start+1e-6)))throw Error('已有重叠的嘴部张合片段，请先移走或禁用原轨道');
      const signature=lipSourceSignature(track,clip,dialogue);
      const editSignature=JSON.stringify([signature,existing?.track.id,existing?.track.enabled,existing?.track.locked,existing?.clip]);
      return {clip,actor,asset,signature,existing,editSignature};
    }
    const initial=inspect();lipSyncBusy=true;let context;
    try{
      const response=await fetch(mediaUrl(initial.asset));if(!response.ok)throw Error('对白音频不可读取');
      const size=Number(response.headers.get('content-length'));if(size>16*1024*1024)throw Error('对白 WAV 超过 16 MB');
      const bytes=await response.arrayBuffer();if(bytes.byteLength>16*1024*1024||bytes.byteLength<44)throw Error('对白 WAV 过大或不完整');
      const view=new DataView(bytes),tag=at=>String.fromCharCode(...new Uint8Array(bytes,at,4));
      if(tag(0)!=='RIFF'||tag(8)!=='WAVE')throw Error('需要未压缩的 WAV 音频');
      let format=0,sourceChannels=0,sourceRate=0,bits=0,dataSize=0;
      for(let i=12;i+8<=bytes.byteLength;){const n=view.getUint32(i+4,true),next=i+8+n+(n%2);if(next>bytes.byteLength||next<=i)throw Error('WAV 数据不完整');if(tag(i)==='fmt '&&n>=16){format=view.getUint16(i+8,true);sourceChannels=view.getUint16(i+10,true);sourceRate=view.getUint32(i+12,true);bits=view.getUint16(i+22,true);}if(tag(i)==='data')dataSize=n;i=next;}
      if(![1,3].includes(format)||![8,16,24,32].includes(bits)||(format===3&&bits!==32)||sourceChannels<1||sourceChannels>2||sourceRate<8000||sourceRate>192000||!dataSize)throw Error('需要单声道或立体声的 PCM / 浮点 WAV 音频');
      if(dataSize/(sourceRate*sourceChannels*(bits/8))>120)throw Error('对白音频超过 120 秒');
      context=new AudioContext({sampleRate:sourceRate});const audio=await context.decodeAudioData(bytes);
      if(audio.duration>120||audio.numberOfChannels>2)throw Error('对白音频过长或声道过多');
      const channels=Array.from({length:audio.numberOfChannels},(_,i)=>audio.getChannelData(i));
      const visemes=mode!=='amplitude'&&initial.existing?.clip.lipVisemes?structuredClone(initial.existing.clip.lipVisemes):{a:'b_mouth.mouth_003',i:'b_mouth.mouth_004',u:'b_mouth.mouth_010',e:'b_mouth.mouth_012',o:'b_mouth.mouth_008'};
      let propertyKeys;
      if(mode!=='amplitude'&&Object.values(visemes).some(name=>!shapeForActor(initial.actor,faceIdForName(name))))throw Error('此角色缺少实验口型形变');
      if(mode==='phoneme'){
        if(Math.abs(audio.duration-initial.asset.voiceTiming.frameCount/initial.asset.voiceTiming.frameRate)>.05)throw Error('音素时间与音频时长不一致，请重新生成语音');
        propertyKeys=CreatorLipSync.phonemeKeys(initial.asset.voiceTiming,initial.clip.sourceOffset||0,initial.clip.len,fps,initial.clip.volume??1,initial.clip.fadeIn||0,initial.clip.fadeOut||0);
      }else if(mode==='manual')propertyKeys=Object.fromEntries(['a','i','u','e','o'].map(v=>['viseme_'+v,[{time:0,value:0},{time:initial.clip.len,value:0}]]));
      else propertyKeys={weight:CreatorLipSync.generate(channels,audio.sampleRate,initial.clip.sourceOffset||0,initial.clip.len,fps,initial.clip.volume??1,initial.clip.fadeIn||0,initial.clip.fadeOut||0)};
      if(mode!=='manual'&&!Object.values(propertyKeys).some(keys=>keys.some(k=>k.value>0)))throw Error('对白片段中没有检测到可用口型');
      const current=inspect();if(current.editSignature!==initial.editSignature)throw Error('对白或口型已改变，请重试');
      const before=copyState(),trackId=current.existing?.track.id||id(),clipId=current.existing?.clip.id||id();if(!current.actor.components.includes('expression'))current.actor.components.push('expression');
      const payload={lipEdited:false,lipGeneration:id(),assetId:'asset-local-mouth',start:current.clip.start,len:current.clip.len,weight:0,lipMode:mode,lipSyncSource:{audioClipId,signature:current.signature},propertyKeys,...(mode!=='amplitude'?{lipVisemes:visemes}:{})},generatedName=mode==='phoneme'?'对白口型（音素实验）':mode==='manual'?'对白口型（手工）':'对白口型（音量近似）';
      if(current.existing){if(mode==='amplitude')delete current.existing.clip.lipVisemes;if(['对白口型（音素实验）','对白口型（手工）','对白口型（音量近似）'].includes(current.existing.clip.name))current.existing.clip.name=generatedName;Object.assign(current.existing.clip,payload);}else state.tracks.push({id:trackId,name:`${current.actor.name} · 自动口型`,type:'expression',target:current.actor.id,clips:[{id:clipId,name:generatedName,...payload}]});
      state.selected=null;state.selectedClip=clipId;selectedAsset=null;remember(before);render();return {trackId,clipId,keyCount:Object.values(propertyKeys).reduce((n,k)=>n+k.length,0),mode,replaced:Boolean(current.existing)};
    }finally{lipSyncBusy=false;if(context)await context.close().catch(()=>{});}
  }
  function effectAudioClips(){return state.tracks.filter(t=>t.type==='audio'&&t.enabled!==false).flatMap(t=>t.clips.map(clip=>({clip,asset:assetById(clip.assetId||state.dialogues.find(d=>d.id===clip.dialogue)?.voice)}))).filter(x=>x.asset?.scope);}
  const audioEffectsPreview=CreatorAudioEffectsPreview({state:()=>state,clips:effectAudioClips,prefix:()=>'/'+location.pathname.split('/')[1],notify,onWaitingChange:updatePlaybackButton});
  function syncAudio(){
    if(!playing){for(const entry of audioPlayers.values())entry.audio.pause();for(const key of [...originalAudioPlayers.keys()])removeOriginalPlayer(key);return;}
    if(uiSceneGate){for(const entry of audioPlayers.values())entry.audio.pause();for(const key of [...originalAudioPlayers.keys()])removeOriginalPlayer(key);return;}
    if(audioEffectsPreview.needs(state.current)){playing=false;lastTick=0;syncAudio();setPlaying(true);return;}
    audioEffectsPreview.prime(state.current);
    const active=new Map();
    for(const track of state.tracks.filter(t=>t.type==='audio'&&t.enabled!==false))for(const clip of track.clips){if(state.current<clip.start||state.current>=clip.start+clip.len)continue;const dialogue=clip.dialogue&&state.dialogues.find(d=>d.id===clip.dialogue),asset=assetById(clip.assetId||dialogue?.voice);if(!asset?.scope)continue;try{active.set(clip.id,audioEffectsPreview.transformed(clip,asset));}catch(error){if(playing){setPlaying(false);notify(error.message+'，请重新播放');}return;}}
    for(const [key,entry] of audioPlayers){const item=active.get(key);if(!item||item.asset.id!==entry.assetId||item.clip.originalLoop)retireAudioPlayer(key,entry);else if(!playing)entry.audio.pause();}
    syncOriginalAudio(active);
    if(!playing)return;
    for(const [key,{clip,asset}] of active){if(clip.originalLoop&&clip.audioLoop)continue;let entry=audioPlayers.get(key);if(!entry||entry.assetId!==asset.id){if(entry)retireAudioPlayer(key,entry);const audio=new Audio(mediaUrl(asset));audio.preload='auto';entry={audio,assetId:asset.id,pending:false,failed:false,retired:false};audioPlayers.set(key,entry);audio.addEventListener('error',()=>{if(!entry.retired&&!entry.failed){entry.failed=true;notify('音频无法读取：'+assetDisplay(asset));}});}
      const audio=entry.audio,offset=Math.max(0,(state.current-clip.start)*(clip.mediaRate||1)+(clip.sourceOffset||0)),loop=clip.audioLoop===true&&!clip.dialogue;audio.loop=loop;audio.playbackRate=clip.mediaRate||1;const elapsed=state.current-clip.start,remaining=clip.start+clip.len-state.current,fadeIn=clip.fadeIn||0,fadeOut=clip.fadeOut||0;audio.volume=Math.max(0,Math.min(1,(clip.volume??1)*(fadeIn?Math.min(1,elapsed/fadeIn):1)*(fadeOut?Math.min(1,remaining/fadeOut):1)));
      if(Number.isFinite(audio.duration)&&audio.duration>0&&!loop&&offset>=audio.duration){audio.pause();continue;}
      const position=loop&&Number.isFinite(audio.duration)&&audio.duration>0?offset%audio.duration:offset;
      try{if(audio.readyState>=1){const difference=Math.abs(audio.currentTime-position),drift=loop&&audio.duration>0?Math.min(difference,Math.abs(audio.duration-difference)):difference,tolerance=loop&&audio.duration>0?Math.min(.15,audio.duration*.2):.15;if(drift>tolerance)audio.currentTime=position;}}catch(_){}
      if(audio.paused&&!entry.pending&&!entry.failed){entry.pending=true;audio.play().catch(error=>{
        // pause() can reject a pending play() during a user pause or scene-load gate.
        // It is a cancelled request, so the next playback sync must be free to retry.
        if(error?.name==='AbortError'&&!audio.error)return;
        if(!entry.retired&&!entry.failed){entry.failed=true;notify('无法播放音频：'+assetDisplay(asset)+(error?.message?'（'+error.message+'）':''));}
      }).finally(()=>{entry.pending=false;if(entry.retired||!playing||uiSceneGate||!active.has(key))audio.pause();});}
    }
  }
  function updatePlaybackButton(){const waiting=audioEffectsPreview.isWaiting(),label=waiting?'取消声音准备':playing?'暂停':'播放';$('#play').innerHTML=icon(waiting?'close':playing?'pause':'play');$('#play').setAttribute('aria-label',label);$('#play').title=label;$('#play').classList.toggle('preparing',waiting);}
  function setPlaying(value){if(value&&state.current>=duration)state.current=0;if(audioEffectsPreview.gate(value,()=>setPlaying(true))){playing=false;lastTick=0;syncAudio();updatePlaybackButton();return;}if(value){finishGizmoEdit();for(const [key,entry] of audioPlayers)if(entry.failed)retireAudioPlayer(key,entry);}playing=value;lastTick=0;updatePlaybackButton();syncAudio();}
  function revealPlayhead(){const scroll=$('.timeline-scroll'),area=scroll.getBoundingClientRect(),ruler=$('#ruler').getBoundingClientRect(),x=ruler.left+ruler.width*state.current/duration;if(x<area.left||x>area.right)scroll.scrollLeft+=x-(area.left+area.right)/2;}
  function seekFrame(frameNumber){setPlaying(false);state.current=Math.max(0,Math.min(Math.round(duration*fps),frameNumber))/fps;updateClock();revealPlayhead();}
  function stepFrame(direction){commitInspectorInput();seekFrame(Math.round(state.current*fps)+direction);}
  function seekBoundary(direction){
    commitInspectorInput();setPlaying(false);
    let target=direction<0?0:duration;const consider=t=>{if(t<0||t>duration)return;if(direction<0&&t<state.current-1e-7&&t>target||direction>0&&t>state.current+1e-7&&t<target)target=t;};
    for(const track of state.tracks)for(const clip of track.clips){consider(clip.start);consider(clip.start+clip.len);}
    state.current=target;updateClock();revealPlayhead();
  }
  $('#previous-boundary').onclick=()=>seekBoundary(-1);$('#next-boundary').onclick=()=>seekBoundary(1);
  function openTimecode(){
    commitInspectorInput();setPlaying(false);updateClock();
    showModal(`<div class="modal-head"><div><h2>定位播放头</h2><p>输入时间码，以当前工程帧率定位。</p></div><button class="icon-button" data-close aria-label="关闭">${icon('close')}</button></div><div class="modal-body"><div class="field"><label for="timecode-input">时间码（时:分:秒:帧）</label><input class="input" id="timecode-input" value="${time(state.current)}" inputmode="numeric" autocomplete="off" spellcheck="false"></div><p class="hint">当前 ${fps} fps；范围 00:00:00:00 至 ${time(duration)}。</p><p class="error" id="timecode-error" role="alert"></p><button class="solid-button" id="timecode-go">定位</button></div>`);
    const input=$('#timecode-input');const go=()=>{const match=/^(\d{1,2}):([0-5]\d):([0-5]\d):(\d{1,2})$/.exec(input.value.trim());if(!match||Number(match[4])>=fps){$('#timecode-error').textContent=`请输入有效时间码，帧数须小于 ${fps}。`;return;}const frames=((Number(match[1])*60+Number(match[2]))*60+Number(match[3]))*fps+Number(match[4]);if(frames>Math.round(duration*fps)){$('#timecode-error').textContent='时间码超出演出时长。';return;}closeModal();seekFrame(frames);};
    $('#timecode-go').onclick=go;input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();go();}};input.focus();input.select();
  }
  $('#time-display').onclick=openTimecode;
  $('#play').onclick=()=>{commitInspectorInput();setPlaying(!playing);};$('#back-start').onclick=()=>{commitInspectorInput();state.current=0;setPlaying(false);updateClock();};
  function tick(now){if(playing){if(uiSceneGate&&Math.abs(state.current-uiSceneGate.time)>1e-6)uiSceneGate=null;if(lastTick&&!uiSceneGate){const next=Math.min(duration,state.current+(now-lastTick)/1000);try{const audioBoundary=audioEffectsPreview.boundary(state.current,next),until=audioBoundary===null?next:audioBoundary,gate=CreatorUITransitions.nextGate(state,state.current,until,sceneAt);if(gate){uiSceneGate=gate;state.current=gate.time;}else state.current=until;}catch(error){setPlaying(false);notify(error.message);}}lastTick=now;if(state.current>=duration)setPlaying(false);try{updateClock();}catch(error){stopForPreviewError(error.message);}}requestAnimationFrame(tick);}requestAnimationFrame(tick);
  document.addEventListener('keydown',e=>{
    if(e.isComposing)return;
    if(e.key==='Escape'&&assetContextMenu){e.preventDefault();closeAssetContextMenu();return;}
    if(!$('#overlay').classList.contains('hidden')){if(e.key==='Escape'&&!exporting&&!translationCooking)closeModal();return;}
    if(e.target.closest('input:not([type="range"]),textarea,select,[contenteditable]:not([contenteditable="false"])'))return;
    // The timeline zoom slider is not a text editor. Keep its native navigation
    // keys, but let letters such as A/B reach the timeline shortcut handler.
    if(e.target.closest('input[type="range"]')&&(!e.target.closest('#timeline-panel')||['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Tab','Enter',' '].includes(e.key)))return;
    if(exporting||translationCooking||timelineEditBusy)return;
    // Windows IME can emit Process/229 outside text fields. Its physical letter
    // code remains usable; real text editing/composition is excluded above.
    const physical=/^Key[A-Z]$/.test(e.code||'');
    if(e.keyCode===229&&!physical)return;
    const key=physical?e.code.slice(3).toLowerCase():e.key.toLowerCase(),ctrl=e.ctrlKey||e.metaKey,timeline=editingScope==='timeline'&&!$('#timeline-panel').classList.contains('hidden');
    const run=fn=>{e.preventDefault();if(!e.repeat)fn();};
    if(e.key==='Escape'){run(()=>{if(drag){state=drag.before;drag=null;}setTimelineMode('select');soloClipId=null;finishGizmoEdit();setTimelineSelection([]);updateClock();});return;}
    if((e.key==='Delete'||e.key==='Backspace')&&!ctrl&&!e.altKey){if(editingScope==='assets'&&selectedAsset)return run(()=>deleteAssetDialog(assetSelection.ids.length?assetSelection.ids:[selectedAsset]));if(editingScope==='hierarchy'&&(state.selected||hierarchySelection.ids.length))return run(()=>removeHierarchyObjects(hierarchySelection.ids.length?hierarchySelection.ids:[state.selected]));}
    if(ctrl&&!e.altKey&&key==='a'&&['assets','hierarchy'].includes(editingScope))return run(()=>selectAllPanel(editingScope));
    if(timeline){
      if(!ctrl&&!e.altKey&&!e.shiftKey&&key==='a')return run(()=>setTimelineMode('select'));
      if(!ctrl&&!e.altKey&&!e.shiftKey&&key==='b')return run(()=>setTimelineMode('blade'));
      if(ctrl&&!e.altKey&&key==='a')return run(()=>{soloClipId=null;setTimelineSelection(state.tracks.flatMap(t=>t.clips.map(c=>c.id)));});
      if(ctrl&&!e.altKey&&!e.shiftKey&&key==='b')return run(splitSelected);
      if(ctrl&&!e.altKey&&key==='g')return run(e.shiftKey?ungroupSelected:groupSelected);
      if(ctrl&&!e.altKey&&key==='c')return run(copySelectedClip);
      if(ctrl&&!e.altKey&&key==='v')return run(pasteClip);
      if(!ctrl&&!e.altKey&&!e.shiftKey&&(key==='q'||key==='w'))return run(()=>trimSelected(key==='q'?'left':'right'));
      if(!ctrl&&!e.altKey&&key==='n')return run(()=>$('#snap').click());
      if(!ctrl&&key==='m')return run(e.shiftKey?()=>seekMarker(e.altKey?-1:1):()=>editTimelineMarker());
      if(!ctrl&&!e.altKey&&e.shiftKey&&key==='z')return run(()=>$('#fit-timeline').click());
      if(ctrl&&!e.altKey&&['+','=','-','_'].includes(e.key))return run(()=>zoomCenter(zoom*(['-','_'].includes(e.key)?1/1.4:1.4)));
      if(!ctrl&&!e.altKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();if(e.key==='ArrowUp'||e.key==='ArrowDown')seekBoundary(e.key==='ArrowUp'?-1:1);else if(e.key==='Home'||e.key==='End')seekFrame(e.key==='Home'?0:Math.round(duration*fps));else stepFrame((e.key==='ArrowLeft'?-1:1)*(e.shiftKey?10:1));return;}
      if(e.key==='Delete'||e.key==='Backspace')return run(deleteSelected);
      if(e.key==='Tab'&&!e.shiftKey&&!ctrl&&!e.altKey&&!selectedAsset)return run(openComponentModal);
    }
    if(!timeline&&!ctrl&&!e.altKey&&['w','r','s'].includes(key))return run(()=>setGizmoMode({w:'move',r:'rotate',s:'scale'}[key]));
    if(ctrl&&!e.altKey&&key==='z')return run(e.shiftKey?historyRedo:historyUndo);
    if(ctrl&&!e.altKey&&key==='y')return run(historyRedo);
    if(e.code==='Space'&&!ctrl&&!e.altKey)return run(()=>setPlaying(!playing));
    if(e.key==='F2'&&assetSelection.ids.length===1&&!$('#assets-panel').classList.contains('hidden')&&assetById(selectedAsset)?.voiceProvider)return run(()=>{closeAssetContextMenu();renameAsset(selectedAsset);});
  });

  let projectName='未命名原型工程', savedFingerprint='', projectBusy=false, translationCooking=false, projectLayout;
  function fingerprint(s=state){const {selected,selectedClip,current,...content}=s;return JSON.stringify(content);}
  function scheduleProjectLabel(){if(desktop&&!projectLabelTimer)projectLabelTimer=setTimeout(updateProjectLabel,50);}
  function updateProjectLabel(){if(projectLabelTimer){clearTimeout(projectLabelTimer);projectLabelTimer=0;}if(desktop)$('#project-name').textContent=projectName+(fingerprint()===savedFingerprint?'':' *');}
  function projectError(error){showModal(`<div class="modal-head"><div><h2>操作失败</h2><p>${esc(error?.message||error)}</p></div><button class="icon-button" data-close aria-label="关闭">${icon('close')}</button></div><div class="modal-body"><p class="hint">当前工程仍保留在编辑器中。</p></div>`);}
  function documentFor(s,layout=projectLayout){return {format:'gakumas-creator-project',version:1,resources:{character:'ttmr-casl-0002-prepared'},state:s,...(layout?{uiLayout:layout}:{})};}
  const layoutConflict=layout=>Boolean(layout&&window.CreatorPanelLayout&&JSON.stringify(CreatorLayoutSchema.normalize(layout))!==JSON.stringify(window.CreatorPanelLayout.snapshot()));
  async function saveProject(saveAs=false){
    finishGizmoEdit();commitInspectorInput();setPlaying(false);
    const answer=await chooseLayout('保存界面布局？','选择是否将当前面板位置、标签与大小随工程保存。选择不保存时保留工程中原有布局。',[{label:'保存当前布局',value:'save'},{label:'不保存当前布局',value:'keep'},{label:'取消',value:'cancel'}]);if(answer==='cancel')return false;
    const layout=answer==='save'?window.CreatorPanelLayout.snapshot():projectLayout,snapshot=copyState(), saved=fingerprint(snapshot);
    const result=await window.projectAPI.save(documentFor(snapshot,layout),saveAs);
    if(!result)return false;
    projectLayout=layout;projectName=result.name;savedFingerprint=saved;updateProjectLabel();notify('工程已保存');return fingerprint()===savedFingerprint;
  }
  async function mayLeave(){
    commitInspectorInput();setPlaying(false);
    if(fingerprint()===savedFingerprint)return true;
    const answer=await window.projectAPI.confirmUnsaved();
    if(answer==='discard')return true;
    if(answer==='save')return saveProject(false);
    return false;
  }
  function applyProject(next,name,layout){
    finishGizmoEdit();projectLayout=layout;
    setPlaying(false);for(const [key,entry] of audioPlayers)retireAudioPlayer(key,entry);selectedClipIds.clear();soloClipId=null;setTimelineMode('select');state=normalizeState(next);clearPanelSelections();knownTimelineTracks=new Set(state.tracks.map(t=>t.id));collapsedTimelineGroups.clear();clipClipboard=null;selectedAsset=null;treeExpanded=true;assetFilter='全部';assetSourceFilter='all';$('#asset-source-filter').value='all';undoStack.length=0;redoStack.length=0;bridgeLast='';projectName=name;
    render();resizeTimeline();updateHistoryButtons();savedFingerprint=fingerprint();updateProjectLabel();for(const a of state.assets)loadAssetPreview(a);
  }
  async function projectAction(action){if(projectBusy)return;projectBusy=true;try{await action();}catch(e){projectError(e);}finally{projectBusy=false;}}
  async function prepareCodeUI(snapshot,width=1280,height=null){if(!snapshot?.composition)return;if(new URLSearchParams(location.search).get('codeUI')!=='1'&&state.tracks.some(t=>t.compositionLayout||t.clips.some(c=>c.uiKind==='code'||c.compositionLayout)))throw Error('UI 片段与合成变换需要新版 Player，请更新并重启');const aspect=state.globalSettings.aspect.split(':').map(Number);height??=Math.round(width*aspect[1]/aspect[0]);if(height>1920){width=Math.round(width*1920/height);height=1920;}for(const n of snapshot.composition.nodes){if(n.kind!=='codeUI'||!n.codeUI)continue;if(!window.codeUIAPI)throw Error('代码 UI 需要桌面工作台');n.png=await window.codeUIAPI.render({code:n.codeUI,time:n.localTime,duration:n.duration,width,height});delete n.codeUI;delete n.localTime;delete n.duration;}}
  async function hostPost(endpoint, body) {
    if(endpoint==='state')await prepareCodeUI(body);if(endpoint==='export-frame'&&body.state)await prepareCodeUI(body.state);for(const row of body.frames||[])await prepareCodeUI(row.state);
    const response=await fetch('/'+location.pathname.split('/')[1]+'/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw Error('导出请求失败（'+response.status+'）：'+(await response.text()).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,300));
    const reply=await response.json();if(!reply.ok)throw Error(reply.error||'导出失败');return reply;
  }
  function exportInputs(){
    CreatorStory.validate(state);CreatorPostEffects.validate(state);
    if(CreatorPostEffects.packet(state,0).enabled&&new URLSearchParams(location.search).get('postEffects')!=='1')throw Error('画面效果需要新版 Player，请先保存并重启');
    if(state.layerSchema===1&&!animationLayersSupported)throw Error('此工程使用动画分层，请重启到新版 Player');
    if(state.sceneId&&!sceneAssets.some(a=>a.sceneId===state.sceneId))throw Error('基础场景素材不可用：'+state.sceneId);
    if(missingProps())throw Error('当前 Player 不支持工程中的教室道具，请使用新版 Player。');
    if(pendingCostume())throw Error(pendingCostume().name+' 的所选服装尚未接入 Player，预览仍为基础服；请先恢复基础服或等待换装功能。');
    if(unsupportedScale())throw Error('当前 Player 不支持工程缩放，请使用新版三轴实验入口。');
    if(actorUnavailable())throw Error(actorUnavailable().name+' 的本地角色资源不可用，请准备素材后重试。');
    if(performance&&!idleSupported)throw Error('当前 Player 不支持角色常驻动画，请使用新版 Player。');
    if(missingIdle())throw Error('常驻动画素材不可用：'+missingIdle().name);
    const audio=[],captions=[];
    const dialogueClips=state.tracks.filter(t=>t.type==='dialogue'&&t.enabled!==false).flatMap(t=>t.clips).filter(c=>c.dialogue&&c.start<duration&&c.start+c.len>0);
    const boundaries=[...new Set([0,duration,...dialogueClips.flatMap(c=>[Math.max(0,c.start),Math.min(duration,c.start+c.len)])])].sort((a,b)=>a-b);
    for(let i=0;i<boundaries.length-1;i++){
      const start=boundaries[i],end=boundaries[i+1],clip=dialogueClips.find(c=>start>=c.start&&start<c.start+c.len),d=clip&&state.dialogues.find(x=>x.id===clip.dialogue);
      if(!d?.text)continue;
      if(d.uiStyle==='game'&&!gameDialogue)throw Error('游戏对话 UI 的本地素材不可用，请先准备素材或更换样式。');
      const speaker=d.speaker.slice(0,100),text=d.text.slice(0,500).replace(/[\uD800-\uDBFF]$/,''),last=captions[captions.length-1],uiStyle=d.uiStyle||'box',typewriter=Boolean(d.typewriter),revealRate=d.revealRate||12;
      if(last&&last.end===start&&last.clipId===clip.id)last.end=end;else captions.push({start,end,speaker,text,uiStyle,typewriter,revealRate,nameColor:dialogueColors(d)[0],nameColorEnd:dialogueColors(d)[1],nameTextColor:CreatorCharacterColors.label(state,d),origin:clip.start,clipId:clip.id});
    }
    for(const track of state.tracks.filter(t=>t.enabled!==false))for(const clip of track.clips){
      if(clip.start>=duration||clip.start+clip.len<=0)continue;
      if(track.type==='animation'&&(!performance||!motionDefinition(clip.assetId)))throw Error(`动作片段“${clip.name}”的本地样本不可用，请重新准备素材或禁用该轨道。`);
      if(track.type==='expression'&&(!faces||!(animationLayersSupported&&faceMotionById(clip.assetId))&&!shapeForActor(state.objects.find(o=>o.id===track.target)||{},clip.assetId)))throw Error(`表情片段“${clip.name}”尚未接入 Player，请禁用该轨道后重试。`);
      if(track.type==='expression'&&clip.lipVisemes&&Object.values(clip.lipVisemes).some(name=>!shapeForActor(state.objects.find(o=>o.id===track.target)||{},faceIdForName(name))))throw Error(`口型片段“${clip.name}”缺少角色嘴形，请禁用或重新生成。`);
      if(track.type==='scene'&&!assetById(clip.assetId)?.sceneId)throw Error(`场景片段“${clip.name}”的本地素材不可用，请重新准备素材或禁用该轨道。`);
      if(track.type==='post')throw Error(`“${track.name}”仍是演示轨道，尚不能导出；请先禁用该轨道。`);
      if(track.type==='media'){if(!mediaSupported)throw Error('当前 Player 不支持画面轨道，请重启新版创作器');const a=assetById(clip.assetId);if(!CreatorScreenMedia.isVisual(a)||!a.visual)throw Error('画面素材不可用：'+clip.name);CreatorScreenMedia.validateClip(clip);}
      if(track.type!=='audio')continue;
      const dialogue=clip.dialogue&&state.dialogues.find(d=>d.id===clip.dialogue),ref=clip.assetId||dialogue?.voice;if(!ref)continue;
      const asset=assetById(ref);if(!asset?.scope)throw Error('音频素材不可用：'+(asset?assetDisplay(asset):ref));
      audio.push({asset,effects:clip.audioEffects||[],rate:clip.mediaRate||1,start:clip.start,length:clip.len,offset:clip.sourceOffset||0,volume:clip.volume??1,fadeIn:clip.fadeIn||0,fadeOut:clip.fadeOut||0,loop:clip.audioLoop===true&&!clip.dialogue,...(clip.originalLoop?{originalLoop:clip.originalLoop}:{})});
    }
    return {audio,captions,uiTransitions:uiPlan().map(c=>({id:c.id,start:c.start,len:c.len,assetId:c.asset.id}))};
  }
  function videoDimensions(quality){const table=quality==='1080'?{'16:9':[1920,1080],'9:16':[1080,1920],'1:1':[1080,1080],'4:3':[1440,1080]}:{'16:9':[1280,720],'9:16':[720,1280],'1:1':[720,720],'4:3':[960,720]};return table[state.globalSettings.aspect];}
  function openVideoExport(){
    if(!videoExport){notify('当前 Player 不支持视频导出，请重启到新版');return;}
    commitInspectorInput();setPlaying(false);
    showModal(`<div class="modal-head"><div><h2>导出视频</h2><p>按时间轴逐帧渲染 MP4</p></div><button class="icon-button" data-close aria-label="关闭">×</button></div><div class="modal-body"><div class="field"><label for="video-quality">画面分辨率</label><select id="video-quality"><option value="720" ${(state.globalSettings.exportQuality||'720')==='720'?'selected':''}>720p</option><option value="1080" ${state.globalSettings.exportQuality==='1080'?'selected':''}>1080p</option></select></div><div class="field"><label for="video-supersampling">超采样</label><select id="video-supersampling"><option value="1" ${(state.globalSettings.exportSupersampling??1)===1?'selected':''}>关闭</option><option value="2" ${state.globalSettings.exportSupersampling===2?'selected':''}>2×（宽高各两倍）</option></select></div><p class="hint">提高世界画面的边缘稳定性，会增加显存占用与导出耗时；成片分辨率不变。</p><div class="field"><label for="video-mode">导出方式</label><select id="video-mode"><option value="gpu" ${state.compositionVersion===1?'selected':'disabled'}>GPU 加速（NVIDIA）</option><option value="compatibility" ${state.compositionVersion===1?'':'selected'}>兼容模式</option></select></div><p class="hint">GPU 加速需要支持 NVENC 的 NVIDIA 显卡；不支持时请选择兼容模式。</p><p class="hint">时长、帧率与画面比例使用工程设置。渲染速度取决于场景和电脑性能；对话文字为实验字幕样式。</p><button id="video-start" class="solid-button">选择位置并导出</button></div>`);
    $('#video-quality').onchange=e=>{const before=copyState();state.globalSettings.exportQuality=e.target.value;remember(before);};
    $('#video-supersampling').onchange=e=>{const before=copyState();state.globalSettings.exportSupersampling=Number(e.target.value);remember(before);};
    $('#video-start').onclick=()=>projectAction(async()=>{const quality=$('#video-quality').value;const output=await window.projectAPI.chooseVideo();if(!output)return;await exportMovie(output,quality,false,null,$('#video-mode').value);});
  }
  async function exportMovie(output,quality,newOnly=false,diagnostic=null,mode="gpu"){
    await uiReady;
    await Promise.all(prepareLayerFaces());
    const {audio,captions,uiTransitions}=exportInputs(),[width,height]=videoDimensions(quality),oldTime=state.current;let started=false,cancelled=false,encoding=false;
    const report=diagnostic?{version:2,runId:diagnostic.runId,label:diagnostic.label||'',startedAt:new Date().toISOString(),projectId:state.projectId,output,width,height,quality,fps,sourceDuration:duration,diagnostic,frames:[],gpuTiming:diagnostic.gpuVideo?'GPU execution not measured; Unity spans are inclusive CPU wall time; frame replies acknowledge submission; finish drains encoding and muxes':'not measured; Unity spans are inclusive CPU wall time; frameRtt includes stdin/backpressure'}:null;
    const clock=()=>globalThis.performance.now(),begin=clock(),originalState=state;let queueSession='',cleanupError=null;
    const normal=diagnostic?{}:CreatorExportQueue.normalOptions(state.compositionVersion,mode);let result=null;
    const fullSummary=diagnostic?.fullProject?CreatorExportQueue.createSummary():null;if(fullSummary)report.frameSummary=fullSummary.value;
    if(diagnostic?.queueCapacity||normal.gpuVideo)state=structuredClone(state);
    exporting=true;showModal(`<div class="modal-head"><div><h2>正在导出视频</h2><p id="export-progress">正在准备…</p></div></div><div class="modal-body"><progress id="export-bar" max="1" value="0" style="width:100%"></progress><p class="hint">导出期间请保持工作台运行。</p><button id="export-cancel" class="top-button">取消导出</button></div>`);
    $('#export-cancel').onclick=()=>{cancelled=true;$('#export-progress').textContent='正在取消…';if(encoding)hostPost('export-cancel',{queueSession}).catch(()=>{});};
    try {
      while(bridgeBusy||bridgePending)await new Promise(r=>setTimeout(r,20));
      if(cancelled)return;
      if(diagnostic){
        const warmStart=clock();
        for(let i=Math.max(0,diagnostic.startFrame-diagnostic.preRollFrames);i<diagnostic.startFrame;i++){
          if(cancelled)return;
          state.current=i/fps;const snapshot=playerSnapshot();if(!snapshot)throw Error('场景或相机不可用');
          await hostPost('state',{...snapshot,id:++bridgeId,profileExport:diagnostic.profile,frameIndex:i,runId:diagnostic.runId});
        }
        report.preRollMs=clock()-warmStart;
      }
      const prepareStart=clock();
      const info=await hostPost('export-start',{output,width,height,duration,fps,audio,captions,uiTransitions,newOnly,...normal,exportSupersampling:state.globalSettings.exportSupersampling??1,nativePostEffects:state.compositionVersion===1||CreatorPostEffects.packet(state,0).enabled,...(diagnostic?{diagnosticRange:{startFrame:diagnostic.startFrame,endFrame:diagnostic.endFrame},profileExport:diagnostic.profile,runId:diagnostic.runId,gpuVideo:diagnostic.gpuVideo===true,mergedFrame:diagnostic.mergedFrame===true,queueCapacity:diagnostic.queueCapacity||0,fullProject:diagnostic.fullProject===true}:{})});started=true;queueSession=info.queueSession||'';result={output,gpuVideo:info.gpuVideo,frames:info.frames};
      if(report)report.prepareMs=clock()-prepareStart;
      const framesStart=clock();
      if(info.queueCapacity){
        const queue=await CreatorExportQueue.run({total:info.frames,capacity:info.queueCapacity,session:queueSession,fullProject:!diagnostic||diagnostic.fullProject===true,
          cancelled:()=>cancelled,request:hostPost,clock,
          makeFrame:async i=>{const begin=clock(),sourceFrame=info.startFrame+i;state.current=sourceFrame/fps;const snapshot=playerSnapshot();if(!snapshot)throw Error('场景或相机不可用');await prepareCodeUI(snapshot,width,height);return {id:++bridgeId,index:i,state:snapshot,snapshotMs:clock()-begin};},
          onFrame:(i,reply,row,latencyMs)=>{if(!report)return;const record={index:i,sourceFrame:info.startFrame+i,time:(info.startFrame+i)/fps,snapshotMs:row.snapshotMs,stateRttMs:null,frameRttMs:null,totalMs:null,queueLatencyMs:latencyMs,state:null,frame:reply};if(fullSummary)fullSummary.add(record);else report.frames.push(record);if(diagnostic.cancelAfterFrames&&i+1>=diagnostic.cancelAfterFrames)cancelled=true;},
          onProgress:(done,total)=>{$('#export-bar').value=done/total;$('#export-progress').textContent=`已提交 ${done} / ${total} 帧`;}
        });
        if(report)report.queue=queue;result.queue=queue;
      }else for(let i=0;i<info.frames;i++){
        if(cancelled)break;
        const frameStart=clock(),sourceFrame=(info.startFrame||0)+i;
        state.current=sourceFrame/fps;const snapshot=playerSnapshot();if(!snapshot)throw Error('场景或相机不可用');
        await prepareCodeUI(snapshot,width,height);const evaluatedAt=clock();
        const stateReply=info.mergedFrame?null:await hostPost('state',{...snapshot,id:++bridgeId,...(diagnostic?{profileExport:diagnostic.profile,frameIndex:sourceFrame,runId:diagnostic.runId}:{})}),stateAt=clock();
        const frameReply=await hostPost('export-frame',{id:++bridgeId,index:i,...(info.mergedFrame?{state:snapshot}:{}),...(diagnostic?{frameDigest:!diagnostic.gpuVideo,runId:diagnostic.runId,skipPreRender:diagnostic.skipPreRender===true,gpuColor:diagnostic.gpuColor===true,referenceFrame:!diagnostic.gpuVideo&&diagnostic.references&&[0,Math.floor(info.frames/2),info.frames-1].includes(i)}:{})});
        if(report)report.frames.push({index:i,sourceFrame,time:state.current,snapshotMs:evaluatedAt-frameStart,stateRttMs:stateAt-evaluatedAt,frameRttMs:clock()-stateAt,totalMs:clock()-frameStart,state:stateReply,frame:frameReply});
        if(i%4===0||i+1===info.frames){$('#export-bar').value=(i+1)/info.frames;$('#export-progress').textContent=`已渲染 ${i+1} / ${info.frames} 帧`;}
      }
      result.framesMs=clock()-framesStart;if(report)report.framesMs=result.framesMs;
      if(cancelled){if(report){report.cancelled=true;report.totalMs=clock()-begin;return report;}return;}
      const finishStart=clock();encoding=true;$('#export-cancel').disabled=true;$('#export-progress').textContent='正在完成视频编码…';const finishReply=await hostPost('export-finish',{queueSession});started=false;
      if(report){report.finishMs=clock()-finishStart;report.totalMs=clock()-begin;if(diagnostic.gpuVideo)report.gpuResult=finishReply;}
      if(!cancelled)notify('视频导出完成：'+output);
      result.totalMs=clock()-begin;result.finish=finishReply;return report||result;
    } catch(error){if(!cancelled)throw error;}
    finally {
      if(started){const cancelStart=clock();try{const reply=await hostPost('export-cancel',{queueSession});if(report)report.cancelResult=reply;}catch(error){cleanupError=error.message;if(report)report.cancelError=cleanupError;}if(report)report.cancelMs=clock()-cancelStart;}
      state=originalState;state.current=oldTime;exporting=false;bridgeLast='';closeModal();render();
      if(cleanupError)notify('导出清理未完成：'+cleanupError);else if(cancelled)notify('已取消视频导出');
    }
  }
  if(window.controlAPI) window.controlAPI.onCommand(async(command,args)=>{
    await Promise.all([filmMotionReady,faceMotionReady]);
    if(projectBusy||exporting)throw Error('工作台正忙');
    const number=(value,min,max)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error('数值无效');return value;};
    const str=value=>{if(typeof value!=='string'||!value.length||value.length>4096)throw Error('参数无效');return value;};
    if(command==='state.get')return {document:documentFor(copyState()),playing,dirty:fingerprint()!==savedFingerprint,playerAvailable:performance,characters:Object.fromEntries([['ttmr',true],...Object.keys(actorNames).map(code=>[code,availableActors.has(code)])])};
    if(command==='assets.list'){await Promise.all([costumeReady,uiReady,filmMotionReady,faceMotionReady]);return allAssets().map(({id,type,source,alias,length})=>({id,type,source,alias,...(length!==undefined?{length}:{})}));}
    if(command==='costume.list'){await costumeReady;if(costumeError)throw Error('本地服装清单不可用：'+costumeError);return costumeDefinitions.map(({id,source,alias,character,kind,number,bodyAvailable,dependenciesAvailable,baseFaceAvailable,baseHairAvailable,specificFaceAvailable,specificHairAvailable,knownCharacter,currentDefault,playerAvailable})=>({id,source,alias,character,kind,number,bodyAvailable,dependenciesAvailable,baseFaceAvailable,baseHairAvailable,specificFaceAvailable,specificHairAvailable,knownCharacter,currentDefault,playerAvailable}));}
    if(command==='costume.select'){await costumeReady;if(costumeError)throw Error('本地服装清单不可用：'+costumeError);const asset=costumeDefinitions.find(x=>x.id===str(args.assetId));if(!asset)throw Error('服装候选不存在');state.selected=null;state.selectedClip=null;selectedAsset=asset.id;assetFilter='服装';setBottomTab('assets');render();return {id:asset.id,detail:$('#inspector').textContent};}
    if(command==='costume.thumbnail'){await costumeReady;const asset=costumeDefinitions.find(x=>x.id===str(args.assetId));if(!asset)throw Error('服装候选不存在');return await generateCostumeThumbnail(asset);}
    if(command==='costume.thumbnailStatus'){await costumeReady;const asset=costumeDefinitions.find(x=>x.id===str(args.assetId));if(!asset)throw Error('服装候选不存在');const found=await window.assetAPI.costumeThumbnails([asset.id]);if(found[asset.id])assetThumbs[asset.id]=found[asset.id];return {assetId:asset.id,cached:Boolean(found[asset.id])};}
    if(command==='actor.setCostume'){await costumeReady;if(costumeError)throw Error('本地服装清单不可用：'+costumeError);const objectId=str(args.objectId),assetId=args.assetId===null?'':str(args.assetId);setActorCostume(objectId,assetId);return {objectId,assetId,applied:!state.objects.find(o=>o.id===objectId)?.costumeAssetId,preview:assetId&&costumeSupported?'等待 Player 确认':'基础服装'};}
    if(command==='actor.setIdle'){const object=state.objects.find(o=>o.id===str(args.objectId));if(!idleSupported||!performance||!object||!supportedActor(object))throw Error('角色待机不可用');const assetId=str(args.assetId);if(!motionDefinition(assetId))throw Error('常驻动画素材不可用');const before=copyState();object.idleAssetId=assetId;remember(before);bridgeLast='';render();return {objectId:object.id,assetId};}
    if(command==='scene.propRemove'){const object=state.objects.find(o=>o.id===str(args.objectId));removeClassroomChair(object);return {objectId:args.objectId};}
    if(command==='scene.propAdd'){
      const propId=str(args.propId),object=addClassroomChair(propId);return {objectId:object.id,propId};
    }
    if(command==='actor.add'){
      const asset=assetById(str(args.assetId));if(!asset||!(asset.id==='asset-actor-1'||actorAssets.some(a=>a.id===asset.id)))throw Error('角色素材不可用');
      const count=state.objects.filter(supportedActor).length;if(count>=10)throw Error('角色数量超限');addAssetToScene(asset);return {objectId:state.selected};
    }
    if(command==='object.setTransform'){
      const target=state.objects.find(o=>o.id===str(args.objectId));if(!target||!(supportedActor(target)||supportedProp(target)||target.type==='相机'))throw Error('对象不支持变换');
      const vector=value=>{if(!Array.isArray(value)||value.length!==3)throw Error('变换向量无效');return value.map(x=>number(x,-10000,10000));};
      if(args.position===undefined&&args.rotation===undefined&&args.scale===undefined&&args.fov===undefined)throw Error('缺少变换');if(args.scale!==undefined&&(!gizmoTrsSupported||target.type==='相机'))throw Error('当前对象或 Player 不支持缩放');if(args.fov!==undefined&&target.type!=='相机')throw Error('仅相机支持 FOV');
      const position=args.position===undefined?null:vector(args.position),rotation=args.rotation===undefined?null:vector(args.rotation),scale=args.scale===undefined?null:vector(args.scale).map(x=>number(x,.01,100)),fov=args.fov===undefined?null:number(args.fov,15,90),before=copyState();target.transform ||= {position:[0,0,0],rotation:[0,0,0]};if(position)target.transform.position=position;if(rotation)target.transform.rotation=rotation;if(scale)target.transform.scale=scale;if(fov!==null)target.fov=fov;remember(before);render();return {objectId:target.id};
    }
    if(command==='timeline.transform'){
      const target=state.objects.find(o=>o.id===str(args.objectId));if(!target||!(supportedActor(target)||supportedProp(target)||target.type==='相机'))throw Error('对象不支持变换');const start=number(args.start,0,duration-frame),len=number(args.length,frame,duration-start),properties=args.keys;if(!properties||typeof properties!=='object'||Array.isArray(properties)||!Object.keys(properties).length)throw Error('变换关键帧无效');
      const propertyKeys={};for(const [property,rows] of Object.entries(properties)){if(!['position','rotation','scale','fov','visible'].includes(property)||(property==='scale'&&(!gizmoTrsSupported||target.type==='相机'))||(property==='fov'&&target.type!=='相机')||!Array.isArray(rows)||!rows.length||rows.length>1000)throw Error('变换关键帧无效');propertyKeys[property]=rows.map(k=>{const t=number(k.time,0,len);let value;if(property==='visible'){if(typeof k.value!=='boolean')throw Error('显示状态关键帧无效');value=k.value;}else if(property==='fov')value=number(k.value,15,90);else{if(!Array.isArray(k.value)||k.value.length!==3)throw Error('变换向量无效');value=k.value.map(x=>number(x,property==='scale'?.01:-10000,property==='scale'?100:10000));}return {time:t,value};}).sort((a,b)=>a.time-b.time);if(propertyKeys[property].some((k,i,a)=>i>0&&Math.abs(k.time-a[i-1].time)<frame/2))throw Error('关键帧重叠');}
      const type=target.type==='相机'?'camera':'transform';if(state.tracks.some(t=>t.type===type&&t.target===target.id&&t.clips.some(c=>start<c.start+c.len-1e-6&&start+len>c.start+1e-6)))throw Error('同一对象的变换片段重叠');
      const label=args.name===undefined?comp(type).name:str(args.name);if(label.length>100)throw Error('片段名称过长');const before=copyState(),trackId=id(),clipId=id();if(!target.components.includes(type))target.components.push(type);state.tracks.push({id:trackId,name:`${target.name} · ${label}`,type,target:target.id,clips:[{id:clipId,name:label,start,len,propertyKeys}]});remember(before);render();return {trackId,clipId};
    }
    if(command==='timeline.faceAnimation'){const target=state.objects.find(o=>o.id===str(args.objectId));return insertFaceMotion(target,str(args.assetId),number(args.start,0,duration-frame));}
    if(command==='timeline.addPairedMotion'){const target=state.objects.find(o=>o.id===str(args.objectId));return insertPairedMotion(target,str(args.assetId),number(args.start,0,duration-frame));}
    if(command==='timeline.fade'){
      const found=getClip(str(args.clipId));if(!found||found.track.locked||!['animation','expression'].includes(found.track.type))throw Error('片段不支持渐变或轨道已锁定');const available=fadeSpan(found.clip,found.track.type),fadeIn=number(args.fadeIn??found.clip.fadeIn??0,0,available),fadeOut=number(args.fadeOut??found.clip.fadeOut??0,0,available);if(fadeIn+fadeOut>available+1e-6)throw Error('渐入与渐出不能重叠');const before=copyState();found.clip.fadeIn=fadeIn;found.clip.fadeOut=fadeOut;remember(before);render();return {clipId:found.clip.id,fadeIn,fadeOut,available};
    }
    if(command==='timeline.move'){const found=getClip(str(args.clipId));if(!found)throw Error('片段不存在');const start=number(args.start,0,duration-frame);if(!canEdit(found.clip,start,found.clip.len))throw Error('片段重叠、超出时长或轨道已锁定');const before=copyState();setClipTiming(found.clip,start,found.clip.len);remember(before);render();return {clipId:found.clip.id,start};}
    if(command==='timeline.visemeKey'){const clipId=str(args.clipId),property=str(args.property),index=number(args.index,0,9999),value=number(args.value,0,100);setVisemeKeyValue(clipId,property,index,value);return {clipId,property,index,value};}
    if(command==='timeline.visemeShape'){const clipId=str(args.clipId),vowel=str(args.vowel),name=str(args.name);setVisemeShape(clipId,vowel,name);return {clipId,vowel,name};}
    if(command==='timeline.visemeAt'){const clipId=str(args.clipId),property=str(args.property),found=getClip(clipId);if(!found||found.track.locked||!found.clip.lipVisemes||!/^viseme_[aiueo]$/.test(property))throw Error('口型片段不可编辑');const time=Math.min(found.clip.len,quantize(number(args.time,0,found.clip.len))),value=number(args.value,0,100),before=copyState(),keys=found.clip.propertyKeys?.[property];if(!Array.isArray(keys))throw Error('口型通道不存在');let key=keys.find(k=>Math.abs(k.time-time)<frame/2);if(key)key.value=value;else keys.push({time,value});keys.sort((a,b)=>a.time-b.time);remember(before);render();return {clipId,property,time,value};}
    if(command==='timeline.add'){
      const target=state.objects.find(o=>o.id===str(args.objectId));if(!target||!supportedActor(target))throw Error('角色不存在');
      const type=args.type;if(!['animation','expression'].includes(type))throw Error('不支持的轨道类型');
      const assetId=str(args.assetId),definition=type==='animation'?motionDefinition(assetId):shapeForActor(target,assetId);if(!definition)throw Error('素材不可用');if(definition.isAdditive)throw Error('原生增量动作请拖入动画叠加层');
      const start=number(args.start,0,duration-frame),len=type==='animation'&&args.length===undefined?motionClipLength(definition):number(args.length,frame,duration-start);if(start+len>duration+1e-6)throw Error('当前演出剩余时长不足');if(type==='animation'&&args.loop===true)throw Error('动作片段只播放一次；循环请设置角色常驻动画');let keys;
      if(type==='expression'&&args.keys!==undefined){if(!Array.isArray(args.keys)||args.keys.length>1000)throw Error('关键帧无效');keys=args.keys.map(k=>({time:number(k.time,0,len),value:number(k.value,0,100)}));keys.sort((a,b)=>a.time-b.time);if(keys.some((k,i)=>i>0&&Math.abs(k.time-keys[i-1].time)<frame/2))throw Error('关键帧重叠');}
      const before=copyState(),trackId=id(),clipId=id(),clip={id:clipId,name:assetDisplay(definition),assetId,start,len,...(type==='expression'?{weight:args.weight===undefined?80:number(args.weight,0,100),...(keys?.length?{propertyKeys:{weight:keys}}:{})}:{loop:false})};
      if(!target.components.includes(type))target.components.push(type);state.tracks.push({id:trackId,name:`${target.name} · ${comp(type).name}`,type,target:target.id,clips:[clip]});remember(before);render();return {trackId,clipId};
    }
    if(command==='audio.listFilm')return await window.controlAPI.filmAudioList();
    if(command==='audio.importFilm'){
      const ids=args.ids;if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(x=>typeof x!=='string'))throw Error('素材选择无效');const projectId=state.projectId,result=await window.controlAPI.importFilmAudio(ids,projectId);if(state.projectId!==projectId)throw Error('工程已切换，导入结果未应用');await importResult(result);return result;
    }
    if(command==='audio.add'){
      const asset=assetById(str(args.assetId));if(!asset?.scope||!['音乐','音效'].includes(asset.type))throw Error('音频素材不可用');if(args.loop!==undefined&&typeof args.loop!=='boolean')throw Error('循环设置无效');const loop=args.loop===true,start=number(args.start,0,duration-frame),offset=args.offset===undefined?0:number(args.offset,0,3600);let len,truncated=false;
      if(args.length===undefined){const measured=await audioClipLength(asset,start,offset,loop);len=measured.length;truncated=measured.truncated;}else len=number(args.length,frame,duration-start);
      const volume=args.volume===undefined?1:number(args.volume,0,1),fadeIn=args.fadeIn===undefined?0:number(args.fadeIn,0,len),fadeOut=args.fadeOut===undefined?0:number(args.fadeOut,0,len);
      const before=copyState(),trackId=id(),clipId=id();state.tracks.push({id:trackId,name:assetDisplay(asset),type:'audio',target:'scene',clips:[{id:clipId,name:assetDisplay(asset),assetId:asset.id,start,len,volume,fadeIn,fadeOut,sourceOffset:offset,...(loop?{audioLoop:true}:{})}]});remember(before);render();return {trackId,clipId,length:len,truncated,loop};
    }
    if(command==='audio.setLoop'){const clipId=str(args.clipId);setAudioLoop(clipId,args.loop);return {clipId,loop:args.loop};}
    if(command==='audio.setOriginalLoop'){const clipId=str(args.clipId);await setOriginalAudioLoop(clipId,args.enabled);return {clipId,enabled:args.enabled};}
    if(command==='dialogue.add'){
      const target=state.objects.find(o=>o.id===str(args.objectId));if(!target)throw Error('说话对象不存在');const speaker=str(args.speaker),text=str(args.text);if(speaker.length>100||text.length>500)throw Error('对白过长');const len=number(args.length,frame,3600),style=args.style??defaultDialogueStyle(),index=args.index===undefined?CreatorStory.insertionIndex(state,number(args.start??state.current,0,3600)):number(args.index,0,CreatorStory.units(state).length);
      return addStoryDialogue(target.id,speaker,text,len,style,index);
    }
    if(command==='voice.list'){const result=await window.voiceAPI.list();voiceSources=result.voices;voiceWarnings=result.warnings;renderAssetBrowser();return result;}
    if(command==='dialogue.cook'){
      const dialogue=state.dialogues.find(d=>d.id===str(args.dialogueId));if(!dialogue)throw Error('对白不存在');const source=voiceSources.find(v=>v.id===str(args.voiceId)),style=source?.styles.find(x=>String(x.id)===String(args.styleId));if(!source||!style||source.available===false)throw Error('音源或语气不可用，请先读取音源');const language=args.language||'all_ja';if(!['all_ja','zh'].includes(language))throw Error('语言无效');
      const reference={id:source.id,provider:source.voiceProvider,name:source.source,styleId:style.id,styleName:style.name,model:style.model||'',modelId:style.modelId||'',version:style.version||source.version||''};return await cookOneDialogue(dialogue.id,reference,language);
    }
    if(command==='dialogue.lipSync'){if(args.replace!==undefined&&typeof args.replace!=='boolean')throw Error('更新参数无效');return await generateLipSync(str(args.audioClipId),args.replace===true,args.mode||'amplitude');}
    if(command==='dialogue.lipSyncStatus'){const found=getClip(str(args.clipId));if(!found?.clip?.lipSyncSource)throw Error('口型片段不存在');return {outdated:lipSyncOutdated(found.clip)};}
    if(command==='story.update'){
      const unitId=str(args.unitId);const ok=storyTransaction(s=>{const u=CreatorStory.units(s).find(u=>u.id===unitId);if(!u)throw Error('剧情段落不存在');for(const key of ['before','after','gap','at','contentLength','placement','name'])if(args[key]!==undefined)u[key]=args[key];if(args.index!==undefined)CreatorStory.reorder(s,unitId,number(args.index,0,CreatorStory.units(s).length-1));},'已更新剧情排时');if(!ok)throw Error('剧情排时未应用，详见消息');return {ok:true};
    }
    if(command==='story.bind'){const clipId=str(args.clipId);if(!storyTransaction(s=>CreatorStory.bind(s,[clipId],args.binding||null),'已更新剧情绑定'))throw Error('绑定未应用，详见消息');return {ok:true};}
    if(command==='story.delete'){if(!storyTransaction(s=>removeStoryUnit(s,str(args.unitId)),'已删除剧情段落'))throw Error('删除未应用');return {ok:true};}
    if(command==='story.addBlock'){let unitId=id();if(!storyTransaction(s=>CreatorStory.insertBlock(s,number(args.index,0,CreatorStory.units(s).length),unitId,args.kind==='action'?'action':'pause',number(args.length,frame,3600)),'已添加剧情段落'))throw Error('添加未应用');return {unitId};}
    if(command==='story.retryVoices'){await applyPendingVoices();return {ok:true};}
    if(command==='history.undo'){if(!undoStack.length)throw Error('没有可撤销的操作');historyUndo();return {ok:true};}
    if(command==='history.redo'){if(!redoStack.length)throw Error('没有可重做的操作');historyRedo();return {ok:true};}
    if(command==='project.settings'){
      if(args.exportSupersampling!==undefined&&![1,2].includes(args.exportSupersampling))throw Error('导出超采样无效');
      if(args.render!==undefined)CreatorRenderSettings.normalize(args.render);
      const renderUpdate=args.render===undefined?null:CreatorRenderSettings.normalize({...state.globalSettings.render,...args.render});
      const durationValue=number(args.duration,1,3600);if(![24,25,30,60].includes(args.fps)||!['16:9','9:16','1:1','4:3'].includes(args.aspect))throw Error('演出设置无效');const before=copyState(),next=structuredClone(before);Object.assign(next.globalSettings,{duration:durationValue,fps:args.fps,aspect:args.aspect},renderUpdate?{render:renderUpdate}:{},args.exportSupersampling!==undefined?{exportSupersampling:args.exportSupersampling}:{});next.current=Math.min(next.current,durationValue);if(CreatorStory.units(next).length)CreatorStory.reflow(next,before);state=next;setPlaying(false);remember(before);render();return {settings:state.globalSettings};
    }
    if(command==='project.physics'){
      if(!physicsAvailable)throw Error('当前会话未加载物理资源');
      const current=CreatorRenderSettings.physicsMode(state.globalSettings);
      let mode=args.mode;
      if(mode===undefined){
        if(typeof args.enabled!=='boolean')throw Error('物理开关无效');
        mode=args.enabled?(current==='none'?'quartz':current):'none';
      }
      const next=CreatorRenderSettings.physicsSettings(mode);
      if(args.enabled!==undefined && args.enabled!==next.physicsEnabled)throw Error('物理方式与开关不一致');
      CreatorRenderSettings.physicsPacket(next,physicsAvailable,physicsModesSupported);
      if(current!==mode){const before=copyState();Object.assign(state.globalSettings,next);remember(before);render();}
      return {enabled:next.physicsEnabled,mode};
    }
    if(command==='preview.seek'){
      if(unsupportedScale())throw Error('当前 Player 不支持工程缩放，请使用新版三轴实验入口');if(missingProps())throw Error('当前 Player 不支持工程中的教室道具');if(actorUnavailable())throw Error('角色素材不可用：'+actorUnavailable().name);if(performance&&!idleSupported)throw Error('当前 Player 不支持角色常驻动画');if(missingIdle())throw Error('常驻动画素材不可用：'+missingIdle().name);setPlaying(false);state.current=number(args.time,0,duration);render();if(missingScene())throw Error('场景素材不可用：'+missingScene());const missing=state.tracks.filter(t=>t.type==='animation'&&t.enabled!==false).flatMap(t=>t.clips).find(c=>clipActive(c)&&!motionDefinition(c.assetId));if(missing)throw Error('动作素材不可用：'+missing.name);
      const deadline=Date.now()+10000;while(bridgeBusy||bridgePending){if(Date.now()>deadline)throw Error('预览连接繁忙');await new Promise(r=>setTimeout(r,20));}
      await Promise.all(prepareLayerFaces());const snapshot=playerSnapshot();if(!snapshot)throw Error('场景或相机不可用');const reply=await hostPost('state',{...snapshot,id:++bridgeId});return {time:state.current,applied:reply.ok,snapshot,...(Array.isArray(reply.physicsMetrics)?{physicsMetrics:reply.physicsMetrics}:{}),...(pendingCostume()?{costumePending:true,warning:'所选服装尚未应用，预览为基础服'}:{})};
    }
    if(command==='preview.capture'){const width=number(args.width??640,64,1024),height=number(args.height??640,64,1024);if(!Number.isInteger(width)||!Number.isInteger(height))throw Error('截图尺寸无效');gizmoPollPaused=true;try{while(bridgeBusy||bridgePending)await new Promise(r=>setTimeout(r,20));const result=await hostPost('capture',{id:++bridgeId,width,height});if(!result.ok||typeof result.dataUrl!=='string')throw Error('截图失败');return {dataUrl:result.dataUrl};}finally{gizmoPollPaused=false;}}
    if(command==='project.saveNew'){
      if(args.saveLayout!==undefined&&typeof args.saveLayout!=='boolean')throw Error('布局保存参数无效');const layout=args.saveLayout?window.CreatorPanelLayout.snapshot():projectLayout;const file=str(args.path),snapshot=copyState(),saved=fingerprint(snapshot);setPlaying(false);const result=await window.controlAPI.saveNew(file,documentFor(snapshot,layout));projectLayout=layout;projectName=result.name;savedFingerprint=saved;updateProjectLabel();return result;
    }
    if(command==='project.new'){
      if(fingerprint()!==savedFingerprint&&args.discard!==true)throw Error('当前工程有未保存的更改');await window.projectAPI.forget();applyProject(newProjectState(),'未命名原型工程');return {created:true};
    }
    if(command==='project.load'){
      if(fingerprint()!==savedFingerprint&&args.discard!==true)throw Error('当前工程有未保存的更改');if(args.layout!==undefined&&!['project','current'].includes(args.layout))throw Error('布局选择无效');const result=await window.controlAPI.load(str(args.path)),layout=result.document.uiLayout,conflict=layoutConflict(layout);if(layout&&args.layout==='project')window.CreatorPanelLayout.apply(layout);applyProject(result.document.state,result.name,layout);return {name:result.name,layoutConflict:conflict,layoutApplied:Boolean(layout&&args.layout==='project')};
    }
    if(command==='video.export'){
      if(!videoExport||!['720','1080'].includes(args.quality))throw Error('导出设置不可用');setPlaying(false);const output=await window.controlAPI.checkOutput(str(args.path));return await exportMovie(output,args.quality,true,null,args.mode??'gpu');
    }
    if(command==='video.benchmark'){
      if(!videoExport||state.compositionVersion!==1||!['720','1080'].includes(args.quality))throw Error('诊断区间需要图层合成工程与有效导出分辨率');
      const fullProject=args.fullProject===true;
      if(args.fullProject!==undefined&&typeof args.fullProject!=='boolean'||fullProject&&(args.gpuVideo!==true||args.mergedFrame!==true||![4,8].includes(args.queueCapacity)))throw Error('完整工程诊断需要合并 GPU 和 4/8 帧队列');
      const {startFrame,endFrame}=args,preRollFrames=args.preRollFrames??30;
      if(fullProject&&(startFrame!==0||endFrame!==Math.ceil(duration*fps)))throw Error('完整工程诊断必须覆盖全部帧');
      if(!Number.isSafeInteger(startFrame)||!Number.isSafeInteger(endFrame)||startFrame<0||endFrame<=startFrame||endFrame>Math.ceil(duration*fps)||endFrame-startFrame>(fullProject?216000:args.gpuVideo===true&&args.mergedFrame===true?1800:300)||!Number.isSafeInteger(preRollFrames)||preRollFrames<0||preRollFrames>300)throw Error('诊断区间或预采样超出当前模式限制');
      if(args.profile!==undefined&&typeof args.profile!=='boolean'||args.references!==undefined&&typeof args.references!=='boolean'||args.skipPreRender!==undefined&&typeof args.skipPreRender!=='boolean'||args.gpuColor!==undefined&&typeof args.gpuColor!=='boolean'||args.gpuVideo!==undefined&&typeof args.gpuVideo!=='boolean'||args.mergedFrame!==undefined&&typeof args.mergedFrame!=='boolean'||args.mergedFrame===true&&args.gpuVideo!==true)throw Error('诊断参数无效');
      if(args.queueCapacity!==undefined&&(![0,1,4,8].includes(args.queueCapacity)||args.queueCapacity>0&&args.mergedFrame!==true))throw Error('队列诊断参数无效');
      if(args.queueCapacity&&(args.skipPreRender||args.gpuColor))throw Error('队列诊断暂不支持其他渲染变体');
      if(args.cancelAfterFrames!==undefined&&(!args.queueCapacity||!Number.isSafeInteger(args.cancelAfterFrames)||args.cancelAfterFrames<1||args.cancelAfterFrames>=endFrame-startFrame))throw Error('取消诊断参数无效');
      const runId=args.runId===undefined?id():str(args.runId),label=args.label===undefined?'':str(args.label);
      if(!/^[0-9A-Za-z_-]{1,80}$/.test(runId)||label.length>80)throw Error('诊断标识无效');
      setPlaying(false);const output=await window.controlAPI.checkOutput(str(args.path));
      return await exportMovie(output,args.quality,true,{runId,label,startFrame,endFrame,preRollFrames,profile:args.profile!==false,references:args.gpuVideo!==true&&args.references===true,skipPreRender:args.skipPreRender===true,gpuColor:args.gpuColor===true,gpuVideo:args.gpuVideo===true,mergedFrame:args.mergedFrame===true,queueCapacity:args.queueCapacity||0,cancelAfterFrames:args.cancelAfterFrames||0,fullProject});
    }
    if(command==='session.close'){
      if(fingerprint()!==savedFingerprint&&args.discard!==true)throw Error('当前工程有未保存的更改');setTimeout(()=>window.controlAPI.close(),100);return {closing:true};
    }
    throw Error('未知控制命令');
  });
  if(desktop){
    $('#new-project').hidden=false;$('#open-project').hidden=false;$('#export-label').textContent='另存为';
    $('#new-project').onclick=()=>projectAction(async()=>{if(!await mayLeave())return;await window.projectAPI.forget();applyProject(newProjectState(),'未命名原型工程');notify('已新建工程');});
    $('#open-project').onclick=()=>projectAction(async()=>{if(!await mayLeave())return;const result=await window.projectAPI.open();if(!result)return;const layout=result.document.uiLayout;if(layoutConflict(layout)){const choice=await chooseLayout('工程布局与当前布局不同','请选择使用工程中保存的布局，或保留当前界面布局。',[{label:'使用工程布局',value:'project'},{label:'保留当前布局',value:'current'}]);if(choice==='project')window.CreatorPanelLayout.apply(layout);}applyProject(result.document.state,result.name,layout);notify('工程已打开');});
    $('#save-project').onclick=()=>projectAction(()=>saveProject(false));
    $('#export-project').onclick=()=>projectAction(()=>saveProject(true));
    window.projectAPI.onMenu(name=>{if(exporting||translationCooking)return;const buttons={new:'#new-project',open:'#open-project',save:'#save-project','save-as':'#export-project',undo:'#undo',redo:'#redo'};if(['undo','redo','copy','paste'].includes(name)&&document.activeElement?.matches('input,textarea,[contenteditable=true]')){window.projectAPI.edit(name);return;}if(name==='export-video')openVideoExport();else if(name==='game-inventory')openGameInventory();else if(['editor-settings','pronunciation-settings','translation-settings'].includes(name))openEditorSettings();else if(name==='project-settings')openProjectSettings();else if(name==='reset-layout')window.CreatorPanelLayout?.reset();else if(name==='translate-script')openScriptTranslation();else if(name==='copy'||name==='paste')document.body.dispatchEvent(new KeyboardEvent('keydown',{key:name==='copy'?'c':'v',ctrlKey:true,bubbles:true}));else if(buttons[name])$(buttons[name]).click();});
    window.projectAPI.onCloseRequest(async()=>{if(projectBusy){window.projectAPI.closeResult(false);return;}projectBusy=true;let approved=false;try{approved=await mayLeave();}catch(e){projectError(e);}finally{projectBusy=false;window.projectAPI.closeResult(approved);}});
    setInterval(updateProjectLabel,2000);
  }else{
    $('#save-project').onclick=()=>{try{localStorage.setItem('creator-bridge-prototype-v1',JSON.stringify(state));notify('已保存到当前浏览器');}catch(e){notify('浏览器无法保存本地数据');}};
    $('#export-project').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='演出原型-工程.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('已导出演示工程 JSON');};
  }
  async function openStartupProject(){
    if(!desktop||!window.projectAPI.startup)return;
    const initialState=state,initialFingerprint=fingerprint();
    await Promise.all([filmMotionReady,faceMotionReady,costumeReady,uiReady]);
    if(document.readyState==='loading')await new Promise(resolve=>window.addEventListener('DOMContentLoaded',resolve,{once:true}));
    if(state!==initialState||fingerprint()!==initialFingerprint){notify('已保留当前编辑，未自动载入启动工程');return;}
    await projectAction(async()=>{
      const result=await window.projectAPI.startup();if(!result)return;
      if(state!==initialState||fingerprint()!==initialFingerprint){await window.projectAPI.startupDone(false);notify('已保留当前编辑，未自动载入启动工程');return;}
      try{const layout=result.document.uiLayout;if(layout)window.CreatorPanelLayout?.apply(layout);applyProject(result.document.state,result.name,layout);await window.projectAPI.startupDone(true);notify('启动工程已自动打开');}
      catch(error){await window.projectAPI.startupDone(false);throw error;}
    });
  }
  storyUI=CreatorStoryEditor({state:()=>state,getClip,esc,id,modal:showModal,close:closeModal,transact:storyTransaction,remove:removeStoryUnit,addDialogue:openDialogueModal,retryPending:applyPendingVoices,select:key=>{closeModal();selectedAsset=null;setBottomTab('timeline');setTimelineSelection([key]);window.CreatorPanelLayout?.activate('inspector');}});
  storyVoice=CreatorStoryVoice({state:()=>state,asset:assetById,url:mediaUrl,id,supported:o=>supportedActor(o)&&shapeForActor(o,'asset-local-mouth'),shape:(o,name)=>shapeForActor(o,faceIdForName(name)),commit:commitStoryVoice,retain:retainStoryVoice});
  $('#story-manage').onclick=()=>{commitInspectorInput();setPlaying(false);storyUI.manage();};
  render();resizeTimeline();updateHistoryButtons();savedFingerprint=fingerprint();updateProjectLabel();
  if(desktop){loadShared();loadOriginalLoopCatalog();loadVoiceLibrary();loadPronunciation();filmMotionReady=loadFilmMotions();faceMotionReady=loadFaceMotions();costumeReady=loadCostumes();for(const a of state.assets)loadAssetPreview(a);if(assetFeatures){window.assetAPI.thumbnails().then(saved=>{Object.assign(assetThumbs,saved);renderAssetBrowser();if(!saved['asset-actor-1'])setTimeout(()=>bakeThumbnail(assetById('asset-actor-1')),1000);if(performance&&!saved['scene-'+state.sceneId])setTimeout(()=>bakeThumbnail(assetById('scene-'+state.sceneId)),1800);}).catch(e=>notify('缩略图缓存读取失败：'+e.message));}}
  openStartupProject().catch(projectError);
})();

