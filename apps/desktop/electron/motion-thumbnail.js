'use strict';
const {spawn}=require('node:child_process'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
function create({python,script,root,assertWritable}){
 let active=null,closed=false;
 const validId=id=>typeof id==='string'&&(/^(asset-film-[0-9a-f]{24}|asset-local-(shy|idle|angry|yes))$/.test(id)||/^asset-face-motion-[A-Za-z0-9_-]{1,190}_f$/.test(id));
 async function cacheFile(id,player,bundles){const stat=await fs.stat(player),key=crypto.createHash('sha256').update(JSON.stringify({v:3,id,bundles:path.resolve(bundles),player:path.resolve(player),size:stat.size,modified:stat.mtimeMs})).digest('hex');return path.join(root,'motion-thumbnails',key+'.json');}
 async function listStatic(ids,player,bundles){if(!Array.isArray(ids)||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>!validId(id)))throw Error('动画缩略图列表无效');const found={};await Promise.all(ids.map(async id=>{try{const file=await cacheFile(id,player,bundles),st=await fs.stat(file);if(st.size>12*1024*1024)return;const data=JSON.parse(await fs.readFile(file,'utf8'));if(data.assetId===id&&Array.isArray(data.frames)&&data.frames.length===12&&typeof data.frames[0]==='string'&&data.frames[0].startsWith('data:image/png;base64,')&&data.frames[0].length<2*1024*1024)found[id]=data.frames[0];}catch(_){}}));return found;}
 async function generate(id,bundles,player,catalogRoot){
  if(!catalogRoot)throw Error('预览必须使用解包资源目录');
  if(closed)throw Error('工作台正在关闭');if(!validId(id))throw Error('动画标识无效');if(active)throw Error('正在生成其他动画预览');
  const job=(async()=>{
   const dir=path.join(root,'motion-thumbnails'),file=await cacheFile(id,player,bundles);
   function validate(x){return x&&x.assetId===id&&Number.isFinite(x.duration)&&x.duration>0&&Array.isArray(x.frames)&&x.frames.length===12&&x.frames.every(v=>typeof v==='string'&&v.startsWith('data:image/png;base64,')&&v.length<2*1024*1024);}
   try{const st=await fs.stat(file);if(st.size<12*1024*1024){const cached=JSON.parse(await fs.readFile(file,'utf8'));if(validate(cached))return cached;}}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
   const result=await new Promise((resolve,reject)=>{
    const child=spawn(python,['-u',script,'--asset-id',id,'--bundles',bundles,'--player',player,...(catalogRoot?['--catalog-root',catalogRoot]:[])],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});let stdout='',stderr='',problem=null;
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',x=>{if(stdout.length+x.length>12*1024*1024){problem=Error('预览结果过大');return;}stdout+=x;});child.stderr.on('data',x=>stderr=(stderr+x).slice(-2000));child.once('error',e=>{problem=e;});child.once('close',code=>{if(problem)return reject(problem);if(code!==0)return reject(Error(stderr.trim()||'动画预览失败'));try{const parsed=JSON.parse(stdout);if(!validate(parsed))throw Error('动画预览数据无效');resolve(parsed);}catch(e){reject(e);}});
   });
   await assertWritable(dir);await fs.mkdir(dir,{recursive:true});await assertWritable(dir);try{await fs.writeFile(file,JSON.stringify(result),{encoding:'utf8',flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}return result;
  })();active=job;try{return await job;}finally{if(active===job)active=null;}
 }
 async function close(){closed=true;if(active)await active.catch(()=>{});}
 return {generate,listStatic,close};
}
module.exports={create};
