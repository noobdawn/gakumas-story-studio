'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {projectFile,create}=require('../startup-project');
const file=path.resolve('测试工程 空格.json');
test('启动参数支持含空格和中文的绝对路径；未指定时保持空工程',()=>{
  assert.equal(projectFile(['electron','app','--project',file]),file);
  assert.equal(projectFile(['--project='+file]),file);
  assert.equal(projectFile(['electron','app']),null);
});
test('缺失、相对路径、错误扩展名或重复工程参数明确报错',()=>{
  for(const args of [['--project'],['--project','relative.json'],['--project',file+'.exe'],['--project',file,'--project',file]])assert.throws(()=>projectFile(args));
});
test('仅读取一次，界面确认载入后才绑定保存路径与文件哈希',async()=>{
  const accepted=[],doc={state:{projectId:'fixture'}},calls=[];
  const startup=create({args:['--project',file],read:async f=>{calls.push(f);return {doc,hash:'original-hash'};},onAccept:p=>accepted.push(p)});
  assert.deepEqual(await startup.take(),{document:doc,name:path.basename(file)});assert.equal(accepted.length,0);
  assert.equal(startup.accept(true),true);assert.deepEqual(accepted,[{file,hash:'original-hash'}]);
  assert.equal(await startup.take(),null);assert.equal(startup.accept(true),false);assert.deepEqual(calls,[file]);
});
test('载入期间用户已编辑时可放弃启动工程，不改变保存目标',async()=>{
  const startup=create({args:['--project',file],read:async()=>({doc:{},hash:'hash'}),onAccept:()=>assert.fail('不应绑定未载入的工程')});
  await startup.take();assert.equal(startup.accept(false),false);assert.equal(startup.accept(true),false);
});
test('工程缺失或校验失败不会绑定当前工程，重载也不反复覆盖',async()=>{
  const startup=create({args:['--project',file],read:async()=>{throw Error('工程缺失');},onAccept:()=>assert.fail('不应绑定失败工程')});
  await assert.rejects(startup.take(),/工程缺失/);assert.equal(startup.accept(true),false);assert.equal(await startup.take(),null);
});
test('同时调用不会重复读取，启动完成标识必须是布尔值',async()=>{
  let release;const startup=create({args:['--project',file],read:()=>new Promise(r=>release=r),onAccept(){}});
  const first=startup.take();assert.equal(await startup.take(),null);release({doc:{},hash:'hash'});await first;
  assert.throws(()=>startup.accept('true'));assert.equal(startup.accept(true),true);
});
