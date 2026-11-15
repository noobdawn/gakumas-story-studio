'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {create}=require('../write-guard'),project=require('../project-store');
test('所选目录及其链接受保护，失效和损坏配置不放行',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'creator-write-guard-'));
 try{
  const game=path.join(root,'game'),other=path.join(root,'game-other'),data=path.join(root,'data'),link=path.join(root,'link');await fs.mkdir(game);await fs.mkdir(other);await fs.mkdir(data);await fs.symlink(game,link,process.platform==='win32'?'junction':'dir');
  const config=path.join(data,'game-directory.json'),guard=create(data),check=guard.assertWritable;await fs.writeFile(config,JSON.stringify({game}));
  await assert.rejects(check(game),/只读游戏目录/);await assert.rejects(check(path.join(game,'new','file')),/只读游戏目录/);await assert.rejects(check(path.join(link,'new')),/只读游戏目录/);await check(path.join(other,'new'));
  const doc={format:'gakumas-creator-project',version:1,resources:{character:'ttmr-casl-0002-prepared'},state:{version:1,objects:[{id:'scene',name:'场景',type:'场景',icon:'x',components:[],parent:null},{id:'ttmr',name:'角色',type:'角色',icon:'x',components:[],parent:null},{id:'cam',name:'相机',type:'相机',icon:'x',components:[],parent:null}],tracks:[],assets:[],dialogues:[],current:0,fov:45,selected:null,selectedClip:null}};
  await assert.rejects(project.write(path.join(game,'project.json'),doc,null,check),/只读游戏目录/);await assert.rejects(project.writeNew(path.join(link,'project.json'),doc,check),/只读游戏目录/);await project.writeNew(path.join(other,'project.json'),doc,check);
  const lib=require('../media-library').create(path.join(game,'library'),{assertWritable:check});await assert.rejects(lib.listShared(),/只读游戏目录/);await assert.rejects(lib.saveGenerated(crypto.randomUUID(),Buffer.concat([Buffer.from('RIFFxxxxWAVE'),Buffer.alloc(32)])),/只读游戏目录/);
  const alias=require('../voice-alias-store').create(path.join(game,'aliases'),{assertWritable:check});await assert.rejects(alias.rename('sovits:sample','别名',[{id:'sovits:sample',source:'sample'}]),/只读游戏目录/);
  assert.deepEqual(await fs.readdir(game),[]);
  await fs.unlink(link);await fs.rename(game,path.join(root,'removed'));await assert.rejects(check(path.join(game,'missing')),/只读游戏目录/);
  await fs.writeFile(config,'null');await assert.rejects(check(other),/设置无效/);await fs.writeFile(config,'{broken');await assert.rejects(check(other),/设置无法读取/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
