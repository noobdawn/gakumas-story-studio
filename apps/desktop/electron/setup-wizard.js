'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
function create({runtime,assertWritable,dialog,window,voices,spawnProcess=spawn}){
 let job=null,starting=false,cancelled=false,status={state:'idle',message:''};
 const busy=()=>starting||Boolean(job);
 const config=()=>path.join(runtime.data(),'onboarding.json');
 async function read(){try{return JSON.parse(await fs.readFile(config(),'utf8'));}catch(e){if(e.code==='ENOENT')return {version:1,completed:false,engine:'none'};throw e;}}
 async function save(value){await assertWritable(runtime.data());await fs.mkdir(runtime.data(),{recursive:true});const temp=config()+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(value));await fs.rename(temp,config());}
 async function info(){const catalog=JSON.parse(await fs.readFile(path.join(runtime.root,'resources/voicevox/models.json'),'utf8'));return {settings:await read(),data:runtime.data(),models:catalog.models,terms:catalog.terms,status:{...status}};}
 async function acquireLock(lock){
  try{return await fs.open(lock,'wx');}catch(error){
   if(error.code!=='EEXIST')throw error;
   const raw=await fs.readFile(lock,'utf8');let record;try{record=JSON.parse(raw);}catch{throw Error('安装锁损坏，请关闭所有创作器后删除 voice-engines/.install.lock 再重试');}
   const pids=[record.pid,record.child].filter(pid=>Number.isInteger(pid)&&pid>0);
   if(!pids.length)throw Error('安装锁无效');
   for(const pid of pids){try{process.kill(pid,0);throw Error('另一创作器仍在安装语音');}catch(e){if(e.code!=='ESRCH')throw e;}}
   if(await fs.readFile(lock,'utf8')!==raw)throw Error('安装任务已变化，请重试');
   await fs.unlink(lock);return fs.open(lock,'wx');
  }
 }
 async function chooseData(){if(busy())throw Error('请先取消下载');const saved=await read();if(saved.completed)throw Error('已完成初始化的数据目录请通过迁移工具调整');const pick=await dialog.showOpenDialog(window(),{title:'选择创作器数据目录',properties:['openDirectory','createDirectory']});if(pick.canceled)return;const target=path.resolve(pick.filePaths[0]);await assertWritable(target);const existing=await fs.readdir(target);if(existing.length)throw Error('请选择空目录，已有作品或资源不会移动');return target;}
 async function start(ids,accepted){if(busy())throw Error('已有下载任务');starting=true;cancelled=false;try{if(accepted!==true)throw Error('请先阅读并确认声库使用条款');const catalog=(await info()).models;if(!Array.isArray(ids)||!ids.length||ids.some(id=>!catalog.some(x=>x.id===id)))throw Error('请选择有效声库');
  const base=runtime.voice();await assertWritable(base);await fs.mkdir(base,{recursive:true});const lock=path.join(base,'.install.lock');const handle=await acquireLock(lock);try{await handle.writeFile(JSON.stringify({pid:process.pid}));}finally{await handle.close();}const staging=path.join(base,'.install-'+crypto.randomUUID());
  status={state:'running',message:'准备下载'};let buffer='',errors='';
  let child;try{child=spawnProcess(runtime.python(),['-X','utf8',path.join(runtime.host,'install_voicevox.py'),'--models',[...new Set(ids)].join(','),'--staging',staging],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1'}});}catch(error){await fs.unlink(lock);throw error;}job=child;
  require('node:fs').writeFileSync(lock,JSON.stringify({pid:process.pid,child:child.pid}));
  child.stdout.on('data',chunk=>{buffer+=chunk.toString('utf8');let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);try{if(!cancelled)status={...JSON.parse(line),state:'running'};}catch{}}});
  child.stderr.on('data',c=>{errors=(errors+c.toString('utf8')).slice(-2000);});
  child.on('error',error=>{errors=error.message;});
  child.on('close',async code=>{try{await fs.rm(staging,{recursive:true,force:true});await fs.unlink(lock);if(!cancelled&&code===0){const settings=await read();await save({...settings,engine:'voicevox'});await voices.list();}status={state:cancelled?'cancelled':code===0?'complete':'error',message:cancelled?'下载已取消':code===0?'引擎与声库已安装':errors||'安装失败'};}catch(e){status={state:'error',message:e.message};}finally{job=null;}});
  if(cancelled){status={state:'cancelling',message:'正在取消'};child.kill();}
 }finally{starting=false;}
 }
 function cancel(){if(busy()){cancelled=true;status={state:'cancelling',message:'正在取消'};if(job)job.kill();}}
 async function finish(engine){if(busy())throw Error('请等待下载结束');if(!['none','voicevox','sovits'].includes(engine))throw Error('引擎选择无效');if(engine!=='none'){const v=await voices.list();if(!v.voices.some(x=>x.voiceProvider===engine&&x.available!==false))throw Error('所选引擎未准备完成');}await save({version:1,completed:true,engine});}
 return {read,info,chooseData,start,cancel,finish,busy};
}
module.exports={create};
