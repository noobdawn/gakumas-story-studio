const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../../ui/character-colors'),composition=require('../../ui/composition'),store=require('../project-store');
const asset={id:'asset-actor-hmsz',type:'角色',source:'秦谷美鈴',alias:''};
function fixture(){return {version:1,selected:null,selectedClip:null,current:0,fov:35,compositionVersion:1,transitions:[],assets:[],objects:[{id:'scene',name:'场景',type:'场景',icon:'box',components:[],parent:null}],dialogues:[{id:'d',speaker:'秦谷美铃',text:'你好',voice:'',linked:false,uiStyle:'game'}],tracks:[{id:'text',name:'字幕',type:'dialogue',target:'scene',clips:[{id:'clip',name:'对白',dialogue:'d',start:0,len:3}]}]};}
test('game dialogue gradients cover the roster and distinguish the generic Rinha default',()=>{
 const expected={ttmr:['#26b4eb','#87e9e2'],hski:['#ff5064','#ffbba7'],fktn:['#f8d721','#ffb5da'],amao:['#c45dc9','#fdafa6'],kllj:['#d2e3e5','#94ccd9'],kcna:['#ff8a22','#ff5d57'],ssmk:['#92de5a','#cee21d'],shro:['#00bed8','#577dff'],hrnm:['#fd7ec2','#f4b9ff'],hume:['#f74b2c','#f0cb4f'],jsna:['#ffad29','#f5eb6e'],hmsz:['#6ea4fc','#d4afff'],atbm:['#8874ff','#c8baff'],nasr:['#988d83','#988d83'],krnh:['#988d83','#988d83']};
 for(const [code,pair] of Object.entries(expected))assert.deepEqual(C.defaults({id:code==='ttmr'?'asset-actor-1':'asset-actor-'+code}),pair);
});
test('automatic colors reach the composition used by preview and export, manual colors win',()=>{
 const s=fixture(),d=s.dialogues[0];assert.deepEqual(C.resolve(s,d),['#6ea4fc','#d4afff']);
 let n=composition.packet(s,1).nodes[0];assert.equal(n.color,'#6ea4fc');assert.equal(n.colorEnd,'#d4afff');
 C.set(s,asset,'#112233','#445566');n=composition.packet(s,1).nodes[0];assert.equal(n.color,'#112233');assert.equal(n.colorEnd,'#445566');
 Object.assign(d,{nameColor:'#abcdef',nameColorEnd:'#fedcba'});n=composition.packet(s,1).nodes[0];assert.equal(n.color,'#abcdef');assert.equal(n.nameTextColor,'#333333');
 C.set(s,asset,null,null);assert.equal(composition.packet(s,1).nodes[0].color,'#abcdef');delete d.nameColor;delete d.nameColorEnd;assert.equal(composition.packet(s,1).nodes[0].color,'#6ea4fc');
});
test('canonical, translated, asset alias and scene instance names resolve without substring guesses',()=>{
 const s=fixture();C.set(s,{...asset,alias:'我的角色'},'#123456','#234567');s.objects.push({id:'copy',type:'角色',name:'主角',assetId:asset.id});
 for(const speaker of ['秦谷美铃','秦谷 美鈴','Misuzu','我的角色','主角'])assert.deepEqual(C.resolve(s,{speaker}),['#123456','#234567']);
 assert.deepEqual(C.resolve(s,{speaker:'手毬的老师'}),['#988d83','#988d83']);
 for(const speaker of ['月村手球','月村手毬','月村手鞠','Temari'])assert.deepEqual(C.resolve(s,{speaker}),['#26b4eb','#87e9e2']);
 s.assets.push({id:'asset-actor-fktn',type:'角色',source:'藤田ことね',alias:'我的角色'});assert.equal(C.character(s,'我的角色'),null);
});
test('project roundtrip retains overrides and undo snapshots; rejects malformed or unrelated color fields',()=>{
 const s=fixture(),before=structuredClone(s);assert.equal(C.set(s,asset,null,null),false);C.set(s,asset,'#112233','#445566');assert.deepEqual(before.assets,[]);
 const doc={format:store.FORMAT,version:1,resources:{character:'ttmr-casl-0002-prepared'},state:s};assert.deepEqual(store.parse(JSON.stringify(doc)),doc);
 for(const change of [a=>delete a.nameColorEnd,a=>a.nameColor='red',a=>a.type='音乐']){const bad=structuredClone(doc);change(bad.state.assets[0]);assert.throws(()=>store.validate(bad),/角色姓名条颜色/);}
 assert.throws(()=>C.set(s,asset,'#abc','no'));assert.equal(C.set(s,asset,'#112233','#445566'),false);
});
test('official name text stays readable on pale presets and custom gradients',()=>{
 const s=fixture();assert.equal(C.label(s,{speaker:'藤田ことね'}),'#333333');assert.equal(C.label(s,{speaker:'月村手毬'}),'#ffffff');
 assert.equal(C.label(s,{nameColor:'#ffffff',nameColorEnd:'#ffffff'}),'#333333');assert.equal(C.label(s,{nameColor:'#000000',nameColorEnd:'#000000'}),'#ffffff');
});
