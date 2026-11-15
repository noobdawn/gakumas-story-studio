'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {create}=require('../voice-library');

test('读取音源和语气并只试听清单允许的本地文件',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'creator-voice-test-'));
 const samples=path.join(dir,'samples'),models=path.join(dir,'models'),sovits=path.join(dir,'sovits'),dataRoot=path.join(dir,'user-data');
 const modelId='7cb1e0dd-718f-41d7-889b-1b1307dc4727',uid='388f246b-8c41-4ac1-8e2d-5d79f3ff56d9',id='voicevox:'+uid;
 const files=[];const folders=[];
 async function folder(p){await fs.mkdir(p,{recursive:true});folders.push(p);}
 async function write(p,v){await fs.writeFile(p,v);files.push(p);}
 try{
  await folder(samples);await folder(models);await folder(sovits);await folder(path.join(sovits,'voices','manbo'));await folder(path.join(sovits,'runtime'));
  await write(path.join(sovits,'runtime','python.exe'),'fixture');
  for(const name of ['gpt.ckpt','vits.pth','ref.wav'])await write(path.join(sovits,'voices','manbo',name),'fixture');
  await write(path.join(sovits,'voices','manbo','voice.json'),JSON.stringify({name:'曼波测试',version:'v2',gpt:'gpt.ckpt',sovits:'vits.pth',reference:'ref.wav'}));
  await write(path.join(samples,'ok.wav'),Buffer.from('RIFFxxxxWAVEfixture'));
  await write(path.join(dir,'outside.wav'),Buffer.from('RIFFxxxxWAVEfixture'));
  await write(path.join(samples,'manifest.json'),JSON.stringify({samples:[{speaker_uuid:uid,style_id:3,model:'0.vvm',file:'ok.wav'},{speaker_uuid:uid,style_id:7,model:'0.vvm',file:'../outside.wav'}]}));
  const result={voices:[{id,type:'音源',alias:'',source:'测试声库',voiceProvider:'voicevox',styles:[{id:3,name:'普通',type:'talk',model:'0.vvm',modelId,version:'v1'},{id:7,name:'耳语',type:'talk',model:'0.vvm',modelId,version:'v1'},{id:8,name:'冲突',type:'talk',model:'0.vvm',modelId,version:'v1'},{id:8,name:'冲突',type:'talk',model:'1.vvm',modelId:'other',version:'v2'}]}],errors:[]};
  const scanner=path.join(dir,'scanner.py');await write(scanner,'import json\nprint('+JSON.stringify(JSON.stringify(result))+')\n');
  const options={python:'python',scanner,models,samples,sovits,dataRoot},lib=create(options);const catalog=await lib.list();
  const v=catalog.voices.find(x=>x.id===id),g=catalog.voices.find(x=>x.id==='sovits:manbo');
  assert.equal(v.styles.length,2);assert.equal(v.styles[0].previewAvailable,true);assert.equal(v.styles[1].previewAvailable,false);assert.equal(g.available,true);assert.ok(catalog.warnings.some(x=>x.includes('多个模型')));
  assert.match(await lib.preview(id,3),/^data:audio\/wav;base64,/);await assert.rejects(lib.preview(id,7),/试听/);await assert.rejects(lib.preview('voicevox:unknown',3),/试听/);
  await lib.rename(id,'月村手毬');assert.equal((await create(options).list()).voices.find(x=>x.id===id).alias,'月村手毬');
  assert.match(await lib.preview(id,3),/^data:audio\/wav;base64,/);await lib.rename(id,'');assert.equal((await lib.list()).voices.find(x=>x.id===id).alias,'');
 }finally{
  await fs.unlink(path.join(dataRoot,'voice-aliases.json')).catch(()=>{});await fs.rmdir(dataRoot).catch(()=>{});
  for(const f of files.reverse())await fs.unlink(f).catch(()=>{});
  for(const p of [path.join(sovits,'voices','manbo'),path.join(sovits,'voices'),path.join(sovits,'runtime'),sovits,models,samples,dir])await fs.rmdir(p).catch(()=>{});
 }
});

test('本地扫描失败时返回可见的不可用状态',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'creator-voice-missing-'));
 try{const lib=create({python:path.join(dir,'missing.exe'),models:dir,samples:dir,sovits:dir});const result=await lib.list();assert.equal(result.voices.length,0);assert.ok(result.warnings.some(x=>x.includes('VOICEVOX 音源不可用')));}
 finally{await fs.rmdir(dir);}
});
