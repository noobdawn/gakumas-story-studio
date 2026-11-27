'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {generate,combineFaceLayers,phonemeKeys} = require('../../ui/lipsync');

test('口型覆盖其他嘴形并保留眉眼，结束后原表情恢复', () => {
  const expression=[{name:'b_mouth.mouth_002',weight:1},{name:'b_eye.eye_001',weight:.4},{name:'b_brow.brow_001',weight:.2}];
  const combined=combineFaceLayers([...expression,{name:'b_mouth.mouth_001',weight:.7,mouthOverride:true}]);
  assert.deepEqual(combined,[{name:'b_eye.eye_001',weight:.4},{name:'b_brow.brow_001',weight:.2},{name:'b_mouth.mouth_001',weight:.7}]);
  assert.deepEqual(combineFaceLayers(expression),expression);
});
test('音素口型按帧、源偏移与无声元音分配五种嘴形', () => {
 const timing={frameRate:100,frameCount:100,phonemes:[{phoneme:'k',startFrame:0,endFrame:10},{phoneme:'a',startFrame:10,endFrame:30},{phoneme:'U',startFrame:30,endFrame:40},{phoneme:'i',startFrame:40,endFrame:80}]};
 const curves=phonemeKeys(timing,.1,.5,30);
 assert.ok(curves.viseme_a.some(k=>k.value===85));assert.ok(curves.viseme_i.some(k=>k.value===85));assert.ok(curves.viseme_u.every(k=>k.value===0));
 assert.equal(curves.viseme_a.at(-1).value,0);assert.throws(()=>phonemeKeys({...timing,phonemes:[{phoneme:'a',startFrame:2,endFrame:1}]},0,1,30));
 const layered=combineFaceLayers([{name:'b_mouth.mouth_002',weight:1},{name:'b_mouth.mouth_003',weight:.7,mouthOverride:true},{name:'b_mouth.mouth_004',weight:0,mouthOverride:true}]);
 assert.deepEqual(layered,[{name:'b_mouth.mouth_003',weight:.7},{name:'b_mouth.mouth_004',weight:0}]);
});

test('音量包络保留静音、响声、片段偏移及结束闭口', () => {
  const rate=1000, samples=new Float32Array(3000);
  samples.fill(.4,1000,1500);
  const keys=generate([samples],rate,.5,2,30);
  const weight=t=>keys.find(k=>Math.abs(k.time-t)<.001).value;
  assert.equal(weight(0),0);
  assert.ok(weight(.6)>70);
  assert.equal(weight(1.4),0);
  assert.deepEqual(keys.at(-1),{time:2,value:0});
  assert.ok(keys.every((k,i)=>k.value>=0&&k.value<=100&&(!i||keys[i-1].time<k.time)));
});

test('全静音、音量和淡入不会制造虚假张口', () => {
  const silent=generate([new Float32Array(500)],1000,0,.5,24);
  assert.ok(silent.every(k=>k.value===0));
  const samples=new Float32Array(1000).fill(.25);
  const muted=generate([samples],1000,0,1,30,0);
  assert.ok(muted.every(k=>k.value===0));
  const fading=generate([samples],1000,0,1,30,1,.5,.5);
  assert.equal(fading[0].value,0);
  assert.ok(fading.find(k=>k.time===.4).value>0);
  assert.equal(fading.at(-1).value,0);
});

test('长对白片段中很短的声音仍可生成口型', () => {
  const samples=new Float32Array(10000);
  samples.fill(.2,4000,4300);
  const keys=generate([samples],1000,0,10,30);
  assert.ok(keys.some(k=>k.time>=4&&k.time<=4.3&&k.value>40));
  assert.equal(keys.find(k=>k.time===2).value,0);
});

test('拒绝过长片段和不合法音频输入', () => {
  assert.throws(()=>generate([new Float32Array(100)],1000,0,61,30));
  assert.throws(()=>generate([new Float32Array(100),new Float32Array(99)],1000,0,1,30));
  assert.throws(()=>generate([new Float32Array(100)],1000,-1,1,30));
});

test('情绪口型在连续发声时启用，停顿时收回，裁剪、静音和短句有界',()=>{
 const L=require('../../ui/lipsync'),A=require('../../ui/animation-layers');
 const settings={length:2,duration:2,fps:30,timing:{frameRate:100,frameCount:200,phonemes:[
   {phoneme:'pau',startFrame:0,endFrame:20},{phoneme:'a',startFrame:20,endFrame:65},
   {phoneme:'pau',startFrame:65,endFrame:105},{phoneme:'i',startFrame:105,endFrame:170},{phoneme:'pau',startFrame:170,endFrame:200}]}};
 const keys=L.sentenceKeys(settings);
 for(const t of [.4,1.2,1.44])assert.ok(A.sample(keys,t)>74);
 for(const t of [0,.19,.8,1,1.71,2])assert.equal(A.sample(keys,t),0);
 const shortened=L.sentenceKeys({...settings,offset:.25,length:1/30});assert.ok(shortened.every((k,i)=>!i||k.time>shortened[i-1].time));
 assert.ok(L.sentenceKeys({...settings,offset:1.8,length:.2}).every(k=>k.value===0));
 const pcm=new Float32Array(2000);pcm.fill(.2,200,500);pcm.fill(.5,1200,1600);
 const wav={length:2,duration:2,channels:[pcm],sampleRate:1000,fps:24};
 assert.equal(A.sample(L.sentenceKeys(wav),.85),0);
 assert.ok(A.sample(L.sentenceKeys(wav),.33)>70);
 assert.ok(L.sentenceKeys({...wav,volume:0}).every(k=>k.value===0));
 assert.ok(L.sentenceKeys({...wav,channels:[new Float32Array(2000)]}).every(k=>k.value===0));
});
test('整句口型轻叠在原有嘴角上，眉眼和脸部贴花仍逐帧生效',()=>{
 const L=require('../../ui/lipsync'),A=require('../../ui/animation-layers');
 const actor={id:'a'},lip={id:'speech',assetId:'open',start:0,len:2,weight:32,lipMode:'emotion',lipSyncSource:{}};
 const expressions={smile:'b_mouth.mouth_007',open:'b_mouth.mouth_001',brow:'b_brow.brow_001',shadow:'decal.Shadow'};
 const env={face:()=>null,shape:id=>({source:expressions[id]})};
 const tracks=[lip,...['smile','brow','shadow'].map(assetId=>({assetId,start:0,len:4,weight:100}))].map(clip=>({target:'a',type:'expression',clips:[clip]}));
 const weights=t=>Object.fromEntries(A.faceLayers({current:t,tracks},actor,env).map(x=>[x.name,x.weight]));
 const mid=weights(1);assert.ok(mid[expressions.smile]>.85);assert.ok(mid[expressions.open]>0&&mid[expressions.open]<.15);
 assert.equal(mid[expressions.brow],1);assert.equal(mid[expressions.shadow],1);
 assert.equal(weights(2)[expressions.smile],1);assert.equal(weights(2)[expressions.open],undefined);
 assert.equal(L.modeFor(), 'emotion');assert.equal(L.modeFor({lipVisemes:{}}),'phoneme');assert.equal(L.modeFor({}),'amplitude');
});

test('持续发声时循环采样表情专用曲线，拖动和分割后仍取同一帧',()=>{
  const L=require('../../ui/lipsync');
  const smile='b_mouth.mouth_002',open='b_mouth.mouth_003',brow='b_brow.brow_001';
  const keys=values=>values.map((v,i)=>[i*.25,v,0,0]);
  const profiles=[{trigger:smile,weight:1,curves:[{shape:smile,keys:keys([100,0,100])},{shape:open,keys:keys([0,100,0])}]}];
  const sample=(time,offset=0,gain=.75)=>Object.fromEntries(L.combineFaceLayers([
    {name:smile,weight:1},{name:brow,weight:.8},{name:'b_mouth.mouth_001',weight:gain,emotion:true,cycleTime:time+offset}
  ],profiles).map(x=>[x.name,x.weight]));
  assert.equal(sample(.25)[open],.75);assert.equal(sample(.5)[open],0);
  assert.equal(sample(.75)[open],.75);assert.equal(sample(.625)[open],.375);
  assert.deepEqual(sample(.75),sample(.25,.5));assert.equal(sample(.25)[brow],.8);
  assert.deepEqual(sample(.25,0,0),{[smile]:1,[brow]:.8});
});
