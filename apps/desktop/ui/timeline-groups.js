(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CreatorTimelineGroups=api;})(globalThis,function(){
  'use strict';
  const types=['audio','dialogue','animation','expression'];
  const labels={audio:'音频',dialogue:'字幕',animation:'动画',expression:'表情 / 口型'};
  const otherLabels={visualEffect:'画面效果 · 上层优先',media:'画面（图片 / 视频）',camera:'相机',scene:'场景',transform:'位移 / 旋转 / 缩放',ui:'UI / 转场',post:'后处理',other:'其他'};
  const canonical=name=>String(name||'').normalize('NFKC').trim().replace(/\s+\d+$/u,'');
  const personKey=id=>'person:'+encodeURIComponent(id);
  function build(state,mode='type',aliases=()=>[]){
    const actors=state.objects.filter(o=>o.type==='角色'),actorMap=new Map(actors.map(o=>[o.id,o]));
    const dialogues=new Map((state.dialogues||[]).map(d=>[d.id,d]));
    const names=new Map(actors.map(o=>[o.id,new Set([o.name,...aliases(o)].map(canonical).filter(Boolean))]));
    const actorPerson=o=>({key:'actor:'+o.id,title:o.name,actorId:o.id});
    const shared={key:'shared',title:'公共 / 未指定人物'},mixed={key:'mixed',title:'多人物 / 混合'};
    function owner(track){
      const target=actorMap.get(track.target);
      if(['dialogue','audio'].includes(track.type)){
        const speakers=[...new Set(track.clips.map(c=>dialogues.get(c.dialogue)?.speaker?.trim()).filter(Boolean))];
        if(speakers.length>1)return mixed;
        if(speakers.length===1){
          const speaker=speakers[0],name=canonical(speaker);
          if(target&&names.get(target.id).has(name))return actorPerson(target);
          const matches=actors.filter(o=>names.get(o.id).has(name));
          if(matches.length===1)return actorPerson(matches[0]);
          return {key:'speaker:'+speaker,title:speaker};
        }
      }
      return target?actorPerson(target):shared;
    }
    const people=new Map(),others=new Map();
    for(const track of state.tracks){
      if(state.compositionVersion===1&&['world','media','dialogue','ui','visualFilter','visualEffect'].includes(track.type))continue;
      if(!types.includes(track.type)){
        const key=Object.hasOwn(otherLabels,track.type)?track.type:'other';
        if(!others.has(key))others.set(key,{key,title:otherLabels[key],tracks:[]});
        others.get(key).tracks.push(track);continue;
      }
      const person=owner(track);
      if(!people.has(person.key))people.set(person.key,{...person,byType:new Map()});
      const entries=people.get(person.key).byType;
      if(!entries.has(track.type))entries.set(track.type,[]);
      entries.get(track.type).push(track);
    }
    // Actors follow hierarchy order; custom speakers keep their first appearance order.
    const ordered=[...actors.map(o=>people.get('actor:'+o.id)).filter(Boolean),...people.values()].filter((p,i,a)=>a.findIndex(q=>q.key===p.key)===i);
    const leaf=(person,type)=>{
      const tracks=[...person.byType.get(type)].sort((a,b)=>Number(b.layerRole==='base')-Number(a.layerRole==='base'));
      return {key:mode+':'+personKey(person.key)+':'+type,title:mode==='person'?labels[type]:person.title,tracks,
        ...(person.actorId&&['animation','expression'].includes(type)?{layerAction:type+':'+person.actorId}:{})};
    };
    const grouped=mode==='person'?ordered.map(person=>{
      const children=types.filter(type=>person.byType.has(type)).map(type=>leaf(person,type));
      return {key:'person:'+personKey(person.key),title:person.title,children,tracks:children.flatMap(c=>c.tracks)};
    }):types.map(type=>{
      const children=ordered.filter(person=>person.byType.has(type)).map(person=>leaf(person,type));
      return {key:'type:'+type,title:labels[type],children,tracks:children.flatMap(c=>c.tracks)};
    }).filter(group=>group.tracks.length);
    return [...(state.compositionVersion===1?[{key:'composition',title:'画面合成 · 上层在前',tracks:state.tracks.filter(t=>['world','media','dialogue','ui','visualFilter','visualEffect'].includes(t.type))}]:[]),...['visualEffect','media','camera','scene'].map(key=>others.get(key)).filter(Boolean),...grouped,
      ...['transform','ui','post','other'].map(key=>others.get(key)).filter(Boolean)];
  }
  function flatten(groups,collapsed,known){
    const rows=[];
    function visit(group,depth){
      if(!collapsed.has(group.key))collapsed.set(group.key,group.key!=='composition'&&!group.children&&group.tracks.length>3);
      if(known&&group.tracks.some(t=>!known.has(t.id)))collapsed.set(group.key,false);
      // Visit hidden children too, so auto-reveal and each mode's fold state remain stable.
      const hidden=collapsed.get(group.key),start=rows.length;
      rows.push({...group,group:true,depth,collapsed:hidden});
      if(group.children)for(const child of group.children)visit(child,depth+1);
      else for(const track of group.tracks)rows.push({group:false,track,depth:depth+1});
      if(hidden)rows.splice(start+1);
    }
    for(const group of groups)visit(group,0);
    return rows;
  }
  function reveal(groups,trackId,collapsed){
    for(const group of groups)if(group.tracks.some(t=>t.id===trackId)){
      collapsed.set(group.key,false);
      if(group.children)reveal(group.children,trackId,collapsed);
    }
  }
  function peers(groups,trackId){
    for(const group of groups)if(group.tracks.some(t=>t.id===trackId))return group.children?peers(group.children,trackId):group.tracks;
    return [];
  }
  return {types,labels,build,flatten,reveal,peers};
});
