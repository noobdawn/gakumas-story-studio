(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./story-timeline'),require('./screen-media'),require('./composition'));
  else root.CreatorTimelineEdit=factory(root.CreatorStory,root.CreatorScreenMedia,root.CreatorComposition);
})(globalThis,function(story,media,composition){
  'use strict';
  const rows=s=>s.tracks.flatMap(track=>track.clips.map(clip=>({track,clip})));
  const overlaps=(a,b)=>a.start<b.start+b.len-1e-6&&a.start+a.len>b.start+1e-6;
  function select(s,ids){const selected=new Set(ids),all=rows(s),groups=new Set(all.filter(r=>selected.has(r.clip.id)).map(r=>r.clip.groupId).filter(Boolean));return all.filter(r=>selected.has(r.clip.id)||r.clip.groupId&&groups.has(r.clip.groupId)).map(r=>r.clip.id);}
  function expand(s,ids,groups=true){
    const all=rows(s),selected=new Set(ids),linked=new Set(s.dialogues.filter(d=>d.linked).map(d=>d.id));
    let changed=true;
    while(changed){changed=false;const chosen=all.filter(r=>selected.has(r.clip.id)),groupIds=new Set(chosen.map(r=>r.clip.groupId).filter(Boolean)),media=new Set(chosen.map(r=>r.clip.mediaLink).filter(Boolean)),dialogues=new Set(chosen.map(r=>r.clip.dialogue).filter(x=>linked.has(x))),audio=new Set(chosen.filter(r=>r.track.type==='audio').map(r=>r.clip.id)),sources=new Set(chosen.map(r=>r.clip.lipSyncSource?.audioClipId).filter(Boolean));
      for(const {clip:c} of all)if(!selected.has(c.id)&&(groups&&c.groupId&&groupIds.has(c.groupId)||c.mediaLink&&media.has(c.mediaLink)||c.dialogue&&dialogues.has(c.dialogue)||sources.has(c.id)||c.lipSyncSource&&audio.has(c.lipSyncSource.audioClipId))){selected.add(c.id);changed=true;}
    }
    return all.filter(r=>selected.has(r.clip.id));
  }
  function unlocked(items){if(items.some(r=>r.track.locked))throw Error('相关轨道已锁定，请先解锁后再整体编辑');}
  function prune(s){
    const empty=s.tracks.filter(t=>t.type!=='world'&&!t.clips.length);
    if(empty.length){
      const removed=new Set(empty);
      s.tracks=s.tracks.filter(t=>!removed.has(t));
      // An enabled empty scene lane used to suppress the legacy background for the whole timeline.
      if(empty.some(t=>t.type==='scene'&&t.enabled!==false)&&!s.tracks.some(t=>t.type==='scene'&&t.enabled!==false))s.sceneId=null;
    }
    const anchors=new Set(s.tracks.filter(t=>t.type!=='media').map(t=>t.id));
    for(const t of s.tracks)if(t.timelineAnchor&&(t.type!=='media'||!anchors.has(t.timelineAnchor)))delete t.timelineAnchor;
    if(!s.clipGroups)return;const counts=new Map();for(const {clip} of rows(s))if(clip.groupId)counts.set(clip.groupId,(counts.get(clip.groupId)||0)+1);
    s.clipGroups=s.clipGroups.filter(g=>(counts.get(g.id)||0)>1);const ids=new Set(s.clipGroups.map(g=>g.id));for(const {clip} of rows(s))if(clip.groupId&&!ids.has(clip.groupId))delete clip.groupId;
  }
  function validate(s){
    const validId=x=>typeof x==='string'&&x.length>0&&x.length<=4096,list=x=>Array.isArray(x)&&x.length<=10000;
    const groups=s.clipGroups??[],markers=s.markers??[];
    if(!list(groups)||!list(markers))throw Error('工程格式无效：片段组或标记');
    const ids=new Set();for(const g of groups){if(!g||!validId(g.id)||ids.has(g.id)||typeof g.name!=='string'||!g.name.trim()||g.name.length>100)throw Error('工程格式无效：片段组');ids.add(g.id);}
    const counts=new Map();for(const {clip} of rows(s))if(clip.groupId!==undefined){if(!ids.has(clip.groupId))throw Error('工程格式无效：片段组引用');counts.set(clip.groupId,(counts.get(clip.groupId)||0)+1);}
    if(groups.some(g=>(counts.get(g.id)||0)<2))throw Error('工程格式无效：片段组至少需要两个片段');
    ids.clear();for(const m of markers){if(!m||!validId(m.id)||ids.has(m.id)||!Number.isFinite(m.time)||m.time<0||m.time>3600||typeof m.name!=='string'||!m.name.trim()||m.name.length>100)throw Error('工程格式无效：时间轴标记');ids.add(m.id);}
  }
  function group(s,ids,id){const items=expand(s,ids);if(items.length<2)throw Error('请先选择至少两个片段');unlocked(items);const old=new Set(items.map(r=>r.clip.groupId).filter(Boolean));s.clipGroups=(s.clipGroups||[]).filter(g=>!old.has(g.id));const g={id:id(),name:'片段组 '+(s.clipGroups.length+1)};s.clipGroups.push(g);for(const {clip} of items)clip.groupId=g.id;return items.map(r=>r.clip.id);}
  function ungroup(s,ids){const selected=expand(s,ids),groups=new Set(selected.map(r=>r.clip.groupId).filter(Boolean));if(!groups.size)throw Error('所选片段尚未组合');unlocked(selected);for(const {clip} of rows(s))if(groups.has(clip.groupId))delete clip.groupId;prune(s);return selected.map(r=>r.clip.id);}
  function checkPlacement(s,items,ignored,duration){
    const all=rows(s);unlocked(items);
    for(const {track,clip} of items){if(!track||clip.start< -1e-6||clip.len<=0||clip.start+clip.len>duration+1e-6)throw Error('整体编辑超出演出时长');
      if(all.some(r=>!ignored.has(r.clip.id)&&overlaps(clip,r.clip)&&(r.track.id===track.id||clip.lipSyncSource&&r.track.enabled!==false&&r.track.type==='expression'&&r.track.target===track.target&&(clip.lipMode==='emotion'?r.clip.lipSyncSource:r.clip.assetId===clip.assetId))))throw Error('目标位置与已有片段重叠');
    }
  }
  function validLips(s,env){const all=rows(s);return new Set(all.filter(({clip:c})=>{if(!c.lipSyncSource)return false;const a=all.find(r=>r.clip.id===c.lipSyncSource.audioClipId),d=a&&s.dialogues.find(d=>d.id===a.clip.dialogue);return a&&d&&c.start===a.clip.start&&c.len===a.clip.len&&c.lipSyncSource.signature===env.signature(a.track,a.clip,d);}).map(r=>r.clip.id));}
  function refreshLips(s,items,env,valid){for(const {clip} of items)if(clip.lipSyncSource&&valid.has(clip.id)){const source=rows(s).find(r=>r.clip.id===clip.lipSyncSource.audioClipId),d=source&&s.dialogues.find(d=>d.id===source.clip.dialogue);if(source&&d)clip.lipSyncSource.signature=env.signature(source.track,source.clip,d);}}
  function move(s,ids,delta,env,groups=true){const items=expand(s,ids,groups);story.assertFree(s,items.map(r=>r.clip.id));if(!items.length)throw Error('请选择片段');const valid=validLips(s,env),proposed=items.map(r=>({track:r.track,clip:{...r.clip,start:env.q(r.clip.start+delta)}}));checkPlacement(s,proposed,new Set(items.map(r=>r.clip.id)),env.duration);for(let i=0;i<items.length;i++)items[i].clip.start=proposed[i].clip.start;refreshLips(s,items,env,valid);return items.map(r=>r.clip.id);}
  // Build a tentative drop without changing the live project or the undo snapshot.
  function transfer(s,ids,primaryId,targetId,delta,env){
    const items=expand(s,ids,false),source=items.find(r=>r.clip.id===primaryId)?.track;
    const hover=s.tracks.find(t=>t.id===targetId);
    if(!source||!hover||source===hover)throw Error('请选择另一条目标轨道');
    unlocked(items);if(hover.locked)throw Error('目标轨道已锁定');
    story.assertFree(s,items.map(r=>r.clip.id));
    if(source.type!=='media'&&source.type!==hover.type)throw Error('请拖到相同类型的轨道');
    const sourceIds=new Set(items.filter(r=>r.track===source).map(r=>r.clip.id));
    if(source.target!==hover.target&&items.some(r=>r.clip.lipSyncSource&&(r.track===source||sourceIds.has(r.clip.lipSyncSource.audioClipId))))
      throw Error('对白配音和生成的口型需要保留在对应角色的轨道');
    const moving=new Set(items.map(r=>r.clip.id)),valid=validLips(s,env);
    const next={...s,objects:[...s.objects],tracks:s.tracks.map(t=>({...t,clips:t.clips.filter(c=>!moving.has(c.id))}))};
    const tracks=new Map(next.tracks.map(t=>[t.id,t])),anchor=tracks.get(targetId);
    const entries=items.map(({track,clip})=>({source:track,track:tracks.get(track.id),
      clip:{...clip,start:delta===0?clip.start:env.q(clip.start+delta),...(clip.lipSyncSource?{lipSyncSource:{...clip.lipSyncSource}}:{})}}));
    const transferred=entries.filter(r=>r.source===source);
    const links=new Set(transferred.map(r=>r.clip.mediaLink).filter(Boolean));
    const followsVideo=r=>source.type==='media'&&r.source.type==='audio'&&r.source.target===source.target&&links.has(r.clip.mediaLink);
    function place(entry,track){
      if(track.clips.some(c=>overlaps(c,entry.clip)))throw Error('目标位置与已有片段重叠');
      track.clips.push(entry.clip);entry.track=track;
    }
    for(const r of entries)if(r.source!==source&&!followsVideo(r))place(r,r.track);
    let destination=anchor;
    const created=source.type==='media'&&(anchor.type!=='media'||transferred.some(r=>anchor.clips.some(c=>overlaps(c,r.clip))));
    if(created){
      const original=s.objects.find(o=>o.id===source.target);
      const layer=media.newLayer(next,original?.mediaLayout||{},env.id);
      next.objects.push(layer);destination=media.newTrack(layer,env.id);
      composition.placeMediaTrack(next,destination,anchor);
    }
    for(const r of transferred){
      const clip=r.clip;
      if(['animation','expression'].includes(source.type)&&source.target!==hover.target&&!env.actorAccepts(hover,clip))
        throw Error('目标角色不支持此片段的动作或表情');
      if(source.type==='media'){
        media.keepLayout(clip,s.objects.find(o=>o.id===source.target),next.objects.find(o=>o.id===destination.target));
      }else if(source.type==='audio'&&hover.clips.some(c=>!!c.dialogue!==!!clip.dialogue)){
        throw Error('对白配音与独立声音使用不同轨道');
      }else if(source.type==='animation'&&source.layerRole!==hover.layerRole){
        if(clip.gaze)throw Error('视线片段只能放在角色动画叠加轨道');
        const motion=env.motion(clip.assetId);
        if(!motion)throw Error('当前动作素材不可用，无法更换动画层');
        if(hover.layerRole==='overlay')clip.blendMode=motion.isAdditive?'additive':'override';
        else if(motion.isAdditive)throw Error('原生增量动作只能放在叠加轨道');
        else delete clip.blendMode;
      }else if(clip.propertyKeys?.scale&&!['角色','道具'].includes(s.objects.find(o=>o.id===hover.target)?.type)){
        throw Error('目标对象不支持缩放关键帧');
      }
      place(r,destination);
    }
    for(const r of entries.filter(followsVideo)){
      // Keep the row under the pointer when the video is dropped above its own sound.
      let sound=r.track;
      if(sound!==anchor){
        sound=media.linkedSoundTrack(next.tracks,destination,r.clip,env.id,r.source.enabled!==false);
        if(!next.tracks.includes(sound))next.tracks.push(sound);
      }else if(r.source.clips.every(c=>links.has(c.mediaLink)))sound.target=destination.target;
      place(r,sound);
    }
    checkPlacement(s,entries,moving,env.duration);
    for(const track of new Set(entries.map(r=>r.track)))track.clips.sort((a,b)=>a.start-b.start);
    if(s.transitions){
      next.transitions=s.transitions.map(x=>x.trackId===source.id&&sourceIds.has(x.leftId)&&sourceIds.has(x.rightId)?{...x,trackId:destination.id}:x)
        .filter(x=>composition.join(next,x));
    }
    refreshLips(next,entries,env,valid);
    return {state:next,track:destination,created};
  }
  function copy(s,ids,groups=true){
    const items=expand(s,ids,groups);
    if(!items.length)throw Error('请选择要复制的片段');
    const selected=new Set(items.map(r=>r.clip.id));
    const ds=new Set(items.map(r=>r.clip.dialogue)),gs=new Set(items.map(r=>r.clip.groupId));
    const data=story.copy(s,[...selected])||{
      projectId:s.projectId,start:Math.min(...items.map(r=>r.clip.start)),items:items.map(r=>({trackId:r.track.id,clip:r.clip})),
      dialogues:s.dialogues.filter(d=>ds.has(d.id)),groups:(s.clipGroups||[]).filter(g=>gs.has(g.id)),
      ...(s.compositionVersion===1?{transitions:(s.transitions||[]).filter(x=>selected.has(x.leftId)&&selected.has(x.rightId))}:{})
    };
    const needed=new Set(data.items.map(r=>r.trackId));
    data.trackSettings=s.tracks.filter(t=>needed.has(t.id)).map(({clips,...settings})=>settings);
    data.trackOrder=s.tracks.map(t=>t.id);
    return structuredClone(data);
  }
  function pasteTime(s,data,time,env){
    if(!data || data.storyUnits)return time;
    // Move the entire selection by the same number of frames to the first free span.
    const tracks=new Map(s.tracks.map(t=>[t.id,t]));
    const ranges=[];
    for(const {trackId,clip} of data.items){
      const offset=clip.start-data.start;
      for(const other of tracks.get(trackId)?.clips||[])ranges.push([other.start-offset-clip.len,other.start+other.len-offset]);
    }
    let at=env.q(time);
    for(const [left,right] of ranges.sort((a,b)=>a[0]-b[0])){
      if(at>left+1e-6&&at<right-1e-6)at=Math.ceil((right-1e-7)/env.frame)*env.frame;
    }
    return env.q(at);
  }
  function paste(s,clipboard,at,env){
    if(!clipboard)throw Error('请先复制片段');
    if(clipboard.projectId!==s.projectId)throw Error('请在当前工程重新复制片段');
    const existing=new Set(s.tracks.map(t=>t.id)),missing=(clipboard.trackSettings||[]).filter(t=>!existing.has(t.id));
    if(!missing.length)return pasteContents(s,clipboard,at,env);
    const draft=structuredClone(s),data=structuredClone(clipboard);
    for(const settings of missing){
      if(draft.objects&&!draft.objects.some(o=>o.id===settings.target))throw Error('片段所属对象已移除，请重新复制');
      // A media object or actor base layer can only have one track of its kind.
      const replacement=draft.tracks.find(t=>t.target===settings.target&&t.type===settings.type
        &&(t.type==='media'||t.layerRole==='base'&&settings.layerRole==='base'));
      if(replacement){
        for(const row of data.items)if(row.trackId===settings.id)row.trackId=replacement.id;
        for(const seam of data.transitions||[])if(seam.trackId===settings.id)seam.trackId=replacement.id;
      }else{
        const next=data.trackOrder.slice(data.trackOrder.indexOf(settings.id)+1).find(id=>existing.has(id));
        const index=next?draft.tracks.findIndex(t=>t.id===next):draft.tracks.length;
        draft.tracks.splice(index,0,{...settings,clips:[]});existing.add(settings.id);
      }
    }
    const result=pasteContents(draft,data,at,env);
    Object.assign(s,draft);return result;
  }
  function pasteContents(s,clipboard,at,env){if(clipboard.storyUnits)return story.paste(s,clipboard,at,env.id);const delta=env.q(at)-clipboard.start,items=clipboard.items.map(r=>({track:s.tracks.find(t=>t.id===r.trackId),clip:structuredClone(r.clip)}));if(items.some(r=>!r.track))throw Error('原轨道已移除，请重新复制');for(const r of items)r.clip.start=env.q(r.clip.start+delta);checkPlacement(s,items,new Set(),env.duration);
    const valid=validLips({dialogues:clipboard.dialogues,tracks:s.tracks.map(t=>({...t,clips:clipboard.items.filter(r=>r.trackId===t.id).map(r=>r.clip)}))},env),ids=new Map(items.map(r=>[r.clip.id,env.id()])),ds=new Map(clipboard.dialogues.map(d=>[d.id,env.id()])),gs=new Map(clipboard.groups.map(g=>[g.id,env.id()])),links=new Map();
    for(const {clip:c} of items){c.id=ids.get(c.id);delete c.storyTiming;if(c.visualEffect?.scope==='clips')c.visualEffect.clipIds=c.visualEffect.clipIds.map(id=>ids.get(id)||id);if(c.dialogue)c.dialogue=ds.get(c.dialogue);if(c.groupId)c.groupId=gs.get(c.groupId);if(c.mediaLink){if(!links.has(c.mediaLink))links.set(c.mediaLink,env.id());c.mediaLink=links.get(c.mediaLink);}if(c.lipSyncSource){const audio=ids.get(c.lipSyncSource.audioClipId);if(!audio)throw Error('关联音频缺失，请重新复制');c.lipSyncSource.audioClipId=audio;}}
    s.dialogues.push(...clipboard.dialogues.map(d=>({...structuredClone(d),id:ds.get(d.id)})));if(gs.size)(s.clipGroups||=[]).push(...clipboard.groups.map(g=>({...g,id:gs.get(g.id)})));
    for(const {track,clip} of items){track.clips.push(clip);track.clips.sort((a,b)=>a.start-b.start);}if(s.compositionVersion===1)for(const x of clipboard.transitions||[])s.transitions.push({...structuredClone(x),id:env.id(),leftId:ids.get(x.leftId),rightId:ids.get(x.rightId)});refreshLips(s,items,env,new Set([...valid].map(x=>ids.get(x))));prune(s);return items.map(r=>r.clip.id);
  }
  function remove(s,ids,groups=true){const items=expand(s,ids,groups);if(!items.length)throw Error('请选择要删除的片段');unlocked(items);const removed=new Set(items.map(r=>r.clip.id));for(const t of s.tracks)t.clips=t.clips.filter(c=>!removed.has(c.id));prune(s);return [];}
  function sample(keys,t){const sorted=[...keys].sort((a,b)=>a.time-b.time),l=[...sorted].reverse().find(k=>k.time<=t)||sorted[0],r=sorted.find(k=>k.time>=t)||sorted.at(-1),u=l.time===r.time?0:(t-l.time)/(r.time-l.time);return typeof l.value==='boolean'?l.value:Array.isArray(l.value)?l.value.map((v,i)=>v+(r.value[i]-v)*u):l.value+(r.value-l.value)*u;}
  function slice(keys,from,len){return Object.fromEntries(Object.entries(keys).map(([k,all])=>[k,all.length?[{time:0,value:structuredClone(sample(all,from))},...all.filter(x=>x.time>from+1e-7&&x.time<from+len-1e-7).map(x=>({...structuredClone(x),time:x.time-from})),{time:len,value:structuredClone(sample(all,from+len))}]:[]]));}
  async function segment(row,from,len,env){const c=structuredClone(row.clip);c.start=env.q(c.start+from);c.len=env.q(len);if(c.storyTiming){c.storyTiming.start.offset+=from;if(c.storyTiming.end)c.storyTiming.end.offset+=from+len-row.clip.len;}if(c.lipCycleOffset!==undefined)c.lipCycleOffset+=from;if(from&&!c.lipSyncSource)c.sourceOffset=await env.offset(row.clip,from,row.track);if(c.propertyKeys)c.propertyKeys=slice(c.propertyKeys,from,c.len);if(c.mediaKeys)c.mediaKeys=slice(c.mediaKeys,from,c.len);if(from&&c.fadeIn!==undefined)c.fadeIn=0;if(from+len<row.clip.len-1e-6&&c.fadeOut!==undefined)c.fadeOut=0;env.clampFade(c,row.track);return c;}
  async function cut(s,ids,at,env,side=null){
    story.assertFree(s,expand(s,ids).map(r=>r.clip.id));
    const valid=validLips(s,env),candidates=expand(s,ids,false),active=candidates.filter(r=>at>r.clip.start+env.frame/2&&at<r.clip.start+r.clip.len-env.frame/2);
    if(!active.length)throw Error('请将切割位置放在所选片段内部');const affected=expand(s,active.map(r=>r.clip.id),false);unlocked(affected);
    if(affected.some(r=>!active.includes(r)&&!(at>r.clip.start+env.frame/2&&at<r.clip.start+r.clip.len-env.frame/2)))throw Error('关联片段没有共同切割位置');
    for(const r of affected){if(r.clip.uiKind==='transition')throw Error('完整转场不能分割或快速裁剪，请调整转场时长');if(!side)env.checkCut(r.clip,r.track,at-r.clip.start);}
    const prepared=[];for(const r of affected){const t=env.q(at-r.clip.start);prepared.push({row:r,left:side==='left'?null:await segment(r,0,t,env),right:side==='right'?null:await segment(r,t,r.clip.len-t,env)});}
    if(side){for(const p of prepared)Object.assign(p.row.clip,side==='left'?p.right:p.left);refreshLips(s,affected,env,valid);return affected.map(r=>r.clip.id);}
    for(const p of prepared)if(p.left.storyTiming)delete p.left.storyTiming.end;
    const idsMap=new Map(prepared.map(p=>[p.row.clip.id,env.id()])),dialogues=new Map(),media=new Map();
    for(const p of prepared){const c=p.right;c.id=idsMap.get(p.row.clip.id);if(c.dialogue){if(!dialogues.has(c.dialogue))dialogues.set(c.dialogue,env.id());c.dialogue=dialogues.get(c.dialogue);}if(c.mediaLink){if(!media.has(c.mediaLink))media.set(c.mediaLink,env.id());c.mediaLink=media.get(c.mediaLink);}if(c.lipSyncSource)c.lipSyncSource.audioClipId=idsMap.get(c.lipSyncSource.audioClipId);}
    if(s.compositionVersion===1){for(const x of s.transitions||[])if(idsMap.has(x.leftId))x.leftId=idsMap.get(x.leftId);for(const {clip} of rows(s))if(clip.visualEffect?.scope==='clips')clip.visualEffect.clipIds=clip.visualEffect.clipIds.flatMap(id=>idsMap.has(id)?[id,idsMap.get(id)]:[id]);}
    s.dialogues.push(...s.dialogues.filter(d=>dialogues.has(d.id)).map(d=>({...structuredClone(d),id:dialogues.get(d.id)})));
    for(const p of prepared){Object.assign(p.row.clip,p.left);p.row.track.clips.push(p.right);p.row.track.clips.sort((a,b)=>a.start-b.start);}refreshLips(s,rows(s).filter(r=>affected.some(a=>a.clip.id===r.clip.id)||[...idsMap.values()].includes(r.clip.id)),env,new Set([...valid,...[...valid].map(x=>idsMap.get(x))]));return prepared.flatMap(p=>[p.left.id,p.right.id]);
  }
  return {rows,select,expand,prune,validate,group,ungroup,move,transfer,copy,paste,pasteTime,remove,cut,slice};
});
