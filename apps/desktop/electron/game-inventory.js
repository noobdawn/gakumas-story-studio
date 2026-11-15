'use strict';
// Scan names and candidate paths; only the manifest itself is authenticated by inventory.py.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const groups=[['body','身体候选',n=>/^mdl_chr_.*_body$/.test(n)],['hair','头发候选',n=>/^mdl_chr_.*_hair$/.test(n)],['face','脸部候选',n=>/^mdl_chr_.*_face$/.test(n)],['motion','动作候选',n=>n.startsWith('mot_')],['scene','场景候选',n=>n.startsWith('env_')]];
function summarize(scan){
 if(!scan||scan.manifest_checksum!=='valid'||typeof scan.manifest_sha256!=='string'||!/^[a-f0-9]{64}$/i.test(scan.manifest_sha256)||!Array.isArray(scan.records))throw Error('扫描结果无效');
 const results=groups.map(([id,label,match])=>{const rows=scan.records.filter(r=>r.kind==='asset'&&typeof r.name==='string'&&match(r.name));return {id,label,total:rows.length,found:rows.filter(r=>Array.isArray(r.local_candidates)&&r.local_candidates.length>0).length,ambiguous:rows.filter(r=>Array.isArray(r.local_candidates)&&r.local_candidates.length>1).length,missing:rows.filter(r=>!Array.isArray(r.local_candidates)||!r.local_candidates.length).slice(0,20).map(r=>r.name)};});
 return {format:'creator-game-inventory-summary',version:1,game:scan.game,manifestSha256:scan.manifest_sha256,scannedAt:scan.scan_utc,groups:results};
}
function create({dataRoot,python,script=path.join(require('./runtime-paths').importer,'inventory.py'),assertWritable=async()=>{},prefixArgs=['-B']}){
 let active=null,closed=false,status={state:'idle'};
 async function start(game){
  if(closed)throw Error('工作台正在关闭');if(active)throw Error('已有素材扫描正在进行');if(typeof game!=='string'||!path.isAbsolute(game))throw Error('游戏目录无效');
  const task={child:null,cancelled:false,done:null};active=task;status={state:'running',message:'正在准备扫描目录。'};
  try{const realGame=await fs.realpath(game),base=await require('./write-guard').resolvedTarget(path.resolve(dataRoot,'game-inventories'));await assertWritable(base);
   const gameKey=realGame.toLowerCase(),baseKey=base.toLowerCase();if(baseKey===gameKey||baseKey.startsWith(gameKey+path.sep))throw Error('扫描结果不能写入游戏目录');
   await fs.mkdir(base,{recursive:true});const realBase=await fs.realpath(base);await assertWritable(realBase);const realKey=realBase.toLowerCase();if(realKey===gameKey||realKey.startsWith(gameKey+path.sep))throw Error('扫描结果不能写入游戏目录');
   if(closed||task.cancelled)throw Error('扫描已取消');const work=path.join(realBase,crypto.randomUUID());await fs.mkdir(work);if(closed||task.cancelled)throw Error('扫描已取消');
   const inventory=path.join(work,'inventory.json');status={state:'running',message:'正在只读扫描游戏清单和本地缓存，完成后显示统计。',work};
   task.done=(async()=>{try{
    await new Promise((resolve,reject)=>{if(task.cancelled||closed)return reject(Error('扫描已取消'));const child=spawn(python,[...prefixArgs,script,'--game',realGame,'--out',inventory],{windowsHide:true,stdio:['ignore','pipe','pipe']});task.child=child;let tail='';const read=b=>{tail=(tail+b.toString('utf8')).slice(-3000);};child.stdout.on('data',read);child.stderr.on('data',read);child.once('error',reject);child.once('close',code=>{task.child=null;if(task.cancelled||closed)return reject(Error('扫描已取消'));if(code!==0)return reject(Error((tail.trim()||'扫描进程退出码 '+code).slice(-1000)));resolve();});});
    if(task.cancelled||closed)throw Error('扫描已取消');const summary=summarize(JSON.parse(await fs.readFile(inventory,'utf8')));if(task.cancelled||closed)throw Error('扫描已取消');await assertWritable(work);await fs.writeFile(path.join(work,'summary.json'),JSON.stringify(summary,null,2),{encoding:'utf8',flag:'wx'});status={state:'complete',summary,work};
   }catch(e){status={state:task.cancelled||closed?'cancelled':'error',message:String(e.message).slice(-1000),work};}finally{if(active===task)active=null;}})();return {started:true};
  }catch(e){if(active===task)active=null;status={state:task.cancelled||closed?'cancelled':'error',message:e.message};throw e;}
 }
 async function cancel(){const task=active;if(!task)return;task.cancelled=true;if(task.child)task.child.kill();if(task.done)await task.done;}
 async function close(){closed=true;await cancel();}
 return {start,cancel,close,getStatus:()=>({...status})};
}
module.exports={create,summarize};
