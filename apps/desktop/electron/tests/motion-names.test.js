'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),names=require('../../ui/motion-names');
test('按当前角色名匹配别名并稳定保留组内顺序，不按资源原名猜测',()=>{
 const rows=[{id:'common',alias:'共通待机',source:'ttmr'},{id:'one',alias:'月村手毬 · 害羞',source:'a'},{id:'custom',alias:'月村手毬 · 自定义动作',source:'b'},{id:'other',alias:'藤田琴音 · 待机',source:'c'},{id:'none',alias:'',source:'月村手毬'}];
 assert.deepEqual(names.prioritize(rows,['月村手毬']).map(x=>x.id),['one','custom','common','other','none']);assert.deepEqual(rows.map(x=>x.id),['common','one','custom','other','none']);
});
test('支持日文全名、Unicode 规范化、空名称及用户命名',()=>{
 const rows=[{alias:'共通'},{alias:'Ｆｕｊｉｔａ · 自定义'},{alias:'藤田ことね · 动作'}];assert.deepEqual(names.prioritize(rows,['fujita','藤田ことね']).map(x=>x.alias),['Ｆｕｊｉｔａ · 自定义','藤田ことね · 动作','共通']);assert.deepEqual(names.prioritize(rows,['']).map(x=>x.alias),rows.map(x=>x.alias));
});
test('角色代码映射与动画名称使用同一角色，避免把美铃等误标为其他人',()=>{
 const expected={ttmr:'月村手毬',fktn:'藤田琴音',amao:'有村麻央',krnh:'贺阳燐羽',hski:'花海咲季',hmsz:'秦谷美铃',hrnm:'姬崎莉波',hume:'花海佑芽',jsna:'十王星南',ssmk:'紫云清夏',shro:'篠泽广',kllj:'葛城莉莉娅',kcna:'仓本千奈',atbm:'雨夜燕',nasr:'根绪亚纱里'};
 for(const [code,label] of Object.entries(expected)){assert.equal(names.actorName(code),label);assert.ok(names.name(`mot_all_chr_${code}_idle-001_in_b`).includes(label));}assert.equal(names.actorName('unknown'),'');assert.ok(names.actorNames('hmsz').includes('美铃'));assert.ok(!names.actorNames('hmsz').includes('佑芽'));
});
