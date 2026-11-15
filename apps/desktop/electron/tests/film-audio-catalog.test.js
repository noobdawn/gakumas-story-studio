'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const catalog=require('../film-audio-catalog');
const library=require('../media-library');

test('本地清单可查找、导入并拒绝越界或过期条目',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-film-test-'));
 const wav=path.join(root,'sud_se_test.wav'),index=path.join(root,'audio-unity.jsonl');
 const row={bundle:'sud_se_test',file:'sud_se_test.wav',category:'音效'};
 await fs.writeFile(wav,Buffer.from('RIFFtestWAVE'));await fs.writeFile(index,JSON.stringify(row)+'\n');await fs.writeFile(path.join(root,'audio-wav.jsonl'),'');
 const c=catalog.create(root),rows=await c.list();assert.equal(rows.length,1);assert.equal(rows[0].type,'音效');
 const project=crypto.randomUUID(),lib=library.create(path.join(root,'lib'));const imported=await lib.importFiles(await c.resolve([rows[0].id]),'project',project);
 assert.equal(imported.errors.length,0);assert.equal(imported.assets[0].type,'音效');assert.deepEqual(await fs.readFile(wav),Buffer.from('RIFFtestWAVE'));
 await assert.rejects(c.resolve(['bank:0']),/变化/);await assert.rejects(c.resolve([rows[0].id,rows[0].id]),/无效/);
 await fs.writeFile(index,JSON.stringify({...row,file:'../outside.wav'})+'\n');const changed=await c.list();await assert.rejects(c.resolve([rows[0].id]),/变化/);await assert.rejects(c.resolve([changed[0].id]),/路径/);
 await fs.unlink(path.join(root,'lib','projects',project,imported.assets[0].id+'.wav'));await fs.rmdir(path.join(root,'lib','projects',project));await fs.rmdir(path.join(root,'lib','projects'));await fs.rmdir(path.join(root,'lib'));await fs.unlink(wav);await fs.unlink(index);await fs.unlink(path.join(root,'audio-wav.jsonl'));await fs.rmdir(root);
});

test('音频清单区分预加载片段和主音频并保留可靠时长',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-film-meta-'));
 try{
  const pre={bank:'sud_bgm_test.acb',index:1,category:'音乐',file:'pre.wav',metadata:{sampleRate:48000,numberOfSamples:4800,playSamples:9600,streamInfo:{name:'test [pre]'}}};
  const main={...pre,bank:'sud_bgm_test.awb',file:'main.wav',metadata:{sampleRate:48000,numberOfSamples:96000,playSamples:200000,loopingInfo:{start:100,end:96000},streamInfo:{name:'original-track-name'}}};
  const bad={...main,file:'bad.wav',metadata:{...main.metadata,loopingInfo:{start:100,end:96001}}};
  await fs.writeFile(path.join(root,'audio-wav.jsonl'),[pre,main,bad].map(x=>JSON.stringify(x)).join('\n'));await fs.writeFile(path.join(root,'audio-unity.jsonl'),JSON.stringify({bundle:'unity-test',file:'unity.wav',category:'音效'}));
  const rows=await catalog.create(root).list();assert.deepEqual(rows.map(x=>x.source),['预加载短段','AWB 音频','AWB 音频','Unity 音频']);assert.equal(rows[0].duration,.1);assert.equal(rows[1].duration,2);assert.equal(rows[1].streamName,'original-track-name');assert.equal(rows[1].hasLoopMetadata,true);assert.equal(rows[2].hasLoopMetadata,undefined);assert.equal(rows[3].duration,undefined);assert.ok(rows.every(x=>!('file' in x)));
 }finally{for(const name of ['audio-wav.jsonl','audio-unity.jsonl'])await fs.unlink(path.join(root,name));await fs.rmdir(root);}
});

test('目录来源和子音轨在工程及共享导入后保留',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-film-origin-'));
 try{
  const row={bank:'sud_se_test.acb',index:3,category:'音效',file:'003.wav',metadata:{streamInfo:{name:'sound-cue'}}};
  await fs.writeFile(path.join(root,'003.wav'),'RIFFtestWAVE');await fs.writeFile(path.join(root,'audio-wav.jsonl'),JSON.stringify(row));await fs.writeFile(path.join(root,'audio-unity.jsonl'),'');
  const c=catalog.create(root),listed=await c.list(),entries=await c.resolveEntries([listed[0].id]),lib=library.create(path.join(root,'lib')),project=crypto.randomUUID();
  for(const scope of ['project','shared']){const result=await lib.importFiles(entries.map(x=>x.file),scope,project,entries);assert.equal(result.errors.length,0);const asset=result.assets[0];assert.equal(asset.type,'音效');assert.match(asset.source,/sound-cue/);assert.deepEqual(asset.filmAudio,{catalogId:listed[0].id,name:'sud_se_test.acb #3',source:'ACB 音频',streamName:'sound-cue'});if(scope==='shared')assert.deepEqual((await lib.listShared())[0].filmAudio,asset.filmAudio);}
  await assert.rejects(lib.importFiles(entries.map(x=>x.file),'project',project,[{...entries[0],file:'other'}]),/来源无效/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('人工 WAV 循环范围绑定内容，修改后校验拒绝',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gss-loop-fixture-'));
 try{const bytes=Buffer.alloc(44+16000);bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(16000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(16000,40);
 const file=path.join(root,'fixture.wav');await fs.writeFile(file,bytes);const entry={file,catalogId:'bank:'+'a'.repeat(64),type:'音效',name:'fixture',source:'fixture',originalLoop:{start:800,end:7200,sampleRate:8000,frames:8000,channels:1}};
 const lib=library.create(path.join(root,'lib')),project=crypto.randomUUID(),result=await lib.importFiles([file],'project',project,[entry]);assert.equal(result.errors.length,0);const asset=result.assets[0];assert.equal(asset.filmAudio.originalLoop.start,800);assert.deepEqual(await lib.bindOriginalLoop(asset,entry),asset.filmAudio.originalLoop);
 bytes[bytes.length-1]^=1;await fs.writeFile(path.join(root,'lib','projects',project,asset.id+'.wav'),bytes);await assert.rejects(lib.bindOriginalLoop(asset,entry),/内容不同/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
