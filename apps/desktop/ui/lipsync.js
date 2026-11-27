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
  const labels={emotion:'情绪口型（缓慢开合）',amplitude:'音量张合',phoneme:'日语五元音',manual:'手工五元音'};
  function modeFor(clip){return clip?(clip.lipMode||(clip.lipVisemes?'phoneme':'amplitude')):'emotion';}

  // Keys describe participation in speech. The mouth cycle is evaluated at the
  // playhead so a sustained voice keeps moving without baking per-frame keys.
  function sentenceKeys({timing,channels,sampleRate,duration,length,fps,offset=0,volume=1,fadeIn=0,fadeOut=0}){
    if(!Number.isFinite(length)||length<=0||length>3600||!Number.isFinite(duration)||duration<=0||
       !Number.isFinite(offset)||offset<0||![24,25,30,60].includes(fps)||!Number.isFinite(volume)||volume<0||volume>1||
       !Number.isFinite(fadeIn)||fadeIn<0||!Number.isFinite(fadeOut)||fadeOut<0)
      throw Error('情绪口型参数无效');
    const end=Math.min(length,duration-offset),spans=[],keys=[{time:0,value:0}];
    // Bridge consonants and brief gaps. Bound key counts on hour-long clips.
    const bridge=Math.max(.12,length/1800);
    function voice(start,stop){
      start=Math.max(0,start);stop=Math.min(end,stop);
      if(stop<=start)return;
      const last=spans[spans.length-1];
      if(last&&start-last.stop<=bridge)last.stop=Math.max(last.stop,stop);
      else spans.push({start,stop});
    }
    if(channels&&end>0&&volume>0){
      if(!channels.length||!Number.isFinite(sampleRate)||sampleRate<=0||
         channels.some(c=>!c||c.length!==channels[0].length))throw Error('语音采样无效');
      const first=Math.floor(offset*sampleRate),last=Math.min(channels[0].length,Math.ceil((offset+end)*sampleRate));
      const block=Math.max(1,Math.round(sampleRate*.02)),levels=[];
      let peak=0;
      for(let i=first;i<last;i+=block){
        const stop=Math.min(i+block,last);let energy=0;
        for(const channel of channels)for(let k=i;k<stop;k++)energy+=channel[k]*channel[k];
        const rms=Math.sqrt(energy/((stop-i)*channels.length));
        levels.push(rms);peak=Math.max(peak,rms);
      }
      const gate=Math.max(.003,peak*.045);
      levels.forEach((level,i)=>{
        if(level>gate)voice((first+i*block)/sampleRate-offset,Math.min(first+(i+1)*block,last)/sampleRate-offset);
      });
    }else if(timing?.frameRate>0&&Array.isArray(timing.phonemes)&&Math.abs(duration-timing.frameCount/timing.frameRate)<=.05){
      for(const p of timing.phonemes)if(!/^(pau|sil[be]?|sp)$/i.test(p.phoneme))
        voice(p.startFrame/timing.frameRate-offset,p.endFrame/timing.frameRate-offset);
    }else voice(0,end);
    function add(time,value){
      const last=keys[keys.length-1];
      if(time>last.time+1e-8)keys.push({time,value});else last.value=value;
    }
    if(volume>0)for(const {start,stop} of spans){
      const attack=Math.min(.09,(stop-start)*.45),release=Math.min(.12,(stop-start)*.45);
      const times=[start,start+attack,stop-release,stop];
      for(const t of [fadeIn,length-fadeOut])if(t>start&&t<stop)times.push(t);
      for(const t of times.sort((a,b)=>a-b)){
        const envelope=Math.max(0,Math.min(1,(t-start)/attack,(stop-t)/release));
        const fade=Math.min(1,fadeIn?t/fadeIn:1,fadeOut?(length-t)/fadeOut:1);
        add(t,75*volume*envelope*fade);
      }
    }
    add(length,0);
    return keys;
  }

  function curveValue(keys,time){
    const end=keys[keys.length-1][0],t=time%end;
    const i=keys.findIndex(k=>k[0]>t);
    const a=keys[i-1],b=keys[i],span=b[0]-a[0],u=(t-a[0])/span;
    const h=u*u*(3-2*u);
    return Math.max(0,Math.min(1,((1-h)*a[1]+h*b[1]+span*u*(1-u)*((1-u)*a[3]-u*b[2]))/100));
  }

  function applyTalkCycle(active,layer,profiles,supports){
    const mouths=[...active].filter(([key,w])=>key.startsWith('b_mouth.')&&w>0);
    const total=mouths.reduce((sum,[,v])=>sum+v,0),gain=layer.weight;
    const add=(key,delta)=>active.set(key,(active.get(key)||0)+delta);
    const neutralPulse=.45*(1-Math.cos(2*Math.PI*layer.cycleTime/(11/30)))/2;
    for(const [key,weight] of mouths){
      // Some base shapes have several authored profiles at different weights.
      let best=null;
      for(const profile of profiles){
        if(profile.trigger!==key||best&&Math.abs(best.weight-weight)<=Math.abs(profile.weight-weight))continue;
        if(!supports||profile.curves.every(c=>supports(c.shape)))best=profile;
      }
      if(!best){
        const hint=weight*gain*neutralPulse*.35/Math.max(1,total);
        add(key,-hint);add(layer.name,hint);
        continue;
      }
      const share=weight*gain/Math.max(1,total);
      add(key,-share);
      for(const c of best.curves)add(c.shape,share*curveValue(c.keys,layer.cycleTime));
    }
    // A neutral mesh has no expression binding. Use a restrained default opening.
    if(total<1)add(layer.name,(1-total)*gain*neutralPulse);
    for(const [key,value] of active)if(key.startsWith('b_mouth.'))active.set(key,Math.max(0,Math.min(1,value)));
  }
  function applyMouthLayers(active,lips,profiles=[],supports){
    if(!lips.length)return;
    const overrides=lips.filter(layer=>!layer.emotion);
    if(overrides.length){
      for(const name of active.keys())if(name.startsWith('b_mouth.'))active.delete(name);
      for(const layer of overrides)active.set(layer.name,layer.weight);
      return;
    }
    const layer=lips[lips.length-1],{name,weight}=layer;
    if(weight<=0)return;
    if(Number.isFinite(layer.cycleTime)){applyTalkCycle(active,layer,profiles,supports);return;}
    let expression=0;
    for(const [key,value] of active)if(key.startsWith('b_mouth.'))expression=Math.max(expression,value);
    // Strong authored expressions retain more of their lip contour. All other facial channels pass through.
    const mix=weight*(1-.65*Math.min(1,expression));
    for(const [key,value] of active)if(key.startsWith('b_mouth.'))active.set(key,value*(1-mix));
    active.set(name,(active.get(name)||0)+mix);
  }
  function combineFaceLayers(layers,profiles,supports) {
    const active=new Map(),mouth=[];
    for(const layer of layers){
      if(layer.mouthOverride||layer.emotion)mouth.push(layer);
      else active.set(layer.name,layer.weight);
    }
    applyMouthLayers(active,mouth,profiles,supports);
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
