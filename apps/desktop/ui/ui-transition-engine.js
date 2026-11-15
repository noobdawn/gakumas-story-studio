(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.CreatorUITransitions=api;})(globalThis,()=>{
 'use strict';
 const total=d=>d.inDuration+d.hold+d.outDuration;
 const family=a=>a.source.replace(/_(l|p)$/,'');
 const canonical=id=>id.replace(/-(?:l|p)-v1$/,'-l-v1');
 function choices(entries){return entries.filter(a=>!a.source.endsWith('_p')&&(!a.source.endsWith('_l')||entries.some(b=>b.source===family(a)+'_p'))).map(a=>({...a,alias:a.alias.replace(/ · 横版$/,'')}));}
 function layout(asset,entries,aspect){if(!/_(l|p)$/.test(asset.source))return asset;const selected=entries.find(a=>a.source===family(asset)+(aspect<1?'_p':'_l'));if(!selected)throw Error('当前画幅的转场布局缺失，请重新准备素材：'+family(asset));return selected;}
 function covered(c,d){const scale=c.len/total(d);return {start:c.start+(d.coverStart??d.inDuration)*scale,end:c.start+(d.inDuration+d.hold+(d.coverOut??0))*scale};}
 function plan(state,entries){const [w,h]=state.globalSettings.aspect.split(':').map(Number),result=[];for(const [order,t] of state.tracks.entries())if(t.type==='ui'&&t.enabled!==false)for(const c of t.clips){let asset=entries.find(a=>a.id===c.assetId);if(c.uiKind!=='transition'||!asset||asset.renderer!=='titan-ui-graph-v2')throw Error('UI / 转场素材不可用：'+c.name+'；请准备素材或禁用该轨道');asset=layout(asset,entries,w/h);result.push({start:c.start,len:c.len,order,asset,id:c.id});}return result;}
 function evaluate(plan,time,aspect){const draws=plan.flatMap(c=>time>=c.start&&time<c.start+c.len?CreatorUITransitionGraph.evaluate(c.asset,(time-c.start)/c.len*total(c.asset),aspect):[]);if(draws.length>512)throw Error('同时叠加的 UI 图形过多，请减少重叠层');return draws;}
 // Only scene tracks supply scene changes; this gate just waits for their load.
 function nextGate(state,from,to,sceneAt){const points=[...new Set(state.tracks.filter(t=>t.type==='scene'&&t.enabled!==false).flatMap(t=>t.clips.flatMap(c=>[c.start,c.start+c.len])))].filter(t=>t>from+1e-8&&t<=to+1e-8).sort((a,b)=>a-b);for(const time of points){const before=sceneAt(Math.max(0,time-1e-6)),after=sceneAt(time);if(before!==after)return {time,sceneId:after};}return null;}
 function migrate(state,id){
  const legacy=state.tracks.filter(t=>t.type==='ui').flatMap(t=>t.clips.filter(c=>c.targetSceneId).map(c=>({track:t,clip:c,time:c.start+c.len/2}))).sort((a,b)=>a.time-b.time);if(!legacy.length){for(const t of state.tracks.filter(t=>t.type==='ui'))for(const c of t.clips)delete c.targetSceneId;return false;}
  const duration=state.globalSettings?.duration||30,existing=state.tracks.filter(t=>t.type==='scene'&&t.enabled!==false).flatMap(t=>t.clips.map(c=>c.start));
  for(const item of legacy){const c=item.clip,end=Math.min(duration,...legacy.filter(x=>x.time>item.time).map(x=>x.time),...existing.filter(t=>t>item.time));if(end>item.time)state.tracks.push({id:id(),name:'场景切换（旧转场迁移）',type:'scene',target:'scene',enabled:item.track.enabled!==false,locked:item.track.locked===true,clips:[{id:id(),name:'场景 · '+c.targetSceneId,assetId:'scene-'+c.targetSceneId,start:item.time,len:end-item.time}]});delete c.targetSceneId;}
  for(const t of state.tracks.filter(t=>t.type==='ui'))for(const c of t.clips)delete c.targetSceneId;
  state.uiTransitionSchema=2;return true;
 }
 return {total,covered,plan,evaluate,nextGate,migrate,choices,layout,canonical};
});
