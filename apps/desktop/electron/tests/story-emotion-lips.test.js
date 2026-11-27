'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../../ui/story-timeline'),lip=require('../../ui/lipsync'),fs=require('node:fs'),vm=require('node:vm');

test('新配音、批量换音与保护已编辑口型',async()=>{
  const samples=new Float32Array(2000).fill(.2);
  const runtime={CreatorStory:S,CreatorLipSync:lip,structuredClone,fetch:async()=>new Response(new ArrayBuffer(8)),AudioContext:class {
    async decodeAudioData(){return {duration:2,numberOfChannels:1,sampleRate:1000,getChannelData:()=>samples};}
    async close(){}
  }};
  vm.runInNewContext(fs.readFileSync(require.resolve('../../ui/story-voice'),'utf8'),runtime);
  let state={projectId:'p',current:0,globalSettings:{duration:6,fps:30},story:S.blank(),objects:[{id:'a',components:[]}],dialogues:[],assets:[],tracks:[]},counter=0;
  for(const id of ['first','second']){
    state.dialogues.push({id,speaker:'角色',text:id,voice:''});
    for(const type of ['audio','dialogue'])state.tracks.push({id:type+id,type,target:'a',clips:[{id:'clip-'+type+id,dialogue:id,start:state.dialogues.length-1,len:1}]});
    S.insertDialogue(state,id,state.dialogues.length-1,'unit-'+id);
  }
  S.reflow(state,structuredClone(state));
  const voice=runtime.CreatorStoryVoice({state:()=>state,supported:()=>true,url:a=>a.id,id:()=>String(++counter),commit:next=>{state=next;},retain:()=>{}});
  const entries=state.dialogues.map((d,i)=>({dialogueId:d.id,asset:{id:'wav-'+i,...(i?{}:{voiceTiming:{frameRate:10,frameCount:20,phonemes:[{phoneme:'a',startFrame:1,endFrame:19}]}})}}));
  await voice.apply(entries);
  const lips=()=>S.rows(state).map(r=>r.clip).filter(c=>c.lipSyncSource);
  assert.equal(lips().length,2);assert.ok(lips().every(c=>c.lipMode==='emotion'&&!c.lipVisemes));
  lips()[0].lipMode='amplitude';await voice.apply(entries);
  assert.equal(lips()[0].lipMode,'amplitude');
  lips()[1].lipEdited=true;const before=JSON.stringify(state);
  await assert.rejects(voice.apply(entries),/手工调整/);assert.equal(JSON.stringify(state),before);
});
