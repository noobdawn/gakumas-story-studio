'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile,spawn}=require('node:child_process');
const {promisify}=require('node:util');
const exec=promisify(execFile);
const AUDIO_ROOT=require('./runtime-paths').voice();
const ARCHIVE=path.join(AUDIO_ROOT,'voicevox');
const DEFAULT_SOVITS=path.join(AUDIO_ROOT,'sovits');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function inside(root,file){const rel=path.relative(root,file);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);}
async function existingFile(root,relative){
 if(typeof relative!=='string'||path.isAbsolute(relative))return null;
 try{const realRoot=await fs.realpath(root),file=await fs.realpath(path.resolve(realRoot,relative));if(!inside(realRoot,file)||(await fs.stat(file)).isFile()===false)return null;return file;}catch{return null;}
}
function create(options={}){
 const aliases=require('./voice-alias-store').create(options.dataRoot||process.env.CREATOR_LIBRARY_DIR||path.resolve(__dirname,'..','user-library'),{assertWritable:options.assertWritable});
 const replacements=require('./pronunciation-store').create(options.dataRoot||process.env.CREATOR_LIBRARY_DIR||path.resolve(__dirname,'..','user-library'),{assertWritable:options.assertWritable});
 const python=options.python||process.env.CREATOR_VOICEVOX_PYTHON||require('./runtime-paths').python();
 const models=options.models||process.env.CREATOR_VOICEVOX_MODELS||path.join(ARCHIVE,'models');
 const samples=options.samples||process.env.CREATOR_VOICEVOX_SAMPLES||path.join(ARCHIVE,'listening');
 const sovits=options.sovits||process.env.CREATOR_SOVITS_ROOT||DEFAULT_SOVITS;
 const scanner=options.scanner||path.join(require('./runtime-paths').host,'voice_catalog_probe.py');
 let catalog=[], previewEntries=new Map(), warnings=[],job=null;
 async function list(){
  const result=[],issues=[];const previews=new Map();let records=[];
  try{const raw=JSON.parse(await fs.readFile(path.join(samples,'manifest.json'),'utf8'));if(Array.isArray(raw.samples))records=raw.samples;}catch(error){issues.push('VOICEVOX 试听归档不可用：'+error.message);}
  try{
   const response=await exec(python,['-B','-s',scanner,'--models',models],{timeout:30000,maxBuffer:4*1024*1024,windowsHide:true,encoding:'utf8',env:{...process.env,CREATOR_SOVITS_ROOT:sovits,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});
   const scan=JSON.parse(response.stdout);
   if(!Array.isArray(scan.voices)||!Array.isArray(scan.errors))throw Error('声库元数据格式错误');
   for(const item of scan.voices){
    if(!item||typeof item.id!=='string'||!item.id.startsWith('voicevox:')||!uuid.test(item.id.slice(9))||typeof item.source!=='string'||!Array.isArray(item.styles))continue;
    const styles=[],seen=new Set(),conflicts=new Set();
    for(const s of item.styles)if(s&&Number.isSafeInteger(s.id)){const same=item.styles.filter(x=>x&&x.id===s.id);if(new Set(same.map(x=>x.modelId)).size>1)conflicts.add(s.id);}
    for(const styleId of conflicts)issues.push('VOICEVOX '+item.source+' 的风格 ID '+styleId+' 存在多个模型，已跳过');
    for(const s of item.styles){
     if(!s||!Number.isSafeInteger(s.id)||s.id<0||typeof s.name!=='string'||!/^\d+\.vvm$|^n0\.vvm$/i.test(s.model)||conflicts.has(s.id)||seen.has(s.id))continue;
     seen.add(s.id);
     const record=records.find(r=>typeof r?.speaker_uuid==='string'&&r.speaker_uuid.toLowerCase()===item.id.slice(9).toLowerCase()&&r.style_id===s.id&&r.model===s.model);
     const file=record&&await existingFile(samples,record.file);const key=item.id+':'+s.id;
     if(file&&path.extname(file).toLowerCase()==='.wav')previews.set(key,file);
     styles.push({...s,previewAvailable:previews.has(key)});
    }
    if(styles.length)result.push({...item,styles});
   }
   issues.push(...scan.errors.map(x=>'VOICEVOX 模型 '+x.model+'：'+x.error));
  }catch(error){issues.push('VOICEVOX 音源不可用：'+(error.killed?'读取超时':error.message));}
  try{
   const folder=path.join(sovits,'voices','manbo'),profile=JSON.parse(await fs.readFile(path.join(folder,'voice.json'),'utf8'));
   const required=await Promise.all([profile.gpt,profile.sovits,profile.reference].map(x=>existingFile(folder,x)));
   const runtime=await existingFile(sovits,path.join('runtime','python.exe'));
   const available=required.every(Boolean)&&Boolean(runtime);
   const item={id:'sovits:manbo',type:'音源',alias:'',source:String(profile.name||'曼波'),voiceProvider:'sovits',version:String(profile.version||''),available,styles:[{id:'default',name:'默认',previewAvailable:false}]};
   const originalProfile=path.resolve(sovits).toLowerCase()===path.resolve(DEFAULT_SOVITS).toLowerCase()&&profile.gpt==='manbo-e10.ckpt'&&profile.sovits==='manbo_e8_s168.pth'&&profile.reference==='refer.wav';
   const sample=originalProfile?await existingFile(AUDIO_ROOT,path.join('results','sovits-ja-01','speech.wav')):null;
   if(sample){previews.set(item.id+':default',sample);item.styles[0].previewAvailable=true;}
   result.push(item);if(!available)issues.push('GPT-SoVITS 曼波配置缺少运行时、模型或参考音频');
  }catch(error){issues.push('GPT-SoVITS 本地研究配置不可用：'+error.message);}
  try{const saved=await aliases.read();for(const item of result)item.alias=saved.aliases[item.id]||'';}catch(error){issues.push('音源别名库读取失败：'+error.message);}
  result.sort((a,b)=>(a.alias||a.source).localeCompare(b.alias||b.source,'ja'));catalog=result;previewEntries=previews;warnings=issues;
  return {voices:catalog,warnings};
 }
 async function preview(id,styleId){
  if(typeof id!=='string'||!(typeof styleId==='string'||Number.isSafeInteger(styleId)))throw Error('音源标识无效');
  const voice=catalog.find(x=>x.id===id),style=voice?.styles.find(x=>String(x.id)===String(styleId));
  if(!voice||!style||!style.previewAvailable)throw Error('该音源没有可用的试听样本');
  const allowed=voice.voiceProvider==='voicevox'?samples:AUDIO_ROOT,file=previewEntries.get(id+':'+style.id),root=await fs.realpath(allowed),real=await fs.realpath(file);
  if(!inside(root,real))throw Error('试听样本不在允许的目录中');
  const stat=await fs.stat(real);
  if(!stat.isFile()||stat.size>8*1024*1024)throw Error('试听样本不可用');
  const bytes=await fs.readFile(real);if(bytes.length<12||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('试听样本不是 WAV');
  return 'data:audio/wav;base64,'+bytes.toString('base64');
 }
 async function rename(id,alias){const updated=await aliases.rename(id,alias,catalog);catalog=catalog.map(item=>item.id===id?{...item,alias:updated.alias}:item);return updated;}
 async function cook(reference,text,language){
  if(job)throw Error('已有语音正在生成，请稍后重试');
  if(!reference||typeof text!=='string'||!text.trim()||text.length>1000||!['all_ja','zh'].includes(language))throw Error('对白文本或语言无效');
  const voice=catalog.find(x=>x.id===reference.id),style=voice?.styles.find(x=>String(x.id)===String(reference.styleId));
  if(!voice||!style||voice.available===false)throw Error('音源或语气不可用，请刷新音源库');
  if((style.modelId&&style.modelId!==reference.modelId)||(voice.voiceProvider==='sovits'&&voice.version!==reference.version))throw Error('音源模型版本已变化，请先确认');
  if(voice.voiceProvider==='voicevox'&&language!=='all_ja')throw Error('VOICEVOX 当前只支持日语生成');
  const model=voice.voiceProvider==='voicevox'?await existingFile(models,style.model):null;if(voice.voiceProvider==='voicevox'&&!model)throw Error('音源模型缺失');
  if(job)throw Error('已有语音正在生成，请稍后重试');
  const spokenText=voice.voiceProvider==='voicevox'?require('../ui/pronunciation').voicevox(text,(await replacements.read()).rules):text;
  if(!spokenText.trim())throw Error('处理后没有可朗读内容；纯省略号请保留为静默停顿');
  if(spokenText.length>1000)throw Error('替换后的语音文本超过 1000 字');
  if(job)throw Error('已有语音正在生成，请稍后重试');
  const request={provider:voice.voiceProvider,text:spokenText.trim(),language,model,modelId:style.modelId,speaker:voice.id.slice(9),style:style.id,version:voice.version||'',sovits,dictionary:path.join(ARCHIVE,'engine','dictionary'),runtime:path.join(ARCHIVE,'engine','onnxruntime','voicevox_onnxruntime.dll'),timing:voice.voiceProvider==='voicevox'};
  return new Promise((resolve,reject)=>{
   const child=spawn(voice.voiceProvider==='sovits'?path.join(sovits,'runtime','python.exe'):python,['-B','-s',options.cooker||path.join(require('./runtime-paths').host,'cook_voice.py')],{windowsHide:true,env:{...process.env,CREATOR_SOVITS_ROOT:sovits,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'}});job=child;let chunks=[],size=0,errors='',settled=false;
   const timer=setTimeout(()=>{child.kill();finish(Error('语音生成超时'));},180000);
   function finish(error,result){if(settled)return;settled=true;clearTimeout(timer);if(job===child)job=null;error?reject(error):resolve({...result,spokenText});}
   child.stdout.on('data',chunk=>{size+=chunk.length;if(size>100*1024*1024){child.kill();finish(Error('生成音频过大'));}else chunks.push(chunk);});
   child.stderr.on('data',chunk=>{errors=(errors+chunk.toString('utf8')).slice(-3000);});
   child.on('error',finish);child.on('close',code=>{if(code!==0)return finish(Error('语音生成失败：'+(errors.trim().split('\n').pop()||'引擎退出 '+code)));try{const output=Buffer.concat(chunks);if(voice.voiceProvider!=='voicevox')return finish(null,{bytes:output,timing:null});if(output.length<8||output.toString('ascii',0,4)!=='VVT1')throw Error('语音时间数据缺失');const n=output.readUInt32LE(4);if(n>2*1024*1024||n+8>=output.length)throw Error('语音时间数据无效');const timing=JSON.parse(output.subarray(8,8+n).toString('utf8'));finish(null,{bytes:output.subarray(8+n),timing});}catch(error){finish(error);}});
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request));
  });
 }
 function cancel(){if(job)job.kill();}
 return {list,preview,rename,cook,cancel};
}
module.exports={create};
