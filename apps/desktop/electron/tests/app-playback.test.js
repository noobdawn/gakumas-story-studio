'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../ui/app.js'),'utf8');
// Run the actual closure functions with isolated dependencies, without a DOM/Player.
const line=name=>source.split('\n').find(s=>s.startsWith('  function '+name+'('));
test('linked video sound uses the host media route; silent videos and images are rejected',()=>{
 const env=vm.createContext({location:{pathname:'/session/ui/'}});vm.runInContext(line('mediaUrl'),env);
 const asset={id:'video-id',scope:'project',projectId:'project-id',extension:'.mp4',type:'视频',visual:{kind:'video',hasAudio:true}};
 assert.equal(env.mediaUrl(asset),'/session/media/project/project-id/video-id.mp4');
 assert.equal(env.mediaUrl({...asset,scope:'shared'}),'/session/media/shared/shared/video-id.mp4');
 assert.throws(()=>env.mediaUrl({...asset,visual:{kind:'video',hasAudio:false}}),/音频素材不可用/);
 assert.throws(()=>env.mediaUrl({...asset,type:'图片',visual:{kind:'image',hasAudio:true}}),/音频素材不可用/);
 assert.equal(env.mediaUrl({...asset,type:'音乐',extension:'.wav',visual:undefined}),'/session/media/project/project-id/video-id.wav');
 assert.equal(env.mediaUrl({effectUrl:'/session/effect-audio/processed.wav'}),'/session/effect-audio/processed.wav');
});
test('a synchronous audio/preview failure stops playback but preserves the animation loop for retry',()=>{
 const queued=[],errors=[];
 const env=vm.createContext({playing:true,lastTick:0,uiSceneGate:null,state:{current:5},duration:20,
  updateClock(){throw Error('音频素材不可用');},requestAnimationFrame(cb){queued.push(cb);},
  stopForPreviewError(message){errors.push(message);env.playing=false;},setPlaying(value){env.playing=value;}});
 vm.runInContext(line('tick'),env);assert.equal(queued.length,1);
 queued.shift()(100);assert.deepEqual(errors,['音频素材不可用']);assert.equal(env.playing,false);assert.equal(queued.length,1);
 let updates=0;env.updateClock=()=>updates++;env.playing=true;env.lastTick=0;
 queued.shift()(200);assert.equal(updates,1);assert.equal(queued.length,1);assert.equal(env.playing,true);
});
