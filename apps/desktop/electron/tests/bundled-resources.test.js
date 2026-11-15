'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {install}=require('../bundled-resources');
test('bundled presets install once without replacing user edits or resurrecting removed assets',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gss-presets-'));
 try{const source=path.join(root,'source'),data=path.join(root,'data'),id=crypto.randomUUID(),bytes=Buffer.from('synthetic-image');await fs.mkdir(path.join(source,'shared'),{recursive:true});
 await fs.writeFile(path.join(source,'shared',id+'.png'),bytes);await fs.writeFile(path.join(source,'shared',id+'.json'),JSON.stringify({id,scope:'shared'}));await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify({version:1,revision:'1.0',assets:[{id,file:'shared/'+id+'.png',sha256:crypto.createHash('sha256').update(bytes).digest('hex')}]}));
 await install(source,data,async()=>{});assert.deepEqual(await fs.readFile(path.join(data,'shared',id+'.png')),bytes);await fs.writeFile(path.join(data,'shared',id+'.json'),'user edit');await fs.unlink(path.join(data,'shared',id+'.png'));await install(source,data,async()=>{});assert.equal(await fs.readFile(path.join(data,'shared',id+'.json'),'utf8'),'user edit');await assert.rejects(fs.access(path.join(data,'shared',id+'.png')));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
