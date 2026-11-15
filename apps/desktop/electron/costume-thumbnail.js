'use strict';
const {spawn}=require('node:child_process');
function create({python,script,prefixArgs=['-u']}){
 let active=null,closed=false;
 function generate(assetId,bundles,player,catalogRoot){
  if(closed)return Promise.reject(Error('工作台正在关闭'));
  if(!catalogRoot)return Promise.reject(Error('预览必须使用解包资源目录'));
  if(active)return Promise.reject(Error('正在生成另一张服装缩略图'));
  if(!/^asset-costume-[0-9a-f]{24}$/.test(assetId||''))return Promise.reject(Error('服装标识无效'));
  const job=new Promise((resolve,reject)=>{
   const child=spawn(python,[...prefixArgs,script,'--asset-id',assetId,'--bundles',bundles,'--player',player,...(catalogRoot?['--catalog-root',catalogRoot]:[])],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});let stdout='',stderr='',error=null;
   child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
   child.stdout.on('data',value=>{if(error)return;if(stdout.length+value.length>3*1024*1024){stdout='';error=Error('预览结果过大');}else stdout+=value;});
   child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});child.once('error',e=>{error=e;});
   child.once('close',code=>{if(error)return reject(error);if(code!==0)return reject(Error(stderr.trim()||'服装缩略图生成失败'));try{const data=JSON.parse(stdout);if(data.assetId!==assetId||typeof data.dataUrl!=='string'||!data.dataUrl.startsWith('data:image/png;base64,'))throw Error('预览结果无效');resolve(data.dataUrl);}catch(e){reject(e);}});
  });
  active=job;job.then(()=>{if(active===job)active=null;},()=>{if(active===job)active=null;});return job;
 }
 async function close(){closed=true;if(active)await active.catch(()=>{});}
 return {generate,close};
}
module.exports={create};
