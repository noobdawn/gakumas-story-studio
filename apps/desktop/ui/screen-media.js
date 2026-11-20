(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CreatorScreenMedia=api;})(globalThis,function(){
 'use strict';
 const defaults={anchorX:.5,anchorY:0,pivotX:.5,pivotY:0,x:0,y:0,width:.45,height:.85,scale:1,scaleX:1,scaleY:1,rotation:0,opacity:1,fit:'contain',lockAspect:true,flipX:false,flipY:false,cropLeft:0,cropRight:0,cropTop:0,cropBottom:0};
 const ranges={anchorX:[0,1],anchorY:[0,1],pivotX:[0,1],pivotY:[0,1],x:[-10,10],y:[-10,10],width:[.001,10],height:[.001,10],scale:[.001,20],scaleX:[.001,20],scaleY:[.001,20],rotation:[-36000,36000],opacity:[0,1],cropLeft:[0,.99],cropRight:[0,.99],cropTop:[0,.99],cropBottom:[0,.99]};
 const animated=['x','y','width','height','scale','scaleX','scaleY','rotation','opacity'];
 const isVisual=a=>a&&['贴图','视频'].includes(a.type);
 function validateLayout(layout){if(!layout||typeof layout!=='object'||Array.isArray(layout))throw Error('画面布局无效');for(const [k,v] of Object.entries(layout)){if(ranges[k]){if(!Number.isFinite(v)||v<ranges[k][0]||v>ranges[k][1])throw Error('画面参数超出范围：'+k);}else if(k==='fit'){if(!['contain','cover','stretch'].includes(v))throw Error('画面适配方式无效');}else if(['lockAspect','flipX','flipY'].includes(k)){if(typeof v!=='boolean')throw Error('画面开关无效');}else throw Error('未知画面参数：'+k);}const l={...defaults,...layout};if(l.cropLeft+l.cropRight>=.999||l.cropTop+l.cropBottom>=.999)throw Error('裁剪后必须保留画面');return l;}
 function sample(keys,time,fallback){if(!keys?.length)return fallback;if(time<=keys[0].time)return keys[0].value;for(let i=1;i<keys.length;i++)if(time<=keys[i].time){const a=keys[i-1],b=keys[i],t=(time-a.time)/(b.time-a.time);return a.value+(b.value-a.value)*t;}return keys[keys.length-1].value;}
 function layout(object,clip,time=0){const l={...defaults,...object?.mediaLayout,...clip?.mediaLayout};for(const [k,v] of Object.entries(clip?.mediaKeys||{}))l[k]=sample(v,time,l[k]);return validateLayout(l);}
 function validateClip(c){if(c.mediaLayout!==undefined)validateLayout(c.mediaLayout);if(c.mediaRate!==undefined&&(!Number.isFinite(c.mediaRate)||c.mediaRate<.25||c.mediaRate>4))throw Error('视频速度须为 0.25–4 倍');if(c.mediaLink!==undefined&&(typeof c.mediaLink!=='string'||c.mediaLink.length>100))throw Error('画面音频关联无效');if(c.mediaKeys!==undefined){if(!c.mediaKeys||typeof c.mediaKeys!=='object'||Array.isArray(c.mediaKeys))throw Error('画面关键帧无效');for(const [k,keys] of Object.entries(c.mediaKeys)){if(!animated.includes(k)||!Array.isArray(keys)||keys.length>10000)throw Error('画面关键帧属性无效');keys.forEach((v,i)=>{if(!v||!Number.isFinite(v.time)||v.time<0||v.time>c.len+1e-6||i&&v.time<=keys[i-1].time)throw Error('画面关键帧时间无效');validateLayout({[k]:v.value});});}}}
 // Coordinates use the final canvas, with +Y pointing upward. Rotation is in physical pixels.
 function quad(l,info,aspect){l=validateLayout(l);let u=l.cropLeft,v=l.cropBottom,uw=1-u-l.cropRight,vh=1-v-l.cropTop,w=l.width,h=l.height;const sourceAspect=info.width*uw/(info.height*vh),boxAspect=w*aspect/h;if(l.fit==='contain'){if(sourceAspect>boxAspect)h=w*aspect/sourceAspect;else w=h*sourceAspect/aspect;}else if(l.fit==='cover'){if(sourceAspect>boxAspect){const n=uw*boxAspect/sourceAspect;u+=(uw-n)*l.pivotX;uw=n;}else{const n=vh*sourceAspect/boxAspect;v+=(vh-n)*l.pivotY;vh=n;}}w*=l.scale*l.scaleX;h*=l.scale*l.scaleY;const radians=l.rotation*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians),points=[];for(const [qx,qy] of [[0,0],[1,0],[1,1],[0,1]]){const dx=(qx-l.pivotX)*w*aspect,dy=(qy-l.pivotY)*h;points.push(l.anchorX+l.x+(dx*cos-dy*sin)/aspect,l.anchorY+l.y+dx*sin+dy*cos);}return {points,uv:[l.flipX?u+uw:u,l.flipY?v+vh:v,l.flipX?u:u+uw,l.flipY?v:v+vh],color:[1,1,1,l.opacity]};}
 function newLayer(state,mediaLayout,id){
  return {id:id(),name:'画面 '+(state.objects.filter(o=>o.type==='画面').length+1),type:'画面',icon:'image',
   parent:'scene',components:['media'],visible:true,mediaLayout:{...mediaLayout}};
 }
 function keepLayout(clip,from,to){
  const previous=validateLayout(from?.mediaLayout||{}),inherited=validateLayout(to?.mediaLayout||{});
  const overrides={...clip.mediaLayout};
  for(const key of Object.keys(previous))if(previous[key]!==inherited[key]&&!(key in overrides))overrides[key]=previous[key];
  if(Object.keys(overrides).length)clip.mediaLayout=overrides;
 }
 function newTrack(layer,id){return {id:id(),name:layer.name,type:'media',target:layer.id,clips:[]};}
 function linkedSoundTrack(tracks,media,clip,id,enabled=true){
  const available=tracks.find(t=>t.type==='audio'&&t.target===media.target&&!t.locked&&(t.enabled!==false)===enabled
   &&t.clips.every(c=>c.mediaLink&&(c.start+c.len<=clip.start+1e-6||clip.start+clip.len<=c.start+1e-6)));
  return available||{id:id(),name:media.name+' · 视频声音',type:'audio',target:media.target,clips:[],...(!enabled?{enabled:false}:{})};
 }
 function editedOffset(c,shift,info){const value=(c.sourceOffset||0)+shift*(c.mediaRate||1);return (c.loop||c.audioLoop)&&info?.duration?((value%info.duration)+info.duration)%info.duration:Math.max(0,Math.min(3600,value));}
 function validateInfo(info){if(!info||!['image','video'].includes(info.kind)||!['width','height'].every(k=>Number.isInteger(info[k])&&info[k]>0&&info[k]<=4096)||info.kind==='video'&&(!Number.isFinite(info.duration)||info.duration<=0||info.duration>3600||!Number.isFinite(info.fps)||info.fps<=0||info.fps>60||typeof info.hasAudio!=='boolean'))throw Error('画面素材信息无效');return info;}
 function sourceTime(c,time,info){let t=(time-c.start)*(c.mediaRate||1)+(c.sourceOffset||0);if(c.loop&&info.duration>0)t=((t%info.duration)+info.duration)%info.duration;return Math.max(0,Math.min(t,Math.max(0,info.duration-1/(info.fps||30))));}
 function slice(keys,start,length){const result={};for(const [k,a] of Object.entries(keys||{})){if(!a.length)continue;result[k]=[{time:0,value:sample(a,start)},...a.filter(v=>v.time>start+1e-7&&v.time<start+length-1e-7).map(v=>({...v,time:v.time-start})),{time:length,value:sample(a,start+length)}];}return result;}
 function preset(name){const l={...defaults};if(['left','center','right'].includes(name))l.anchorX={left:.22,center:.5,right:.78}[name];if(name==='full')Object.assign(l,{anchorX:.5,anchorY:.5,pivotX:.5,pivotY:.5,width:1,height:1,fit:'cover'});if(name==='corner')Object.assign(l,{anchorX:1,anchorY:1,pivotX:1,pivotY:1,x:-.025,y:-.025,width:.3,height:.3});return l;}
 return {defaults,ranges,animated,newLayer,newTrack,keepLayout,linkedSoundTrack,isVisual,validateLayout,validateClip,sample,layout,quad,sourceTime,editedOffset,validateInfo,slice,preset};
});
