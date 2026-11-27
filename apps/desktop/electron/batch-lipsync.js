'use strict';
const crypto=require('node:crypto'),lip=require('../ui/lipsync');
function generate(document,roleTargets,audioDurations){
 const doc=structuredClone(document),s=doc.state,fps=s.globalSettings.fps,dialogues=new Map(s.dialogues.map(d=>[d.id,d])),assets=new Map(s.assets.map(a=>[a.id,a])),tracks=new Map(),skipped=[],created=[];
 const audioTracks=s.tracks.filter(t=>t.type==='audio');
 for(const track of audioTracks)for(const c of track.clips){
  const d=dialogues.get(c.dialogue);if(!d||!d.voice||!Object.hasOwn(roleTargets,d.speaker))continue;
  if(/^[（(].*[）)]$/u.test(d.text)){skipped.push({dialogueId:d.id,reason:'内心独白不生成口型'});continue;}
  const actorId=roleTargets[d.speaker];if(track.target!==actorId){skipped.push({dialogueId:d.id,reason:'音频轨道不属于说话角色'});continue;}
  const conflicts=s.tracks.some(t=>t.type==='expression'&&t.target===actorId&&t.clips.some(x=>x.lipSyncSource&&
    (x.lipSyncSource.audioClipId===c.id||t.enabled!==false&&c.start<x.start+x.len-1e-6&&c.start+c.len>x.start+1e-6)));
  if(conflicts){skipped.push({dialogueId:d.id,reason:'已有对白口型，保留原片段'});continue;}
  const asset=assets.get(d.voice),duration=audioDurations[d.voice];
  if(!asset||!Number.isFinite(duration)||duration<=0){skipped.push({dialogueId:d.id,reason:'缺少有效语音时长'});continue;}
  const keys=lip.sentenceKeys({timing:asset.voiceTiming,duration,length:c.len,fps,offset:c.sourceOffset||0,volume:c.volume??1,fadeIn:c.fadeIn||0,fadeOut:c.fadeOut||0});
  if(!keys.some(k=>k.value>0)){skipped.push({dialogueId:d.id,reason:'裁剪范围内没有发声'});continue;}
  let t=tracks.get(actorId);if(!t){t={id:crypto.randomUUID(),name:d.speaker+' · 情绪口型',type:'expression',target:actorId,clips:[]};tracks.set(actorId,t)}
  const signature=JSON.stringify([s.projectId,fps,track.target,c.start,c.len,c.sourceOffset||0,c.volume??1,c.fadeIn||0,c.fadeOut||0,d.id,d.voice]);
  t.clips.push({id:crypto.randomUUID(),name:'对白口型（缓慢开合）',assetId:'asset-local-mouth',start:c.start,len:c.len,weight:0,lipMode:'emotion',lipCycleOffset:c.sourceOffset||0,lipSyncSource:{audioClipId:c.id,signature},propertyKeys:{weight:keys}});created.push(d.id);
 }
 for(const [id,t] of tracks){const actor=s.objects.find(o=>o.id===id);if(!actor)throw Error('口型角色不存在');if(!actor.components.includes('expression'))actor.components.push('expression');s.tracks.push(t)}
 return {document:doc,created,skipped};
}
module.exports={generate};
