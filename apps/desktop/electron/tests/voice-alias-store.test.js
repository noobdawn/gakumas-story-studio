'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {create}=require('../voice-alias-store');
const a='voicevox:388f246b-8c41-4ac1-8e2d-5d79f3ff56d9',b='sovits:manbo',missing='voicevox:12345678-1234-1234-1234-123456789abc';
const catalog=[{id:a,source:'ずんだもん'},{id:b,source:'曼波'}];
async function fixture(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'creator-voice-alias-'));try{await fn(dir);}finally{for(const name of await fs.readdir(dir))await fs.unlink(path.join(dir,name));await fs.rmdir(dir);}}
test('跨实例保存别名，空白恢复原名，保持音源 ID',()=>fixture(async dir=>{
 const store=create(dir);assert.deepEqual(await store.rename(a,' 月村手毬 ',catalog),{id:a,alias:'月村手毬'});
 assert.equal((await create(dir).read()).aliases[a],'月村手毬');
 await store.rename(b,'琴音',catalog);await store.rename(a,'   ',catalog);
 const saved=(await create(dir).read()).aliases;assert.equal(saved[a],undefined);assert.equal(saved[b],'琴音');
}));
test('同类音源名称按大小写和 Unicode 规范化去重，保留离线音源别名',()=>fixture(async dir=>{
 const store=create(dir);await store.rename(a,'Ｋｏｔｏｎｅ',catalog);
 await assert.rejects(store.rename(b,'kotone',catalog),/已被其他音源使用/);
 await assert.rejects(store.rename(b,'ずんだもん',[{id:a,source:'ずんだもん'},{id:b,source:'曼波'}].map(x=>x.id===a?{...x,source:'别的原名'}:x).concat([{id:missing,source:'ずんだもん'}])),/已被其他音源使用/);
 await store.rename(missing,'离线音源',[...catalog,{id:missing,source:'其他'}]);
 await assert.rejects(store.rename(b,'离线音源',catalog),/已被其他音源使用/);
 assert.equal((await store.read()).aliases[missing],'离线音源');
}));
test('损坏文件和被占用的锁不会被覆盖',()=>fixture(async dir=>{
 const store=create(dir),file=path.join(dir,'voice-aliases.json'),lock=path.join(dir,'voice-aliases.lock');
 await fs.writeFile(file,'not json');await assert.rejects(store.rename(a,'别名',catalog),/JSON/);assert.equal(await fs.readFile(file,'utf8'),'not json');
 await fs.writeFile(lock,JSON.stringify({pid:process.pid,created:Date.now()}));await assert.rejects(store.rename(a,'别名',catalog),/正在被使用/);assert.equal(await fs.readFile(file,'utf8'),'not json');
}));
test('并发写入不会产生重复别名或覆盖数据',()=>fixture(async dir=>{
 const results=await Promise.allSettled([create(dir).rename(a,'同一名称',catalog),create(dir).rename(b,'同一名称',catalog)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 const saved=(await create(dir).read()).aliases;assert.equal(Object.values(saved).filter(x=>x==='同一名称').length,1);
}));
test('拒绝写入所选游戏目录',()=>fixture(async dir=>{
 await fs.writeFile(path.join(dir,'game-directory.json'),JSON.stringify({game:dir}));
 await assert.rejects(create(dir).rename(a,'别名',catalog),/只读游戏目录/);
}));
