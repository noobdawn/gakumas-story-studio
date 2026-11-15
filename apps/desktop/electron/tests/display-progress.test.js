'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {model}=require('../../ui/task-progress');
const {options,fitBounds}=require('../window-layout');
test('display bounds use available DIP, including negative monitor origins',()=>{
  for(const area of [{x:0,y:0,width:1536,height:824},{x:-1920,y:0,width:1920,height:1040},{x:0,y:0,width:640,height:420}]){
    const screen={getCursorScreenPoint:()=>({x:area.x,y:area.y}),getDisplayNearestPoint:()=>({workArea:area})};
    const b=options(screen,'editor');assert.ok(b.x>=area.x&&b.y>=area.y);assert.ok(b.x+b.width<=area.x+area.width&&b.y+b.height<=area.y+area.height);assert.ok(b.minWidth<=b.width&&b.minHeight<=b.height);
    assert.deepEqual(fitBounds({x:9999,y:-2000,width:4000,height:3000},area),area);
  }
});
test('download counts are per file; verify/unpack stay indeterminate until success',()=>{
  const half=model({state:'running',phase:'download',received:50,total:100,itemIndex:2,itemTotal:5},'voice');assert.equal(half.value,.5);assert.match(half.detail,/2 \/ 5/);
  for(const phase of ['verify','unpack','install'])assert.equal(model({state:'running',phase,received:100,total:100},'voice').value,null);
  assert.equal(model({state:'running',phase:'download',total:0},'voice').value,null);
  assert.ok(model({state:'running',phase:'download',received:100,total:100},'voice').value<1);
});
test('resource progress is staged, and failures/cancellations never report success',()=>{
  assert.equal(model({state:'running',phase:'准备 Player 资源'}).value,2/8);
  assert.equal(model({state:'running',phase:'unknown'}).value,null);
  for(const state of ['error','cancelled','partial']){const m=model({state,message:'fixture'});assert.notEqual(m.value,1);assert.equal(m.message,'fixture');}
  assert.equal(model({state:'complete'}).value,1);
});
