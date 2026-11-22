(function(root,factory){
  const api=factory();
  if(typeof module==='object')module.exports=api;else root.CreatorCodeUI=api;
})(globalThis,()=>{
  'use strict';
  const template={html:'<div class="panel"><strong>UI 片段</strong><span id="clock"></span></div>',css:'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent} .panel{position:absolute;left:6%;top:8%;padding:20px 28px;border-radius:12px;background:#18243de6;color:white;font:28px sans-serif;border-left:5px solid #83e8ff} #clock{margin-left:24px;color:#83e8ff}',js:'function render(time, duration) {\n  document.getElementById("clock").textContent = time.toFixed(2) + " s";\n}'};
  function validate(code){
    if(!code||typeof code!=='object'||Array.isArray(code)||Object.keys(code).some(k=>!['html','css','js'].includes(k))||
       ['html','css','js'].some(k=>typeof code[k]!=='string'||code[k].length>100000))throw Error('UI 代码无效（HTML / CSS / JS 各不超过 100000 字符）');
    return code;
  }
  function validateSampling(mode){
    if(mode!==undefined&&!['auto','static','dynamic'].includes(mode))throw Error('代码 UI 取样方式无效');
  }
  // Positive, deliberately small subset: plain text elements with literal classes/IDs and resource-free CSS.
  // Animated images, inline styles, CSS functions/at-rules and arbitrary script use time-based sampling by default.
  const plainTags=/<\/?(?:div|span|p|strong|b|em|i|small|br|h[1-6]|section|header|footer)(?:\s+(?:class|id)\s*=\s*(?:"[\w -]*"|'[\w -]*'))*\s*\/?>/gi;
  const staticMemo=new WeakMap();
  function isStatic(code,mode){
    if(mode==='static')return true;
    if(mode==='dynamic'||code.js.trim())return false;
    const old=staticMemo.get(code);
    if(old&&old.html===code.html&&old.css===code.css)return old.value;
    const value=!code.html.replace(plainTags,'').includes('<')&&
      !/[@\\()<]|(?:animation|transition|:hover|:active|:focus)/i.test(code.css);
    staticMemo.set(code,{html:code.html,css:code.css,value});return value;
  }
  function sample(clip,time){
    const start=clip.sourceOffset||0;
    return {codeUI:clip.codeUI,localTime:isStatic(clip.codeUI,clip.codeUISampling)?start:time-clip.start+start,duration:clip.len+start};
  }
  function dimensions(aspect,width=1280,height){
    if(height==null){const [w,h]=aspect.split(':').map(Number);height=Math.round(width*h/w);}
    if(height>1920){width=Math.round(width*1920/height);height=1920;}
    return {width,height};
  }
  return {template,validate,validateSampling,isStatic,sample,dimensions};
});
