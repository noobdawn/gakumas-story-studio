'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const idPattern=/^(?:voicevox:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|sovits:[a-z0-9_-]+)$/i;
const canonical=value=>value.trim().normalize('NFKC').toLocaleLowerCase();
function within(parent,target){const rel=path.relative(parent,target);return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));}
function create(root,options={}){
 root=path.resolve(root);
 const file=path.join(root,'voice-aliases.json'),lock=path.join(root,'voice-aliases.lock');
 const assertWritable=options.assertWritable||require('./write-guard').create(root).assertWritable;
 async function prepareRoot(){
  await assertWritable(root);await fs.mkdir(root,{recursive:true});await assertWritable(root);
 }
 async function read(){
  let raw;
  try{raw=await fs.readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return {raw:null,aliases:Object.create(null)};throw error;}
  if(Buffer.byteLength(raw,'utf8')>1024*1024)throw Error('音源别名文件过大');
  let data;try{data=JSON.parse(raw);}catch{throw Error('音源别名文件不是有效 JSON');}
  if(!data||data.format!=='creator-voice-aliases'||data.version!==1||!data.aliases||typeof data.aliases!=='object'||Array.isArray(data.aliases))throw Error('音源别名文件格式无效');
  const aliases=Object.create(null),used=new Set();
  for(const [id,value] of Object.entries(data.aliases)){
   if(!idPattern.test(id)||typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>100||/[\x00-\x1f\x7f]/.test(value))throw Error('音源别名文件包含无效条目');
   const key=canonical(value);if(used.has(key))throw Error('音源别名文件包含重复别名');used.add(key);aliases[id]=value;
  }
  return {raw,aliases};
 }
 async function acquire(){
  try{const handle=await fs.open(lock,'wx');try{await handle.writeFile(JSON.stringify({pid:process.pid,created:Date.now()}));return handle;}catch(error){await handle.close();await fs.unlink(lock).catch(()=>{});throw error;}}
  catch(error){if(error.code!=='EEXIST')throw error;
   try{
    const before=await fs.readFile(lock,'utf8'),stat=await fs.stat(lock),info=JSON.parse(before);
    if(Number.isInteger(info.pid)&&info.pid>0&&Date.now()-stat.mtimeMs>120000){let running=true;try{process.kill(info.pid,0);}catch(e){if(e.code==='ESRCH')running=false;}
     if(!running&&(await fs.readFile(lock,'utf8'))===before){await fs.unlink(lock);return acquire();}}
   }catch(e){if(e.code==='ENOENT')return acquire();}
   throw Error('音源别名库正在被使用，请稍后重试');
  }
 }
 async function rename(id,value,catalog){
  if(!idPattern.test(id)||!Array.isArray(catalog)||!catalog.some(x=>x.id===id))throw Error('音源不存在，请刷新音源库');
  if(typeof value!=='string'||/[\x00-\x1f\x7f]/.test(value))throw Error('别名不能超过 100 字符或包含控制字符');
  value=value.trim();if(value.length>100)throw Error('别名不能超过 100 字符或包含控制字符');
  await prepareRoot();const handle=await acquire();let temp=null;
  try{
   const previous=await read(),aliases=previous.aliases;
   if(value){const key=canonical(value);
    if(Object.entries(aliases).some(([other,name])=>other!==id&&canonical(name)===key)||catalog.some(x=>x.id!==id&&canonical(x.source||'')===key))throw Error('该别名已被其他音源使用');
    aliases[id]=value;
   }else delete aliases[id];
   const contents=JSON.stringify({format:'creator-voice-aliases',version:1,aliases},null,2)+'\n';
   temp=path.join(root,'.voice-aliases-'+crypto.randomUUID()+'.tmp');await fs.writeFile(temp,contents,{encoding:'utf8',flag:'wx'});
   const current=await read();if(current.raw!==previous.raw)throw Error('音源别名文件已被其他程序修改，请重试');
   await fs.rename(temp,file);temp=null;return {id,alias:value};
  }finally{if(temp)await fs.unlink(temp).catch(()=>{});await handle.close();await fs.unlink(lock).catch(()=>{});}
 }
 return {read,rename};
}
module.exports={create};
