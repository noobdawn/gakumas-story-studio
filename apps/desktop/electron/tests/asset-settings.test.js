'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {create}=require('../asset-settings');
function fixture(){
 const log=[],questions=[],responses=[],root=path.resolve('fixture/cache'),target=path.resolve('fixture/new-cache');
 let info={root,managedPath:path.join(root,'gakumas-creator-cache'),game:{state:'valid',path:path.resolve('fixture/game')},job:{state:'idle'}};
 const cache={info:async()=>info,checkGameTarget:async()=>{},inspectDestination:async()=>({managedPath:path.join(target,'gakumas-creator-cache'),managedExists:false,otherEntries:2}),refreshGame:async()=>log.push('refresh'),clear:async o=>{log.push(['clear',o]);return {deferred:1}},start:async o=>log.push(['start',o]),configure:async(t,o)=>{log.push(['configure',t,o]);return {deferred:1,visualNext:true}},cancel:async()=>log.push('cancel'),usePartialAudio:async()=>log.push('use')};
 const dialog={showOpenDialog:async()=>({canceled:false,filePaths:[target]}),showMessageBox:async(_,options)=>{questions.push(options);return {response:responses.shift()??0}}};
 const api=create({cache,gameDirectory:{save:async t=>log.push(['game',t])},validateGame:async t=>t,dialog,window:()=>null});
 return {api,cache,log,questions,responses,dialog,info,target,setInfo:v=>info=v};
}
test('游戏目录取消不修改；仅切换保留缓存；切换并清理后完整解包',async()=>{
 for(const response of [0,1,2]){const x=fixture();x.responses.push(response);await x.api.game();
  if(response===0)assert.deepEqual(x.log,[]);
  else if(response===1)assert.deepEqual(x.log,[['game',x.target],'refresh']);
  else assert.deepEqual(x.log,[['game',x.target],'refresh',['clear',{deferInUse:true}],['start',undefined]]);
  assert.match(x.questions[0].detail,/生成配音/);assert.match(x.questions[0].detail,/退出后清理/);
 }
});
test('目录验证和重叠检查失败时不写设置、不清理',async()=>{const x=fixture();x.cache.checkGameTarget=async()=>{throw Error('重叠')};await assert.rejects(x.api.game(),/重叠/);assert.deepEqual(x.log,[]);assert.equal(x.questions.length,0);});
test('切换缓存前说明已有文件和自动创建；原目录清理是显式选项',async()=>{
 for(const response of [0,1,2]){const x=fixture();x.responses.push(response);const result=await x.api.directory();
  assert.match(x.questions[0].detail,/新建 gakumas-creator-cache/);assert.match(x.questions[0].detail,/另有 2 项内容，会原样保留/);
  if(response===0)assert.deepEqual(x.log,[]);else{assert.deepEqual(x.log,[['configure',x.target,{deferInUse:true,cleanPrevious:response===2}]]);assert.match(result.message,response===1?/原缓存已保留/:/退出后清理/);}
 }
});
test('已有受管理缓存明确复用，冲突目录不尝试覆盖',async()=>{const x=fixture();x.cache.inspectDestination=async()=>({managedPath:x.target,managedExists:true,otherEntries:0});await x.api.directory();assert.match(x.questions[0].detail,/已有可识别/);x.cache.inspectDestination=async()=>{throw Error('不是可识别，请新建')};await assert.rejects(x.api.directory(),/新建/);assert.deepEqual(x.log,[]);});
test('重新解包三种选择，保留分支不清理，清理分支先清理',async()=>{for(const response of [0,1,2]){const x=fixture();x.responses.push(response);await x.api.start();assert.deepEqual(x.log,response===0?[]:response===1?['refresh',['start',undefined]]:[['clear',{deferInUse:true}],'refresh',['start',undefined]]);assert.match(x.questions[0].detail,/2D／3D/);assert.match(x.questions[0].detail,/无法恢复/);}});
test('无有效游戏目录不能先删除缓存，清理失败不解包',async()=>{const x=fixture();x.info.game.state='invalid';await assert.rejects(x.api.start(),/先在/);assert.deepEqual(x.log,[]);x.info.game.state='valid';x.responses.push(2);x.cache.clear=async()=>{throw Error('缓存占用')};await assert.rejects(x.api.start(),/占用/);assert.deepEqual(x.log,[]);});
test('清理、停止都有取消分支',async()=>{const x=fixture();await x.api.clear();await x.api.cancel();assert.deepEqual(x.log,[]);x.responses.push(1,1);await x.api.clear();await x.api.cancel();assert.deepEqual(x.log,[['clear',{deferInUse:true}],'cancel']);});
test('部分音频保持显式确认，同一批次不重复弹窗，可从结果再次确认',async()=>{const x=fixture();Object.assign(x.info,{partialAudioPending:true,partialAudioRun:'fixture-run'});await x.api.review();await x.api.review();assert.equal(x.questions.length,1);assert.deepEqual(x.log,[]);x.responses.push(1);await x.api.review({force:true});assert.deepEqual(x.log,['use']);assert.match(x.questions.at(-1).detail,/不受影响/);});
test('清理旧目录失败时报告切换成功但清理不完整',async()=>{const x=fixture();x.responses.push(2);x.cache.configure=async()=>({cleanupError:'发现链接'});assert.match((await x.api.directory()).message,/已切换，但原缓存未清理完成：发现链接/);});

test('音频启用不等于预览切换，待生效场景明确要求保存并重开',async()=>{
 for(const response of [0,1])for(const mode of ['legacy','prior','current']){
  const x=fixture();Object.assign(x.info,{partialAudioPending:true,partialAudioRun:'fixture-run',visualNext:true,visualActive:mode!=='legacy',visualUpdatePending:mode==='prior'});x.responses.push(response);
  const result=await x.api.review();assert.deepEqual(x.log,response?['use']:[]);
  for(const text of [x.questions[0].detail,result.message]){
   if(mode==='current')assert.doesNotMatch(text,/当前预览尚未切换/);
   else assert.match(text,/2D／3D.*保存工程并完全退出后重开工作台/);
  }
 }
});
