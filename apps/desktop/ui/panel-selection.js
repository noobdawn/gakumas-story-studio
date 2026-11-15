(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CreatorPanelSelection=factory();})(globalThis,function(){
  function create(){return {ids:[],anchor:null,lead:null};}
  function reset(s,key=null){s.ids=key?[key]:[];s.anchor=key;s.lead=key;return s;}
  function retain(s,order){const allowed=new Set(order);s.ids=s.ids.filter(key=>allowed.has(key));if(!allowed.has(s.anchor))s.anchor=null;if(!s.ids.includes(s.lead))s.lead=s.ids.at(-1)||null;return s;}
  function click(s,key,order,event={}){
    retain(s,order);if(!order.includes(key))return s;
    const additive=event.ctrlKey||event.metaKey;
    if(event.shiftKey&&s.anchor&&order.includes(s.anchor)){
      const a=order.indexOf(s.anchor),b=order.indexOf(key),range=order.slice(Math.min(a,b),Math.max(a,b)+1);
      s.ids=[...new Set([...(additive?s.ids:[]),...range])];s.lead=key;
    }else if(additive){s.ids=s.ids.includes(key)?s.ids.filter(x=>x!==key):[...s.ids,key];s.anchor=key;s.lead=s.ids.includes(key)?key:s.ids.at(-1)||null;}
    else reset(s,key);
    return s;
  }
  function context(s,key,order){retain(s,order);if(!s.ids.includes(key))reset(s,key);return s;}
  return {create,reset,retain,click,context};
});
