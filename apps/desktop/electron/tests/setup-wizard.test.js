'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events');
const {create}=require('../setup-wizard');
async function fixture(run){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gss-onboarding-'));
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{child.killed=true;};
 const runtime={root,host:root,data:()=>path.join(root,'data'),voice:()=>path.join(root,'data/voice-engines'),python:()=>process.execPath};
 await fs.mkdir(path.join(root,'resources/voicevox'),{recursive:true});
 await fs.writeFile(path.join(root,'resources/voicevox/models.json'),JSON.stringify({models:[{id:'0.vvm'}],terms:'fixture'}));
 const wizard=create({runtime,assertWritable:async()=>{},dialog:{},window:()=>null,voices:{list:async()=>({voices:[]})},spawnProcess:()=>child});
 try{await run({wizard,child,runtime});}finally{await fs.rm(root,{recursive:true,force:true});}
}
async function settled(wizard){for(let n=0;n<100&&wizard.busy();n++)await new Promise(r=>setTimeout(r,10));assert.equal(wizard.busy(),false);}
test('first run can skip speech and persists completion; missing engine cannot finish',()=>fixture(async({wizard})=>{
 assert.equal((await wizard.read()).completed,false);
 await assert.rejects(wizard.finish('voicevox'),/未准备完成/);
 await wizard.finish('none');assert.deepEqual(await wizard.read(),{version:1,completed:true,engine:'none'});
}));
test('invalid consent/models cannot start or leave wizard busy',()=>fixture(async({wizard})=>{
 await assert.rejects(wizard.start(['0.vvm'],false),/使用条款/);assert.equal(wizard.busy(),false);
 await assert.rejects(wizard.start(['unknown'],true),/有效声库/);assert.equal(wizard.busy(),false);
}));
test('concurrent downloads and finish are blocked; cancellation survives late stdout and permits retry',()=>fixture(async({wizard,child,runtime})=>{
 const start=wizard.start(['0.vvm'],true);
 await assert.rejects(wizard.start(['0.vvm'],true),/已有下载/);await start;
 await assert.rejects(wizard.finish('none'),/等待下载/);
 wizard.cancel();child.stdout.emit('data',Buffer.from('{"message":"late progress"}\n'));
 assert.equal((await wizard.info()).status.state,'cancelling');assert.equal(child.killed,true);
 child.emit('close',0);await settled(wizard);
 assert.equal((await wizard.info()).status.state,'cancelled');assert.equal((await wizard.read()).completed,false);
 await assert.rejects(fs.stat(path.join(runtime.voice(),'.install.lock')),{code:'ENOENT'});
}));
