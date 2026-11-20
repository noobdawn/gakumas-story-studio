'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const store = require('../project-store');

// Run the actual workbench with isolated media, catalogs and preview transport.
function fixtureServices() {
  window.q = selector => document.querySelector(selector);
  window.projectAPI = {onMenu(){}, onCloseRequest(){}};
  window.controlAPI = {
    onCommand(fn){ window.command = (name, args = {}) => fn(name, args); },
    load(){ return {name:'属性检查', document:structuredClone(window.fixtureDocument)}; }
  };
  const shared = [
    {id:'sound-a',type:'音乐',source:'a.wav',alias:'旧音乐',extension:'.wav'},
    {id:'sound-b',type:'音效',source:'b.wav',alias:'铃声',extension:'.wav'},
    {id:'picture',type:'贴图',source:'still.png',alias:'背景图',extension:'.png',visual:{kind:'image',width:16,height:9}},
    {id:'movie',type:'视频',source:'movie.mp4',alias:'视频素材',extension:'.mp4',visual:{kind:'video',width:16,height:9,fps:30,duration:10,hasAudio:true}}
  ].map(a=>({...a,scope:'shared'}));
  window.assetAPI = {
    listShared:async()=>shared,visualInfo:async a=>shared.find(x=>x.id===a.id).visual,
    preview:async()=>'',thumbnails:async()=>({'asset-actor-1':'test','scene-trainingroom':'test'})
  };
  window.Audio = class {
    duration = 4;
    load(){ if(this.onloadedmetadata)queueMicrotask(()=>this.onloadedmetadata?.()); }
    removeAttribute(){}
  };
  const faces = ['smile','frown','pending','unusable'].map((name,i)=>({
    name:'fixture_'+name+'_f',id:'asset-face-motion-fixture_'+name+'_f',length:2,
    channels:[{shape:i===3?'b_eye.eye_099':i===1?'b_brow.brow_001':'b_eye.eye_001',keys:[{time:0,value:100}]}]
  }));
  const transition = name=>({id:name,source:name,alias:'转场 '+name,renderer:'titan-ui-graph-v2',inDuration:.3,hold:.4,outDuration:.3});
  window.fetch = async (url,init) => {
    const endpoint=String(url).split('/').pop();
    let data=[];
    if(endpoint==='face-motions')data=faces.map(({channels,...row})=>row);
    else if(endpoint.startsWith('asset-face-motion-')){
      if(endpoint.includes('pending'))await new Promise(resolve=>window.finishFaceRead=resolve);
      data=faces.find(a=>a.id===endpoint);
    }else if(endpoint==='ui-transitions')data={entries:['wipe','fade'].map(transition)};
    else if(endpoint==='state'){
      window.lastPacket=JSON.parse(init.body);
      data={ok:true,id:window.lastPacket.id,sceneReady:true};
    }
    return new Response(JSON.stringify(data),{status:200});
  };
  window.setField=(selector,value)=>{
    const input=q(selector);
    if(input.type==='checkbox')input.checked=value;else input.value=value;
    input.dispatchEvent(new Event('change',{bubbles:true}));
  };
}

module.exports=async function(win,ui,temp) {
  async function js(code){
    const result=await win.webContents.executeJavaScript(`Promise.resolve().then(()=>eval(${JSON.stringify(code)})).then(value=>({value}),error=>({error:error.stack}))`);
    if(result.error)throw Error(code.slice(0,140)+'\n'+result.error);
    return result.value;
  }
  const filename=path.join(temp,'clip-inspector.html');
  const html=fs.readFileSync(path.join(ui,'index.html'),'utf8')
    .replace('<head>','<head><base href="'+pathToFileURL(ui+path.sep).href+'">')
    .replace('<script src="./classroom-props.js"></script>','')
    .replace('<script src="./app.js"></script>',()=>'<script>('+fixtureServices.toString()+')()</script><script src="./app.js"></script>');
  fs.writeFileSync(filename,html);
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1150,height:780,deviceScaleFactor:1,mobile:false});
  await win.loadFile(filename,{query:{performance:'1',faces:'1',animationLayers:'1',faceDecals:'1',arrangement:'1',
    faceNames:['b_eye.eye_001','b_eye.eye_099','b_brow.brow_001',...'001 002 003 004 008 010 012'.split(' ').map(n=>'b_mouth.mouth_'+n)].join(','),
    missingShapes:'ttmr:b_eye.eye_099',assets:'1',motions:'idle,shy',scenes:'classroom,trainingroom',uiTransitions:'2',
    composition:'1',postEffects:'1',gizmoTrs:'1',codeUI:'1',physics:'1',physicsModes:'1'}});
  const fixture=await js(`(async()=>{
    await command('assets.list');
    const doc=(await command('state.get')).document,s=doc.state;
    s.current=1;s.selected=s.selectedClip=null;
    s.objects.push({id:'picture-layer',name:'画面层',type:'画面',icon:'image',parent:'scene',components:['media']});
    s.assets.push(...['smile','frown'].map((name,i)=>({id:'asset-face-motion-fixture_'+name+'_f',alias:i?'皱眉':'微笑',source:'fixture_'+name+'_f',type:'表情'})));
    const row=(type,id,target,payload,props={})=>({type,id:'track-'+id,target,name:id,...props,clips:[{id,name:'自定义 '+id,start:0,len:3,...payload}]});
    s.dialogues=[{id:'line',speaker:'手毬',text:'人工对白',voice:'sound-a',linked:true}];
    const lipSyncSource={audioClipId:'speech',signature:'initial'};
    s.tracks=[
      row('expression','face','ttmr',{assetId:s.assets.at(-2).id,sourceOffset:.25,fadeIn:.2,fadeOut:.4,playback:'hold',propertyKeys:{weight:[{time:0,value:65}]},storyTiming:{start:{unitId:'@story',edge:'start',offset:0},keys:'keep'}},{layerRole:'base'}),
      row('animation','motion','ttmr',{assetId:'asset-local-idle',layerPlayback:true},{layerRole:'base'}),
      row('scene','scene-cut','scene',{assetId:'scene-classroom'}),
      row('audio','sound','scene',{assetId:'sound-a',volume:.35,audioLoop:true,sourceOffset:.5,originalLoop:{start:2,end:6,frames:8,sampleRate:8000,sha256:'a'.repeat(64)},audioEffects:[CreatorPostEffects.audio('telephone','phone')]}),
      row('camera','camera','cam',{}),row('transform','trs','ttmr',{}),
      row('media','picture-clip','picture-layer',{assetId:'picture',start:10,mediaLayout:{opacity:.75},mediaKeys:{x:[{time:0,value:.1}]}}),
      row('dialogue','subtitle','ttmr',{dialogue:'line',start:5}),row('audio','speech','ttmr',{dialogue:'line',start:5}),
      row('expression','amplitude','ttmr',{assetId:'asset-local-mouth',start:5,lipMode:'amplitude',lipSyncSource,propertyKeys:{weight:[{time:0,value:10}]}}),
      row('expression','vowels','ttmr',{assetId:'asset-local-mouth',start:9,lipSyncSource,lipMode:'manual',lipVisemes:{a:'b_mouth.mouth_099',i:'b_mouth.mouth_004',u:'b_mouth.mouth_010',e:'b_mouth.mouth_012',o:'b_mouth.mouth_008'}}),
      row('ui','transition','scene',{uiKind:'transition',assetId:'wipe',start:10}),
      row('ui','code','scene',{uiKind:'code',codeUI:{...CreatorCodeUI.template},start:10}),
      row('visualFilter','filter','scene',{visualEffect:CreatorPostEffects.visual('memory'),start:10}),
      row('visualEffect','effect','scene',{visualEffect:CreatorPostEffects.visual('television'),start:10}),
      row('post','legacy-post','scene',{}, {enabled:false}),
      {id:'world',target:'scene',type:'world',name:'演出画面',clips:[]}
    ];
    return doc;
  })()`);
  const snapshot=()=>js("command('state.get').then(r=>r.document)");
  const load=async(doc,selected=doc.state.selectedClip)=>{
    doc=structuredClone(doc);doc.state.selected=null;doc.state.selectedClip=selected;
    await js('window.fixtureDocument='+JSON.stringify(doc)+";command('project.load',{path:'fixture',discard:true})");
  };
  const clip=(doc,id)=>doc.state.tracks.flatMap(t=>t.clips).find(c=>c.id===id);
  const click=selector=>js('q('+JSON.stringify(selector)+').click()');
  const set=(selector,value)=>js('setField('+JSON.stringify(selector)+','+JSON.stringify(value)+')');
  const apply=key=>js(`q('#${key}-picker-apply').onclick()`);
  const check=async(id,selectors)=>{
    await load(fixture,id);
    for(const selector of selectors)assert.ok(await js(`!!q(${JSON.stringify(selector)})`),id+' '+selector);
  };

  await load(fixture,null);
  await js(`for(let b=q('[data-group-toggle][aria-expanded="false"]');b;b=q('[data-group-toggle][aria-expanded="false"]'))b.click();
    q('[data-track="track-face"]').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  const point=await js(`(()=>{const r=q('[data-clip="face"]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height*.6};})()`);
  for(const type of ['mousePressed','mouseReleased'])await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point});
  assert.equal(await js("q('.clip-motion-name').textContent"),'微笑');
  assert.equal(await js("q('.clip-motion-original code').textContent"),'fixture_smile_f');
  assert.equal(await js("q('#clip-name').value"),'自定义 face');
  const before=await snapshot(), old=clip(before,'face');
  await click('#clip-expression-replace');
  await js("q('#expression-picker-search').value='fixture_frown';q('#expression-picker-search').oninput();q('[data-expression-pick]').click()");
  await click('#expression-picker-cancel');
  assert.deepEqual(clip(await snapshot(),'face'),old);
  await click('#clip-expression-replace');
  await click('[data-expression-pick="asset-face-motion-fixture_frown_f"]');
  await apply('expression');
  const after=await snapshot();
  assert.deepEqual(clip(after,'face'),{...old,assetId:'asset-face-motion-fixture_frown_f',sourceOffset:0,weight:100});
  assert.equal(after.state.tracks.length,before.state.tracks.length);
  assert.equal(await js("window.lastPacket?.actorInstances[0]?.faceShapes?.find(x=>x.name==='b_brow.brow_001')?.weight"),.65,await js("q('#bridge-status').textContent"));
  await js("command('history.undo')");assert.equal(await js("q('.clip-motion-name').textContent"),'微笑');
  await js("command('history.redo')");assert.equal(await js("q('.clip-motion-name').textContent"),'皱眉');
  const saved=path.join(temp,'test-project.json');
  const previousLibrary=process.env.CREATOR_LIBRARY_DIR;
  try{
    process.env.CREATOR_LIBRARY_DIR=path.join(temp,'fixture-library');
    await store.writeNew(saved,after);
  }finally{
    if(previousLibrary===undefined)delete process.env.CREATOR_LIBRARY_DIR;else process.env.CREATOR_LIBRARY_DIR=previousLibrary;
  }
  await load((await store.read(saved)).doc);
  assert.equal(await js("q('.clip-motion-original code').textContent"),'fixture_frown_f');
  await set('#layer-playback','loop');await set('#clip-source-offset',.4);
  assert.equal(clip(await snapshot(),'face').playback,'loop');
  assert.equal(clip(await snapshot(),'face').sourceOffset,.4);

  // Generated labels follow the source. A manually edited label can also equal the old asset name.
  const beforeNaming=await snapshot(),named=structuredClone(fixture);
  clip(named,'face').name='微笑';
  await load(named,'face');
  await click('#clip-expression-replace');await click('[data-expression-pick="asset-face-motion-fixture_frown_f"]');await apply('expression');
  assert.equal(clip(await snapshot(),'face').name,'皱眉');
  await set('#clip-name','排练备注');await set('#clip-name','皱眉');
  await click('#clip-expression-replace');await click('[data-expression-pick="asset-face-motion-fixture_smile_f"]');await apply('expression');
  assert.equal(clip(await snapshot(),'face').name,'皱眉');
  await load(beforeNaming,'face');

  // No mutation after cancel, a late lock, a project switch, or failed channel preparation.
  const openPending=async()=>{
    await click('#clip-expression-replace');await click('[data-expression-pick="asset-face-motion-fixture_pending_f"]');
    await js("window.pendingApply=q('#expression-picker-apply').onclick();void 0");
  };
  await openPending();await click('#expression-picker-cancel');await js('finishFaceRead();pendingApply');
  assert.equal(clip(await snapshot(),'face').assetId,'asset-face-motion-fixture_frown_f');
  await click('#clip-expression-replace');await click('[data-expression-pick="asset-face-decal.Pale"]');
  await click('[data-track-lock="track-face"]');await apply('expression');
  assert.match(await js("q('#expression-picker-error').textContent"),/锁定/);
  await click('#expression-picker-cancel');assert.equal(await js("q('#clip-expression-replace').disabled"),true);
  await click('[data-track-lock="track-face"]');await click('#clip-expression-replace');
  await click('[data-expression-pick="asset-face-motion-fixture_unusable_f"]');await apply('expression');
  assert.ok(await js("q('#expression-picker-error').textContent.length"));
  await click('[data-expression-pick="asset-face-decal.Pale"]');await load(fixture,'face');await apply('expression');
  assert.match(await js("q('#expression-picker-error').textContent"),/工程或片段/);await click('#expression-picker-cancel');
  const missing=structuredClone(fixture);clip(missing,'face').assetId='missing-face';
  await load(missing,'face');assert.match(await js("q('.clip-motion-source').textContent"),/missing-face/);
  await click('#clip-expression-replace');await set('#expression-picker-kind','effect');await click('[data-expression-pick="asset-face-decal.Pale"]');await apply('expression');
  assert.equal(clip(await snapshot(),'face').assetId,'asset-face-decal.Pale');
  await check('vowels',['[data-viseme-map="a"]','[data-viseme-slider="a"]','[data-inspect-related="speech"]']);
  assert.equal(await js(`q('[data-viseme-map="a"]').value`),'b_mouth.mouth_099');
  await set('[data-viseme-map="a"]','b_mouth.mouth_003');assert.equal(clip(await snapshot(),'vowels').lipVisemes.a,'b_mouth.mouth_003');
  await click('[data-inspect-related="speech"]');assert.ok(await js("!!q('#lip-mode')"));
  await check('amplitude',['#clip-expression-replace','#expression-key']);
  await click('#clip-expression-replace');assert.equal(await js("!!q('[data-expression-pick=\"asset-face-decal.Pale\"]')"),false);
  await click('[data-expression-pick="asset-face-b_mouth.mouth_002"]');await apply('expression');
  assert.equal(clip(await snapshot(),'amplitude').lipEdited,true);

  await check('scene-cut',['#clip-scene-replace']);
  await click('#clip-scene-replace');await click('[data-scene-pick="scene-trainingroom"]');await apply('scene');
  assert.equal(await js('lastPacket.sceneId'),'trainingroom');
  await check('sound',['#clip-audio-replace','#clip-audio-rate','#clip-original-loop','[data-afx-param]']);
  await click('#clip-audio-replace');await click('[data-audio-pick="sound-b"]');await apply('audio');
  await set('#clip-audio-rate',1.5);
  const sound=clip(await snapshot(),'sound');
  assert.equal(sound.assetId,'sound-b');assert.equal(sound.originalLoop,undefined);assert.equal(sound.sourceOffset,0);
  assert.equal(sound.volume,.35);assert.equal(sound.mediaRate,1.5);assert.equal(sound.audioEffects[0].id,'phone');

  await check('picture-clip',['[data-media-replace]','[data-media-field="opacity"]','[data-composition-layout="width"]']);
  await click('[data-media-replace]');await click('[data-media-pick="movie"]');await apply('media');
  const media=await snapshot(),picture=clip(media,'picture-clip'),soundtrack=media.state.tracks.find(t=>t.type==='audio'&&t.clips.some(c=>c.mediaLink===picture.mediaLink)).clips[0];
  assert.equal(picture.assetId,'movie');assert.equal(picture.name,'自定义 picture-clip');
  assert.deepEqual(picture.mediaKeys,clip(fixture,'picture-clip').mediaKeys);assert.equal(soundtrack.assetId,'movie');
  await set('[data-media-rate]',1.25);await load(await snapshot(),soundtrack.id);
  assert.equal(await js("q('#clip-audio-rate').disabled && q('#clip-audio-offset').disabled"),true);
  await click('[data-inspect-related="picture-clip"]');assert.equal(await js("q('[data-media-rate]').value"),'1.25');
  await check('camera',['[data-camera-field="fov"]','#visibility-key']);await click('#visibility-key');await set('#object-visible',false);
  assert.equal(clip(await snapshot(),'camera').propertyKeys.visible[0].value,false);
  await check('trs',['[data-camera-field="position"]','[data-camera-field="rotation"]','[data-camera-field="scale"]','#object-visible']);
  await check('motion',['#clip-motion-replace','#clip-source-offset','#layer-end','#layer-loop']);
  const overlay=structuredClone(fixture),body=overlay.state.tracks.find(t=>t.type==='animation');
  body.layerRole='overlay';await load(overlay,'motion');
  for(const selector of ['#layer-blend','#layer-scope','#layer-weight'])assert.ok(await js(`!!q('${selector}')`));
  await check('subtitle',['#dialogue-speaker-edit','#dialogue-ui-style','#dialogue-edit','[data-dialogue-layout="x"]']);
  await check('transition',['#ui-effect-choice','[data-composition-layout="opacity"]']);
  await set('#ui-effect-choice','fade');assert.equal(clip(await snapshot(),'transition').assetId,'fade');
  await check('code',['[data-ui-code="html"]','[data-ui-code="css"]','[data-ui-code="js"]','#clip-source-offset']);
  await check('filter',['[data-fx-preset]','[data-fx-scope]','[data-fx-param="tone"]']);
  await check('effect',['[data-fx-enable]','[data-fx-param="rollSpeed"]','[data-fx-fade="fadeIn"]']);
  await check('legacy-post',['#clip-render-settings']);
  await click('[data-track-menu="world"]');assert.ok(await js(`!!q('#modal [data-composition-layout="width"]')`));await click('#modal [data-close]');
  const seam=structuredClone(fixture),pictureTrack=seam.state.tracks.find(t=>t.type==='media');
  pictureTrack.clips.push({...pictureTrack.clips[0],id:'next-picture',start:13});
  seam.state.transitions=[{id:'join',trackId:pictureTrack.id,leftId:'picture-clip',rightId:'next-picture',kind:'dissolve',duration:.5}];
  await load(seam,'picture-clip');await click('[data-clip-seam="join"]');
  assert.equal(await js("q('#seam-duration').value"),'0.5');await click('#modal [data-close]');
  const grouped=structuredClone(fixture);
  grouped.state.clipGroups=[{id:'pair',name:'演出'}];
  for(const id of ['face','motion'])clip(grouped,id).groupId='pair';
  await load(grouped,'face');await set('#batch-type','expression');await set('#batch-member','face');
  assert.equal(await js("q('.clip-motion-name').textContent"),'微笑');
  return 'passed';
};
