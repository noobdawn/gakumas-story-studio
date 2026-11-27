'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const G=require('../../ui/gaze');
const L=require('../../ui/animation-layers');
const clip=(kind,seed=22)=>({start:1,len:2,fadeIn:.2,fadeOut:.2,weight:100,gaze:G.create(kind,[1,2,3],seed)});
const track=c=>({target:'actor',enabled:true,type:'animation',layerRole:'overlay',clips:[c]});
const evaluate=(tracks,t,camera=[0,1,4])=>G.layers(tracks,'actor',t,camera,L.sample,L.fade);
test('camera, point and away layers use upper-track priority with keyed strength',()=>{
  const base=clip('look'),away=clip('away'),tracks=[track(away),track(base)];
  away.propertyKeys={weight:[{time:0,value:0},{time:2,value:100}]};
  assert.deepEqual(evaluate(tracks,3),[]);
  assert.deepEqual(evaluate(tracks,1),[]);
  const [look,avert]=evaluate(tracks,2);
  assert.deepEqual(look.point,[0,1,4]);assert.equal(avert.weight,.5);
  assert.deepEqual(evaluate(tracks,2,[4,1,0])[0].point,[4,1,0]);
  base.gaze.target='point';
  assert.deepEqual(evaluate(tracks,2,null)[0].point,[1,2,3]);
  tracks[0].enabled=false;assert.equal(evaluate(tracks,2).length,1);
  assert.deepEqual(L.bodyLayers({tracks,current:2},{id:'actor'},{}),[]);
});
test('wander is reproducible across seeks, save/load and splits',()=>{
  const c=clip('away');c.len=130;
  const saved=JSON.parse(JSON.stringify(c));
  const path=Array.from({length:51},(_,i)=>G.angles(c.gaze,i/15));
  assert.ok(path.some(([x])=>x<0)&&path.some(([x])=>x>0));
  for(let i=50;i>=0;i--)assert.deepEqual(G.angles(saved.gaze,i/15),path[i]);
  assert.ok(path.every(([,y])=>y<0));
  const split={...c,start:2,len:129,sourceOffset:1,fadeIn:0};
  assert.deepEqual(evaluate([track(c)],90),evaluate([track(split)],90));
  assert.notDeepEqual(G.angles({...c.gaze,seed:23},2),G.angles(c.gaze,2));
});
test('sky, directional and preset validation',()=>{
  const g=clip('away').gaze;
  for(const style of Object.keys(G.styles)){G.setStyle(g,style);assert.ok(G.valid(g));}
  assert.ok(G.angles(g,0)[1]>0);
  G.setStyle(g,'direction');g.direction='left';assert.deepEqual(G.angles(g,4),[-12,0]);
  assert.ok(!G.valid({...g,head:101}));assert.ok(!G.valid({...g,point:[NaN,0,0]}));
  assert.ok(!G.valid({...g,holdMax:.1}));
});
