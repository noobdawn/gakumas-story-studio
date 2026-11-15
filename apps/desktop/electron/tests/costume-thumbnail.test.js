'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const thumbnails=require('../costume-thumbnail');const library=require('../media-library');
test('服装缩略图任务串行且关闭时等待工作完成',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'creator-costume-worker-')),script=path.join(dir,'worker.cjs');
 try{await fs.writeFile(script,"setTimeout(()=>console.log(JSON.stringify({assetId:process.argv[3],dataUrl:'data:image/png;base64,iVBORw0KGgo='})),150)");const manager=thumbnails.create({python:process.execPath,script,prefixArgs:[]});const id='asset-costume-0123456789abcdef01234567',job=manager.generate(id,'base','player','catalog');await assert.rejects(manager.generate(id,'base','player','catalog'),/正在生成/);const closing=manager.close();assert.equal(await job,'data:image/png;base64,iVBORw0KGgo=');await closing;await assert.rejects(manager.generate(id,'base','player','catalog'),/关闭/);}finally{await fs.unlink(script);await fs.rmdir(dir);}
});
test('服装缩略图按标识缓存，拒绝非法标识',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'creator-costume-cache-')),lib=library.create(dir),id='asset-costume-0123456789abcdef01234567';
 try{const png='data:image/png;base64,iVBORw0KGgo=';await lib.saveThumbnail(id,png);assert.equal((await lib.listCostumeThumbnails([id]))[id],png);assert.deepEqual(await lib.listCostumeThumbnails(['asset-costume-aaaaaaaaaaaaaaaaaaaaaaaa']),{});await assert.rejects(lib.listCostumeThumbnails(['../x']),/无效/);await assert.rejects(lib.saveThumbnail('../x',png),/无效/);}finally{const p=path.join(dir,'thumbnails',id);for(const f of await fs.readdir(p))await fs.unlink(path.join(p,f));await fs.rmdir(p);await fs.rmdir(path.join(dir,'thumbnails'));await fs.rmdir(dir);}
});

test('无解包目录时不启动预览进程',async()=>{const manager=thumbnails.create({python:'must-not-run',script:'missing'});await assert.rejects(manager.generate('asset-costume-0123456789abcdef01234567','base','player'),/解包资源目录/);await manager.close();});
