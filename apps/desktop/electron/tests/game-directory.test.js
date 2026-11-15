'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {create,validate}=require('../game-directory');
test('目录持久化、失效和重新选择，错误选择不替换旧设置',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-game-test-'));
 try{
  async function make(name){const dir=path.join(root,name);await fs.mkdir(path.join(dir,'octo','pdb','400'),{recursive:true});await fs.mkdir(path.join(dir,'gakumas_Data'));await fs.writeFile(path.join(dir,'gakumas.exe'),'');await fs.writeFile(path.join(dir,'octo','pdb','400','octocacheevai'),'');return dir;}
  const first=await make('first'),second=await make('second'),lib=path.join(root,'library'),store=create(lib);
  assert.equal((await store.status()).state,'missing');await store.save(first);assert.equal((await create(lib).status()).path,await fs.realpath(first));
  await assert.rejects(store.save(root),/游戏目录不可用/);assert.equal((await store.status()).path,await fs.realpath(first));
  await fs.rename(path.join(first,'gakumas.exe'),path.join(first,'missing.exe'));assert.equal((await store.status()).state,'invalid');
  await store.save(second);assert.equal((await create(lib).status()).path,await fs.realpath(second));
  await assert.rejects(create(path.join(second,'data')).save(second),/不能位于游戏目录/);await assert.rejects(fs.stat(path.join(second,'data')),{code:'ENOENT'});
  await fs.writeFile(path.join(lib,'game-directory.json'),'{bad');assert.equal((await store.status()).state,'invalid');
  await fs.mkdir(path.join(second,'octo','pdb','other'));await fs.writeFile(path.join(second,'octo','pdb','other','octocacheevai'),'');await assert.rejects(validate(second),/唯一清单/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('首次提示、稍后选择、音频复用及失效后的重新选择',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-game-dialog-'));
 try{
  const game=path.join(root,'game');await fs.mkdir(path.join(game,'octo','pdb','400'),{recursive:true});await fs.mkdir(path.join(game,'gakumas_Data'));await fs.writeFile(path.join(game,'gakumas.exe'),'');await fs.writeFile(path.join(game,'octo','pdb','400','octocacheevai'),'');
  const store=create(path.join(root,'data'));let response=1,chosen=null,messages=0,opens=0;const dialog={showMessageBox:async()=>{messages++;return {response};},showOpenDialog:async()=>{opens++;return chosen?{canceled:false,filePaths:[chosen]}:{canceled:true,filePaths:[]};}};
  const ui=require('../game-directory-dialogs').create({store,dialog,window:()=>null});
  await ui.promptOnStartup();assert.equal(messages,1);assert.equal(opens,0);assert.equal((await store.status()).state,'missing');
  response=0;await ui.promptOnStartup();assert.equal(opens,1);assert.equal((await store.status()).state,'missing');
  chosen=root;await ui.choose();assert.equal((await store.status()).state,'missing');
  chosen=game;await ui.choose();assert.equal(await ui.requireDirectory(),await fs.realpath(game));const before=opens;await ui.promptOnStartup();assert.equal(opens,before);
  await fs.rename(path.join(game,'gakumas.exe'),path.join(game,'gone'));chosen=null;assert.equal(await ui.requireDirectory(),null);assert.equal((await store.status()).state,'invalid');
  await fs.rename(path.join(game,'gone'),path.join(game,'gakumas.exe'));chosen=game;assert.equal(await ui.requireDirectory(),await fs.realpath(game));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
