'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net');
const {create}=require('../control-server');
function call(port,message){return new Promise((resolve,reject)=>{const s=net.connect(port,'127.0.0.1',()=>s.write(JSON.stringify(message)+'\n'));let data='';s.on('data',x=>data+=x);s.on('end',()=>{try{resolve(JSON.parse(data));}catch(e){reject(e);}});s.on('error',reject);});}
test('控制服务仅接受正确令牌，串行处理并报告未知命令',async()=>{
 const token='a'.repeat(64);let release,entered;const started=new Promise(r=>entered=r);const c=create({token,dispatch:async command=>{if(command==='hold'){entered();await new Promise(r=>release=r);return 'done';}throw Error('未知命令');}});const addr=await c.listen(0);
 try{assert.equal(addr.address,'127.0.0.1');assert.match((await call(addr.port,{id:'1',token:'b'.repeat(64),command:'hold',args:{}})).error,/认证/);assert.match((await call(addr.port,{id:'2',token,command:'bad',args:{}})).error,/未知/);const first=call(addr.port,{id:'3',token,command:'hold',args:{}});await started;assert.match((await call(addr.port,{id:'4',token,command:'hold',args:{}})).error,/正在处理/);release();assert.equal((await first).result,'done');}
 finally{c.close();}
});
