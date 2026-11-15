'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const protector=require('../windows-secret-storage'),{create}=require('../deepseek-translation');
test('Windows 用户加密跨进程可解密，翻译设置不写入明文', {skip:process.platform!=='win32'},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'creator-dpapi-'));const dummy='nonsecret-test-key-2026';
 try{
  const api=create(dir,{protector,safeStorage:{isEncryptionAvailable:()=>false},assertWritable:async()=>{},transport:async(key)=>{assert.equal(key,dummy);return {choices:[{finish_reason:'stop',message:{content:'{"lines":[{"id":"1","text":"はい"}]}'}}]}}});
  await api.save({key:dummy,prompt:'测试',clearKey:false});const raw=await fs.readFile(path.join(dir,'deepseek-settings.json'),'utf8');assert.ok(!raw.includes(dummy));const encrypted=Buffer.from(JSON.parse(raw).encryptedKey,'base64');assert.ok(protector.isProtected(encrypted));
  const modulePath=require.resolve('../windows-secret-storage');const child=spawnSync(process.execPath,['-e',`const p=require(${JSON.stringify(modulePath)});let a=[];process.stdin.on('data',x=>a.push(x));process.stdin.on('end',async()=>{try{console.log((await p.decrypt(Buffer.from(Buffer.concat(a).toString(),'base64')))==='nonsecret-test-key-2026'?'ok':'mismatch')}catch{process.exitCode=1}})`],{input:encrypted.toString('base64'),encoding:'utf8',timeout:30000,windowsHide:true});assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),'ok');
  assert.equal((await api.read()).keyStatus,'available');assert.equal((await api.translate([{id:'1',speaker:'甲',text:'是'}])).lines[0].text,'はい');
  const before=await fs.readFile(path.join(dir,'deepseek-settings.json'),'utf8');const fail=create(dir,{protector:{...protector,encrypt:async()=>{throw Error('unavailable')}},safeStorage:{isEncryptionAvailable:()=>false},assertWritable:async()=>{}});await assert.rejects(fail.save({key:'new-dummy',prompt:'测试',clearKey:false}));assert.equal(await fs.readFile(path.join(dir,'deepseek-settings.json'),'utf8'),before);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
