(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CreatorStory=factory();})(globalThis,function(){
  'use strict';
  const rows=s=>s.tracks.flatMap(track=>track.clips.map(clip=>({track,clip})));
  const clone=x=>structuredClone(x), finite=Number.isFinite, near=(a,b)=>Math.abs(a-b)<1e-6;
  const units=s=>s.story?.units||[];
  const unitFor=(s,dialogueId)=>dialogueId&&units(s).find(u=>u.dialogueId===dialogueId);
  const blank=()=>({version:1,units:[],tail:0});
  const frame=s=>1/(s.globalSettings?.fps||30);
  const q=(s,x)=>Math.round(x/frame(s))*frame(s);
  const ceil=(s,x)=>Math.max(frame(s),Math.ceil(x/frame(s)-1e-7)*frame(s));
  const label=(s,u)=>u.dialogueId?(s.dialogues.find(d=>d.id===u.dialogueId)?.speaker||'对白')+' · '+(s.dialogues.find(d=>d.id===u.dialogueId)?.text||''):u.name;
  const fail=message=>{throw Error(message);};
  function schedule(s){
    const result=new Map();let end=0,lastStart=0;
    for(const u of units(s)){
      const wanted=q(s,end+u.gap),start=u.placement==='fixed'?q(s,u.at):wanted;
      if(start< -1e-6||start<lastStart-1e-6)fail('“'+label(s,u)+'”的提前接话时间超出了上一段起点');
      if(u.placement==='fixed'&&wanted>start+1e-6)fail('固定时间冲突：“'+label(s,u)+'”固定在 '+start.toFixed(3)+' 秒，前面的剧情需要排到 '+wanted.toFixed(3)+' 秒');
      const speechStart=q(s,start+u.before),speechEnd=q(s,speechStart+ceil(s,u.contentLength)),finish=q(s,speechEnd+u.after);
      if(finish>3600+1e-6)fail('剧情长度超过一小时');
      result.set(u.id,{start,speechStart,speechEnd,end:finish});end=finish;lastStart=start;
    }
    const points=[...result.values()],finish=points.length?Math.max(...points.map(p=>p.end)):1;
    result.set('@story',{start:0,speechStart:0,speechEnd:finish,end:finish});return result;
  }
  function anchorTime(map,a){const point=map.get(a.unitId);if(!point)fail('剧情绑定的段落已不存在，请重新绑定');return point[a.edge]+a.offset;}
  function validate(s){
    if(s.story===undefined){if(rows(s).some(r=>r.clip.storyTiming)||s.markers?.some(m=>m.storyAnchor))fail('工程格式无效：缺少剧情主线');return;}
    const st=s.story,ids=new Set(),ds=new Set(),validId=x=>typeof x==='string'&&x.length>0&&x.length<=4096;
    if(!st||st.version!==1||!Array.isArray(st.units)||st.units.length>10000||!finite(st.tail)||st.tail<0||st.tail>3600)fail('工程格式无效：剧情主线');
    for(const u of st.units){
      if(!u||!validId(u.id)||u.id==='@story'||ids.has(u.id)||!['dialogue','pause','action'].includes(u.kind)||typeof u.name!=='string'||u.name.length>200||!['flow','fixed'].includes(u.placement)||!finite(u.at)||u.at<0||u.at>3600||!finite(u.gap)||Math.abs(u.gap)>3600||!finite(u.before)||u.before<0||!finite(u.after)||u.after<0||!finite(u.contentLength)||u.contentLength<=0||u.contentLength>3600)fail('工程格式无效：剧情段落');
      ids.add(u.id);
      if(u.kind==='dialogue'){
        if(!validId(u.dialogueId)||ds.has(u.dialogueId)||!s.dialogues.some(d=>d.id===u.dialogueId))fail('工程格式无效：剧情对白引用');ds.add(u.dialogueId);
        const linked=rows(s).filter(r=>r.clip.dialogue===u.dialogueId);
        if(linked.filter(r=>r.track.type==='audio').length!==1||linked.filter(r=>r.track.type==='dialogue').length!==1||linked.some(r=>(r.clip.sourceOffset||0)!==0))fail('剧情对白需要一段完整语音和一段字幕，请先整理拆分的片段');
      }else if(u.dialogueId!==undefined)fail('工程格式无效：非对白段落');
    }
    function anchor(a){if(!a||!(ids.has(a.unitId)||a.unitId==='@story')||!['start','speechStart','speechEnd','end'].includes(a.edge)||!finite(a.offset)||Math.abs(a.offset)>3600)fail('工程格式无效：剧情时间绑定');}
    for(const {clip:c} of rows(s))if(c.storyTiming!==undefined){
      const b=c.storyTiming;if(!b||!['keep','scale'].includes(b.keys))fail('工程格式无效：剧情片段设置');anchor(b.start);if(b.end!==undefined)anchor(b.end);
      if(unitFor(s,c.dialogue)||c.lipSyncSource)fail('对白和口型由剧情段落统一排时');
    }
    for(const m of s.markers||[])if(m.storyAnchor)anchor(m.storyAnchor);
    schedule(s);
  }
  function validateLayout(s){
    validate(s);if(!s.story)return;const map=schedule(s),all=rows(s),audio=new Map(all.filter(r=>r.track.type==='audio').map(r=>[r.clip.id,r.clip]));
    for(const {track,clip:c} of all){let start,end;const u=unitFor(s,c.dialogue),lipAudio=audio.get(c.lipSyncSource?.audioClipId);
      if(u){const p=map.get(u.id);start=track.type==='audio'?p.speechStart:p.start;end=track.type==='audio'?p.speechEnd:p.end;}
      else if(c.storyTiming){start=q(s,anchorTime(map,c.storyTiming.start));if(c.storyTiming.end)end=q(s,anchorTime(map,c.storyTiming.end));}
      else if(lipAudio&&unitFor(s,lipAudio.dialogue)){start=lipAudio.start;end=lipAudio.start+lipAudio.len;}
      if(start!==undefined&&!near(start,c.start)||end!==undefined&&!near(end,c.start+c.len))fail('工程中的剧情排时不一致：“'+c.name+'”');
    }
  }
  function signature(s,track,c,d){return JSON.stringify([s.projectId,s.globalSettings?.fps||30,track.target,c.start,c.len,c.sourceOffset||0,c.volume??1,c.fadeIn||0,c.fadeOut||0,d.id,d.voice]);}
  function resize(s,c,start,len){
    len=q(s,len);start=q(s,start);if(start< -1e-6||len<frame(s)-1e-6||start+len>3600+1e-6)fail('“'+c.name+'”绑定后的时间无效');
    if(!near(len,c.len)){
      const scale=c.storyTiming?.keys==='scale',ratio=len/c.len;
      for(const group of ['propertyKeys','mediaKeys'])for(const keys of Object.values(c[group]||{})){
        if(scale){for(const k of keys)k.time=Math.max(0,Math.min(len,k.time*ratio));}
        else if(keys.some(k=>k.time>len+1e-6))fail('“'+c.name+'”缩短后会丢失手工关键帧，请调整结束绑定或选择按比例调整关键帧');
      }
      if(scale){if(c.fadeIn!==undefined)c.fadeIn*=ratio;if(c.fadeOut!==undefined)c.fadeOut*=ratio;}
      else if((c.fadeIn||0)+(c.fadeOut||0)>len+1e-6)fail('“'+c.name+'”缩短后容纳不下淡入淡出，请先调整');
    }
    c.start=Math.max(0,start);c.len=len;
  }
  // Build and validate a complete layout before touching the caller's state.
  function reflow(s,baseline=s,{regenerated=new Set()}={}){
    validate(s);const next=clone(s),map=schedule(next),old=new Map(rows(baseline).map(r=>[r.clip.id,r])),all=rows(next);
    for(const {track,clip:c} of all){
      const u=unitFor(next,c.dialogue);
      if(u){const p=map.get(u.id);resize(next,c,track.type==='audio'?p.speechStart:p.start,track.type==='audio'?p.speechEnd-p.speechStart:p.end-p.start);}
      else if(c.storyTiming){const b=c.storyTiming,start=anchorTime(map,b.start),end=b.end?anchorTime(map,b.end):start+c.len;resize(next,c,start,end-start);}
    }
    const audio=new Map(all.filter(r=>r.track.type==='audio').map(r=>[r.clip.id,r]));
    for(const {clip:c} of all)if(c.lipSyncSource){
      const a=audio.get(c.lipSyncSource.audioClipId),u=a&&unitFor(next,a.clip.dialogue);if(!u)continue;
      const prior=old.get(c.id),oldAudio=old.get(a.clip.id),d=next.dialogues.find(d=>d.id===a.clip.dialogue),oldD=baseline.dialogues.find(d=>d.id===a.clip.dialogue);
      if(!regenerated.has(a.clip.dialogue)&&oldD&&oldD.voice!==d.voice)fail('“'+d.speaker+'”的口型需要随新语音重新生成');
      resize(next,c,a.clip.start,a.clip.len);
      if(regenerated.has(a.clip.dialogue)||prior&&oldAudio&&oldD&&prior.clip.lipSyncSource.signature===signature(baseline,oldAudio.track,oldAudio.clip,oldD))c.lipSyncSource.signature=signature(next,a.track,a.clip,d);
    }
    for(const m of next.markers||[])if(m.storyAnchor){m.time=q(next,anchorTime(map,m.storyAnchor));if(m.time<0||m.time>3600)fail('剧情标记“'+m.name+'”超出有效时间');}
    const changed=new Set();
    for(const {track,clip:c} of all){const prev=old.get(c.id);if(!prev||JSON.stringify(prev.clip)!==JSON.stringify(c)){changed.add(c.id);if(track.locked||prev?.track.locked)fail('“'+track.name+'”已锁定，无法调整整段剧情');}}
    for(const [id,r] of old)if(!all.some(x=>x.clip.id===id)&&r.track.locked)fail('“'+r.track.name+'”已锁定，无法删除整段剧情');
    const overlap=(a,b)=>a.start<b.start+b.len-1e-6&&a.start+a.len>b.start+1e-6;
    for(const t of next.tracks){const sorted=[...t.clips].sort((a,b)=>a.start-b.start);for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length&&sorted[j].start<sorted[i].start+sorted[i].len-1e-6;j++){
      const a=sorted[i],b=sorted[j];if(!changed.has(a.id)&&!changed.has(b.id))continue;
      const oa=old.get(a.id)?.clip,ob=old.get(b.id)?.clip;
      if(oa&&ob&&overlap(oa,ob)&&near(a.start-oa.start,b.start-ob.start)&&near(a.len,oa.len)&&near(b.len,ob.len))continue;
      fail('排时冲突：“'+a.name+'”与“'+b.name+'”在轨道“'+t.name+'”重叠，请调整绑定或固定时间片段');
    }}
    // Manual mouth animation must not be silently overridden by a newly timed lip track.
    for(const a of all.filter(r=>r.clip.lipSyncSource&&changed.has(r.clip.id)))for(const b of all)if(b.clip!==a.clip&&b.track.type==='expression'&&b.track.target===a.track.target&&b.track.enabled!==false&&a.track.enabled!==false&&b.clip.assetId===a.clip.assetId&&overlap(a.clip,b.clip)){
      const pa=old.get(a.clip.id)?.clip,pb=old.get(b.clip.id)?.clip;if(pa&&pb&&overlap(pa,pb)&&near(a.clip.start-pa.start,b.clip.start-pb.start)&&near(a.clip.len,pa.len)&&near(b.clip.len,pb.len))continue;
      fail('“'+a.clip.name+'”与另一嘴部动画重叠，请先整理口型轨道');
    }
    const end=Math.max(0,...[...map.values()].map(p=>p.end)),extent=Math.max(end+(next.story?.tail||0),...all.map(r=>r.clip.start+r.clip.len),...(next.markers||[]).map(m=>m.time),1);
    if(extent>3600+1e-6)fail('演出长度超过一小时');
    if(units(next).length||units(baseline).length){next.globalSettings.duration=ceil(next,extent);next.current=Math.min(next.current,next.globalSettings.duration);}
    Object.assign(s,next);return {changed:changed.size,delta:(s.globalSettings?.duration||30)-(baseline.globalSettings?.duration||30),end};
  }
  function insertDialogue(s,dialogueId,index,id,options={}){
    s.story ||=blank();if(unitFor(s,dialogueId))fail('对白已在剧情主线中');
    if(!s.story.units.length)for(const {track,clip:c} of rows(s))if(['camera','scene'].includes(track.type)&&!c.storyTiming&&near(c.start,0)&&near(c.len,s.globalSettings.duration))c.storyTiming={start:{unitId:'@story',edge:'start',offset:0},end:{unitId:'@story',edge:'end',offset:0},keys:'keep'};
    const audio=rows(s).find(r=>r.track.type==='audio'&&r.clip.dialogue===dialogueId);if(!audio)fail('对白缺少音频片段');
    const u={id,kind:'dialogue',dialogueId,name:'对白',contentLength:audio.clip.len,before:0,after:0,gap:0,placement:'flow',at:0,...options};
    s.story.units.splice(Math.max(0,Math.min(index,s.story.units.length)),0,u);s.dialogues.find(d=>d.id===dialogueId).linked=true;return u;
  }
  function insertBlock(s,index,id,kind='pause',length=1){s.story ||=blank();const u={id,kind,name:kind==='pause'?'停顿':'动作段',contentLength:length,before:0,after:0,gap:0,placement:'flow',at:0};s.story.units.splice(index,0,u);return u;}
  function insertionIndex(s,time){const map=schedule(s);const i=units(s).findIndex(u=>map.get(u.id).start>=time-1e-6);return i<0?units(s).length:i;}
  function reorder(s,id,index){const list=units(s),i=list.findIndex(u=>u.id===id);if(i<0)fail('剧情段落不存在');const [u]=list.splice(i,1);list.splice(Math.max(0,Math.min(index,list.length)),0,u);}
  function owned(s,ids){const chosen=new Set(ids),ds=new Set(units(s).filter(u=>chosen.has(u.id)).map(u=>u.dialogueId).filter(Boolean)),clips=new Set(rows(s).filter(r=>ds.has(r.clip.dialogue)||chosen.has(r.clip.storyTiming?.start.unitId)&&(!r.clip.storyTiming.end||chosen.has(r.clip.storyTiming.end.unitId))).map(r=>r.clip.id));let more=true;while(more){more=false;const links=new Set(rows(s).filter(r=>clips.has(r.clip.id)).map(r=>r.clip.mediaLink).filter(Boolean));for(const {clip:c} of rows(s))if(!clips.has(c.id)&&(clips.has(c.lipSyncSource?.audioClipId)||c.mediaLink&&links.has(c.mediaLink))){clips.add(c.id);more=true;}}return clips;}
  function removeUnits(s,ids){
    const selected=new Set(ids),map=schedule(s),deleted=owned(s,ids),list=units(s),remaining=list.filter(u=>!selected.has(u.id)),keep=new Set(remaining.map(u=>u.id));
    function retarget(a){if(a.unitId==='@story'||keep.has(a.unitId))return true;const at=list.findIndex(u=>u.id===a.unitId);const candidate=a.edge==='end'||a.edge==='speechEnd'?[...list.slice(0,at)].reverse().find(u=>keep.has(u.id)):list.slice(at+1).find(u=>keep.has(u.id));if(!candidate)return false;a.unitId=candidate.id;a.edge=a.edge==='end'||a.edge==='speechEnd'?'end':'start';return true;}
    for(const {track,clip:c} of rows(s)){
      if(deleted.has(c.id)&&track.locked)fail('“'+track.name+'”已锁定，无法删除剧情段落');
      if(c.storyTiming&&!deleted.has(c.id)){const before=JSON.stringify(c.storyTiming),b=c.storyTiming;if(!retarget(b.start)||b.end&&!retarget(b.end))fail('“'+c.name+'”跨越被删除的剧情边界，请先重新绑定起止');if(before!==JSON.stringify(b)&&track.locked)fail('跨段片段所在轨道已锁定');}
    }
    for(const t of s.tracks)t.clips=t.clips.filter(c=>!deleted.has(c.id));
    const dialogues=new Set(list.filter(u=>selected.has(u.id)).map(u=>u.dialogueId));s.dialogues=s.dialogues.filter(d=>!dialogues.has(d.id));
    s.markers=(s.markers||[]).filter(m=>!selected.has(m.storyAnchor?.unitId));s.story.units=remaining;
    return deleted;
  }
  // Manual moves of followers edit their relative offsets, so a later voice update preserves the edit.
  function rebase(s,before){
    const previousClips=new Map(rows(before).map(r=>[r.clip.id,r.clip]));
    for(const {clip:c} of rows(s)){const prev=previousClips.get(c.id);if(c.lipSyncSource&&prev&&c.lipGeneration===prev.lipGeneration&&(JSON.stringify(c.propertyKeys)!==JSON.stringify(prev.propertyKeys)||JSON.stringify(c.lipVisemes)!==JSON.stringify(prev.lipVisemes)))c.lipEdited=true;}
    if(!s.story||JSON.stringify(s.story)!==JSON.stringify(before.story)||s.globalSettings?.fps!==before.globalSettings?.fps)return;
    const map=schedule(s),old=new Map(rows(before).map(r=>[r.clip.id,r.clip]));
    for(const {track,clip:c} of rows(s))if(!old.has(c.id)&&!c.storyTiming&&!c.dialogue&&!c.lipSyncSource&&units(s).length){
      const u=[...units(s)].reverse().find(u=>map.get(u.id).start<=c.start+1e-6)||units(s)[0];
      c.storyTiming={start:{unitId:u.id,edge:'start',offset:q(s,c.start-map.get(u.id).start)},keys:'keep'};
      if(['camera','scene'].includes(track.type)&&near(c.start+c.len,s.globalSettings.duration))c.storyTiming.end={unitId:'@story',edge:'end',offset:q(s,c.start+c.len-map.get('@story').end)};
    }
    for(const {clip:c} of rows(s)){const prev=old.get(c.id),b=c.storyTiming;if(!prev||!b||JSON.stringify(b)!==JSON.stringify(prev.storyTiming))continue;
      if(!near(c.start,prev.start))b.start.offset=q(s,c.start-map.get(b.start.unitId)[b.start.edge]);
      if(b.end&&(!near(c.start,prev.start)||!near(c.len,prev.len)))b.end.offset=q(s,c.start+c.len-map.get(b.end.unitId)[b.end.edge]);
    }
  }
  function bind(s,ids,binding){const selected=new Set(ids),all=rows(s),links=new Set(all.filter(r=>selected.has(r.clip.id)).map(r=>r.clip.mediaLink).filter(Boolean));for(const {track,clip:c} of all)if(selected.has(c.id)||c.mediaLink&&links.has(c.mediaLink)){if(track.locked)fail('轨道已锁定');if(unitFor(s,c.dialogue)||c.lipSyncSource)fail('请在剧情段落中设置对白和口型时间');if(binding)c.storyTiming=clone(binding);else delete c.storyTiming;}}
  function assertFree(s,ids){const selected=new Set(ids),audio=new Map(rows(s).filter(r=>r.track.type==='audio').map(r=>[r.clip.id,r.clip]));if(rows(s).some(r=>selected.has(r.clip.id)&&(unitFor(s,r.clip.dialogue)||unitFor(s,audio.get(r.clip.lipSyncSource?.audioClipId)?.dialogue))))fail('此片段由剧情主线排时，请在“剧情主线”调整顺序、停顿或长度');}
  function copy(s,ids){
    const selected=new Set(ids),all=rows(s),audios=new Map(all.filter(r=>r.track.type==='audio').map(r=>[r.clip.id,r.clip]));
    const ds=new Set(all.filter(r=>selected.has(r.clip.id)).map(r=>r.clip.dialogue||audios.get(r.clip.lipSyncSource?.audioClipId)?.dialogue));
    const us=units(s).filter(u=>ds.has(u.dialogueId));if(!us.length)return null;const ownedIds=owned(s,us.map(u=>u.id));
    if(ids.some(id=>!ownedIds.has(id)))fail('请分别复制剧情段落与固定片段；剧情复制会包含其专属动作');
    const items=all.filter(r=>ownedIds.has(r.clip.id)),fresh=[];
    for(const r of items)if(r.clip.lipSyncSource){const a=all.find(a=>a.clip.id===r.clip.lipSyncSource.audioClipId),d=s.dialogues.find(d=>d.id===a?.clip.dialogue);if(a&&d&&r.clip.lipSyncSource.signature===signature(s,a.track,a.clip,d))fresh.push(d.id);}
    return clone({projectId:s.projectId,storyUnits:us,items:items.map(r=>({trackId:r.track.id,clip:r.clip})),dialogues:s.dialogues.filter(d=>us.some(u=>u.dialogueId===d.id)),groups:(s.clipGroups||[]).filter(g=>items.some(r=>r.clip.groupId===g.id)),fresh});
  }
  function paste(s,clipboard,at,id){
    if(clipboard.projectId!==s.projectId)fail('请在当前工程重新复制剧情');
    const destination=s;s=clone(s);
    const before=clone(s),index=insertionIndex(s,at),um=new Map(clipboard.storyUnits.map(u=>[u.id,id()])),dm=new Map(clipboard.dialogues.map(d=>[d.id,id()])),cm=new Map(clipboard.items.map(r=>[r.clip.id,id()])),gm=new Map(clipboard.groups.map(g=>[g.id,id()])),mm=new Map();
    for(const d of clipboard.dialogues){const next={...clone(d),id:dm.get(d.id)};delete next.pendingVoice;s.dialogues.push(next);}
    const copied=clipboard.storyUnits.map((u,i)=>({...clone(u),id:um.get(u.id),dialogueId:dm.get(u.dialogueId),placement:'flow',at:0,...(!i?{gap:0}:{})}));s.story.units.splice(index,0,...copied);
    for(const row of clipboard.items){const t=s.tracks.find(t=>t.id===row.trackId);if(!t)fail('原轨道已删除，请重新复制剧情');const c=clone(row.clip);c.id=cm.get(c.id);if(c.dialogue)c.dialogue=dm.get(c.dialogue);if(c.groupId)c.groupId=gm.get(c.groupId);if(c.mediaLink){if(!mm.has(c.mediaLink))mm.set(c.mediaLink,id());c.mediaLink=mm.get(c.mediaLink);}if(c.lipSyncSource)c.lipSyncSource.audioClipId=cm.get(c.lipSyncSource.audioClipId);if(c.storyTiming)for(const edge of ['start','end']){const a=c.storyTiming[edge];if(a&&um.has(a.unitId))a.unitId=um.get(a.unitId);}t.clips.push(c);}
    s.clipGroups=[...(s.clipGroups||[]),...clipboard.groups.map(g=>({...g,id:gm.get(g.id)}))];
    reflow(s,before,{regenerated:new Set(clipboard.fresh.map(d=>dm.get(d)))});Object.assign(destination,s);return [...cm.values()];
  }
  return {blank,rows,units,unitFor,label,frame,q,ceil,schedule,validate,validateLayout,signature,reflow,insertDialogue,insertBlock,insertionIndex,reorder,owned,removeUnits,rebase,bind,assertFree,copy,paste};
});
