const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../../ui/clip-properties'),T=require('../../ui/timeline-edit'),C=require('../../ui/composition'),S=require('../../ui/shot-preview');

function fixture(){
  return {projectId:'isolated',globalSettings:{fps:30,duration:24},compositionVersion:1,transitions:[],objects:[{id:'screen',type:'画面'}],dialogues:[],
    tracks:[{id:'picture',type:'media',target:'screen',clips:[{id:'v',start:10,len:8,mediaLink:'av',sourceOffset:6,mediaKeys:{x:[{time:8,value:.4}]}}]},
      {id:'sound',type:'audio',target:'screen',clips:[{id:'a',start:10,len:8,mediaLink:'av',sourceOffset:6,volume:.4}]},
      {id:'world',type:'world',clips:[],compositionLayout:{scale:.8}},
      {id:'camera',type:'camera',clips:[{id:'shot',start:2,len:6}]}]};
}
test('8 秒选区逐帧变速，关联声音、源偏移、布局关键帧与精确源长保持一致',()=>{
  const s=fixture(),[t,a]=s.tracks,c=t.clips[0],sound=a.clips[0];
  P.retime(s,t,c,2);assert.deepEqual([c.start,c.len,c.mediaKeys.x[0].time,sound.len,sound.sourceOffset],[10,4,4,4,6]);
  for(const rate of [1.31,2.99,.9,1])P.retime(s,a,sound,rate);
  assert.deepEqual([c.len,c.sourceOffset,c.mediaKeys.x[0].time,sound.len,sound.volume],[8,6,8,8,.4]);
  c.len=sound.len=3;assert.equal(P.sourceLength(c,30),3);
  const old={len:6,mediaRate:2,sourceOffset:10};assert.equal(P.newLength(old,1,30),12);assert.equal(old.len,6);
});
test('慢放与同轨片段、工程末尾、联动锁定冲突时原子拒绝',()=>{
  const s=fixture(),[t,a]=s.tracks,c=t.clips[0];t.clips.push({id:'next',start:19,len:2});
  for(const [rate,reason] of [[.8,/重叠/],[.5,/末尾/]]){const before=structuredClone(s);assert.throws(()=>P.retime(s,t,c,rate),reason);assert.deepEqual(s,before);}
  a.locked=true;const before=structuredClone(s);assert.throws(()=>P.retime(s,t,c,2),/锁定/);assert.deepEqual(s,before);
});
test('时间轴普通片段可在无对白剧情段中复制，原位粘贴寻找共同空位',()=>{
  const s=fixture();s.story={version:1,tail:0,units:[{id:'pause',kind:'pause',name:'间奏'}]};
  const data=T.copy(s,['v']);assert.equal(data.storyUnits,undefined);
  assert.equal(data.items.length,2);const env={q:v=>Math.round(30*v)/30,frame:1/30};
  s.tracks[1].clips.push({id:'other',start:18.1,len:1});
  assert(Math.abs(T.pasteTime(s,data,10,env)-19.1)<1e-6);
  assert.equal(T.pasteTime(s,data,1,env),1);
});
test('拍摄画面只在所选镜头覆盖布局和蒙版，字幕与画面独立',()=>{
  const s=fixture(),shot=s.tracks[3].clips[0];
  shot.compositionLayout={x:.25};shot.masks=Object.keys(P.shapes).map(k=>P.mask(k,k));
  const node=C.packet(s,3,{shot}).nodes.find(n=>n.kind==='world');assert.equal(node.layout.scale,.8);assert.equal(node.layout.x,.25);assert.deepEqual(node.masks,shot.masks);
  assert.equal(C.packet(s,9).nodes.find(n=>n.kind==='world').masks,undefined);
  shot.masks[1].id=shot.masks[0].id;assert.throws(()=>C.validate(s),/蒙版/);
});
test('贴图位置、声音音量和拍摄画面布局复用底图，机位改变使后续物理历史失效',()=>{
  const s=fixture(),b=structuredClone(s);
  b.tracks[0].clips[0].mediaLayout={x:.2};b.tracks[1].clips[0].volume=.3;b.tracks[3].clips[0].compositionLayout={x:.1};
  assert.equal(S.firstChange(s,b),Infinity);
  b.tracks[3].clips[0].propertyKeys={fov:[{time:1,value:42}]};assert.equal(S.firstChange(s,b),2);
  b.globalSettings.physicsMode='hybrid';assert.equal(S.firstChange(s,b),0);
});
test('后台有独立取样时间，编辑期间已发出的旧结果不能发布',async()=>{
  const original=Date.now;let clock=0;Date.now=()=>clock;
  try{
    const times=[],batches=[];let complete,blocked=false,id=0;
    const sample=t=>({composition:{time:t,nodes:[{kind:'world'}]},fov:35,physicsFrame:t*30});
    const cache=S.create({fps:()=>30,time:()=>.5,physics:()=>true,size:()=>[100,100],area:()=>({start:0,len:1}),id:()=>String(++id),
      sample:t=>{times.push(t);return sample(t);},blocked:()=>blocked,post:data=>{batches.push(data);return new Promise(r=>complete=r);}});
    clock=1000;await cache.step();clock=2000;const old=cache.step();assert.deepEqual(times,[0,1/30]);
    cache.invalidate();complete({keys:['old0','old1'],evicted:[]});await old;assert.equal(cache.lookup(0,sample(0)),null);
    clock=3000;blocked=true;await cache.step();assert.equal(batches.length,1);
    blocked=false;const next=cache.step();complete({keys:['new0','new1'],evicted:[]});await next;
    assert.notEqual(batches[0].session,batches[1].session);assert.equal(cache.lookup(0,sample(0)),'new0');cache.dispose();
  }finally{Date.now=original;}
});
