(function(root){'use strict';root.CreatorStoryVoice=function(env){
  const S=root.CreatorStory,L=root.CreatorLipSync;
  async function decode(asset){
    const response=await fetch(env.url(asset));if(!response.ok)throw Error('无法读取新语音文件');
    if(Number(response.headers.get('content-length'))>128*1024*1024)throw Error('语音文件超过 128 MB');
    const bytes=await response.arrayBuffer();if(bytes.byteLength>128*1024*1024)throw Error('语音文件超过 128 MB');
    const context=new AudioContext();try{const audio=await context.decodeAudioData(bytes);if(!Number.isFinite(audio.duration)||audio.duration<=0||audio.duration>3600||audio.numberOfChannels>8)throw Error('语音长度或声道无效');return audio;}finally{await context.close();}
  }
  async function apply(entries,identity=env.state(),stamp=JSON.stringify(identity)){
    if(!entries.length)return {applied:0,delta:0};
    const before=structuredClone(identity),next=structuredClone(before),regenerated=new Set();
    try{
      for(const entry of entries){
        const d=next.dialogues.find(d=>d.id===entry.dialogueId),asset=entry.asset;
        if(!d||entry.expected&&JSON.stringify(d)!==entry.expected)throw Error('对白已改变，请重新生成或应用语音');
        const matching=S.rows(next).filter(r=>r.clip.dialogue===d.id),a=matching.find(r=>r.track.type==='audio');
        if(!a||matching.filter(r=>r.track.type==='audio').length!==1||(a.clip.sourceOffset||0)!==0)throw Error('对白语音已拆分或带源偏移，请先整理');
        if(matching.some(r=>r.track.locked))throw Error('对白轨道已锁定');
        const audio=await decode(asset),length=S.ceil(next,audio.duration);
        if(!next.assets.some(x=>x.id===asset.id))next.assets.push(structuredClone(asset));
        if(!S.unitFor(next,d.id))S.insertDialogue(next,d.id,S.insertionIndex(next,a.clip.start),env.id(),{gap:!S.units(next).length?a.clip.start:0});
        const unit=S.unitFor(next,d.id);unit.contentLength=length;d.voice=asset.id;
        if(entry.request){d.cookedFor=structuredClone(entry.request);d.voiceSource=structuredClone(entry.request.reference);d.language=entry.request.language;}else delete d.cookedFor;
        if(d.pendingVoice?.assetId===asset.id){const saved=next.assets.find(a=>a.id===asset.id);if(saved)saved.alias=d.pendingVoice.originalAlias??saved.alias.replace(/（待排时）$/,'');}delete d.pendingVoice;
        const actor=next.objects.find(o=>o.id===a.track.target),lips=S.rows(next).filter(r=>r.clip.lipSyncSource?.audioClipId===a.clip.id);
        if(lips.length>1)throw Error('对白有多个口型片段，请先整理');
        const old=lips[0];if(old&&(old.track.locked||old.clip.lipMode==='manual'||old.clip.lipEdited))throw Error('已有手工调整或锁定的口型，请先保留为独立动画或删除后重试');
        if(old||actor&&env.supported(actor)){
          const use=L.modeFor(old?.clip);
          if(use!=='emotion'&&length>60)throw Error('音量及五元音口型单句限 60 秒');
          if(use==='phoneme'&&!asset.voiceTiming)throw Error('新音频缺少音素时间，请先将口型切换到情绪口型或音量模式');
          if(use==='phoneme'&&Math.abs(audio.duration-asset.voiceTiming.frameCount/asset.voiceTiming.frameRate)>.05)throw Error('新语音与音素时间不一致');
          const fades=[Math.min(a.clip.fadeIn||0,length),Math.min(a.clip.fadeOut||0,length)],volume=a.clip.volume??1,fps=next.globalSettings.fps;
          let propertyKeys;
          if(use==='phoneme')propertyKeys=L.phonemeKeys(asset.voiceTiming,0,length,fps,volume,...fades);
          else {
            const channels=Array.from({length:audio.numberOfChannels},(_,i)=>audio.getChannelData(i));
            const weight=use==='emotion'?L.sentenceKeys({timing:asset.voiceTiming,channels,sampleRate:audio.sampleRate,duration:audio.duration,length,fps,volume,fadeIn:fades[0],fadeOut:fades[1]}):
              L.generate(channels,audio.sampleRate,0,length,fps,volume,...fades);
            propertyKeys={weight};
          }
          const payload={assetId:'asset-local-mouth',len:length,start:a.clip.start,weight:0,lipMode:use,lipCycleOffset:use==='emotion'?0:undefined,lipEdited:false,lipGeneration:env.id(),lipSyncSource:{audioClipId:a.clip.id,signature:'pending'},propertyKeys};
          if(use==='phoneme')payload.lipVisemes=structuredClone(old.clip.lipVisemes);
          if(old){Object.assign(old.clip,payload);if(use!=='phoneme')delete old.clip.lipVisemes;}
          else{actor.components=[...new Set([...actor.components,'expression'])];next.tracks.push({id:env.id(),name:actor.name+' · 自动口型',type:'expression',target:actor.id,clips:[{id:env.id(),name:'对白口型（缓慢开合）',...payload}]});}
        }
        // Audio fades remain bounded; original source files and voice speed stay unchanged.
        for(const key of ['fadeIn','fadeOut'])if(a.clip[key]!==undefined)a.clip[key]=Math.min(a.clip[key],length/2);
        regenerated.add(d.id);
      }
      const result=S.reflow(next,before,{regenerated});
      if(env.state()!==identity||JSON.stringify(env.state())!==stamp)throw Error('语音准备期间工程已改变，未覆盖后续编辑');
      env.commit(next,before,result);return {...result,applied:entries.length};
    }catch(error){if(env.state().projectId===identity.projectId)env.retain(entries,error.message);throw error;}
  }
  return {apply};
};})(globalThis);
