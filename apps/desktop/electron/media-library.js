'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {constants}=require('node:fs');
const originalLoop=require('./original-loop');
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const formats={'.mp4':['视频','video/mp4'],'.mov':['视频','video/quicktime'],'.webm':['视频','video/webm'],'.mkv':['视频','video/x-matroska'],'.png':['贴图','image/png'],'.jpg':['贴图','image/jpeg'],'.jpeg':['贴图','image/jpeg'],'.webp':['贴图','image/webp'],'.gif':['贴图','image/gif'],'.wav':['音乐','audio/wav'],'.mp3':['音乐','audio/mpeg'],'.ogg':['音乐','audio/ogg'],'.m4a':['音乐','audio/mp4']};
function create(root,options={}){
 const shared=path.join(root,'shared'), projects=path.join(root,'projects');
 const visualJobs=new Map(),deleting=new Set();
 const assertWritable=options.assertWritable||require('./write-guard').create(root).assertWritable;
 function validateProject(projectId){if(!ID.test(projectId||''))throw Error('工程标识无效');}
 function location(a){
  if(!a||!ID.test(a.id||'')||!formats[a.extension]||!['project','shared'].includes(a.scope))throw Error('素材标识无效');
  if(a.scope==='project')validateProject(a.projectId);
  const base=a.scope==='shared'?shared:path.join(projects,a.projectId);
  return path.join(base,a.id+a.extension);
 }
 async function listShared(){
  await assertWritable(shared);await fs.mkdir(shared,{recursive:true});const result=[];
  for(const name of await fs.readdir(shared))if(/^[0-9a-f-]{36}\.json$/i.test(name)){
   try {const a=JSON.parse(await fs.readFile(path.join(shared,name),'utf8'));if(a.scope!=='shared'||name!==a.id+'.json')continue;const file=location(a);try{await fs.access(file);result.push(a);}catch(e){if(e.code==='ENOENT')result.push({...a,available:false});else throw e;}} catch(_){}
  }
  return result.sort((a,b)=>a.source.localeCompare(b.source));
 }
 async function audioStatus(a){if(a?.type==='视频'){try{const info=await visualInfo(a);return {available:info.hasAudio};}catch(_){return {available:false};}}if(!a||!['音乐','音效'].includes(a.type)||!['.wav','.mp3','.ogg','.m4a'].includes(a.extension))throw Error('音频素材无效');const file=location(a);try{const stat=await fs.stat(file);return {available:stat.isFile()&&stat.size>0};}catch(e){if(e.code==='ENOENT')return {available:false};throw e;}}
 async function bindOriginalLoop(a,entry){if(!a||!['音乐','音效'].includes(a.type)||a.extension!=='.wav'||!entry?.originalLoop||a.filmAudio?.catalogId!==entry.catalogId)throw Error('此音频没有可用的原始循环点');const file=location(a),[stat,sourceStat]=await Promise.all([fs.stat(file),fs.stat(entry.file)]);if(!stat.isFile()||stat.size<44||stat.size>100*1024*1024||!sourceStat.isFile()||sourceStat.size!==stat.size)throw Error('音频文件无效或与本地清单大小不同');const [source,actual]=await Promise.all([fs.readFile(entry.file),fs.readFile(file)]),expected=originalLoop.bind(source,entry.originalLoop),found=originalLoop.bind(actual,entry.originalLoop);if(expected.sha256!==found.sha256)throw Error('导入的音频与本地清单内容不同，不能应用原始循环点');return found;}
 async function restoreAudio(a,source){
  if(!a||!['音乐','音效'].includes(a.type)||!['.wav','.mp3','.ogg','.m4a'].includes(a.extension))throw Error('音频素材无效');
  const target=location(a);if(typeof source!=='string'||!path.isAbsolute(source)||path.extname(source).toLowerCase()!==a.extension)throw Error('请选择相同格式的音频文件');
  const stat=await fs.stat(source);if(!stat.isFile()||stat.size<1||stat.size>100*1024*1024)throw Error('文件为空或超过 100 MB');
  await assertWritable(path.dirname(target));await fs.mkdir(path.dirname(target),{recursive:true});await assertWritable(path.dirname(target));
  try{await fs.copyFile(source,target,constants.COPYFILE_EXCL);}catch(e){if(e.code==='EEXIST')throw Error('素材文件已存在，不会覆盖');throw e;}
  return {available:true};
 }
 async function importFiles(files,scope,projectId,filmEntries){
  if(!Array.isArray(files)||files.length<1||files.length>100||!['project','shared'].includes(scope))throw Error('导入请求无效');
  if(filmEntries!==undefined&&(!Array.isArray(filmEntries)||filmEntries.length!==files.length||filmEntries.some((x,i)=>!x||x.file!==files[i]||!['音乐','音效'].includes(x.type)||typeof x.name!=='string'||x.name.length>500||typeof x.source!=='string'||x.source.length>100||typeof x.catalogId!=='string'||!/^(bank|unity):[0-9a-f]{64}$/.test(x.catalogId)||(x.streamName!==undefined&&(typeof x.streamName!=='string'||x.streamName.length>500))||(x.originalLoop!==undefined&&!originalLoop.valid(x.originalLoop)))))throw Error('本地音频来源无效');
  if(scope==='project')validateProject(projectId);
  const base=scope==='shared'?shared:path.join(projects,projectId);await assertWritable(base);
  const made=[],errors=[];
  for(const [index,file] of files.entries()){
   let created=null;
   try {
    if(typeof file!=='string'||!path.isAbsolute(file))throw Error('无法读取拖入的文件');
    const ext=path.extname(file).toLowerCase(), format=formats[ext];if(!format)throw Error('不支持的格式');
    const stat=await fs.stat(file);const limit=format[0]==='视频'?2*1024*1024*1024:100*1024*1024;if(!stat.isFile()||stat.size===0||stat.size>limit)throw Error('文件为空或超出限制（图片/音频 100 MB，视频 2 GB）');
    const basename=path.basename(file),bank=path.basename(path.dirname(file)),bankSample=ext==='.wav'&&/^\d{4}\.wav$/i.test(basename)&&/^sud_(?:se|bgm|music)_.+\.(?:acb|awb)$/i.test(bank);
    const origin=filmEntries?.[index];if(origin&&ext!=='.wav')throw Error('本地音频格式无效');
    const source=origin?(origin.streamName?origin.streamName+' · '+origin.name:origin.name)+'.wav':bankSample?bank+' #'+parseInt(basename,10)+'.wav':basename;
    const type=origin?.type||(ext==='.wav'&&/^sud_se_/i.test(bankSample?bank:basename)?'音效':format[0]);
    const bytes=origin?.originalLoop?await fs.readFile(file):null;if(bytes&&bytes.length!==stat.size)throw Error('音频读取期间发生变化');const bound=bytes?originalLoop.bind(bytes,origin.originalLoop):null;
    const a={id:crypto.randomUUID(),type,alias:'',source,scope,extension:ext,...(scope==='project'?{projectId}:{}),...(origin?{filmAudio:{catalogId:origin.catalogId,name:origin.name,source:origin.source,...(origin.streamName?{streamName:origin.streamName}:{}),...(bound?{originalLoop:bound}:{})}}:{})};
    const dest=location(a);await fs.mkdir(path.dirname(dest),{recursive:true});await assertWritable(path.dirname(dest));if(bytes)await fs.writeFile(dest,bytes,{flag:'wx'});else await fs.copyFile(file,dest,constants.COPYFILE_EXCL);created=dest;
    if(options.prepareVisual&&['贴图','视频'].includes(type)){options.onProgress?.({index:index+1,total:files.length,name:basename});a.visual=await visualInfo(a);}
     if(scope==='shared')await fs.writeFile(path.join(shared,a.id+'.json'),JSON.stringify(a),{encoding:'utf8',flag:'wx'});
    made.push(a);
   } catch(e) {if(created){await fs.unlink(created).catch(()=>{});const prepared=path.join(path.dirname(created),path.basename(created,path.extname(created))+'.media');for(const name of ['preview.png','image.png','video.mp4','poster.png','audio.wav','info.json'])await fs.unlink(path.join(prepared,name)).catch(()=>{});await fs.rmdir(prepared).catch(()=>{});}errors.push({name:path.basename(String(file)),error:e.message});}
  }
  return {assets:made,errors};
 }
 function visualInfo(a){if(!['贴图','视频'].includes(a?.type)||!options.prepareVisual)throw Error('画面准备服务不可用');const file=location(a);if(deleting.has(file))throw Error('此素材正在删除');if(visualJobs.has(file))return visualJobs.get(file);const job=(async()=>{await assertWritable(path.dirname(file));return options.prepareVisual(file);})().finally(()=>visualJobs.delete(file));visualJobs.set(file,job);return job;}
  async function preview(a){let file=location(a);if(['贴图','视频'].includes(a.type)&&options.prepareVisual){await visualInfo(a);file=path.join(path.dirname(file),a.id+'.media','preview.png');}const stat=await fs.stat(file);if(stat.size>16*1024*1024)throw Error('预览文件超过 16 MB');return 'data:'+(['贴图','视频'].includes(a.type)&&options.prepareVisual?'image/png':formats[a.extension][1])+';base64,'+(await fs.readFile(file)).toString('base64');}
 async function saveGenerated(projectId,bytes){
  validateProject(projectId);if(!Buffer.isBuffer(bytes)||bytes.length<44||bytes.length>100*1024*1024||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('生成结果不是有效的 WAV');
  const a={id:crypto.randomUUID(),type:'音效',alias:'',source:'生成对白.wav',scope:'project',extension:'.wav',projectId};const dest=location(a);await assertWritable(path.dirname(dest));await fs.mkdir(path.dirname(dest),{recursive:true});await assertWritable(path.dirname(dest));await fs.writeFile(dest,bytes,{flag:'wx'});return a;
 }
 async function deleteFile(a){const file=location(a);if(visualJobs.has(file))throw Error('此素材正在准备，请准备完成后再删除');if(deleting.has(file))throw Error('此素材正在删除');deleting.add(file);try{return await deleteFiles(a);}finally{deleting.delete(file);}}
 async function deleteFiles(a){
  const file=location(a),base=path.dirname(file),rootReal=await fs.realpath(root);
  // Never follow junctions/symlinks out of the managed media library. Validate
  // every candidate before unlinking anything; only known generated files count.
  async function check(target,directory=false){
   await assertWritable(target);
   try{const stat=await fs.lstat(target);if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile()))throw Error('素材删除目标不是普通'+(directory?'目录':'文件'));
    const real=await fs.realpath(target),relative=path.relative(rootReal,real);if(relative.startsWith('..')||path.isAbsolute(relative)||!relative)throw Error('素材删除目标超出素材库');
    return true;
   }catch(e){if(e.code==='ENOENT')return false;throw e;}
  }
  if(!await check(base,true))return {deleted:true};
  const prepared=path.join(base,a.id+'.media'),files=[file];
  if(a.scope==='shared')files.push(path.join(base,a.id+'.json'));
  if(await check(prepared,true)){
   const allowed=new Set(['preview.png','image.png','video.mp4','poster.png','audio.wav','info.json']);
   const names=await fs.readdir(prepared);if(names.some(n=>!allowed.has(n)))throw Error('素材准备目录包含未知文件，未执行删除');
   files.push(...names.map(n=>path.join(prepared,n)));
  }
  const existing=[];for(const target of files)if(await check(target))existing.push(target);
  const warnings=[];for(const [index,target] of existing.entries()){try{await fs.unlink(target);}catch(e){if(e.code==='ENOENT')continue;if(index===0)throw e;warnings.push(path.basename(target)+': '+e.message);}}
  if(await check(prepared,true))try{await fs.rmdir(prepared);}catch(e){warnings.push(e.message);}
  return {deleted:true,warnings};
 }
 const thumbnailIds=['asset-actor-1','scene-trainingroom','scene-classroom','scene-courtyard','scene-dormitory','scene-rooftop'];
 const dynamicSceneThumbnailId=/^scene-(?:2d-env_2d_|3d-env_3d_)[A-Za-z0-9_-]{1,160}$/;
 const costumeThumbnailId=/^asset-costume-[0-9a-f]{24}$/;
 async function saveThumbnail(assetId,dataUrl){
  if((!thumbnailIds.includes(assetId)&&!costumeThumbnailId.test(assetId||'')&&!dynamicSceneThumbnailId.test(assetId||''))||typeof dataUrl!=='string'||!dataUrl.startsWith('data:image/png;base64,'))throw Error('缩略图格式无效');
  const bytes=Buffer.from(dataUrl.slice('data:image/png;base64,'.length),'base64');if(bytes.length<8||bytes.length>2*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('缩略图不是有效 PNG');
  const dir=path.join(root,'thumbnails',assetId);await assertWritable(dir);await fs.mkdir(dir,{recursive:true});await assertWritable(dir);await fs.writeFile(path.join(dir,Date.now()+'-'+crypto.randomUUID()+'.png'),bytes,{flag:'wx'});
 }
 async function listThumbnails(){
  const thumbs={},ids=[...thumbnailIds];try{for(const e of await fs.readdir(path.join(root,'thumbnails'),{withFileTypes:true}))if(e.isDirectory()&&dynamicSceneThumbnailId.test(e.name))ids.push(e.name);}catch(e){if(e.code!=='ENOENT')throw e;}for(const assetId of ids){try{const dir=path.join(root,'thumbnails',assetId),files=(await fs.readdir(dir)).filter(x=>/^\d+-[0-9a-f-]{36}\.png$/i.test(x)).sort();if(!files.length)continue;const file=path.join(dir,files[files.length-1]);const stat=await fs.stat(file);if(stat.size<=2*1024*1024)thumbs[assetId]='data:image/png;base64,'+(await fs.readFile(file)).toString('base64');}catch(_){}}
  return thumbs;
 }
 async function listCostumeThumbnails(ids){
  if(!Array.isArray(ids)||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!costumeThumbnailId.test(id)))throw Error('服装缩略图列表无效');
  const thumbs={},base=path.join(root,'thumbnails');let existing;
  try{await assertWritable(base);existing=new Set(await fs.readdir(base));}catch(_){return thumbs;}
  await Promise.all(ids.filter(id=>existing.has(id)).map(async assetId=>{try{const dir=path.join(base,assetId);await assertWritable(dir);const files=(await fs.readdir(dir)).filter(x=>/^\d+-[0-9a-f-]{36}\.png$/i.test(x)).sort();if(!files.length)return;const file=path.join(dir,files[files.length-1]),stat=await fs.stat(file);if(stat.size<=2*1024*1024)thumbs[assetId]='data:image/png;base64,'+(await fs.readFile(file)).toString('base64');}catch(_){}}));return thumbs;
 }
 const locateFile=a=>require('./asset-location').containedFile(root,location(a));
 return {listShared,importFiles,preview,visualInfo,saveGenerated,saveThumbnail,listThumbnails,listCostumeThumbnails,audioStatus,restoreAudio,bindOriginalLoop,deleteFile,locateFile};
}
module.exports={create};
