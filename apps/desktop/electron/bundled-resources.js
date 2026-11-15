'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
// Install each shipped revision once. Never overwrite a user-edited/shared asset,
// and do not resurrect a deleted preset on every launch.
async function install(source,destination,assertWritable){
 const manifest=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8'));
 if(manifest.version!==1||!Array.isArray(manifest.assets)||!/^[0-9.]+$/.test(manifest.revision))throw Error('预设资源清单无效');
 const marker=path.join(destination,'bundled-resources',manifest.revision+'.json');
 try{await fs.access(marker);return;}catch(e){if(e.code!=='ENOENT')throw e;}
 const shared=path.join(destination,'shared');await assertWritable(shared);await fs.mkdir(shared,{recursive:true});
 for(const item of manifest.assets){
  if(!/^[a-f0-9-]{36}$/.test(item.id)||item.file!=='shared/'+item.id+'.png')throw Error('预设资源路径无效');
  const bytes=await fs.readFile(path.join(source,item.file));
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('预设资源校验失败');
  const metadata=await fs.readFile(path.join(source,'shared',item.id+'.json'));
  await assertWritable(shared);
  for(const [file,data] of [[item.id+'.png',bytes],[item.id+'.json',metadata]]){
   try{await fs.writeFile(path.join(shared,file),data,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
  }
 }
 await assertWritable(path.dirname(marker));await fs.mkdir(path.dirname(marker),{recursive:true});await fs.writeFile(marker,JSON.stringify({revision:manifest.revision}),{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
}
module.exports={install};
