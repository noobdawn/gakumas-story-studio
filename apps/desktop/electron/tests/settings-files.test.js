const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const T=require('../deepseek-translation'),P=require('../pronunciation-store'),F=require('../settings-files');
const secure={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
async function fixture(run){const root=await fs.mkdtemp(path.join(os.tmpdir(),'config-files-'));try{await run(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
test('materializes legacy prompt and defaults, preserves encrypted key and existing external files',()=>fixture(async root=>{
 const keyFile=path.join(root,'deepseek-settings.json'),raw=JSON.stringify({version:1,prompt:'旧的多行\n提示词',encryptedKey:Buffer.from('synthetic').toString('base64')});await fs.writeFile(keyFile,raw);
 const t=T.create(root,{safeStorage:secure,assertWritable:async()=>{}}),p=P.create(root);await t.ensureFile();await p.ensureFile();assert.equal(await fs.readFile(t.file,'utf8'),'旧的多行\n提示词');assert.equal(await fs.readFile(keyFile,'utf8'),raw);assert.equal((await p.read()).rules.length,180);
 await fs.writeFile(t.file,'外部改写');await fs.writeFile(p.file,JSON.stringify({format:'creator-pronunciation-replacements',version:1,rules:[]}));await t.ensureFile();await p.ensureFile();assert.equal((await t.read()).prompt,'外部改写');assert.deepEqual((await p.read()).rules,[]);
}));
test('next translation and rule read observe external edits; stale form cannot overwrite files or key',()=>fixture(async root=>{
 let sent;const t=T.create(root,{safeStorage:secure,assertWritable:async()=>{},transport:async(key,body)=>{sent=body;return {choices:[{finish_reason:'stop',message:{content:'{"lines":[{"id":"x","text":"訳文"}]}'}}]};}}),p=P.create(root);
 await t.save({key:'synthetic',prompt:'开始',clearKey:false});await p.ensureFile();const before=await t.read(),oldRules=await p.read(),keyBefore=await fs.readFile(path.join(root,'deepseek-settings.json'),'utf8');
 await fs.writeFile(t.file,'\uFEFF外部新提示\r\n第二行');await fs.writeFile(p.file,JSON.stringify({format:'creator-pronunciation-replacements',version:1,rules:[{from:'新词',to:'しん'}]}));
 await t.translate([{id:'x',speaker:'测试',text:'你好'}]);assert.ok(sent.messages[0].content.startsWith('外部新提示\r\n第二行'));
 await assert.rejects(t.save({key:'changed',prompt:'旧草稿',clearKey:false,revision:before.revision}),/外部修改/);assert.equal(await fs.readFile(path.join(root,'deepseek-settings.json'),'utf8'),keyBefore);
 await assert.rejects(p.save([],oldRules.revision),/外部编辑/);assert.equal((await p.read()).rules[0].from,'新词');
 const next=await t.read();await t.save({key:'',prompt:next.prompt,revision:next.revision,clearKey:false});assert.equal((await t.read()).prompt,next.prompt);
}));
test('bad files remain available for repair and never silently fall back or get replaced',()=>fixture(async root=>{
 const t=T.create(root,{safeStorage:secure,assertWritable:async()=>{}}),p=P.create(root),opened=[];await t.ensureFile();await p.ensureFile();await fs.writeFile(t.file,' ');await fs.writeFile(p.file,'{bad json');
 await assert.rejects(t.read(),/12000/);await assert.rejects(p.read(),/JSON/);const files=F.create({translation:t,pronunciation:p,shell:{openPath:async f=>{opened.push(f);return '';},showItemInFolder:f=>opened.push(f)},assertWritable:async()=>{}});
 await files.open('prompt');await files.open('rules',true);assert.deepEqual(opened,[t.file,p.file]);await assert.rejects(files.open('../../secret'),/未知/);assert.equal(await fs.readFile(p.file,'utf8'),'{bad json');
 await fs.writeFile(t.file,Buffer.from([0xff]));await assert.rejects(t.read(),/UTF-8/);
}));
test('fixed file links propagate open failures and apply write protection',()=>fixture(async root=>{
 const t=T.create(root,{safeStorage:secure,assertWritable:async()=>{}}),p=P.create(root);const files=F.create({translation:t,pronunciation:p,shell:{openPath:async()=> '没有关联程序'},assertWritable:async()=>{}});await assert.rejects(files.open('prompt'),/在文件夹中显示/);
 const guarded=T.create(root,{safeStorage:secure,assertWritable:async()=>{throw Error('不能向只读游戏目录写入');}});await assert.rejects(guarded.save({prompt:'修改',key:'',clearKey:false}),/只读/);
}));
