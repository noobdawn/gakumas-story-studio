(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./timeline-edit'),require('./story-timeline'));else root.CreatorProjectRemoval=factory(root.CreatorTimelineEdit,root.CreatorStory);})(globalThis,function(edit,story){
  'use strict';
  const sceneKey=(c,asset)=>asset(c.assetId)?.sceneId||String(c.assetId||'scene-missing').replace(/^scene-/,'');
  function sceneAt(s,time,duration,asset){
    const tracks=s.tracks.filter(t=>t.type==='scene'&&t.enabled!==false);
    for(const t of tracks.slice().reverse()){const c=t.clips.find(c=>time>=c.start&&(time<c.start+c.len||time===duration&&Math.abs(c.start+c.len-duration)<1e-6));if(c)return sceneKey(c,asset);}
    return tracks.length?'':s.sceneId||'';
  }
  function source(a){if(a.scope==='project')return 'project';if(a.scope==='shared'||a.voiceProvider||a.effectKind||a.id?.startsWith('effect-'))return 'shared';return 'unpacked';}
  function descendants(s,ids){const found=new Set(ids);let changed=true;while(changed){changed=false;for(const o of s.objects)if(found.has(o.parent)&&!found.has(o.id)){found.add(o.id);changed=true;}}return found;}
  function apply(s,objectIds,clipIds,trackIds=new Set()){
    const before=structuredClone(s);
    const objects=descendants(s,objectIds),tracks=new Set([...trackIds,...s.tracks.filter(t=>objects.has(t.target)).map(t=>t.id)]);
    const seeds=[...clipIds,...s.tracks.filter(t=>tracks.has(t.id)).flatMap(t=>t.clips.map(c=>c.id))];
    const primary=edit.expand(s,seeds,false),storyIds=story.units(s).filter(u=>primary.some(r=>r.clip.dialogue===u.dialogueId&&u.dialogueId)).map(u=>u.id);
    const extra=story.owned(s,storyIds),items=edit.expand(s,[...seeds,...extra],false),removed=new Set(items.map(r=>r.clip.id));
    if(s.tracks.some(t=>t.locked&&(tracks.has(t.id)||t.clips.some(c=>removed.has(c.id)))))throw Error('相关轨道已锁定，请先解锁后再删除');
    const dialogues=new Set(items.map(r=>r.clip.dialogue).filter(Boolean));
    if(storyIds.length)story.removeUnits(s,storyIds);
    s.tracks=s.tracks.filter(t=>!tracks.has(t.id));for(const t of s.tracks)t.clips=t.clips.filter(c=>!removed.has(c.id));
    s.objects=s.objects.filter(o=>!objects.has(o.id));
    const used=new Set(s.tracks.flatMap(t=>t.clips.map(c=>c.dialogue)));
    s.dialogues=s.dialogues.filter(d=>!dialogues.has(d.id)||used.has(d.id));
    if(objects.has(s.selected))s.selected=null;if(removed.has(s.selectedClip))s.selectedClip=null;
    edit.prune(s);if(story.units(before).length)story.reflow(s,before);
  }
  function cleanupScenes(s,removedScenes,asset){
    const remaining=new Set(s.tracks.filter(t=>t.type==='scene').flatMap(t=>t.clips.map(c=>sceneKey(c,asset))));
    // Once a scene has been edited on the timeline, removing it must not reveal
    // the invisible legacy base scene again, including after deleting its track.
    s.sceneId=null;
    const gone=new Set([...removedScenes].filter(key=>!remaining.has(key)));
    apply(s,s.objects.filter(o=>o.propId&&gone.has(o.sceneId||'classroom')).map(o=>o.id),[]);
    if(gone.has('classroom'))s.hiddenSceneProps=[];
  }
  function clips(s,ids,asset,groups=true){let items=edit.expand(s,ids,groups);const unitIds=story.units(s).filter(u=>u.dialogueId&&items.some(r=>r.clip.dialogue===u.dialogueId)).map(u=>u.id);items=edit.expand(s,[...items.map(r=>r.clip.id),...story.owned(s,unitIds)],false);if(!items.length)throw Error('请选择要删除的片段');const scenes=new Set(items.filter(r=>r.track.type==='scene').map(r=>sceneKey(r.clip,asset)));apply(s,[],items.map(r=>r.clip.id));if(scenes.size)cleanupScenes(s,scenes,asset);return [];}
  function track(s,id,asset){const t=s.tracks.find(t=>t.id===id);if(!t)throw Error('轨道不存在');const scenes=new Set(t.type==='scene'?t.clips.map(c=>sceneKey(c,asset)):[]);apply(s,t.type==='media'?[t.target]:[],[],new Set([id]));if(t.type==='scene')cleanupScenes(s,scenes,asset);return [];}
  function scene(s,key,asset){const ids=s.tracks.filter(t=>t.type==='scene').flatMap(t=>t.clips.filter(c=>sceneKey(c,asset)===key).map(c=>c.id));apply(s,[],ids);if(s.sceneId===key)s.sceneId=null;const props=s.objects.filter(o=>o.propId&&(o.sceneId||'classroom')===key);apply(s,props.map(o=>o.id),[]);if(key==='classroom')s.hiddenSceneProps=[];return [];}
  function object(s,id,asset,currentScene){if(id==='scene')return scene(s,currentScene,asset);const o=s.objects.find(o=>o.id===id);if(!o)throw Error('对象不存在');apply(s,[id],[]);if(o.propId)s.hiddenSceneProps=[...new Set([...(s.hiddenSceneProps||[]),o.propId])];return [];}
  function asset(s,a,lookup){
    if(a.sceneId)scene(s,a.sceneId,lookup);
    const objects=s.objects.filter(o=>o.assetId===a.id||a.id==='asset-actor-1'&&o.id==='ttmr');
    const dialogues=new Set(s.dialogues.filter(d=>d.voice===a.id).map(d=>d.id));
    apply(s,objects.map(o=>o.id),s.tracks.flatMap(t=>t.clips.filter(c=>c.assetId===a.id||dialogues.has(c.dialogue)).map(c=>c.id)));
    for(const o of s.objects){if(o.idleAssetId===a.id)delete o.idleAssetId;if(o.costumeAssetId===a.id)delete o.costumeAssetId;o.residentLayers=o.residentLayers?.filter(l=>l.assetId!==a.id);}
    for(const d of s.dialogues){if(d.pendingVoice?.assetId===a.id)delete d.pendingVoice;if(d.voice===a.id)d.voice='';if(d.voiceSource?.id===a.id){delete d.voiceSource;delete d.cookedFor;}}
    s.assets=s.assets.filter(x=>x.id!==a.id);s.hiddenAssetIds=[...new Set([...(s.hiddenAssetIds||[]),a.id])];return [];
  }
  return {sceneAt,source,clips,track,scene,object,asset};
});
