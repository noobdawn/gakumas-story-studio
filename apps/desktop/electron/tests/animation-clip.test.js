'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../../ui/animation-layers'),store=require('../project-store');
const definitions={old:{motionId:'old',length:3,isPose:false},next:{motionId:'next',length:1,isPose:false},pose:{motionId:'pose',length:.033,isPose:true},add:{motionId:'add',length:2,isAdditive:true}};
const motion=id=>definitions[id];
function fixture(role='base'){
 const clip={id:'clip',name:'对白动作 · line-007',assetId:'old',start:29.9,len:2.233,sourceOffset:1.2,layerPlayback:true,loop:true,weight:75,fadeIn:.12,fadeOut:.15,scope:'upperBody',storyBinding:{start:{anchorId:'line-007',edge:'start',offset:0},end:{anchorId:'line-007',edge:'end',offset:0}}};
 const track={id:'track',name:'手毬 · 动画',type:'animation',target:'actor',layerRole:role,clips:[clip]};
 return {clip,track};
}
test('更换动画保留片段排时、名称、剧情绑定和播放设置，重置旧素材裁剪',()=>{
 const {clip,track}=fixture(),before=structuredClone(clip);
 assert.equal(L.replaceMotion(track,clip,'next',motion),true);
 assert.deepEqual(clip,{...before,assetId:'next',sourceOffset:0});
 assert.equal(L.motionTime(motion(clip.assetId),1.5,clip.loop),.5);
 L.replaceMotion(track,clip,'pose',motion);assert.equal(L.motionTime(motion(clip.assetId),1.5,clip.loop),0);
});
test('动画更换拒绝锁定、失效引用和基础层增量素材，失败不改变片段',()=>{
 const {clip,track}=fixture(),before=structuredClone(clip);
 for(const id of ['missing','add'])assert.throws(()=>L.replaceMotion(track,clip,id,motion));
 track.locked=true;assert.throws(()=>L.replaceMotion(track,clip,'next',motion),/锁定/);track.locked=false;
 assert.throws(()=>L.replaceMotion({...track,clips:[]},clip,'next',motion),/片段已改变/);
 assert.deepEqual(clip,before);
 assert.equal(L.replaceMotion(track,clip,'old',motion),false);assert.deepEqual(clip,before);
});
test('叠加层更换按素材选择有效混合方式并使用新动画求值',()=>{
 const {clip,track}=fixture('overlay');L.replaceMotion(track,clip,'add',motion);
 assert.equal(clip.blendMode,'additive');assert.equal(clip.scope,'upperBody');
 const state={current:30.9,tracks:[track]},actor={id:'actor'};
 assert.equal(L.bodyLayers(state,actor,{motion})[0].motionId,'add');
 L.replaceMotion(track,clip,'next',motion);const layer=L.bodyLayers(state,actor,{motion})[0];
 assert.equal(layer.motionId,'next');assert.equal(layer.additive,false);assert.equal(layer.scope,'upperBody');
});
test('更换后的素材引用通过工程序列化往返',()=>{
 const {clip,track}=fixture();delete clip.storyBinding;
 L.replaceMotion(track,clip,'next',motion);
 const doc={format:store.FORMAT,version:1,resources:{character:'ttmr-casl-0002-prepared'},state:{version:1,selected:null,selectedClip:'clip',current:30,fov:35,globalSettings:{duration:60,fps:30,outlineEnabled:true,outlineWidth:.15,physicsEnabled:false},objects:[{id:'scene',name:'场景',type:'场景',icon:'box',parent:null,components:[]},{id:'actor',name:'手毬',type:'角色',icon:'user',parent:'scene',components:['animation']}],tracks:[track],assets:[],dialogues:[]}};
 assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
});
