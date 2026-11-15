'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');

// Only paths found in the locally prepared catalog may be imported.
function create(root){
 async function entries(){
  if(!root)return [];
  const rows=[];
  for(const [prefix,name] of [['bank','audio-wav.jsonl'],['unity','audio-unity.jsonl']]){
   const data=await fs.readFile(path.join(root,name),'utf8');
   for(const line of data.split(/\r?\n/)){
    if(!line.trim())continue;
    const row=JSON.parse(line);
    if(!['音乐','音效'].includes(row.category)||typeof row.file!=='string')continue;
    const label=row.bank ? `${row.bank} #${row.index}` : row.bundle;
    if(typeof label!=='string')continue;
    const id=prefix+':'+crypto.createHash('sha256').update(JSON.stringify([row.file,row.category,label])).digest('hex');
    // WAVs were decoded with vgmstream -i (one pass); playSamples may include loops and fades.
    const rate=row.metadata?.sampleRate,samples=row.metadata?.numberOfSamples;
    const duration=Number.isFinite(rate)&&rate>0&&Number.isFinite(samples)&&samples>=0?samples/rate:null;
    const loop=row.metadata?.loopingInfo;
    const hasLoopMetadata=Number.isSafeInteger(rate)&&rate>=8000&&rate<=192000&&Number.isSafeInteger(samples)&&samples>0&&Number.isSafeInteger(loop?.start)&&Number.isSafeInteger(loop?.end)&&loop.start>=0&&loop.start<loop.end&&loop.end<=samples;
    const channels=row.metadata?.mixingInfo?.outputChannels;
    const originalLoop=hasLoopMetadata?{start:loop.start,end:loop.end,sampleRate:rate,frames:samples,...(Number.isSafeInteger(channels)&&channels>=1&&channels<=8?{channels}:{})}:undefined;
    const rawStreamName=row.metadata?.streamInfo?.name;
    const streamName=typeof rawStreamName==='string'&&rawStreamName.length>0&&rawStreamName.length<=500?rawStreamName:undefined;
    const source=prefix==='unity'?'Unity 音频':/\.mp3$/i.test(row.bank||'')?'MP3 音频':/\.awb$/i.test(row.bank||'')?'AWB 音频':/\[pre\]$/i.test(row.metadata?.streamInfo?.name||'')?'预加载短段':'ACB 音频';
    rows.push({id,type:row.category,name:label,file:row.file,source,...(streamName?{streamName}:{}),...(duration!==null&&duration<=86400?{duration}:{}),...(hasLoopMetadata?{hasLoopMetadata:true,originalLoop}:{})});
   }
  }
  return rows;
 }
 async function list(){return (await entries()).map(({id,type,name,source,streamName,duration,hasLoopMetadata})=>({id,type,name,source,...(streamName?{streamName}:{}),...(duration!==undefined?{duration}:{}),...(hasLoopMetadata?{hasLoopMetadata:true}:{})}));}
 async function resolveEntries(ids){
  if(!root)throw Error('尚未启用解包音频目录');
  if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length)throw Error('素材选择无效');
  const all=new Map((await entries()).map(row=>[row.id,row]));
  const base=await fs.realpath(root),files=[];
  for(const id of ids){
   const row=all.get(id);if(!row)throw Error('素材清单已变化，请重新打开');
   const candidate=path.resolve(base,row.file);
   if(!candidate.toLowerCase().startsWith((base+path.sep).toLowerCase())||path.extname(candidate).toLowerCase()!=='.wav')throw Error('素材路径无效');
   const real=await fs.realpath(candidate);
   if(!real.toLowerCase().startsWith((base+path.sep).toLowerCase()))throw Error('素材路径超出清单目录');
   files.push({file:real,type:row.type,name:row.name,source:row.source,...(row.streamName?{streamName:row.streamName}:{}),...(row.originalLoop?{originalLoop:row.originalLoop}:{}),catalogId:row.id});
  }
  return files;
 }
 async function resolve(ids){return (await resolveEntries(ids)).map(row=>row.file);}
 return {list,resolve,resolveEntries};
}
module.exports={create};
