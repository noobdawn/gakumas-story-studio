(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.CreatorGaze=api;
})(globalThis,function(){
  'use strict';
  const targets={camera:'相机',point:'场景点'};
  const styles={wander:'低头游移',direction:'定向移开',sky:'抬眼望天'};
  const presets={eyes:[100,0,0],natural:[100,60,0],upper:[100,75,25]};
  const directions={down:[0,-1],downLeft:[-1,-1],downRight:[1,-1],left:[-1,0],right:[1,0],upLeft:[-1,1],up:[0,1],upRight:[1,1]};
  const limits={eyes:[0,100],head:[0,100],body:[0,100],horizontal:[0,80],vertical:[0,55],holdMin:[.05,8],holdMax:[.05,8],move:[.03,3],delay:[0,2]};
  function create(kind,point,seed){
    return {kind,target:'camera',point:point.slice(),style:'wander',direction:'down',eyes:100,head:kind==='look'?60:20,body:0,
      horizontal:12,vertical:15,holdMin:.35,holdMax:.70,move:.12,delay:.1,seed};
  }
  function valid(g){
    return !!g&&['look','away'].includes(g.kind)&&Object.hasOwn(targets,g.target)&&Object.hasOwn(styles,g.style)&&Object.hasOwn(directions,g.direction)
      &&(g.style!=='sky'||g.direction.startsWith('up'))&&Array.isArray(g.point)&&g.point.length===3&&g.point.every(x=>Number.isFinite(x)&&Math.abs(x)<=10000)
      &&Object.entries(limits).every(([k,[lo,hi]])=>Number.isFinite(g[k])&&g[k]>=lo&&g[k]<=hi)
      &&g.holdMin<=g.holdMax&&Number.isInteger(g.seed)&&g.seed>=0&&g.seed<=4294967295;
  }
  function name(g){return g.kind==='look'?'注视 · '+targets[g.target]:'移开目光 · '+styles[g.style];}
  function setStyle(g,style){
    Object.assign(g,{style,head:style==='sky'?65:style==='direction'?35:20,direction:style==='sky'?'upRight':'down',
      vertical:style==='sky'?30:15,horizontal:style==='sky'?18:12});
  }
  function smooth(x){x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);}
  // Each pair has a fixed duration. The seeded split varies dwell times while permitting direct seeks.
  function noise(seed,index){
    let n=(seed+Math.imul(index+1,0x9e3779b9))>>>0;
    n=Math.imul(n^(n>>>16),0x21f0aaad);n=Math.imul(n^(n>>>15),0x735a2d97);
    return ((n^(n>>>15))>>>0)/4294967296;
  }
  function angles(g,time){
    if(g.style!=='wander'){
      const [x,y]=directions[g.direction];return [x*g.horizontal,y*g.vertical];
    }
    const pair=g.holdMin+g.holdMax+2*g.move,index=Math.floor(time/pair),within=time-index*pair;
    const split=g.holdMin+(g.holdMax-g.holdMin)*noise(g.seed,index)+g.move;
    const step=2*index+Number(within>=split),elapsed=within>=split?within-split:within;
    function spot(i){
      if(i<=0)return [0,-g.vertical];
      const side=(i%2===0?-1:1)*(g.seed%2===0?1:-1);
      const amount=noise(g.seed,i+401);
      return [side*(amount<.15?.08:.45+.55*amount)*g.horizontal,-(.78+.22*noise(g.seed,i+113))*g.vertical];
    }
    const a=spot(step-1),b=spot(step),u=smooth(elapsed/g.move);
    return a.map((v,i)=>v+(b[i]-v)*u);
  }
  function layers(tracks,actorId,time,camera,sample,fade){
    const result=[];
    for(let i=tracks.length-1;i>=0;i--){
      const t=tracks[i];if(t.target!==actorId||t.type!=='animation'||t.enabled===false)continue;
      for(const c of t.clips){
        const g=c.gaze,local=time-c.start;if(!g||local<0||local>=c.len)continue;
        const fadeTotal=(c.fadeIn||0)+(c.fadeOut||0);
        const envelope=fadeTotal>c.len?{...c,fadeIn:(c.fadeIn||0)*c.len/fadeTotal,fadeOut:(c.fadeOut||0)*c.len/fadeTotal}:c;
        const w=(c.propertyKeys?.weight?.length?sample(c.propertyKeys.weight,local):c.weight??100)*fade(envelope,local)/100;
        if(w<=0)continue;
        const p={weight:w,eyes:g.eyes/100,head:g.head/100,body:g.body/100};
        if(g.kind==='look'){
          p.point=g.target==='point'?g.point:camera;if(!p.point)continue;
        }else{
          const source=local+(c.sourceOffset||0);
          [p.yaw,p.pitch]=angles(g,source);
          if(g.style==='sky'&&g.delay>0)p.head*=smooth((source-g.delay)/.18);
        }
        result.push(p);
      }
    }
    return result;
  }
  return {create,valid,name,targets,styles,presets,directions,limits,setStyle,angles,layers};
});
