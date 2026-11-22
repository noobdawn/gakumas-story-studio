(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.CreatorClipProperties=api;
})(globalThis,function(){
  'use strict';
  const shapes={linear:'线性',mirror:'镜面',circle:'圆形',rectangle:'矩形'};
  const within=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
  function mask(id,shape='rectangle'){
    return {id,shape,enabled:true,x:0,y:0,width:.5,height:.5,rotation:0,feather:0,radius:0,lockAspect:true};
  }
  function validateMasks(masks){
    if(masks===undefined)return;
    if(!Array.isArray(masks)||masks.length>8)throw Error('每个片段最多可添加 8 个蒙版');
    const ids=new Set();
    for(const m of masks){
      if(!m||typeof m.id!=='string'||!m.id||m.id.length>100||ids.has(m.id)||!Object.hasOwn(shapes,m.shape)||
        !within(m.x,-2,2)||!within(m.y,-2,2)||!within(m.width,.001,4)||!within(m.height,.001,4)||
        !within(m.rotation,-36000,36000)||!within(m.feather,0,1)||!within(m.radius,0,1)||
        typeof m.enabled!=='boolean'||typeof m.lockAspect!=='boolean')throw Error('蒙版形状或边界无效');
      ids.add(m.id);
    }
  }
  function sound(s,t,c){
    if(t.type==='audio')return {track:t,clip:c};
    for(const track of s.tracks.filter(track=>track.type==='audio')){
      const clip=track.clips.find(a=>(c.mediaLink && a.mediaLink===c.mediaLink)||
        (c.dialogue && a.dialogue===c.dialogue && (a.start===c.start||s.dialogues.find(d=>d.id===c.dialogue)?.linked)));
      if(clip)return {track,clip};
    }
    return null;
  }
  function sourceLength(c,fps){
    const rate=c.mediaRate||1;
    if(within(c.rateSourceLength,0,14400)&&Math.abs(Math.max(1,Math.round(c.rateSourceLength*fps/rate))/fps-c.len)<1e-6)return c.rateSourceLength;
    return c.len*rate;
  }
  function newLength(c,rate,fps){
    if(!within(rate,.25,4))throw Error('播放速度须在 0.25–4 倍之间');
    return Math.max(1,Math.round(sourceLength(c,fps)*fps/rate))/fps;
  }
  function retime(s,t,c,rate){
    if(!['media','audio'].includes(t.type)||c.dialogue)throw Error('此片段没有独立的变速时间');
    const fps=s.globalSettings.fps,len=newLength(c,rate,fps),span=sourceLength(c,fps);
    if(rate===(c.mediaRate||1))return false;
    const entries=[];
    for(const track of s.tracks)for(const clip of track.clips)if(clip===c||c.mediaLink&&clip.mediaLink===c.mediaLink)entries.push({track,clip});
    for(const {track,clip} of entries){
      if(track.locked)throw Error('片段或关联声音已锁定');
      if(clip.start+len>s.globalSettings.duration+1e-6)throw Error('变速后超出演出末尾，请先延长工程');
      if(track.clips.some(other=>other!==clip&&clip.start<other.start+other.len-1e-6&&clip.start+len>other.start+1e-6))throw Error('变速后与同轨片段重叠，请先腾出时间');
    }
    for(const {clip} of entries){
      const ratio=len/clip.len;
      for(const keys of Object.values(clip.mediaKeys||{}))for(const key of keys)key.time=Math.min(len,key.time*ratio);
      for(const key of ['fadeIn','fadeOut'])if(clip[key]!==undefined)clip[key]=Math.min(len,clip[key]);
      Object.assign(clip,{mediaRate:rate,len,rateSourceLength:span});
    }
    return true;
  }
  return {shapes,mask,validateMasks,sound,sourceLength,newLength,retime};
});
