'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {collect}=require('../asset-preparation-report');
test('缺失报告保留资源名、无法唯一定位的依赖和未支持场景',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-report-test-'));
 try{
  await fs.mkdir(path.join(root,'player-view'));
  await fs.writeFile(path.join(root,'summary.json'),JSON.stringify({missing_dependencies:[{asset:'env_test',id:42,matches:2}]}));
  await fs.writeFile(path.join(root,'audio-banks.jsonl'),JSON.stringify({name:'missing.mp3',error:'本地未找到该资源文件',errorCode:'local_source_missing'})+'\n');
  await fs.writeFile(path.join(root,'player-view/scene-report.json'),JSON.stringify({issues:[{source:'env_2d_special',error:'unsupported tint'}]}));
  const rows=await collect(root);assert.equal(rows.length,3);assert(rows.some(r=>r.source==='env_test'&&r.dependencyId===42&&r.error.includes('2 条')));assert(rows.some(r=>r.source==='missing.mp3'&&r.errorCode==='local_source_missing'));assert(rows.some(r=>r.source==='env_2d_special'));
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
