'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const catalogs=require('../film-audio-catalog');const previews=require('../film-audio-preview');
test('只试听清单内文件，支持音频范围请求并在关闭后退出',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-film-preview-')),file=path.join(root,'sound.wav'),bytes=Buffer.from('RIFFtestWAVE0123456789');
 const index=path.join(root,'audio-unity.jsonl'),bank=path.join(root,'audio-wav.jsonl');let preview;
 try{
  await fs.writeFile(file,bytes);await fs.writeFile(index,JSON.stringify({bundle:'sample',file:'sound.wav',category:'音效'}));await fs.writeFile(bank,'');
  const catalog=catalogs.create(root),id=(await catalog.list())[0].id;preview=previews.create({catalog});
  const [url,again]=await Promise.all([preview.url(id),preview.url(id)]);assert.equal(url,again);
  let response=await fetch(url);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/wav');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  response=await fetch(url,{headers:{Range:'bytes=4-7'}});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes 4-7/${bytes.length}`);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(4,8));
  response=await fetch(url,{headers:{Range:'bytes=-3'}});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(-3));
  response=await fetch(url,{headers:{Range:'bytes=999-'}});assert.equal(response.status,416);assert.equal(response.headers.get('content-range'),`bytes */${bytes.length}`);
  const invalid=new URL(url);invalid.pathname=invalid.pathname.replace(/\/[0-9a-f]{64}\//,'/'+'0'.repeat(64)+'/');assert.equal((await fetch(invalid)).status,404);
  await assert.rejects(preview.url('unity:bad'),/标识/);await fs.unlink(file);assert.equal((await fetch(url)).status,404);await preview.close();await assert.rejects(preview.url(id),/关闭/);
 }finally{if(preview)await preview.close();for(const f of [file,index,bank])await fs.unlink(f).catch(()=>{});await fs.rmdir(root);}
});
