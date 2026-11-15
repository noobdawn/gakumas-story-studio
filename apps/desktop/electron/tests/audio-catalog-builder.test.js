'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {create}=require('../audio-catalog-builder');
const code=`const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1],script=path.basename(process.argv[1]);
if(script==='inventory.py')fs.writeFileSync(get('--out'),'{}',{flag:'wx'});
if(script==='prepare_film_assets.py'){if(!args.includes('--audio-only'))process.exit(2);const d=get('--out');fs.mkdirSync(d);fs.writeFileSync(path.join(d,'summary.json'),JSON.stringify({bundle_errors:0,missing_dependencies:[]}));fs.writeFileSync(path.join(d,'audio-banks.jsonl'),'');}
if(script==='decode_film_audio.py'){let d=get('--root');fs.writeFileSync(path.join(d,'audio-summary.json'),JSON.stringify({files:1,errors:0,skippedForSpace:0}));fs.writeFileSync(path.join(d,'audio-wav.jsonl'),'');}
if(script==='decode_film_unity_audio.py'){let d=get('--root');fs.writeFileSync(path.join(d,'audio-unity-summary.json'),JSON.stringify({files:0,errors:0,skippedForSpace:0}));fs.writeFileSync(path.join(d,'audio-unity.jsonl'),'');}`;
async function until(fn){for(let i=0;i<200;i++){const x=fn();if(x)return x;await new Promise(r=>setTimeout(r,25));}throw Error('timed out');}
test('音频准备使用新目录、串行完成并在成功后切换',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-audio-build-'));
 try{const game=path.join(root,'game'),scripts=path.join(root,'scripts'),dataRoot=path.join(root,'data');await fs.mkdir(game);await fs.mkdir(scripts);for(const n of ['inventory.py','prepare_film_assets.py','decode_film_audio.py','decode_film_unity_audio.py'])await fs.writeFile(path.join(scripts,n),code);
 let selected;const builder=create({dataRoot,python:process.execPath,scripts,onComplete:async p=>{selected=p;}});await builder.start(game);await assert.rejects(builder.start(game),/已有/);const result=await until(()=>{const s=builder.getStatus();return s.state==='complete'||s.state==='error'?s:null;});assert.equal(result.state,'complete',result.message);assert.equal(selected,result.catalog);assert.ok(selected.toLowerCase().startsWith((await fs.realpath(dataRoot)).toLowerCase()+path.sep));assert.deepEqual(await fs.readdir(game),[]);await builder.close();await assert.rejects(builder.start(game),/关闭/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('拒绝在所选游戏目录写入准备结果',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-audio-readonly-'));
 try{const game=path.join(root,'game');await fs.mkdir(game);const builder=create({dataRoot:path.join(game,'data')});await assert.rejects(builder.start(game),/不能位于游戏目录/);assert.deepEqual(await fs.readdir(game),[]);}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('关闭时停止本次准备进程',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-audio-stop-'));
 try{const game=path.join(root,'game'),scripts=path.join(root,'scripts');await fs.mkdir(game);await fs.mkdir(scripts);await fs.writeFile(path.join(scripts,'inventory.py'),"setInterval(()=>{},1000)");const builder=create({dataRoot:path.join(root,'data'),python:process.execPath,scripts});await builder.start(game);await until(()=>builder.getStatus().state==='running');await builder.close();const status=await until(()=>{const s=builder.getStatus();return s.state==='error'&&s;});assert.ok(status.message);await assert.rejects(builder.start(game),/关闭/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('准备中出错不会切换清单',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-audio-error-'));
 try{const game=path.join(root,'game'),scripts=path.join(root,'scripts');await fs.mkdir(game);await fs.mkdir(scripts);await fs.writeFile(path.join(scripts,'inventory.py'),"console.error('broken manifest');process.exit(2)");let switched=false;const builder=create({dataRoot:path.join(root,'data'),python:process.execPath,scripts,onComplete:async()=>{switched=true;}});await builder.start(game);const s=await until(()=>{const x=builder.getStatus();return x.state==='error'&&x;});assert.match(s.message,/broken manifest/);assert.equal(switched,false);await builder.close();}finally{await fs.rm(root,{recursive:true,force:true});}
});
