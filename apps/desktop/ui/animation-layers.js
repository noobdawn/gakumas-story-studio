(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CreatorAnimationLayers=api;})(globalThis,function(){
 'use strict';
 const scopes=['full','head','upperBody','lowerBody','leftArm','rightArm'];
 const kinds=['animation','expression','decal','gaze'];
 const clamp=x=>Math.max(0,Math.min(1,x));
 const active=(clip,time)=>time>=clip.start&&time<clip.start+clip.len;
 const finite=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
 const str=x=>typeof x==='string'&&x.length>0&&x.length<=200;
 function validateResident(item){
  if(!item||!str(item.id)||!kinds.includes(item.kind)||typeof item.enabled!=='boolean'||!finite(item.weight,0,100))return false;
  if(item.kind==='gaze')return item.enabled===false&&['camera','actor','direction'].includes(item.targetType||'camera')&&['eyes','head','body'].includes(item.gazeScope||'eyes');
  if(!str(item.assetId))return false;
  if(item.kind==='animation')return ['additive','override'].includes(item.blendMode)&&scopes.includes(item.scope)&&['always','resident'].includes(item.condition||'always')&&typeof item.loop==='boolean';
  return ['hold','loop'].includes(item.playback||'hold')&&(item.sourceOffset===undefined||finite(item.sourceOffset,0,3600));
 }
 function normalize(state,newId,isActor=o=>o.type==='角色'){
  const old=state.layerSchema!==1;
  for(const actor of state.objects.filter(isActor)){
   actor.components ||= [];
   actor.residentLayers ||= [];
   if(actor.inheritBodyFace===undefined)actor.inheritBodyFace=!old;
   for(const type of ['animation','expression']){
    if(!actor.components.includes(type))actor.components.push(type);
    const tracks=state.tracks.filter(t=>t.type===type&&t.target===actor.id);
    if(!tracks.some(t=>t.layerRole==='base')){
     const first=type==='animation'?tracks.find(t=>!t.layerRole):null;
     if(first)first.layerRole='base';
     else state.tracks.push({id:newId(),name:actor.name+' · '+(type==='animation'?'基础动画':'基础表情'),type,target:actor.id,layerRole:'base',clips:[]});
    }
    for(const track of tracks)if(!track.layerRole)track.layerRole='legacy';
   }
  }
  state.layerSchema=1;return state;
 }
 function motionTime(def,time,loop){if(def.isPose)return 0;return loop&&def.length>0?((time%def.length)+def.length)%def.length:Math.max(0,Math.min(time,Math.max(0,def.length-.0001)));}
 function fade(clip,time){const i=clip.fadeIn||0,o=clip.fadeOut||0,smooth=x=>{x=clamp(x);return x*x*(3-2*x);};return Math.min(i?smooth(time/i):1,o?smooth((clip.len-time)/o):1);}
 function bodyLayers(state,actor,env){
  const result=[],time=state.current;
  const push=(item,key,local,weight)=>{
   const def=env.motion(item.assetId);if(!def)throw Error('叠加动作素材不可用：'+item.assetId);
   const mode=item.blendMode||def.defaultBlend||'override';
   if(mode==='additive'&&!def.isAdditive)throw Error('此动作不具备原生增量数据，请使用局部覆盖：'+def.source);
   result.push({id:key,motionId:def.motionId,time:motionTime(def,local,item.loop===true),weight:clamp(weight/100),additive:mode==='additive',scope:item.scope||def.defaultScope||'full'});
  };
  for(const item of actor.residentLayers||[])if(item.kind==='animation'&&item.enabled!==false&&!(item.condition==='resident'&&env.hasBaseAction))push(item,'resident:'+item.id,time,item.weight);
  for(const track of state.tracks.filter(t=>t.type==='animation'&&t.target===actor.id&&t.layerRole==='overlay'&&t.enabled!==false))for(const clip of track.clips)if(active(clip,time))push(clip,'clip:'+clip.id,time-clip.start+(clip.sourceOffset||0),(clip.weight??100)*fade(clip,time-clip.start));
  if(result.length>32)throw Error('同一角色同时生效的身体叠加不能超过 32 层');
  return result;
 }
 function sample(keys,time){if(!keys?.length)return 0;if(time<=keys[0].time)return keys[0].value;for(let i=1;i<keys.length;i++)if(time<=keys[i].time){const a=keys[i-1],b=keys[i],u=(time-a.time)/(b.time-a.time);return a.value+(b.value-a.value)*u;}return keys[keys.length-1].value;}
 function faceLayers(state,actor,env){
  const values=new Map(),times=new Map(),time=state.current,sampler=env.sample||sample;
  function apply(item,local,factor=1){
   const def=env.face(item.assetId),shape=env.shape(item.assetId);
   const weight=clamp((item.propertyKeys?.weight?.length?sampler(item.propertyKeys.weight,Math.max(0,local-(item.sourceOffset||0))):item.weight??100)/100)*factor;
   if(def){
    if(!def.channels)throw Error('正在读取表情曲线：'+(def.source||item.assetId));
    const position=item.playback==='loop'||item.loop===true?local%def.length:Math.min(local,def.length);
    for(const channel of def.channels){if(env.supports&&!env.supports(channel.shape))continue;const value=clamp(sampler(channel.keys,Math.max(0,position))/100);values.set(channel.shape,(values.get(channel.shape)||0)*(1-weight)+value*weight);}
   }else if(shape){if(env.supports&&!env.supports(shape.source))throw Error('角色缺少表情通道：'+shape.source);const value=clamp((item.propertyKeys?.weight?.length?sampler(item.propertyKeys.weight,Math.max(0,local-(item.sourceOffset||0))):item.weight??80)/100);values.set(shape.source,(values.get(shape.source)||0)*(1-factor)+value*factor);if(shape.source.startsWith('eyeMaterial.'))times.set(shape.source,Math.max(0,local));}
   else throw Error('常驻表情或贴花素材不可用：'+item.assetId);
  }
  if(actor.inheritBodyFace&&env.bodyFace){const inherited=env.bodyFace();if(inherited)apply(inherited.item,inherited.time);}
  for(const item of actor.residentLayers||[])if(['expression','decal'].includes(item.kind)&&item.enabled!==false)apply(item,item.playback==='loop'?time+(item.sourceOffset||0):(item.sourceOffset??0));
  // Authored face clips take precedence over defaults. Lip-sync remains a final mouth-only pass.
  const lips=[];
  for(const track of state.tracks.filter(t=>t.type==='expression'&&t.target===actor.id&&t.enabled!==false))for(const clip of track.clips){
   if(!active(clip,time))continue;
   const local=time-clip.start,factor=fade(clip,local);
   if(clip.lipSyncSource){
    if(clip.lipVisemes)for(const [v,name] of Object.entries(clip.lipVisemes)){const keys=clip.propertyKeys?.['viseme_'+v];if(keys?.length)lips.push({name,weight:clamp(sampler(keys,local)/100)*factor});}
    else {const shape=env.shape(clip.assetId);if(shape)lips.push({name:shape.source,weight:clamp((clip.propertyKeys?.weight?.length?sampler(clip.propertyKeys.weight,local):clip.weight??80)/100)*factor});}
   }else if(env.face(clip.assetId)||env.shape(clip.assetId))apply(clip,local+(clip.sourceOffset||0),factor);
  }
  if(lips.length){for(const name of values.keys())if(name.startsWith('b_mouth.'))values.delete(name);for(const item of lips)values.set(item.name,item.weight);}
  return [...values].map(([name,weight])=>({name,weight,...(times.has(name)?{time:times.get(name)}:{})}));
 }
 function matchesFilter(def,filter){if(filter==='all')return true;if(!def)return false;if(filter==='pose')return def.isPose===true;if(filter==='animation')return def.isPose===false;if(filter==='overlay')return def.overlayReady===true;return false;}
 function summary(actor,assetName){return (actor.residentLayers||[]).filter(x=>x.enabled&&x.kind!=='gaze').map(x=>assetName(x.assetId)||'素材缺失').join('、');}
 return {scopes,kinds,validateResident,normalize,motionTime,bodyLayers,faceLayers,sample,fade,active,matchesFilter,summary};
});
