(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.CreatorUITransitions=api;})(globalThis,()=>{
  'use strict';
  const ease=(t,mode)=>{t=Math.max(0,Math.min(1,t));if(mode==='OutCubic')return 1-(1-t)**3;if(mode==='InOutCubic')return t<.5?4*t*t*t:1-(-2*t+2)**3/2;throw Error('转场缓动尚未支持：'+mode);};
  const total=d=>d.inDuration+d.hold+d.outDuration;
  const switchTime=(c,d)=>c.start+c.len*(d.inDuration+d.hold/2)/total(d);
  function rects(c,d,time){
    if(time<c.start||time>=c.start+c.len)return [];
    const t=(time-c.start)/c.len*total(d),out=t>=d.inDuration+d.hold;
    return d.strips.map(s=>{const track=out?s.outTrack:s.inTrack,clock=out?t-d.inDuration-d.hold:t;
      const x=t>=d.inDuration&&!out?0:track.initial+track.delta*ease((clock-track.start)/track.duration,track.ease);
      const left=Math.max(0,.5+(x-s.width/2)/d.referenceWidth),right=Math.min(1,.5+(x+s.width/2)/d.referenceWidth);
      return {x:left,y:1-s.anchorMax,w:Math.max(0,right-left),h:s.anchorMax-s.anchorMin,color:d.color};
    }).filter(r=>r.w>0);
  }
  function plan(state,entries,scenes){
    const result=[];
    for(const [order,t] of state.tracks.entries())if(t.type==='ui'&&t.enabled!==false)for(const c of t.clips){
      const asset=entries.find(a=>a.id===c.assetId);
      if(c.uiKind!=='transition'||!asset)throw Error('UI / 转场素材不可用：'+c.name+'；请准备素材或禁用该轨道');
      if(c.targetSceneId&&!scenes.some(a=>a.sceneId===c.targetSceneId))throw Error('转场目标场景不可用：'+c.targetSceneId);
      result.push({start:c.start,len:c.len,targetSceneId:c.targetSceneId||'',order,asset,id:c.id});
    }
    const changes=result.filter(c=>c.targetSceneId).sort((a,b)=>a.start-b.start);
    for(let i=1;i<changes.length;i++)if(changes[i].start<changes[i-1].start+changes[i-1].len-1e-6)throw Error('两个切换场景的转场片段重叠，请错开时间或将其中一个设为仅遮挡');
    return result;
  }
  function sceneAt(plan,time,base,sceneStart=-1){let result=base,last=sceneStart;for(const c of plan){const point=switchTime(c,c.asset);if(c.targetSceneId&&point<=time+1e-8&&point>=last){result=c.targetSceneId;last=point;}}return result;}
  function nextGate(plan,from,to){return plan.filter(c=>c.targetSceneId).map(c=>({time:switchTime(c,c.asset),sceneId:c.targetSceneId})).filter(p=>p.time>from+1e-8&&p.time<=to+1e-8).sort((a,b)=>a.time-b.time)[0]||null;}
  function evaluate(plan,time){return plan.flatMap(c=>rects(c,c.asset,time));}
  return {ease,total,switchTime,rects,plan,sceneAt,nextGate,evaluate};
});
