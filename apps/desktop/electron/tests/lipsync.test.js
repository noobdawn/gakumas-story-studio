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
