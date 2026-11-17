'use strict';
const net=require('node:net');
const crypto=require('node:crypto');
function create({token,dispatch}) {
 if(typeof token!=='string'||!/^[0-9a-f]{64}$/i.test(token))throw Error('控制令牌必须是 64 位十六进制字符串');
 const secret=Buffer.from(token,'hex');const clients=new Set();let busy=false;
 const server=net.createServer(socket=>{
  if(clients.size>=16){socket.destroy();return;}clients.add(socket);socket.setEncoding('utf8');socket.setTimeout(30000,()=>socket.destroy());let buffer='',pending=false;
  socket.on('error',()=>{});socket.on('close',()=>clients.delete(socket));
  socket.on('data',async chunk=>{
   buffer+=chunk;if(Buffer.byteLength(buffer)>65536){socket.destroy();return;}
   const pos=buffer.indexOf('\n');if(pos<0)return;
   if(pending||buffer.indexOf('\n',pos+1)>=0||buffer.slice(pos+1).length){socket.destroy();return;}
   const raw=buffer.slice(0,pos);buffer='';pending=true;socket.setTimeout(300000);let reply;
   try{
    const request=JSON.parse(raw);const given=typeof request.token==='string'&&/^[0-9a-f]{64}$/i.test(request.token)?Buffer.from(request.token,'hex'):Buffer.alloc(0);
    if(given.length!==secret.length||!crypto.timingSafeEqual(given,secret))throw Error('认证失败');
    if(typeof request.id!=='string'||request.id.length<1||request.id.length>100||typeof request.command!=='string'||request.command.length>80||!request.args||typeof request.args!=='object'||Array.isArray(request.args))throw Error('请求格式无效');
    socket.setTimeout(request.command==='video.benchmark'&&request.args.fullProject===true?1800000:300000);
    if(busy)throw Error('控制接口正在处理其他请求');busy=true;
    try{const result=await dispatch(request.command,request.args);reply={id:request.id,ok:true,result};}finally{busy=false;}
   }catch(error){reply={ok:false,error:String(error.message||error)};}
   if(!socket.destroyed)socket.end(JSON.stringify(reply)+'\n');
  });
 });
 return {server,listen:port=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve(server.address());});}),close:()=>{for(const socket of clients)socket.destroy();server.close();}};
}
module.exports={create};
