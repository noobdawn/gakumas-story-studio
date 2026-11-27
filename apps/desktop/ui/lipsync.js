(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CreatorLipSync = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  // This is an amplitude envelope, not speech recognition or phoneme timing.
  function generate(channels, sampleRate, offset, length, fps, volume=1, fadeIn=0, fadeOut=0) {
    if (!Array.isArray(channels) || !channels.length || channels.length > 8 ||
        channels.some(c => !c || typeof c.length !== 'number' || c.length !== channels[0].length) ||
        !Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(offset) || offset < 0 ||
        !Number.isFinite(length) || length <= 0 || length > 60 || ![24,25,30,60].includes(fps) ||
        !Number.isFinite(volume) || volume < 0 || volume > 1 ||
        !Number.isFinite(fadeIn) || fadeIn < 0 || !Number.isFinite(fadeOut) || fadeOut < 0)
      throw Error('口型分析参数无效');
    const step = Math.max(1, Math.round(fps / 15));
    const half = Math.max(1, Math.round(sampleRate * .035));
    const frameCount = Math.ceil(length * fps - 1e-7);
    const values = [];
    for (let frame = 0; frame < frameCount; frame += step) {
      const time = frame / fps, center = Math.round((offset + time) * sampleRate);
      const start = Math.max(0, center - half), end = Math.min(channels[0].length, center + half);
      let energy = 0, count = 0;
      for (const channel of channels) for (let i = start; i < end; i++) {
        const value = Number.isFinite(channel[i]) ? channel[i] : 0;
        energy += value * value; count++;
      }
      values.push({time, rms: count ? Math.sqrt(energy / count) : 0});
    }
    const sorted = values.map(v => v.rms).filter(x => x > .003).sort((a,b) => a-b);
    const peak = sorted[Math.floor((sorted.length - 1) * .9)] || 0;
    const gate = Math.max(.003, peak * .10);
    const keys = values.map(({time,rms}) => {
      const level = peak <= gate ? 0 : Math.sqrt(Math.max(0, Math.min(1, (rms-gate)/(peak-gate))));
      const fade = (fadeIn ? Math.min(1,time/fadeIn) : 1) * (fadeOut ? Math.min(1,(length-time)/fadeOut) : 1);
      return {time, value: Math.round(90 * level * Math.max(0,fade) * volume)};
    });
    keys.push({time:length,value:0});
    return keys;
  }
  const labels={emotion:'情绪口型（整句）',amplitude:'音量张合',phoneme:'日语五元音',manual:'手工五元音'};
  function modeFor(clip){return clip?(clip.lipMode||(clip.lipVisemes?'phoneme':'amplitude')):'emotion';}

  // Find only the first and last spoken samples. Interior pauses never trigger another mouth change.
  function sentenceKeys({timing,channels,sampleRate,duration,length,fps,offset=0,volume=1,fadeIn=0,fadeOut=0}){
    if(!Number.isFinite(length)||length<=0||length>3600||!Number.isFinite(duration)||duration<=0||
       !Number.isFinite(offset)||offset<0||![24,25,30,60].includes(fps)||!Number.isFinite(volume)||volume<0||volume>1)
      throw Error('整句口型参数无效');
    const silent=[{time:0,value:0},{time:length,value:0}];
    let first=0,last=Math.min(length,duration-offset);
    if(last<=0||volume===0)return silent;
    if(timing?.frameRate>0&&Array.isArray(timing.phonemes)&&Math.abs(duration-timing.frameCount/timing.frameRate)<=.05){
      const voiced=timing.phonemes.filter(p=>!/^(pau|sil[be]?|sp)$/i.test(p.phoneme)&&p.endFrame/timing.frameRate>offset&&p.startFrame/timing.frameRate<offset+last);
      if(!voiced.length)return silent;
      first=Math.max(0,voiced[0].startFrame/timing.frameRate-offset);
      last=Math.min(last,voiced[voiced.length-1].endFrame/timing.frameRate-offset);
    }else if(channels){
      const block=Math.max(1,Math.round(sampleRate*.02)),start=Math.floor(offset*sampleRate),end=Math.min(channels[0].length,Math.ceil((offset+last)*sampleRate));
      let onset=-1,release=0;
      for(let i=start;i<end;i+=block){
        const stop=Math.min(i+block,end);let energy=0;
        for(const channel of channels)for(let k=i;k<stop;k++)energy+=channel[k]*channel[k];
        if(energy>(stop-i)*channels.length*.003**2){if(onset<0)onset=i;release=stop;}
      }
      if(onset<0)return silent;
      first=Math.max(0,onset/sampleRate-offset);last=Math.min(last,release/sampleRate-offset);
    }
    const span=last-first;
    if(span<=0)return silent;
    const attack=Math.min(span*.42,Math.max(.16,fadeIn-first)),release=Math.min(span*.44,Math.max(.20,fadeOut-(length-last)));
    const peak=32*volume,keys=[{time:0,value:0}];
    function add(time,value){
      if(time>keys[keys.length-1].time+1e-8)keys.push({time,value});
      else keys[keys.length-1].value=value;
    }
    add(first,0);
    for(const u of [.25,.75,1])add(first+attack*u,peak*u*u*(3-2*u));
    add(last-release,peak);
    for(const u of [.25,.75,1])add(last-release+release*u,peak*(1-u*u*(3-2*u)));
    add(length,0);
    return keys;
  }
  function applyMouthLayers(active,lips){
    if(!lips.length)return;
    const overrides=lips.filter(layer=>!layer.emotion);
    if(overrides.length){
      for(const name of active.keys())if(name.startsWith('b_mouth.'))active.delete(name);
      for(const layer of overrides)active.set(layer.name,layer.weight);
      return;
    }
    const {name,weight}=lips[lips.length-1];
    if(weight<=0)return;
    let expression=0;
    for(const [key,value] of active)if(key.startsWith('b_mouth.'))expression=Math.max(expression,value);
    // Strong authored expressions retain more of their lip contour. All other facial channels pass through.
    const mix=weight*(1-.65*Math.min(1,expression));
    for(const [key,value] of active)if(key.startsWith('b_mouth.'))active.set(key,value*(1-mix));
    active.set(name,(active.get(name)||0)+mix);
  }
  function combineFaceLayers(layers) {
    const active=new Map(),mouth=[];
    for(const layer of layers){
      if(layer.mouthOverride||layer.emotion)mouth.push(layer);
      else active.set(layer.name,layer.weight);
    }
    applyMouthLayers(active,mouth);
    return [...active].map(([name,weight])=>({name,weight}));
  }
  function phonemeKeys(timing,offset,length,fps,volume=1,fadeIn=0,fadeOut=0){
    if(!timing||!Number.isFinite(timing.frameRate)||timing.frameRate<=0||!Number.isSafeInteger(timing.frameCount)||!Array.isArray(timing.phonemes)||timing.phonemes.length>10000||!Number.isFinite(offset)||offset<0||!Number.isFinite(length)||length<=0||length>60||![24,25,30,60].includes(fps)||!Number.isFinite(volume)||volume<0||volume>1||!Number.isFinite(fadeIn)||fadeIn<0||!Number.isFinite(fadeOut)||fadeOut<0)throw Error('音素时间无效');
    let previous=0;for(const p of timing.phonemes){if(!p||typeof p.phoneme!=='string'||!/^[A-Za-z]{1,10}$/.test(p.phoneme)||!Number.isSafeInteger(p.startFrame)||!Number.isSafeInteger(p.endFrame)||p.startFrame<previous||p.endFrame<=p.startFrame||p.endFrame>timing.frameCount)throw Error('音素时间无效');previous=p.endFrame;}
    const vowels=['a','i','u','e','o'],result=Object.fromEntries(vowels.map(v=>['viseme_'+v,[]]));let index=0;
    const count=Math.ceil(length*fps-1e-7);for(let f=0;f<count;f++){
      const t=f/fps,frame=(offset+t)*timing.frameRate;
      while(index<timing.phonemes.length&&timing.phonemes[index].endFrame<=frame)index++;
      const p=timing.phonemes[index],active=p&&p.startFrame<=frame&&frame<p.endFrame?p.phoneme:'';
      const fade=(fadeIn?Math.min(1,t/fadeIn):1)*(fadeOut?Math.min(1,(length-t)/fadeOut):1);
      for(const v of vowels)result['viseme_'+v].push({time:t,value:active===v?Math.round(85*volume*Math.max(0,fade)):0});
    }
    for(const v of vowels){const key='viseme_'+v;result[key].push({time:length,value:0});const keys=result[key];result[key]=keys.filter((k,i)=>i===0||i===keys.length-1||k.value!==keys[i-1].value||k.value!==keys[i+1].value);}
    return result;
  }
  return {generate,combineFaceLayers,phonemeKeys,sentenceKeys,applyMouthLayers,labels,modeFor};
});
