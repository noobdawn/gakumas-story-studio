'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const words=require('../../ui/pronunciation'),store=require('../pronunciation-store');
test('默认词、大小写、最长优先、单次替换及字面特殊字符',()=>{
 assert.equal(words.apply('Producer、制作人、producer',words.defaults),'プロデューサー、プロデューサー、プロデューサー');
 assert.equal(words.apply('abcd a.b $', [{from:'ab',to:'cd'},{from:'abcd',to:'X'},{from:'a.b',to:'$&'},{from:'$',to:'ab'}]),'X $& ab');
 assert.throws(()=>words.validate([{from:'X',to:'x'},{from:'x',to:'y'}]),/重复/);
 assert.throws(()=>words.validate([{from:'',to:'x'}]),/填写/);
});
test('VOICEVOX 省略号只影响语音文本，并处理括号与已有标点',()=>{
 for(const [input,expected] of [['……はい？','はい？'],['そうです……','そうです'],['（……そうです……）','そうです'],['（普通の内心）','（普通の内心）'],['あの……制作人','あの、プロデューサー'],['はい。……次です','はい。次です'],['そう……？','そう？'],['…………',''],['（……）',''],['3.14 の話','3.14 の話'],['A...B','A、B'],['A‥B','A、B'],['……あの……次……','あの、次']])assert.equal(words.voicevox(input,words.defaults),expected,input);
 assert.equal(words.apply('……制作人……',words.defaults),'……プロデューサー……');
});
test('用户全局词表可持久化，冲突和损坏不覆盖数据',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pronunciation-test-'));try{
  const a=store.create(dir),b=store.create(dir),initial=await a.read();assert.deepEqual(initial.rules,words.defaults);
  const custom=[{from:'制作人',to:'ぷろでゅーさー'},{from:'莉波',to:'りなみ'}];await a.save(custom,initial.revision);
  assert.deepEqual((await b.read()).rules,custom);await assert.rejects(b.save([],initial.revision),/其他窗口修改/);
  await fs.writeFile(path.join(dir,'pronunciation-replacements.json'),'{broken');await assert.rejects(a.read(),/JSON/);
  await assert.rejects(a.save([],null),/JSON/);assert.equal(await fs.readFile(path.join(dir,'pronunciation-replacements.json'),'utf8'),'{broken');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
