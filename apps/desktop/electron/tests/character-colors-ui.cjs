const assert=require('node:assert/strict');
module.exports=async function(js){
 await js(`window.colorTest={state:{assets:[],objects:[]},history:[],asset:{id:'asset-actor-hmsz',type:'角色',source:'秦谷美鈴',alias:''}};
 colorTest.draw=()=>{document.querySelector('#inspector').innerHTML='';colorTest.editor.mount(colorTest.state.assets[0]||colorTest.asset);};
 colorTest.editor=CreatorCharacterColorEditor({state:()=>colorTest.state,remember:s=>colorTest.history.push(s),render:colorTest.draw,esc:s=>s});colorTest.draw();`);
 assert.equal(await js(`document.querySelector('#actor-color-left').value`),'#6ea4fc');
 assert.equal(await js(`document.querySelector('#actor-color-reset').disabled`),true);
 await js(`document.querySelector('#actor-color-left').value='#123456';document.querySelector('#actor-color-left').onchange()`);
 assert.deepEqual(await js(`CreatorCharacterColors.resolve(colorTest.state,{speaker:'秦谷美铃'})`),['#123456','#d4afff']);
 assert.equal(await js(`colorTest.history.length`),1);
 const layout=await js(`(()=>{const e=document.querySelector('#character-colors');return {width:e.clientWidth,scroll:e.scrollWidth};})()`);assert.ok(layout.scroll<=layout.width+1);
 await js(`colorTest.after=structuredClone(colorTest.state);colorTest.state=colorTest.history.pop();colorTest.draw()`);
 assert.equal(await js(`document.querySelector('#actor-color-left').value`),'#6ea4fc');
 await js(`colorTest.state=colorTest.after;colorTest.draw();document.querySelector('#actor-color-reset').click()`);
 assert.equal(await js(`colorTest.state.assets[0].nameColor===undefined`),true);
 assert.equal(await js(`document.querySelector('#actor-color-right').value`),'#d4afff');
 return {colors:true,reset:true,undo:true,layout};
};
