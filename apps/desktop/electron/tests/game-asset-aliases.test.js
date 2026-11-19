'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const aliases=require('../../ui/game-asset-aliases');
const {create}=require('../deepseek-translation');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');

test('catalog IDs, original names, project overrides and numbered-only resources',()=>{
  const rows={action:['mot_a','鞠躬'],empty:['mot_b',''],missing:['different','错配'],dup:['mot_c','手填名']};
  const item=(id,source,alias='')=>({id,source,alias,type:'动作'});
  const input=[item('action','mot_a'),item('empty','mot_b','旧机翻'),item('missing','mot_old'),
               item('own','mot_x','手填名'),item('dup','mot_c')];
  const project=new Set(['own']);
  const resolved=aliases.catalog(input,project,rows,()=>null);
  assert.deepEqual(resolved.map(x=>x.alias),['鞠躬','','','手填名','手填名 · 2']);
  assert.equal(input[0].alias,'');
  assert.equal(aliases.catalog([item('action','mot_a','自定')],new Set(['action']),rows,()=>null)[0].alias,'自定');
  assert.equal(aliases.catalog([{...input[0],gameAliasOverride:true}],new Set(['action']),rows,()=>null)[0].alias,'');
  assert.equal(aliases.catalog([input[0]],new Set(),{},()=>'原有动作名')[0].alias,'原有动作名');
});

test('imported audio gets the same catalog alias with its own project UUID',()=>{
  const rows={[aliases.audioId('bank:abc')]:['bank.acb #1','关门声']};
  const a={id:'uuid',type:'音效',source:'wav',alias:'',filmAudio:{catalogId:'bank:abc',name:'bank.acb #1'}};
  assert.equal(aliases.catalog([a],new Set(['uuid']),rows,()=>null)[0].alias,'关门声');
  assert.equal(aliases.lookup(rows,{...a,filmAudio:{...a.filmAudio,name:'other.wav'}}),undefined);
  assert.equal(aliases.catalog([{...a,alias:'我的音效'}],new Set(['uuid']),rows,()=>null)[0].alias,'我的音效');
});

test('filename batches preserve ids, allow abstention and keep dialogue settings separate',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gss-alias-test-'));
  try{
    await fs.writeFile(path.join(dir,'deepseek-settings.json'),JSON.stringify({version:1,prompt:'对白测试用提示词',encryptedKey:Buffer.from('fixture').toString('base64')}));
    let reply=[[1,''],[0,'开门 {1}']];
    const client=create(dir,{safeStorage:{isEncryptionAvailable:()=>true,decryptString:()=> 'fixture'},
      transport:async(_,body)=>{
        assert.ok(!JSON.stringify(body).includes('对白测试用提示词'));
        assert.deepEqual(JSON.parse(body.messages[1].content).map(x=>x.id),[0,1]);
        return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({aliases:reply})}}]};
      }});
    const batch=[['se_open-door_01','se_open-door_{1}'],['se_123','se_{1}']];
    assert.deepEqual(await client.translateAssetNames(batch),['开门 {1}','']);
    reply=[[0,'错配'],[0,'重复']];
    await assert.rejects(client.translateAssetNames(batch),/编号/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
