(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CreatorFades=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function span(clip,sourceLength){const len=Math.max(0,Number(clip.len)||0);return Number.isFinite(sourceLength)?Math.min(len,Math.max(0,sourceLength-(clip.sourceOffset||0)-.0001)):len;}
  function amounts(clip,available){const total=Math.max(0,available);
    if(clip.gaze&&(clip.fadeIn||0)+(clip.fadeOut||0)>total){
      const ratio=total/((clip.fadeIn||0)+(clip.fadeOut||0));return {fadeIn:(clip.fadeIn||0)*ratio,fadeOut:(clip.fadeOut||0)*ratio};
    }
    const fadeIn=clamp(Number(clip.fadeIn)||0,0,total),fadeOut=clamp(Number(clip.fadeOut)||0,0,total-fadeIn);return {fadeIn,fadeOut};}
  function factor(clip,elapsed,available){const {fadeIn,fadeOut}=amounts(clip,available),smooth=x=>{const t=clamp(x,0,1);return t*t*(3-2*t);};return Math.min(fadeIn?smooth(elapsed/fadeIn):1,fadeOut?smooth((available-elapsed)/fadeOut):1);}
  function set(clip,side,value,available,fps){const old=amounts(clip,available),quantized=Math.round(value*fps)/fps;clip[side==='in'?'fadeIn':'fadeOut']=clamp(quantized,0,Math.max(0,available-(side==='in'?old.fadeOut:old.fadeIn)));return clip[side==='in'?'fadeIn':'fadeOut'];}
  function clampStored(clip,available){const a=amounts(clip,available);if(clip.fadeIn!==undefined)clip.fadeIn=a.fadeIn;if(clip.fadeOut!==undefined)clip.fadeOut=a.fadeOut;}
  return {span,amounts,factor,set,clampStored};
});
