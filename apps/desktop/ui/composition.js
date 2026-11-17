(function(root,factory){const api=factory(typeof module==='object'?require('./post-effects'):root.CreatorPostEffects,typeof module==='object'?require('./character-colors'):root.CreatorCharacterColors);if(typeof module==='object')module.exports=api;else root.CreatorComposition=api;})(globalThis,(P,C)=>{
 'use strict';
 const visualTypes=['world','media','dialogue','ui','visualFilter','visualEffect'];
 const visual=t=>visualTypes.includes(t.type), processing=t=>['visualFilter','visualEffect'].includes(t.type);
 const layoutDefaults={x:0,y:0,scale:1,width:1,height:1,opacity:1};
 function layout(value){if(value===undefined)return {...layoutDefaults};fail(value&&typeof value==='object'&&!Array.isArray(value),'画面变换无效');for(const [k,v] of Object.entries(value))fail(k in layoutDefaults&&Number.isFinite(v)&&(k==='opacity'?v>=0&&v<=1:k==='x'||k==='y'?v>=-10&&v<=10:v>=.001&&v<=20),'画面变换参数无效');return {...layoutDefaults,...value};}
 const active=(c,time)=>time>=c.start&&time<c.start+c.len;
 const fail=(ok,msg)=>{if(!ok)throw Error('画面合成：'+msg);};
 function initialize(s,id){
  fail(s.compositionVersion===undefined,'工程已经启用图层合成');s.compositionVersion=1;s.transitions=[];
  const world={id:id(),name:'演出画面',type:'world',target:'scene',clips:[]};
  for(const t of s.tracks.filter(processing)){const filters=t.clips.filter(c=>P.trackType(c.visualEffect.preset)==='visualFilter');if(filters.length===t.clips.length&&filters.length)t.type='visualFilter';else if(filters.length){s.tracks.splice(s.tracks.indexOf(t),0,{...t,id:id(),type:'visualFilter',clips:filters});t.clips=t.clips.filter(c=>!filters.includes(c));}for(const c of [...t.clips,...filters])Object.assign(c.visualEffect,{scope:'categories',clipIds:[],order:0});}
  for(const t of s.tracks.filter(processing))t.name=t.type==='visualFilter'?'滤镜':'特效';
  const ordered=[...s.tracks.filter(processing),...s.tracks.filter(t=>t.type==='ui').reverse(),...s.tracks.filter(t=>t.type==='dialogue'),...s.tracks.filter(t=>t.type==='media').reverse(),world];
  s.tracks=[...ordered,...s.tracks.filter(t=>!visual(t))];return s;
 }
 function tracks(s){return s.tracks.filter(visual);}
 function reconcile(s,before){if(s.compositionVersion!==1)return;
  const old=new Set(before.tracks.map(t=>t.id)),added=s.tracks.filter(t=>visual(t)&&!old.has(t.id));
  if(added.length)s.tracks=[...added,...s.tracks.filter(t=>!added.includes(t))];
  s.transitions=(s.transitions||[]).filter(x=>{const j=join(s,x);return j&&x.duration<=2*Math.min(j.a.len,j.b.len);});
  const ids=new Set(s.tracks.filter(t=>['media','dialogue','ui'].includes(t.type)).flatMap(t=>t.clips.map(c=>c.id)));
  for(const t of s.tracks.filter(processing))for(const c of t.clips)if(c.visualEffect.scope==='clips')c.visualEffect.clipIds=c.visualEffect.clipIds.filter(id=>ids.has(id));
 }
 function join(s,x){const t=s.tracks.find(t=>t.id===x.trackId);if(!t||t.type!=='media')return null;const a=t.clips.find(c=>c.id===x.leftId),b=t.clips.find(c=>c.id===x.rightId);if(!a||!b||Math.abs(a.start+a.len-b.start)>1e-7)return null;return {track:t,a,b,cut:b.start};}
 function validate(s){if(s.compositionVersion===undefined)return;fail(s.compositionVersion===1,'不支持的合成版本');fail(s.tracks.filter(t=>t.type==='world').length<=1,'演出输出不能重复');
  for(const t of tracks(s)){layout(t.compositionLayout);if(t.type==='world')fail(t.clips.length===0,'演出输出由相机控制轨驱动');if(['media','dialogue'].includes(t.type)){const cs=[...t.clips].sort((a,b)=>a.start-b.start);for(let i=1;i<cs.length;i++)fail(cs[i].start>=cs[i-1].start+cs[i-1].len-1e-7,'同轨画面片段不能重叠');}
   for(const c of t.clips){layout(c.compositionLayout);if(c.uiKind==='code'){const U=typeof module==='object'?require('./code-ui'):globalThis.CreatorCodeUI;U.validate(c.codeUI);}if(c.dialogueLayout){fail(t.type==='dialogue','仅字幕支持文字布局');for(const [k,v] of Object.entries(c.dialogueLayout))fail(['x','y','scale','opacity'].includes(k)&&Number.isFinite(v)&&(k==='opacity'?v>=0&&v<=1:k==='scale'?v>=.1&&v<=5:v>=-2&&v<=2),'文字布局无效');}
    if(processing(t)){const v=c.visualEffect;fail(v&&P.trackType(v.preset)===t.type,'滤镜与特效须分别放置');fail(['below','clips','categories'].includes(v.scope),'效果作用范围无效');if(v.scope==='clips'){fail(Array.isArray(v.clipIds)&&v.clipIds.length<=128&&new Set(v.clipIds).size===v.clipIds.length,'效果目标无效');const valid=new Set(s.tracks.filter(t=>['media','dialogue','ui'].includes(t.type)).flatMap(t=>t.clips.map(c=>c.id)));fail(v.clipIds.every(x=>valid.has(x)),'效果目标片段已不存在');fail(Number.isSafeInteger(v.order)&&v.order>=0&&v.order<=10000,'效果顺序无效');}}
   }
  }
  fail(Array.isArray(s.transitions)&&s.transitions.length<=1000,'转场列表无效');const ids=new Set(),edges=new Set();
  for(const x of s.transitions){const j=join(s,x);fail(j,'转场必须连接同轨连续的两个画面片段');fail(typeof x.id==='string'&&x.id.length>0&&x.id.length<=100&&!ids.has(x.id),'转场标识无效');ids.add(x.id);const key=x.leftId+'|'+x.rightId;fail(!edges.has(key),'接缝已有转场');edges.add(key);fail(['dissolve','black','wipe'].includes(x.kind)&&Number.isFinite(x.duration)&&x.duration>0&&x.duration<=Math.min(j.a.len,j.b.len)*2,'转场时长无效');const start=j.cut-x.duration/2,end=j.cut+x.duration/2;fail(!s.transitions.some(y=>y!==x&&y.trackId===x.trackId&&join(s,y)&&start<join(s,y).cut+y.duration/2-1e-7&&end>join(s,y).cut-y.duration/2+1e-7),'相邻转场区间重叠');}
 }
 function transitionAt(s,t,time){for(const x of s.transitions||[]){if(x.trackId!==t.id)continue;const j=join(s,x);if(j&&time>=j.cut-x.duration/2&&time<j.cut+x.duration/2)return {...j,...x,progress:(time-j.cut+x.duration/2)/x.duration};}return null;}
 function mediaSamples(s,t,time,asset){const x=transitionAt(s,t,time);if(!x)return t.clips.filter(c=>active(c,time)).map(c=>({clip:c,time}));
  // Both inputs use real source handles. Never silently freeze missing video frames.
  const samples=[x.a,x.b].map(c=>({clip:c,time}));for(const {clip:c} of samples){const a=asset(c.assetId);if(a?.visual?.kind==='video'&&!c.loop){const source=(c.sourceOffset||0)+(time-c.start)*(c.mediaRate||1);fail(source>=-1e-7&&source<a.visual.duration,'转场素材余量不足，请缩短转场或调整视频源区间');}}return samples;
 }
 function layer(c,time){const v=c.visualEffect;return P.layer(c,time);}
 function packet(s,time,{ui=()=>[],text=(d,c)=>d.text}={}){validate(s);const ordered=tracks(s).filter(t=>t.enabled!==false),effects=ordered.filter(processing).flatMap(t=>t.clips).filter(c=>active(c,time)&&P.effective(c.visualEffect));
  const local=id=>effects.filter(c=>c.visualEffect.scope==='clips'&&c.visualEffect.clipIds.includes(id)).sort((a,b)=>a.visualEffect.order-b.visualEffect.order||a.id.localeCompare(b.id)).map(c=>layer(c,time));
  const nodes=[];
  for(const t of [...ordered].reverse()){
   if(processing(t)){for(const c of t.clips)if(effects.includes(c)&&c.visualEffect.scope==='below')nodes.push({kind:'effect',id:c.id,effects:[layer(c,time)]});continue;}
   if(t.type==='world'){nodes.push({kind:'world',id:t.id,layout:layout(t.compositionLayout)});continue;}
   if(t.type==='media'&&s.objects.find(o=>o.id===t.target)?.visible===false)continue;
   if(t.type==='media'){const x=transitionAt(s,t,time);if(x){nodes.push({kind:'transition',id:x.id,leftId:x.leftId,rightId:x.rightId,transition:x.kind,progress:x.progress,leftEffects:local(x.leftId),rightEffects:local(x.rightId),leftLayout:layout(x.a.compositionLayout),rightLayout:layout(x.b.compositionLayout)});continue;}}
   for(const c of t.clips.filter(c=>active(c,time))){const node={kind:t.type,id:c.id,effects:local(c.id),layout:layout(c.compositionLayout)};
    if(t.type==='dialogue'){const d=s.dialogues.find(d=>d.id===c.dialogue);if(!d)continue;Object.assign(node,{speaker:d.speaker.slice(0,100),text:text(d,c).slice(0,500),style:d.uiStyle||'box',color:C.resolve(s,d)[0],colorEnd:C.resolve(s,d)[1],nameTextColor:C.label(s,d),x:c.dialogueLayout?.x||0,y:c.dialogueLayout?.y||0,scale:c.dialogueLayout?.scale??1,opacity:c.dialogueLayout?.opacity??1});}
    if(t.type==='ui'){if(c.uiKind==='code')Object.assign(node,{kind:'codeUI',codeUI:c.codeUI,localTime:time-c.start+(c.sourceOffset||0),duration:c.len+(c.sourceOffset||0)});else node.draws=ui(c);}nodes.push(node);
   }
  }
  fail(nodes.length<=256,'同时合成的图层过多');return {version:1,time,nodes};
 }
 return {layout,layoutDefaults,visual,processing,tracks,initialize,reconcile,validate,join,transitionAt,mediaSamples,packet};
});
