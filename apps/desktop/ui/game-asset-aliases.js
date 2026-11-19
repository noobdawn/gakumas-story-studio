(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.CreatorGameAliases=factory();
})(globalThis,function(){
  'use strict';
  const audioId=id=>'asset-audio-catalog-'+id.replace(':','-');
  function lookup(rows,asset){
    const origin=asset.filmAudio;
    const id=origin?.catalogId?audioId(origin.catalogId):asset.id;
    const pair=Object.hasOwn(rows,id)?rows[id]:null;
    return pair && pair[0]===(origin?.name||asset.source)?pair[1]:undefined;
  }
  function catalog(assets,projectIds,rows,legacyName){
    const used=new Set(),pending=[];
    const key=(a,name)=>a.type+'\0'+name.trim().normalize('NFKC').toLowerCase();
    const result=assets.map((a,i)=>{
      // Old projects did not flag explicit blank aliases. A saved asset takes priority.
      const manual=a.gameAliasOverride||a.motionNameRevision===1||projectIds.has(a.id)&&(!a.filmAudio||a.alias);
      let alias=manual?undefined:lookup(rows,a);
      if(alias===undefined && !manual){
        const old=legacyName(a);
        if(old)alias=old;
      }
      if(alias===undefined){
        if(a.alias)used.add(key(a,a.alias));
        return a;
      }
      pending.push([i,alias]);
      return a;
    });
    for(const [i,initial] of pending){
      const a=result[i];let alias=initial;
      if(alias && used.has(key(a,alias))){
        let n=2;
        do {alias=initial.slice(0,88)+' · '+n++;} while(used.has(key(a,alias)));
      }
      if(alias)used.add(key(a,alias));
      if(a.alias!==alias)result[i]={...a,alias,priorAlias:a.alias||''};
    }
    return result;
  }
  return {audioId,lookup,catalog};
});
