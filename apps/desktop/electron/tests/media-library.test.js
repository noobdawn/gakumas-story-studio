'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {create}=require('../media-library');
test('视频导入保留原文件并准备封面，失败清理本次复制，不产生素材记录',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-video-import-')),source=path.join(root,'movie.mp4'),library=path.join(root,'library');await fs.writeFile(source,'fixture-video');
 const info={version:1,kind:'video',width:64,height:48,duration:1,fps:30,hasAudio:true};const lib=create(library,{prepareVisual:async file=>{const folder=path.join(path.dirname(file),path.basename(file,'.mp4')+'.media');await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'preview.png'),'fixture-png');return info;}});
 try{const result=await lib.importFiles([source],'shared',crypto.randomUUID());assert.equal(result.errors.length,0);assert.equal(result.assets[0].type,'视频');assert.deepEqual(result.assets[0].visual,info);assert.ok((await lib.preview(result.assets[0])).startsWith('data:image/png;'));assert.equal(await fs.readFile(source,'utf8'),'fixture-video');const before=await fs.readdir(path.join(library,'shared'));const fail=create(library,{prepareVisual:async()=>{throw Error('bad decoder');}});const rejected=await fail.importFiles([source],'shared',crypto.randomUUID());assert.equal(rejected.errors.length,1);assert.deepEqual(await fs.readdir(path.join(library,'shared')),before);}
 finally{const resolved=await fs.realpath(root);assert.ok(resolved.startsWith(await fs.realpath(os.tmpdir())));await fs.rm(resolved,{recursive:true});}
});
test('导入复制源文件，本工程与共享目录隔离，重启可读取共享素材',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-media-test-'));const source=path.join(root,'picture.png'), music=path.join(root,'music.wav');
 await fs.writeFile(source,Buffer.from([137,80,78,71,13,10,26,10]));await fs.writeFile(music,Buffer.from('RIFFtestWAVE'));
 const lib=create(path.join(root,'library')), project=crypto.randomUUID();
 const p=await lib.importFiles([source],'project',project);const g=await lib.importFiles([music],'shared',project);
 assert.equal(p.assets.length,1);assert.equal(g.assets.length,1);assert.deepEqual(await fs.readFile(source),Buffer.from([137,80,78,71,13,10,26,10]));
 assert.deepEqual((await create(path.join(root,'library')).listShared()).map(x=>x.id),[g.assets[0].id]);
 assert.ok((await lib.preview(p.assets[0])).startsWith('data:image/png;base64,'));
 assert.ok((await lib.preview(g.assets[0])).startsWith('data:audio/wav;base64,'));
 await assert.rejects(lib.preview({...p.assets[0],projectId:'../outside'}),/标识/);
 const rejected=await lib.importFiles([path.join(root,'invalid.exe')],'shared',project);assert.equal(rejected.errors.length,1);
});

test('缩略图写入新缓存并可在新会话读取',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-thumb-test-'));const lib=create(root);const png='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,1,2]).toString('base64');
 await lib.saveThumbnail('scene-classroom',png);assert.equal((await create(root).listThumbnails())['scene-classroom'],png);
 await assert.rejects(lib.saveThumbnail('../other',png),/格式/);await assert.rejects(lib.saveThumbnail('scene-classroom','data:image/png;base64,eA=='),/PNG/);
});

test('导入解包音效时保留音频库名称并归类为音效',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-game-sfx-')),bank=path.join(root,'sud_se_general.acb'),source=path.join(bank,'0001.wav'),library=path.join(root,'library'),project=crypto.randomUUID();
 await fs.mkdir(bank);await fs.writeFile(source,Buffer.from('RIFFtestWAVE'));
 try{const result=await create(library).importFiles([source],'project',project);assert.equal(result.errors.length,0);const asset=result.assets[0];assert.equal(asset.type,'音效');assert.equal(asset.source,'sud_se_general.acb #1.wav');await fs.unlink(path.join(library,'projects',project,asset.id+'.wav'));await fs.rmdir(path.join(library,'projects',project));await fs.rmdir(path.join(library,'projects'));await fs.rmdir(library);}
 finally{await fs.unlink(source);await fs.rmdir(bank);await fs.rmdir(root);}
});


test('拒绝向所选只读游戏目录导入素材和创建共享库',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gss-media-guard-'));
 try{await fs.writeFile(path.join(root,'game-directory.json'),JSON.stringify({game:root}));
 const lib=create(root),project=crypto.randomUUID();
 await assert.rejects(lib.importFiles([path.join(root,'x.wav')],'project',project),/只读游戏目录/);
 await assert.rejects(lib.listShared(),/只读游戏目录/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('缺失音频保留引用并可从同格式副本恢复，绝不覆盖现有文件',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-audio-relink-'));
 try{
  const source=path.join(root,'sound.wav');await fs.writeFile(source,'RIFFtestWAVE');const lib=create(path.join(root,'lib')),project=crypto.randomUUID();
  for(const scope of ['project','shared']){
   const asset=(await lib.importFiles([source],scope,project)).assets[0],dest=scope==='project'?path.join(root,'lib','projects',project,asset.id+'.wav'):path.join(root,'lib','shared',asset.id+'.wav');
   await assert.rejects(lib.restoreAudio(asset,source),/不会覆盖/);await fs.unlink(dest);assert.equal((await lib.audioStatus(asset)).available,false);
   if(scope==='shared')assert.equal((await lib.listShared()).find(a=>a.id===asset.id).available,false);
   const wrong=path.join(root,'sound.mp3');await fs.writeFile(wrong,'wrong');await assert.rejects(lib.restoreAudio(asset,wrong),/相同格式/);
   await lib.restoreAudio(asset,source);assert.equal((await lib.audioStatus(asset)).available,true);assert.deepEqual(await fs.readFile(dest),await fs.readFile(source));
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});


test('缓存场景缩略图在重开后恢复且拒绝越界 ID',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-scene-thumb-test-'));
 try{const lib=create(root),id='scene-2d-env_2d_all_classroom-00-01-noon_c00',png='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');await lib.saveThumbnail(id,png);assert.equal((await create(root).listThumbnails())[id],png);await assert.rejects(lib.saveThumbnail('scene-2d-env_2d_../../bad',png),/格式/);}
 finally{await fs.rm(root,{recursive:true,force:true})}
});
