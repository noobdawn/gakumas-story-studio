globalThis.CreatorAudioEffectsPreview=function(env){
 const ready=new Map(),pending=new Map(),prefetchFailed=new Set();let request=0,waiting=null;
 function item(clip,asset){const reference=Object.fromEntries(['id','scope','projectId','extension','type','source'].filter(k=>asset[k]!==undefined).map(k=>[k,asset[k]]));return {asset:reference,length:clip.len,offset:clip.sourceOffset||0,rate:clip.mediaRate||1,loop:clip.audioLoop===true&&!clip.dialogue,...(clip.originalLoop?{originalLoop:clip.originalLoop}:{}),effects:clip.audioEffects||[]};}
 function key(c,a){return JSON.stringify(item(c,a));}
 function has(c){return CreatorPostEffects.activeAudio(c).length>0;}
 function refs(){return env.clips().filter(({clip})=>has(clip));}
 function at(time){return refs().filter(({clip})=>time>=clip.start&&time<clip.start+clip.len);}
 function needs(time){return at(time).some(({clip,asset})=>!ready.has(key(clip,asset)));}
 function boundary(from,to){const starts=refs().filter(({clip,asset})=>clip.start>from+1e-8&&clip.start<=to+1e-8&&!ready.has(key(clip,asset))).map(({clip})=>clip.start);return starts.length?Math.min(...starts):null;}
 function name(c,a){return c.name||a.alias||a.source||'未命名声音片段';}
 function prepare(c,a){
  const k=key(c,a);if(ready.has(k))return Promise.resolve(ready.get(k));if(pending.has(k))return pending.get(k).promise;
  const controller=new AbortController(),timeout=env.timeoutMs??Math.max(30000,Math.min(615000,c.len*2000+15000));let timer;
  const cancelled=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason||Error('已取消声音准备')),{once:true}));
  const job={controller,promise:null};
  const work=(async()=>{
   const response=await fetch(env.prefix()+'/audio-effects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item(c,a)),signal:controller.signal});
   const text=await response.text();let result;try{result=JSON.parse(text);}catch{throw Error('声音服务返回无效响应（HTTP '+response.status+'）');}
   if(!response.ok||!result.ok)throw Error(result.error||'声音服务请求失败（HTTP '+response.status+'）');
   if(typeof result.key!=='string'||!/^[0-9a-f]{64}$/.test(result.key))throw Error('声音服务返回无效缓存标识');
   return {...a,id:'processed-'+result.key,effectUrl:env.prefix()+'/effect-audio/'+result.key+'.wav'};
  })();
  timer=setTimeout(()=>controller.abort(Error('等待超过 '+Math.round(timeout/1000)+' 秒，声音服务未完成处理')),timeout);
  job.promise=Promise.race([work,cancelled]).then(value=>{if(controller.signal.aborted)throw controller.signal.reason;ready.set(k,value);prefetchFailed.delete(k);return value;}).catch(error=>{throw Error(name(c,a)+'：'+error.message);}).finally(()=>{clearTimeout(timer);if(pending.get(k)===job)pending.delete(k);});
  pending.set(k,job);return job.promise;
 }
 function prime(time){for(const {clip,asset} of refs())if(clip.start>=time&&clip.start<=time+10){const k=key(clip,asset);if(!ready.has(k)&&!pending.has(k)&&!prefetchFailed.has(k))prepare(clip,asset).catch(()=>prefetchFailed.add(k));}}
 function transformed(c,a){if(!has(c))return {clip:c,asset:a};const value=ready.get(key(c,a));if(!value)throw Error('声音效果尚未准备');return {asset:value,clip:{...c,sourceOffset:0,mediaRate:1,audioLoop:false,originalLoop:undefined}};}
 function cancel(){request++;waiting=null;for(const job of pending.values())job.controller.abort(Error('已取消声音准备'));pending.clear();env.onWaitingChange?.(false);}
 function gate(value,start){
  if(!value){const wasWaiting=waiting!==null;cancel();if(wasWaiting)env.notify('已取消声音准备，播放保持暂停',{detail:'播放位置或编辑状态已改变；按播放可从当前位置重新开始。'});return false;}
  if(waiting){cancel();env.notify('已取消声音准备，播放保持暂停',{detail:'再次按播放会重新尝试当前片段。'});return true;}
  const time=env.state().current||0,required=at(time);if(required.every(({clip,asset})=>ready.has(key(clip,asset))))return false;
  const token=++request,identity=env.state(),signature=JSON.stringify(required.map(({clip,asset})=>key(clip,asset))),job={token};waiting=job;env.onWaitingChange?.(true);
  let completed=0;const update=()=>{if(waiting!==job)return;env.notify('正在准备声音 '+completed+'/'+required.length,{kind:'progress',sticky:true,group:'audio-prepare-'+token,replace:true,detail:'片段：'+required.filter(({clip,asset})=>!ready.has(key(clip,asset))).map(({clip,asset})=>name(clip,asset)).join('、')+'\n完成后自动播放；按播放按钮或空格可取消。'});};update();
  Promise.all(required.map(({clip,asset})=>prepare(clip,asset).then(()=>{completed++;update();}))).then(()=>{
   if(waiting!==job||token!==request)return;waiting=null;env.onWaitingChange?.(false);
   if(env.state()!==identity||Math.abs((env.state().current||0)-time)>1e-7||JSON.stringify(at(time).map(({clip,asset})=>key(clip,asset)))!==signature){env.notify('工程或播放位置已变化，本次等待已取消',{detail:'按播放可从当前位置重新开始。'});return;}
   env.notify('声音准备完成，开始播放',{group:'audio-prepare-'+token,replace:true,detail:required.map(({clip,asset})=>name(clip,asset)).join('、')});start();
  }).catch(error=>{if(waiting!==job||token!==request)return;cancel();env.notify('声音效果准备失败',{kind:'error',sticky:true,detail:error.message+'\n时间轴已暂停。可再次播放重试，或在片段属性中检查声音效果。'});});return true;
 }
 return {gate,transformed,prepare,item,needs,boundary,prime,isWaiting:()=>waiting!==null};
};
