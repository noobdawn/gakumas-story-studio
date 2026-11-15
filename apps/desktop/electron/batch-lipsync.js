'use strict';
const crypto=require('node:crypto'),lip=require('../ui/lipsync');
function generate(document,roleTargets,audioDurations){
 const doc=structuredClone(document),s=doc.state,fps=s.globalSettings.fps,dialogues=new Map(s.dialogues.map(d=>[d.id,d])),assets=new Map(s.assets.map(a=>[a.id,a])),tracks=new Map(),skipped=[],created=[];
 const audioTracks=s.tracks.filter(t=>t.type==='audio');
 for(const track of audioTracks)for(const c of track.clips){
  const d=dialogues.get(c.dialogue);if(!d||!d.voice||!Object.hasOwn(roleTargets,d.speaker))continue;
  if(/^[（(].*[）)]$/u.test(d.text)){skipped.push({dialogueId:d.id,reason:'内心独白不生成口型'});continue;}
  const actorId=roleTargets[d.speaker];if(track.target!==actorId){skipped.push({dialogueId:d.id,reason:'音频轨道不属于说话角色'});continue;}
  const conflicts=s.tracks.some(t=>t.type==='expression'&&t.target===actorId&&t.enabled!==false&&t.clips.some(x=>c.start<x.start+x.len-1e-6&&c.start+c.len>x.start+1e-6&&(x.lipSyncSource?.audioClipId===c.id||x.assetId==='asset-local-mouth'||x.assetId?.startsWith('asset-face-b_mouth.'))));
  if(conflicts){skipped.push({dialogueId:d.id,reason:'已有重叠嘴形或口型，保留原片段'});continue;}
  const asset=assets.get(d.voice),timing=asset?.voiceTiming,duration=audioDurations[d.voice];if(!timing||!Number.isFinite(duration)||Math.abs(duration-timing.frameCount/timing.frameRate)>.05||c.len>60){skipped.push({dialogueId:d.id,reason:'音素时间或音频时长不匹配'});continue;}
  const keys=lip.phonemeKeys(timing,c.sourceOffset||0,c.len,fps,c.volume??1,c.fadeIn||0,c.fadeOut||0);if(!Object.values(keys).some(list=>list.some(k=>k.value>0))){skipped.push({dialogueId:d.id,reason:'未检测到可用口型'});continue;}
  let t=tracks.get(actorId);if(!t){t={id:crypto.randomUUID(),name:d.speaker+' · 音素口型',type:'expression',target:actorId,clips:[]};tracks.set(actorId,t)}
  const signature=JSON.stringify([s.projectId,fps,track.target,c.start,c.len,c.sourceOffset||0,c.volume??1,c.fadeIn||0,c.fadeOut||0,d.id,d.voice]);
  t.clips.push({id:crypto.randomUUID(),name:'对白口型（音素实验）',assetId:'asset-local-mouth',start:c.start,len:c.len,weight:0,lipMode:'phoneme',lipSyncSource:{audioClipId:c.id,signature},propertyKeys:keys,lipVisemes:{a:'b_mouth.mouth_003',i:'b_mouth.mouth_004',u:'b_mouth.mouth_010',e:'b_mouth.mouth_012',o:'b_mouth.mouth_008'}});created.push(d.id);
 }
 for(const [id,t] of tracks){const actor=s.objects.find(o=>o.id===id);if(!actor)throw Error('口型角色不存在');if(!actor.components.includes('expression'))actor.components.push('expression');s.tracks.push(t)}
 return {document:doc,created,skipped};
}
module.exports={generate};
