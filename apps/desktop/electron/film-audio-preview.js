'use strict';
// Stream only catalog-validated files over an authenticated loopback endpoint.
const http=require('node:http');const fs=require('node:fs');const fsp=require('node:fs/promises');const crypto=require('node:crypto');
function create({catalog}){
 const token=crypto.randomBytes(32).toString('hex'),sockets=new Set();let server=null,starting=null,closed=false;
 function error(res,status){if(res.destroyed||res.writableEnded)return;if(!res.headersSent)res.writeHead(status,{'Content-Length':'0','Cache-Control':'no-store'});res.end();}
 async function handle(req,res){
  try{
   if(!['GET','HEAD'].includes(req.method))return error(res,405);
   const match=(req.url||'').match(/^\/([0-9a-f]{64})\/((?:bank|unity)%3A[0-9a-f]{64})$/i);
   if(!match||match[1]!==token)return error(res,404);
   const id=decodeURIComponent(match[2]);const [file]=await catalog.resolve([id]);const stat=await fsp.stat(file);if(!stat.isFile()||stat.size<1)return error(res,404);
   let start=0,end=stat.size-1,status=200;const range=req.headers.range;
   if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2])){res.setHeader('Content-Range',`bytes */${stat.size}`);return error(res,416);}
    if(!m[1]){const suffix=Number(m[2]);if(!Number.isSafeInteger(suffix)||suffix<1){res.setHeader('Content-Range',`bytes */${stat.size}`);return error(res,416);}start=Math.max(0,stat.size-suffix);}
    else{start=Number(m[1]);end=m[2]?Math.min(end,Number(m[2])):end;}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=stat.size){res.setHeader('Content-Range',`bytes */${stat.size}`);return error(res,416);}status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${stat.size}`);
   }
   if(res.destroyed)return;res.writeHead(status,{'Content-Type':'audio/wav','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   if(req.method==='HEAD')return res.end();
   const stream=fs.createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }catch(_){error(res,404);}
 }
 async function start(){
  if(closed)throw Error('音频试听已关闭');if(server?.listening)return server.address().port;if(starting)return starting;
  server=http.createServer((req,res)=>void handle(req,res));server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  starting=new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve(server.address().port);});});
  try{return await starting;}finally{starting=null;}
 }
 async function url(id){if(closed)throw Error('音频试听已关闭');if(typeof id!=='string'||!/^(bank|unity):[0-9a-f]{64}$/.test(id))throw Error('音频标识无效');await catalog.resolve([id]);const port=await start();if(closed)throw Error('音频试听已关闭');return `http://127.0.0.1:${port}/${token}/${encodeURIComponent(id)}`;}
 async function close(){closed=true;if(starting)await starting.catch(()=>{});for(const socket of sockets)socket.destroy();if(server?.listening)await new Promise(resolve=>server.close(resolve));}
 return {url,close};
}
module.exports={create};
