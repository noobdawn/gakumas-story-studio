'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {create,summarize}=require('../game-inventory');
const snapshot={manifest_checksum:'valid',manifest_sha256:'a'.repeat(64),game:'test',scan_utc:'2026-01-01',records:[{kind:'asset',name:'mdl_chr_a_body',local_candidates:['a']},{kind:'asset',name:'mdl_chr_b_body',local_candidates:[]},{kind:'asset',name:'mot_x',local_candidates:['a','b']},{kind:'asset',name:'env_3d_x',local_candidates:['a']},{kind:'resource',name:'mot_bad',local_candidates:[]}]};
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function done(manager){for(let i=0;i<300;i++){const s=manager.getStatus();if(s.state!=='running')return s;await wait(10);}throw Error('扫描超时');}
test('候选统计区分缺失、歧义和素材种类',()=>{const r=summarize(snapshot);assert.deepEqual(r.groups.map(g=>[g.total,g.found,g.ambiguous]),[[2,1,0],[0,0,0],[0,0,0],[1,1,1],[1,1,0]]);assert.deepEqual(r.groups[0].missing,['mdl_chr_b_body']);assert.throws(()=>summarize({...snapshot,manifest_checksum:'invalid'}),/无效/);});
test('新目录扫描、并发拒绝、错误及取消',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-inventory-test-'));
 try{const game=path.join(root,'game'),data=path.join(root,'data'),script=path.join(root,'scanner.js');await fs.mkdir(game);
  const fake=`const fs=require('fs'),p=process.argv,output=p[p.indexOf('--out')+1];setTimeout(()=>fs.writeFileSync(output,${JSON.stringify(JSON.stringify(snapshot))},{flag:'wx'}),150);`;
  await fs.writeFile(script,fake);const manager=create({dataRoot:data,python:process.execPath,script,prefixArgs:[]});await manager.start(game);await assert.rejects(manager.start(game),/已有/);let status=await done(manager);assert.equal(status.state,'complete',status.message);assert.deepEqual(JSON.parse(await fs.readFile(path.join(status.work,'summary.json'),'utf8')),status.summary);const first=status.work;await manager.start(game);status=await done(manager);assert.equal(status.state,'complete');assert.notEqual(status.work,first);await manager.start(game);await manager.cancel();assert.equal(manager.getStatus().state,'cancelled');await manager.close();await assert.rejects(manager.start(game),/关闭/);
  const bad=create({dataRoot:data,python:process.execPath,script:path.join(root,'missing'),prefixArgs:[]});await bad.start(game);assert.equal((await done(bad)).state,'error');await bad.close();
  const unsafe=create({dataRoot:path.join(game,'data'),python:process.execPath,script,prefixArgs:[]});await assert.rejects(unsafe.start(game),/不能写入游戏目录/);assert.deepEqual(await fs.readdir(game),[]);await unsafe.close();
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
