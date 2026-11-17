(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CreatorExportQueue=factory();})(globalThis,()=>{
  'use strict';
  const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
  async function run({total,capacity,session,fullProject=false,makeFrame,request,cancelled,onFrame,onProgress,clock=()=>performance.now(),sleep=()=>new Promise(r=>setTimeout(r,1))}){
    if(typeof fullProject!=='boolean'||fullProject&&![4,8].includes(capacity)||![1,4,8].includes(capacity)||!Number.isInteger(total)||total<1||total>(fullProject?216000:1800)||typeof session!=='string'||session.length!==32)throw Error('导出队列设置无效');
    let enqueued=0,received=0,pending=[],requests=0,backpressure=0,lastProgress=clock(),last=null;
    const waiting=new Map();
    while(received<total){
      if(cancelled())return {cancelled:true,requests,backpressure,last};
      const room=capacity-(enqueued-received);
      if(!pending.length&&enqueued<total&&room>0){
        for(let i=0;i<Math.min(4,room,total-enqueued);i++){
          const row=makeFrame(enqueued+i);
          // Snapshot ownership ends here; later timeline evaluations cannot mutate it.
          const frame=JSON.parse(JSON.stringify(row));
          if(bytes({queueSession:session,frames:[frame]})>512*1024)throw Error('单帧演出状态过大');
          if(bytes({queueSession:session,frames:[...pending,frame]})>512*1024)break;
          pending.push(frame);
        }
      }
      const sending=pending.length>0;
      const start=clock();
      const reply=await request(sending?'export-enqueue':'export-status',{queueSession:session,...(sending?{frames:pending}: {})});requests++;
      if(reply.queueSession!==session||!Array.isArray(reply.queueResults)||typeof reply.queueAdmitted!=='boolean'||!sending&&reply.queueAdmitted)throw Error('导出队列回复无效');
      const expected=enqueued+(reply.queueAdmitted?pending.length:0);
      if(reply.queueEnqueued!==expected||reply.queueReported!==received+reply.queueResults.length||reply.queueReported>expected||expected-reply.queueReported>capacity)throw Error('导出队列帧数不匹配');
      if(reply.queueAdmitted){for(const row of pending)waiting.set(row.index,{row,start});enqueued=expected;pending=[];lastProgress=clock();}
      else if(sending)backpressure++;
      for(const frame of reply.queueResults){
        if(!frame.ok||frame.gpuAccepted!==received+1||!waiting.has(received))throw Error('导出队列帧序不匹配');
        const item=waiting.get(received);waiting.delete(received);
        onFrame(received,frame,item.row,clock()-item.start);received++;lastProgress=clock();
      }
      last=reply;onProgress(received,total);
      if(clock()-lastProgress>60000)throw Error('导出队列等待超时');
      if(!reply.queueAdmitted&&!reply.queueResults.length)await sleep();
    }
    return {cancelled:false,requests,backpressure,last};
  }
  // Full-project diagnostics retain aggregates and eight slow samples, not a
  // growing array of all state/reply objects. Native frame logs remain streamed.
  function createSummary(){
    const value={count:0,first:null,last:null,slowest:[],stages:{},snapshotMs:0,queueLatencyMs:0};
    return {value,add(row){
      if(row.index!==value.count)throw Error('诊断汇总帧序无效');
      value.count++;value.first??=row;value.last=row;
      value.snapshotMs+=row.snapshotMs||0;value.queueLatencyMs+=row.queueLatencyMs||0;
      const cost=row.frame?.exportTiming?.totalMs||0;
      value.slowest.push({cost,row});value.slowest.sort((a,b)=>b.cost-a.cost);value.slowest.length=Math.min(8,value.slowest.length);
      for(const stage of row.frame?.exportTiming?.stages||[]){
        const sum=value.stages[stage.name]??={ms:0,calls:0,maxMs:0};
        sum.ms+=stage.ms;sum.calls+=stage.calls;sum.maxMs=Math.max(sum.maxMs,stage.ms);
      }
    }};
  }
  function normalOptions(compositionVersion,mode='gpu'){
    if(!['gpu','compatibility'].includes(mode))throw Error('视频导出模式无效');
    if(mode==='gpu'&&compositionVersion===1)return {exportMode:'gpu',gpuVideo:true,mergedFrame:true,queueCapacity:8};
    return {exportMode:'compatibility'};
  }
  return {run,createSummary,normalOptions};
});
