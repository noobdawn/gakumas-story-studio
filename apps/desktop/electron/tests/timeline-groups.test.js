const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../../ui/timeline-groups');
function fixture(){
  const s={objects:[{id:'a',name:'甲',type:'角色'},{id:'b',name:'乙 2',type:'角色'},{id:'scene',name:'场景',type:'场景'}],dialogues:[{id:'a-line',speaker:'甲'},{id:'b-line',speaker:'乙'},{id:'producer-line',speaker:'制作人'}],tracks:[]};
  const track=(id,type,target,dialogue,layerRole)=>({id,type,target,name:id,layerRole,clips:dialogue?[{id:id+'-clip',dialogue}]:[]});
  s.tracks=[track('b-face','expression','b',null,'base'),track('a-overlay','animation','a',null,'overlay'),track('scene','scene','scene'),track('producer-audio','audio','a','producer-line'),track('a-subtitle','dialogue','a','a-line'),track('b-audio','audio','b','b-line'),track('a-base','animation','a',null,'base'),track('a-audio','audio','a','a-line'),track('producer-subtitle','dialogue','a','producer-line'),track('b-subtitle','dialogue','b','b-line'),track('a-face','expression','a',null,'base'),track('music','audio','scene')];
  return s;
}
const category=groups=>groups.filter(g=>g.key.startsWith('type:'));
const actor=(groups,name)=>groups.find(g=>g.title===name);
test('按类别固定音频、字幕、动画、表情顺序；类别内按人物收拢',()=>{
  const s=fixture(),groups=G.build(s,'type');
  assert.deepEqual(category(groups).map(g=>g.key),['type:audio','type:dialogue','type:animation','type:expression']);
  assert.deepEqual(category(groups)[0].children.map(g=>g.title),['甲','乙 2','制作人','公共 / 未指定人物']);
  assert.equal(groups[0].key,'scene');
});
test('按人物合并四类内容，子类别同样固定顺序，基础轨道在同类内排首位',()=>{
  const groups=G.build(fixture(),'person'),a=actor(groups,'甲');
  assert.deepEqual(a.children.map(g=>g.title),['音频','字幕','动画','表情 / 口型']);
  assert.deepEqual(a.children[2].tracks.map(t=>t.id),['a-base','a-overlay']);
  assert.equal(a.children[2].layerAction,'animation:a');
});
test('借用角色目标的自定义说话人独立分组；带序号角色名称仍能归并对白',()=>{
  const groups=G.build(fixture(),'person');
  assert.deepEqual(actor(groups,'制作人').tracks.map(t=>t.id),['producer-audio','producer-subtitle']);
  assert.deepEqual(actor(groups,'乙 2').tracks.map(t=>t.id),['b-audio','b-subtitle','b-face']);
  assert.ok(!actor(groups,'甲').tracks.some(t=>t.id.startsWith('producer')));
});
test('混合说话人不拆分或复制原轨道，同名角色优先使用原目标',()=>{
  const s=fixture();s.objects.push({id:'a2',name:'甲 2',type:'角色'});
  s.tracks.find(t=>t.id==='a-audio').target='a2';
  s.tracks.push({id:'mixed',name:'混合',type:'audio',target:'a',clips:[{dialogue:'a-line'},{dialogue:'producer-line'}]});
  const groups=G.build(s,'person');
  assert.deepEqual(actor(groups,'甲 2').tracks.map(t=>t.id),['a-audio']);
  assert.deepEqual(actor(groups,'多人物 / 混合').tracks.map(t=>t.id),['mixed']);
});
test('切换分组只生成显示行，不改变工程数据、顺序或复制轨道',()=>{
  const s=fixture(),before=structuredClone(s);
  for(const mode of ['type','person']){
    const groups=G.build(s,mode),folds=new Map();
    for(const t of s.tracks)G.reveal(groups,t.id,folds);
    const rows=G.flatten(groups,folds,new Set(s.tracks.map(t=>t.id))).filter(r=>!r.group);
    assert.deepEqual(rows.map(r=>r.track.id).sort(),s.tracks.map(t=>t.id).sort());
    for(const row of rows)assert.equal(row.track,s.tracks.find(t=>t.id===row.track.id));
  }
  assert.deepEqual(s,before);
});
test('两层折叠均收起基础轨道；新增轨道与定位展开全部祖先',()=>{
  const s=fixture(),groups=G.build(s,'person'),a=actor(groups,'甲'),folds=new Map([[a.key,true]]),known=new Set(s.tracks.map(t=>t.id));
  assert.ok(!G.flatten(groups,folds,known).some(r=>r.track?.id==='a-base'));
  G.reveal(groups,'a-base',folds);
  assert.ok(G.flatten(groups,folds,known).some(r=>r.track?.id==='a-base'));
  folds.set(a.key,true);folds.set(a.children[2].key,true);known.delete('a-overlay');
  assert.ok(G.flatten(groups,folds,known).some(r=>r.track?.id==='a-overlay'));
});
test('两种视图分别保留折叠状态，轨道重排只在同人物同类别内进行',()=>{
  const s=fixture(),byType=G.build(s,'type'),byPerson=G.build(s,'person'),folds=new Map([['type:audio',true]]),known=new Set(s.tracks.map(t=>t.id));
  G.flatten(byPerson,folds,known);
  assert.equal(folds.get('type:audio'),true);
  assert.ok(!G.flatten(byType,folds,known).some(r=>r.track?.type==='audio'));
  for(const groups of [byType,byPerson])assert.deepEqual(G.peers(groups,'a-overlay').map(t=>t.id),['a-base','a-overlay']);
});
