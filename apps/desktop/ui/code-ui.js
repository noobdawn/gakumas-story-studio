(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.CreatorCodeUI=api;})(globalThis,()=>{
 'use strict';
 const template={html:'<div class="panel"><strong>UI 片段</strong><span id="clock"></span></div>',css:'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent} .panel{position:absolute;left:6%;top:8%;padding:20px 28px;border-radius:12px;background:#18243de6;color:white;font:28px sans-serif;border-left:5px solid #83e8ff} #clock{margin-left:24px;color:#83e8ff}',js:'function render(time, duration) {\n  document.getElementById("clock").textContent = time.toFixed(2) + " s";\n}'};
 function validate(code){if(!code||typeof code!=='object'||Array.isArray(code)||Object.keys(code).some(k=>!['html','css','js'].includes(k))||['html','css','js'].some(k=>typeof code[k]!=='string'||code[k].length>100000))throw Error('UI 代码无效（HTML / CSS / JS 各不超过 100000 字符）');return code;}
 return {template,validate};
});
