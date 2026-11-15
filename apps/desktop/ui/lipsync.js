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
  function combineFaceLayers(layers) {
    const active=new Map(),mouth=new Map();
    for(const layer of layers){
      if(layer.mouthOverride){mouth.set(layer.name,layer.weight);continue;}
      active.set(layer.name,layer.weight);
    }
    if(mouth.size){for(const name of active.keys())if(name.startsWith('b_mouth.'))active.delete(name);for(const [name,weight] of mouth)active.set(name,weight);}
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
  return {generate,combineFaceLayers,phonemeKeys};
});
