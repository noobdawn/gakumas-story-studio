(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.CreatorUITransitionGraph=api;})(globalThis,()=>{
 'use strict';
 const identity=()=>[1,0,0,1,0,0];
 const mul=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
 const point=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
 function ease(t,mode){t=Math.max(0,Math.min(1,t));switch(mode){case 'Linear':return t;case 'OutCubic':return 1-(1-t)**3;case 'InCubic':return t**3;case 'InOutCubic':return t<.5?4*t**3:1-(-2*t+2)**3/2;case 'OutQuint':return 1-(1-t)**5;default:throw Error('不支持的转场缓动：'+mode);}}
 function parameter(p,base){return base.map((x,i)=>(p.ignore&(1<<i))?x:(p.relative?x:0)+(p.value[i]??0));}
 function trackValue(track,base,time){
  const initial=track.initialEnabled?parameter(track.initial,base):base;let value=initial,cycles=0;
  if(track.loop&&track.loopEnd>track.loopStart&&time>=track.loopEnd){const len=track.loopEnd-track.loopStart;cycles=Math.floor((time-track.loopStart)/len);time=track.loopStart+(time-track.loopStart)%len;if(track.loopType===1&&cycles%2)time=track.loopEnd-(time-track.loopStart);}
  for(const c of track.clips){if(time<c.start)break;const end=parameter(c.end,value),p=ease((time-c.start)/c.duration,c.ease);value=value.map((v,i)=>v+(end[i]-v)*p);if(time<c.start+c.duration)break;}
  if(cycles&&track.loopType===2){let end=initial;for(const c of track.clips)end=parameter(c.end,end);value=value.map((v,i)=>v+cycles*(end[i]-initial[i]));}
  return value;
 }
 function evaluate(asset,clock,aspect){
  const W=1080*Math.max(1,aspect),H=1080*Math.max(1,1/aspect),outStart=asset.inDuration+asset.hold;
  const nodes=asset.nodes.map(n=>({...n,position:[...n.position],size:[...n.size],scale:[...n.scale],color:[...n.color],rotation:[0,0,n.rotation],alpha:[n.alpha]}));
  for(const phase of ['constant','in','idle','nested','out']){
   if(phase==='out'&&clock<outStart)continue;
   for(const track of asset.tracks){if(track.phase!==phase)continue;const time=phase==='out'?clock-outStart:phase==='nested'?clock-track.nestStart:Math.min(clock,phase==='in'?asset.inDuration:clock),n=nodes[track.node],prop=track.property==='anchor'?'position':track.property;n[prop]=trackValue(track,n[prop],time);}
  }
  for(let i=0;i<nodes.length;i++){
   const n=nodes[i],parent=nodes[n.parent];let x,y,w,h;
   if(asset.nodes[i].size[0]>=2000&&n.anchorMin[0]===n.anchorMax[0]&&asset.nodes[i].size[1]===0){const factor=W/asset.referenceWidth;n.size[0]*=factor;n.position[0]*=factor;}
   if(!parent){w=W;h=H;x=W/2+n.position[0];y=H/2+n.position[1];}
   else if(n.rect){w=parent.width*(n.anchorMax[0]-n.anchorMin[0])+n.size[0];h=parent.height*(n.anchorMax[1]-n.anchorMin[1])+n.size[1];x=parent.width*(n.anchorMin[0]+(n.anchorMax[0]-n.anchorMin[0])*n.pivot[0]-parent.pivot[0])+n.position[0];y=parent.height*(n.anchorMin[1]+(n.anchorMax[1]-n.anchorMin[1])*n.pivot[1]-parent.pivot[1])+n.position[1];}
   else{w=0;h=0;x=n.position[0];y=n.position[1];}
   if(n.name==='MaskImage'){const factor=Math.max(1,Math.hypot(W,H)*1.02/2950);w*=factor;h*=factor;}
   n.width=Math.max(0,w);n.height=Math.max(0,h);const a=n.rotation[2]*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
   n.matrix=mul(parent?.matrix||identity(),[c*n.scale[0],s*n.scale[0],-s*n.scale[1],c*n.scale[1],x,y]);n.opacity=(parent?.opacity??1)*n.alpha[0];n.shown=n.active&&(parent?.shown??true);
  }
  function mask(target){const n=nodes[target],m=n.matrix,det=m[0]*m[3]-m[1]*m[2],w=n.width,h=n.height;
   if(w<.01||h<.01||Math.abs(det)<1e-8)return {texture:n.texture||'',map:[0,0,-1,0,0,-1]};
   const a=m[3]/det,b=-m[1]/det,c=-m[2]/det,d=m[0]/det,tx=-(a*m[4]+c*m[5]),ty=-(b*m[4]+d*m[5]);return {texture:n.texture||'',map:[a*W/w,c*H/w,tx/w+n.pivot[0],b*W/h,d*H/h,ty/h+n.pivot[1]]};
  }
  const draws=[];
  for(const n of nodes){const opacity=n.opacity*n.color[3];if(!n.draw||!n.shown||opacity<=0||n.width<=0||n.height<=0||Math.abs(n.matrix[0]*n.matrix[3]-n.matrix[1]*n.matrix[2])<1e-8)continue;
   const masks=n.mask?n.mask.targets.map(mask):[],color=[...n.color.slice(0,3),Math.min(1,opacity)];
   const quad=(left,bottom,right,top,uv)=>{if(right<=left||top<=bottom)return;const points=[[left,bottom],[right,bottom],[right,top],[left,top]].flatMap(([x,y])=>{const p=point(n.matrix,x-n.width*n.pivot[0],y-n.height*n.pivot[1]);return [p[0]/W,p[1]/H]});draws.push({points,uv,color,texture:n.texture||'',masks,invert:n.mask?.invert||false});};
   if(n.imageType===1&&n.border.some(v=>v>0)){
    let [l,b,r,t]=n.border;const [tw,th]=n.textureSize;if(l+r>n.width){const f=n.width/(l+r);l*=f;r*=f;}if(b+t>n.height){const f=n.height/(b+t);b*=f;t*=f;}
    const xs=[0,l,n.width-r,n.width],ys=[0,b,n.height-t,n.height],us=[0,n.border[0]/tw,1-n.border[2]/tw,1],vs=[0,n.border[1]/th,1-n.border[3]/th,1];
    for(let y=0;y<3;y++)for(let x=0;x<3;x++)quad(xs[x],ys[y],xs[x+1],ys[y+1],[us[x],vs[y],us[x+1],vs[y+1]]);
   }else quad(0,0,n.width,n.height,[0,0,1,1]);
  }
  return draws;
 }
 return {evaluate,ease};
});
