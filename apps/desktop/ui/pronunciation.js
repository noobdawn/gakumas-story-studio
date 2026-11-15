(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CreatorPronunciation=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const defaults=[{from:'Producer',to:'プロデューサー'},{from:'制作人',to:'プロデューサー'}];
 function validate(rules){
  if(!Array.isArray(rules)||rules.length>200)throw Error('替换词最多 200 条');
  const seen=new Set();return rules.map(r=>{
   if(!r||typeof r.from!=='string'||typeof r.to!=='string'||!r.from.trim()||r.from.length>100||!r.to.trim()||r.to.length>100||/[\x00-\x1f\x7f]/.test(r.from+r.to))throw Error('原词和读音均须填写，且不能超过 100 字或包含换行');
   const key=r.from.toLowerCase();if(seen.has(key))throw Error('原词重复：'+r.from);seen.add(key);return {from:r.from,to:r.to};
  });
 }
 function apply(text,rules){
  const entries=validate(rules).map((r,i)=>({...r,i})).sort((a,b)=>b.from.length-a.from.length||a.i-b.i);
  if(!entries.length)return text;
  const escaped=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re=new RegExp(entries.map(r=>escaped(r.from)).join('|'),'gi');
  return text.replace(re,(match)=>entries.find(r=>r.from.toLowerCase()===match.toLowerCase()).to);
 }
 // Only used for spoken text. Subtitles and translated text stay untouched.
 function normalizeEllipses(text){
  if(typeof text!=='string')throw Error('语音文本无效');
  const ellipsis=/(?:[…⋯‥]+|\.{3,}|．{3,})/gu;if(!ellipsis.test(text))return text;
  const nonSpeech=/[\s…⋯‥.．、。，,!?！？（）()「」『』【】［］\[\]“”‘’"'：:；;—－-]/gu;
  if(!text.replace(nonSpeech,''))return '';
  const normalized=text.replace(ellipsis,(match,offset,whole)=>{
   const left=whole.slice(0,offset),right=whole.slice(offset+match.length);
   if(!left.replace(nonSpeech,'')||!right.replace(nonSpeech,''))return '';
   if(/[（(「『【［\[“‘"]\s*$/u.test(left)||/^\s*[）)」』】］\]”’"]/.test(right))return '';
   if(/[、。，,!?！？：:；;]\s*$/u.test(left)||/^\s*[、。，,!?！？：:；;]/u.test(right))return '';
   return '、';
  });
  // Outer brackets here mark an inner voice; they are not spoken, and Open JTalk
  // may treat an opening bracket as an invalid leading pause.
  const trimmed=normalized.trim();if((trimmed.startsWith('（')&&trimmed.endsWith('）'))||(trimmed.startsWith('(')&&trimmed.endsWith(')')))return trimmed.slice(1,-1);
  return normalized;
 }
 function voicevox(text,rules){return normalizeEllipses(apply(text,rules));}
 return {defaults,validate,apply,normalizeEllipses,voicevox};
});
