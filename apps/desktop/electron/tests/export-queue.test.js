'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Q=require('../../ui/export-queue');
const session='1'.repeat(32);
test('normal composition export defaults to bounded GPU; compatibility and legacy remain available',()=>{
  assert.deepEqual(Q.normalOptions(1),{exportMode:'gpu',gpuVideo:true,mergedFrame:true,queueCapacity:8});
  assert.deepEqual(Q.normalOptions(1,'compatibility'),{exportMode:'compatibility'});
  assert.deepEqual(Q.normalOptions(undefined),{exportMode:'compatibility'});
  assert.throws(()=>Q.normalOptions(1,'bad'),/模式/);
});
function simulation(capacity,total=17){
  let enqueued=0,reported=0,clock=0,calls=0;const pending=[],source={value:0},seen=[],delivered=[];
  return {seen,delivered,get calls(){return calls;},opts:{total,capacity,session,clock:()=>++clock,sleep:async()=>{},cancelled:()=>false,
    makeFrame:index=>{source.value=index;return {index,state:source};},
    onFrame:(i,reply,row)=>delivered.push([i,row.state.value]),onProgress:()=>{},
    request:async(endpoint,message)=>{
      calls++;let admitted=false;
      // Slow consumer: every second request completes just one frame.
      const rows=[];
      if(calls%2===0&&pending.length){const n=pending.shift();reported++;rows.push({ok:true,gpuAccepted:n+1});}
      if(endpoint==='export-enqueue'&&enqueued-reported+message.frames.length<=capacity){
        for(const row of message.frames){assert.equal(row.index,enqueued++);seen.push(row.state.value);pending.push(row.index);}admitted=true;
      }
      assert.ok(enqueued-reported<=capacity);
      return {queueSession:session,queueAdmitted:admitted,queueEnqueued:enqueued,queueReported:reported,queueResults:rows};
    }
  }};
}
for(const cap of [1,4,8])test(`queue ${cap}: slow consumer preserves immutable snapshots/order and bounds`,async()=>{
  const s=simulation(cap);const result=await Q.run(s.opts);
  assert.equal(result.cancelled,false);assert.deepEqual(s.seen,Array.from({length:17},(_,i)=>i));assert.deepEqual(s.delivered,s.seen.map(i=>[i,i]));
});
test('cancel with full queue stops new batches without reporting completion',async()=>{
  const s=simulation(8,100);s.opts.cancelled=()=>s.calls>=2;const r=await Q.run(s.opts);assert.equal(r.cancelled,true);assert.ok(s.delivered.length<100);assert.equal(s.calls,2);
});
test('stale session or reordered completion is rejected',async()=>{
  for(const change of [r=>r.queueSession='2'.repeat(32),r=>r.queueResults=[{ok:true,gpuAccepted:99}]]){
    const s=simulation(1),request=s.opts.request;s.opts.request=async(...args)=>{const r=await request(...args);change(r);return r;};await assert.rejects(Q.run(s.opts),/回复|帧数|帧序/);
  }
});
test('byte cap shrinks batches and rejects a single oversized snapshot',async()=>{
  const s=simulation(4,4),make=s.opts.makeFrame;s.opts.makeFrame=i=>({...make(i),padding:'x'.repeat(200000)});await Q.run(s.opts);assert.equal(s.seen.length,4);
  const bad=simulation(1,1);bad.opts.makeFrame=i=>({index:i,padding:'x'.repeat(600000)});await assert.rejects(Q.run(bad.opts),/过大/);assert.equal(bad.calls,0);
});

test('1800-frame slow-consumer run remains bounded; larger probe is rejected',async()=>{
  const s=simulation(8,1800);await Q.run(s.opts);assert.equal(s.delivered.length,1800);
  const tooLong=simulation(8,1801);await assert.rejects(Q.run(tooLong.opts),/设置/);assert.equal(tooLong.calls,0);
});

test('full-project run retains bounded diagnostic samples and preserves every index',async()=>{
  const s=simulation(8,37951),summary=Q.createSummary();s.opts.fullProject=true;
  s.opts.onFrame=(index,frame,row,queueLatencyMs)=>summary.add({index,frame:{...frame,exportTiming:{totalMs:index%23,stages:[{name:'stage',ms:1,calls:1}]}},snapshotMs:1,queueLatencyMs});
  await Q.run(s.opts);
  assert.equal(summary.value.count,37951);assert.equal(summary.value.first.index,0);assert.equal(summary.value.last.index,37950);
  assert.equal(summary.value.slowest.length,8);assert.equal(summary.value.stages.stage.calls,37951);
  assert.ok(JSON.stringify(summary.value).length<16384);
  for(const changes of [{capacity:1},{total:216001},{fullProject:1}])await assert.rejects(Q.run({...s.opts,...changes}),/设置/);
});
