// Artificial assets only; exercised by the hidden Electron layout harness.
const assert=require('node:assert/strict');
module.exports=async function(js){
 await js(`
 window.motionTest={state:{tracks:[{id:'track',type:'animation',layerRole:'base',clips:[{id:'clip',name:'对白动作 · line-007',assetId:'old',start:29.9,len:2.233,sourceOffset:1,loop:true}]}]},history:[],messages:[]};
 motionTest.assets=Array.from({length:125},(_,i)=>({id:'motion-'+i,source:'mot_test_'+i,alias:'候选动画 '+i,length:2,isPose:false}));
 motionTest.assets.unshift({id:'old',source:'mot_test_'+ 'very_long_original_name_'.repeat(8),alias:'原动画 <检索名称>',length:2.233,isPose:false},{id:'pose',source:'pose_test',alias:'静态姿势',length:.033,isPose:true},{id:'add',source:'add_test',alias:'叠加律动',length:2,isPose:false,isAdditive:true,overlayReady:true});
 motionTest.draw=()=>{const t=motionTest.state.tracks[0],c=t.clips[0];document.querySelector('#inspector').innerHTML=motionTest.ui.motionFields(t,c)+motionTest.ui.clipFields(t,c);motionTest.ui.bindSources(t,c);};
 motionTest.ui=CreatorAnimationLayerUI({state:()=>motionTest.state,assets:()=>motionTest.assets,motion:id=>motionTest.assets.find(a=>a.id===id),name:id=>motionTest.assets.find(a=>a.id===id)?.alias||'素材缺失：'+id,esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),remember:s=>motionTest.history.push(s),render:motionTest.draw,notify:s=>motionTest.messages.push(s),showModal:html=>{document.querySelector('#modal').innerHTML=html;document.querySelector('#overlay').classList.remove('hidden');document.querySelector('[data-close]').onclick=motionTest.close;},closeModal:()=>motionTest.close()});
 motionTest.close=()=>{document.querySelector('#overlay').classList.add('hidden');document.querySelector('#modal').innerHTML='';};
 motionTest.close();motionTest.draw();
 `);
 assert.equal(await js(`document.querySelector('.clip-motion-name').textContent`),'原动画 <检索名称>');
 assert.ok(await js(`document.querySelector('.clip-motion-source').scrollWidth<=document.querySelector('.clip-motion-source').clientWidth+1`));
 await js(`document.querySelector('#clip-motion-replace').click()`);
 assert.equal(await js(`document.querySelectorAll('[data-motion-pick]').length`),60);
 await js(`document.querySelector('#motion-picker-next').click()`);
 assert.ok((await js(`document.querySelector('#motion-picker-count').textContent`)).includes('2 / 3'));
 await js(`document.querySelector('#motion-picker-kind').value='overlay';document.querySelector('#motion-picker-kind').onchange()`);
 assert.equal(await js(`document.querySelectorAll('[data-motion-pick]').length`),0);
 await js(`document.querySelector('#motion-picker-kind').value='all';document.querySelector('#motion-picker-search').value='mot_test_124';document.querySelector('#motion-picker-search').oninput();document.querySelector('[data-motion-pick]').click();document.querySelector('#motion-picker-cancel').click()`);
 assert.equal(await js(`motionTest.state.tracks[0].clips[0].assetId`),'old');
 assert.equal(await js(`motionTest.history.length`),0);
 await js(`document.querySelector('#clip-motion-replace').click();document.querySelector('#motion-picker-search').value='mot_test_124';document.querySelector('#motion-picker-search').oninput();document.querySelector('[data-motion-pick]').click()`);
 const layout=await js(`(()=>{const m=document.querySelector('#modal'),b=document.querySelector('#motion-picker-apply'),r=b.getBoundingClientRect();return {bottom:m.getBoundingClientRect().bottom,applyBottom:r.bottom,view:innerHeight,overflow:m.scrollWidth>m.clientWidth};})()`);
 assert.ok(layout.bottom<=layout.view&&layout.applyBottom<=layout.view&&!layout.overflow,JSON.stringify(layout));
 await js(`document.querySelector('#motion-picker-apply').click()`);
 assert.deepEqual(await js(`motionTest.state.tracks[0].clips[0]`),{id:'clip',name:'对白动作 · line-007',assetId:'motion-124',start:29.9,len:2.233,sourceOffset:0,loop:true});
 assert.equal(await js(`motionTest.history.length`),1);
 await js(`motionTest.redo=structuredClone(motionTest.state);motionTest.state=motionTest.history.pop();motionTest.draw()`);
 assert.equal(await js(`document.querySelector('.clip-motion-name').textContent`),'原动画 <检索名称>');
 await js(`motionTest.state=motionTest.redo;motionTest.draw()`);
 assert.equal(await js(`document.querySelector('.clip-motion-name').textContent`),'候选动画 124');
 // A track locked while the picker is open must still reject applying.
 await js(`document.querySelector('#clip-motion-replace').click();document.querySelector('[data-motion-pick="pose"]').click();motionTest.state.tracks[0].locked=true;document.querySelector('#motion-picker-apply').click()`);
 assert.ok((await js(`document.querySelector('#motion-picker-error').textContent`)).includes('锁定'));
 assert.equal(await js(`motionTest.state.tracks[0].clips[0].assetId`),'motion-124');
 await js(`motionTest.close();motionTest.draw()`);
 assert.equal(await js(`document.querySelector('#clip-motion-replace').disabled`),true);
 await js(`motionTest.state.tracks[0].locked=false;motionTest.state.tracks[0].clips[0].assetId='missing';motionTest.draw()`);
 assert.ok((await js(`document.querySelector('.clip-motion-source').textContent`)).includes('动画素材缺失'));
 await js(`document.querySelector('#clip-motion-replace').click();document.querySelector('[data-motion-pick="pose"]').click();document.querySelector('#motion-picker-apply').click()`);
 assert.equal(await js(`motionTest.state.tracks[0].clips[0].assetId`),'pose');
 // Replacing the project under an open picker must not mutate either project.
 await js(`document.querySelector('#clip-motion-replace').click();document.querySelector('[data-motion-pick="old"]').click();motionTest.state=structuredClone(motionTest.state);document.querySelector('#motion-picker-apply').click()`);
 assert.ok((await js(`document.querySelector('#motion-picker-error').textContent`)).includes('工程或片段已改变'));
 await js(`motionTest.close()`);
 return 'passed: identity, search, pagination, cancel, apply, history, lock, missing asset, stale project, narrow layout';
};
