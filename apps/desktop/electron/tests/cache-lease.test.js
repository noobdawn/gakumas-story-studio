'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {recover}=require('../cache-lease');
const windows={skip:process.platform!=='win32'};
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gss-lease-test-'));
 await fs.writeFile(path.join(root,'.creator-asset-cache.json'),JSON.stringify({format:'gakumas-creator-asset-cache',version:1,id:crypto.randomUUID()}));
 await fs.writeFile(path.join(root,'keep.bundle'),'cache data');
 const child=spawn(process.execPath,['-e',''],{windowsHide:true});await once(child,'exit');
 const previous={pid:child.pid,id:crypto.randomUUID()},file=path.join(root,'.creator-cache.lock');await fs.writeFile(file,JSON.stringify(previous));
 return {root,previous,file,async close(){assert.equal(await fs.readFile(path.join(root,'keep.bundle'),'utf8'),'cache data');await fs.rm(root,{recursive:true,force:true});}};
}
test('dead owner recovers only its marker; simultaneous recoverers serialize',windows,async()=>{
 const x=await fixture();try{
  const results=await Promise.all([recover(x.root,x.previous),recover(x.root,x.previous)]);
  assert.equal(results.filter(x=>x.state==='recovered').length,1);assert(results.some(x=>x.state==='missing'));
  await assert.rejects(fs.access(x.file));
 }finally{await x.close();}
});
test('live owner and a replaced identity stay protected',windows,async()=>{
 const x=await fixture();try{
  const active={...x.previous,pid:process.pid};await fs.writeFile(x.file,JSON.stringify(active));
  assert.equal((await recover(x.root,x.previous)).state,'changed');
  await assert.rejects(recover(x.root,active),/仍被进程/);assert.deepEqual(JSON.parse(await fs.readFile(x.file,'utf8')),active);
 }finally{await x.close();}
});
test('a live process explicitly reading the cache prevents stale recovery',windows,async()=>{
 const x=await fixture(),child=spawn(process.execPath,['-e','setInterval(()=>{},1000)','--',x.root],{windowsHide:true,stdio:'ignore'});
 try{
  await once(child,'spawn');await assert.rejects(recover(x.root,x.previous),/仍被进程/);assert.deepEqual(JSON.parse(await fs.readFile(x.file,'utf8')),x.previous);
 }finally{if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill();await done;}await x.close();}
});
test('orphaned descendants prevent recovery even without the cache path in argv',windows,async()=>{
 const x=await fixture();let orphan;
 try{
  const source="const p=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{detached:true,stdio:'ignore',windowsHide:true});console.log(p.pid);p.unref();";
  const parent=spawn(process.execPath,['-e',source],{windowsHide:true,stdio:['ignore','pipe','inherit']});let output='';parent.stdout.on('data',b=>output+=b);await once(parent,'close');orphan=Number(output.trim());assert(orphan>0);
  const previous={...x.previous,pid:parent.pid};await fs.writeFile(x.file,JSON.stringify(previous));
  await assert.rejects(recover(x.root,previous),/仍被进程/);assert.deepEqual(JSON.parse(await fs.readFile(x.file,'utf8')),previous);
 }finally{if(orphan)try{process.kill(orphan);}catch(e){if(e.code!=='ESRCH')throw e;}await x.close();}
});
test('unreadable lease content is retained',windows,async()=>{
 const x=await fixture();try{await fs.writeFile(x.file,'broken');await assert.rejects(recover(x.root,x.previous),/无法确认/);assert.equal(await fs.readFile(x.file,'utf8'),'broken');}finally{await x.close();}
});
