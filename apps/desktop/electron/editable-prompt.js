'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
function create(root,assertWritable){
 const file=path.join(root,'translation-prompt.txt');
 const hash=raw=>crypto.createHash('sha256').update(raw).digest('hex');
 function validate(raw){const prompt=raw.replace(/^\uFEFF/,'');if(Buffer.byteLength(raw)>100000||!prompt.trim()||prompt.length>12000||prompt.includes('\0'))throw Error('translation-prompt.txt 须为 UTF-8 文本，内容为 1～12000 字');return prompt;}
 async function read(fallback){try{const bytes=await fs.readFile(file);let raw;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('translation-prompt.txt 编码无效，请保存为 UTF-8');}return {prompt:validate(raw),revision:hash(bytes)};}catch(e){if(e.code==='ENOENT')return {prompt:fallback,revision:null};throw e;}}
 async function ensure(fallback){await assertWritable(root);await fs.mkdir(root,{recursive:true});await assertWritable(file);try{await fs.writeFile(file,validate(fallback),{encoding:'utf8',flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}return file;}
 async function save(prompt,revision){validate(prompt);await assertWritable(root);await fs.mkdir(root,{recursive:true});await assertWritable(file);const temp=path.join(root,'.prompt-'+crypto.randomUUID()+'.tmp');try{
  await fs.writeFile(temp,prompt,{encoding:'utf8',flag:'wx'});
  if(revision!==undefined&&(await read('')).revision!==revision)throw Error('提示词文件已在外部修改，请重新载入文件后再保存');
  await fs.rename(temp,file);
 }finally{await fs.unlink(temp).catch(()=>{});}return hash(prompt);}
 return {file,read,ensure,save};
}
module.exports={create};
