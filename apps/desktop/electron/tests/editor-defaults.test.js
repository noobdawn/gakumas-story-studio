'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const preset=require('../../../../resources/editor-defaults/defaults.json');
const translation=require('../deepseek-translation'),pronunciation=require('../pronunciation-store'),words=require('../../ui/pronunciation');
async function fixture(run){const root=await fs.mkdtemp(path.join(os.tmpdir(),'gss-defaults-'));try{await run(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
const options={safeStorage:{isEncryptionAvailable:()=>false},assertWritable:async()=>{}};
test('fresh data uses the shipped prompt and 180 rules, without creating private settings',()=>fixture(async root=>{
 const t=await translation.create(root,options).read(),p=await pronunciation.create(root).read();
 assert.equal(t.prompt,preset.prompt);assert.equal(t.defaultPrompt,preset.prompt);assert.equal(t.prompt.length,2770);assert.equal(t.hasKey,false);
 assert.equal(p.rules.length,180);assert.deepEqual(p.defaults,p.rules);assert.equal(p.revision,null);assert.deepEqual(await fs.readdir(root),[]);
 assert.equal(words.apply('Re;IRIS、まりちゃん、Pっち',p.rules),'リイリス、マリチャン、ぴーっち');
 p.defaults.length=0;assert.equal((await pronunciation.create(root).read()).defaults.length,180);
}));
test('saved custom/empty rules and custom prompt win over bundled defaults after restart',()=>fixture(async root=>{
 const p=pronunciation.create(root);const saved=await p.save([],null);assert.equal(saved.defaults.length,180);
 assert.deepEqual((await pronunciation.create(root).read()).rules,[]);
 const t=translation.create(root,options);await t.save({prompt:'用户自行修改的提示词',key:'',clearKey:false});
 assert.equal((await translation.create(root,options).read()).prompt,'用户自行修改的提示词');
}));
test('restoring the bundled prompt leaves the existing opaque encrypted key untouched',()=>fixture(async root=>{
 const file=path.join(root,'deepseek-settings.json'),encryptedKey=Buffer.from('synthetic encrypted key bytes').toString('base64');
 await fs.writeFile(file,JSON.stringify({version:1,prompt:'旧提示词',encryptedKey}));
 await translation.create(root,options).save({prompt:preset.prompt,key:'',clearKey:false});
 const saved=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(saved.encryptedKey,encryptedKey);assert.equal(saved.prompt,preset.prompt);
}));
