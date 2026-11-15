'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const words=require('../ui/pronunciation');
function create(root,options={}){
 root=path.resolve(root);const file=path.join(root,'pronunciation-replacements.json');
 async function read(){let raw;try{raw=await fs.readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')return {rules:structuredClone(words.defaults),revision:null};throw e;}
  if(Buffer.byteLength(raw)>100000)throw Error('发音替换词文件过大');let data;try{data=JSON.parse(raw);}catch{throw Error('发音替换词文件不是有效 JSON');}
  if(!data||data.format!=='creator-pronunciation-replacements'||data.version!==1)throw Error('发音替换词文件格式无效');
  return {rules:words.validate(data.rules),revision:crypto.createHash('sha256').update(raw).digest('hex')};
 }
 async function save(input,revision){
  const rules=words.validate(input);if(revision!==null&&!(typeof revision==='string'&&/^[0-9a-f]{64}$/.test(revision)))throw Error('词表版本无效');
  if(options.assertWritable)await options.assertWritable(root);await fs.mkdir(root,{recursive:true});if(options.assertWritable)await options.assertWritable(file);
  const lock=path.join(root,'pronunciation-replacements.lock');let handle;
  async function acquire(){try{const h=await fs.open(lock,'wx');try{await h.writeFile(JSON.stringify({pid:process.pid,created:Date.now()}));return h;}catch(e){await h.close();await fs.unlink(lock).catch(()=>{});throw e;}}catch(e){if(e.code!=='EEXIST')throw e;try{const before=await fs.readFile(lock,'utf8'),stat=await fs.stat(lock),info=JSON.parse(before);if(Number.isInteger(info.pid)&&info.pid>0&&Date.now()-stat.mtimeMs>120000){let running=true;try{process.kill(info.pid,0);}catch(err){if(err.code==='ESRCH')running=false;}if(!running&&(await fs.readFile(lock,'utf8'))===before){await fs.unlink(lock);return acquire();}}}catch(err){if(err.code==='ENOENT')return acquire();}throw Error('词表正在被其他窗口保存，请稍后重试');}}
  handle=await acquire();
  let temp;try{const current=await read();if(current.revision!==revision)throw Error('词表已被其他窗口修改，请重新打开设置');
   temp=path.join(root,'.pronunciation-'+crypto.randomUUID()+'.tmp');const raw=JSON.stringify({format:'creator-pronunciation-replacements',version:1,rules},null,2)+'\n';
   await fs.writeFile(temp,raw,{encoding:'utf8',flag:'wx'});await fs.rename(temp,file);temp=null;return {rules,revision:crypto.createHash('sha256').update(raw).digest('hex')};
  }finally{if(temp)await fs.unlink(temp).catch(()=>{});await handle.close();await fs.unlink(lock).catch(()=>{});}
 }
 return {read,save};
}
module.exports={create};
