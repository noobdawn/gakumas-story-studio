const assert=require('node:assert/strict');
module.exports=async js=>{
 await js(`(async()=>{document.querySelector('#inspector').innerHTML='<section id="file-prompt"><div class="section-title">提示词</div></section><section id="file-rules"><div class="section-title">替换词</div></section>';
 window.fileTest={opened:[],reload:[]};await CreatorSettingsFileLinks.mount({api:{files:async()=>({prompt:'E:/人工测试/提示词/translation-prompt.txt',rules:'E:/人工测试/pronunciation-replacements.json'}),open:async(...args)=>fileTest.opened.push(args)},connection:document.querySelector('#file-prompt'),pronunciation:document.querySelector('#file-rules'),reloadPrompt:async()=>fileTest.reload.push('prompt'),reloadRules:async()=>{throw Error('JSON 格式错误');}});})()`);
 await js(`document.querySelector('#file-prompt .config-file-path').click();document.querySelector('#file-rules .config-file-actions a').click()`);
 assert.deepEqual(await js(`fileTest.opened`),[['prompt'],['rules',true]]);
 await js(`document.querySelector('#file-prompt .config-file-actions a:last-child').click();document.querySelector('#file-rules .config-file-actions a:last-child').click()`);
 assert.deepEqual(await js(`fileTest.reload`),['prompt']);assert.equal(await js(`document.querySelector('#file-rules .error').textContent`),'JSON 格式错误');
 assert.ok(await js(`[...document.querySelectorAll('.config-file-guide')].every(e=>e.scrollWidth<=e.clientWidth+1)`));
 // The native color input's default action is suppressed; only a committed color emits change.
 await js(`window.colorTestCalls=0;window.colorAPI={pick:async()=> '#123456'};document.querySelector('#inspector').innerHTML='<input type="color" id="native-color" value="#000000">';document.querySelector('#native-color').onchange=()=>colorTestCalls++;document.querySelector('#native-color').click()`);
 assert.equal(await js(`document.querySelector('#native-color').value`),'#123456');assert.equal(await js(`colorTestCalls`),1);
 await js(`colorAPI.pick=async()=>null;document.querySelector('#native-color').click()`);assert.equal(await js(`colorTestCalls`),1);
 await js(`colorAPI.pick=()=>new Promise(r=>window.finishColor=r);document.querySelector('#native-color').click();document.querySelector('#native-color').remove();finishColor('#ff0000')`);assert.equal(await js(`colorTestCalls`),1);
 return {links:true,reload:true,error:true,colorCommit:true,cancel:true,staleControl:true};
};
