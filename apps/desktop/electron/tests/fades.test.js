'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fades=require('../../ui/fades');
test('动作与表情渐变按片内时间平滑求值，结束回零',()=>{
 const clip={len:4,fadeIn:1,fadeOut:1};assert.equal(fades.factor(clip,0,4),0);assert.equal(fades.factor(clip,.5,4),.5);assert.equal(fades.factor(clip,2,4),1);assert.equal(fades.factor(clip,3.5,4),.5);assert.equal(fades.factor(clip,4,4),0);
});
test('裁短源动作、偏移与手柄边界不会使渐变相互重叠',()=>{
 const c={len:10,sourceOffset:1,fadeIn:.5,fadeOut:.2};const available=fades.span(c,3);assert.ok(Math.abs(available-1.9999)<1e-8);fades.set(c,'out',4,available,30);assert.ok(c.fadeOut<=available-c.fadeIn);fades.clampStored(c,1);assert.ok(c.fadeIn+c.fadeOut<=1+1e-9);
});
test('无渐变保持完整权重且零时长安全',()=>{const c={len:1};assert.equal(fades.factor(c,0,1),1);fades.set(c,'in',1,0,30);assert.equal(c.fadeIn,0);});
