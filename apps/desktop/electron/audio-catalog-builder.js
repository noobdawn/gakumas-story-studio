'use strict';
// Prepare a fresh local audio catalog; the game directory is only read.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
function create({dataRoot,python='python',scripts=require('./runtime-paths').importer,onComplete=async()=>{},assertWritable=async()=>{}}){
 let active=null,status={state:'idle'},closed=false;
 const inside=(parent,child)=>{const p=path.resolve(parent).toLowerCase(),c=path.resolve(child).toLowerCase();return c===p||c.startsWith(p+path.sep);};
 async function runChild(args){if(closed)throw Error('音频准备已停止');return new Promise((resolve,reject)=>{
  const task=active,child=spawn(python,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});task.child=child;
  let tail='';const read=buf=>{tail=(tail+buf.toString('utf8')).slice(-4000);const lines=tail.trim().split(/\r?\n/);status.message=lines.at(-1)?.slice(-400)||status.message;};child.stdout.on('data',read);child.stderr.on('data',read);
  child.once('error',reject);child.once('close',code=>{task.child=null;if(code!==0)reject(Error((tail.trim()||'进程退出码 '+code).slice(-1000)));else resolve();});
 });}
 async function start(game){
  if(closed)throw Error('工作台正在关闭');if(active)throw Error('已有音频准备任务运行');if(typeof game!=='string'||!path.isAbsolute(game))throw Error('游戏目录无效');active={child:null};
  try{
  const gameReal=await fs.realpath(game);let ancestor=path.resolve(dataRoot),realAncestor;while(true){try{realAncestor=await fs.realpath(ancestor);break;}catch(error){if(error.code!=='ENOENT')throw error;const next=path.dirname(ancestor);if(next===ancestor)throw error;ancestor=next;}}
  const target=path.resolve(realAncestor,path.relative(ancestor,path.resolve(dataRoot)));if(inside(gameReal,target))throw Error('创作器数据目录不能位于游戏目录');
  const base=path.join(target,'audio-catalogs');await assertWritable(base);await fs.mkdir(base,{recursive:true});const realBase=await fs.realpath(base);await assertWritable(realBase);if(inside(gameReal,realBase))throw Error('创作器数据目录不能位于游戏目录');
  const work=path.join(realBase,crypto.randomUUID());await fs.mkdir(work);const catalog=path.join(work,'catalog'),inventory=path.join(work,'inventory.json');
  active={child:null,work};status={state:'running',phase:'扫描游戏清单',message:'正在读取本地游戏目录'};
  const promise=(async()=>{try{
   await runChild([path.join(scripts,'inventory.py'),'--game',gameReal,'--out',inventory]);
   status.phase='准备音频资源';await runChild([path.join(scripts,'prepare_film_assets.py'),'--index',inventory,'--out',catalog,'--audio-only']);
   const prepared=JSON.parse(await fs.readFile(path.join(catalog,'summary.json'),'utf8'));
   const bankRows=(await fs.readFile(path.join(catalog,'audio-banks.jsonl'),'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
   const bankErrors=bankRows.filter(row=>row.error&&!/\.mp3$/i.test(row.name||''));
   if(prepared.bundle_errors||prepared.missing_dependencies?.length||bankErrors.length)throw Error(`本地音频资源缺失或校验失败：Unity 包 ${prepared.bundle_errors}、依赖 ${prepared.missing_dependencies?.length||0}、音频库 ${bankErrors.length}`);
   status.phase='解码音频库';await runChild([path.join(scripts,'decode_film_audio.py'),'--root',catalog,'--cancel-file',path.join(work,'cancel')]);
   status.phase='解码 Unity 音频';await runChild([path.join(scripts,'decode_film_unity_audio.py'),'--root',catalog]);
   const summary=JSON.parse(await fs.readFile(path.join(catalog,'audio-summary.json'),'utf8')),unity=JSON.parse(await fs.readFile(path.join(catalog,'audio-unity-summary.json'),'utf8'));
   if(summary.errors||summary.skippedForSpace||unity.errors||unity.skippedForSpace||summary.files+unity.files===0)throw Error(`音频准备不完整：音频库错误 ${summary.errors}、Unity 错误 ${unity.errors}；请检查本地资源及磁盘空间`);
   if(closed)throw Error('音频准备已停止');await onComplete(catalog);status={state:'complete',phase:'准备完成',message:`已准备 ${summary.files+unity.files} 条音频`,catalog};return catalog;
  }catch(error){status={state:'error',phase:status.phase,message:String(error.message).slice(-1000),work};throw error;}finally{active=null;}})();
  promise.catch(()=>{});return {started:true};
  }catch(error){active=null;throw error;}
 }
 async function close(){closed=true;const task=active,child=task?.child;if(!child)return;let done=false;const exited=new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null){done=true;return resolve();}child.once('close',()=>{done=true;resolve();});});
  if(status.phase==='解码音频库'&&task.work){await fs.writeFile(path.join(task.work,'cancel'),'stop',{flag:'wx'}).catch(()=>{});let timer;await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(resolve,3000);})]);clearTimeout(timer);}
  if(!done){if(process.platform==='win32')await new Promise(resolve=>{const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',()=>{child.kill();resolve();});killer.once('close',code=>{if(code!==0)child.kill();resolve();});});else child.kill();}
  let timer;await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);clearTimeout(timer);
 }
 return {start,getStatus:()=>({...status}),close};
}
module.exports={create};
