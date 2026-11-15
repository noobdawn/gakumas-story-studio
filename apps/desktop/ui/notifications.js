globalThis.CreatorNotifications=function({toast,button}){
 const records=[];let serial=0,timer;
 function dismiss(){clearTimeout(timer);toast.classList.add('hidden');}
 function show(message,options={}){
  let record=options.replace&&options.group?records.findLast(r=>r.group===options.group):null;
  if(!record){record={id:++serial};records.push(record);if(records.length>50)records.shift();}
  Object.assign(record,{message:String(message),detail:String(options.detail||''),kind:options.kind||'info',group:options.group||'',time:new Date().toLocaleTimeString()});
  clearTimeout(timer);toast.replaceChildren();toast.dataset.kind=record.kind;toast.setAttribute('role',record.kind==='error'?'alert':'status');toast.setAttribute('aria-live',record.kind==='error'?'assertive':'polite');
  const header=document.createElement('div');header.className='toast-heading';const title=document.createElement('strong');title.textContent=record.message;header.append(title);
  const close=document.createElement('button');close.type='button';close.className='toast-close';close.textContent='×';close.setAttribute('aria-label','关闭提示');close.onclick=dismiss;header.append(close);toast.append(header);
  if(record.detail){const detail=document.createElement('div');detail.className='toast-detail';detail.textContent=record.detail;toast.append(detail);}
  const footer=document.createElement('div');footer.className='toast-meta';footer.textContent=record.time+' · 消息 '+record.id+' · 可从底栏“消息”查看记录';toast.append(footer);
  button.textContent='消息 ('+records.length+')';toast.classList.remove('hidden','toast-replay');void toast.offsetWidth;toast.classList.add('toast-replay');
  if(!options.sticky)timer=setTimeout(dismiss,options.duration??5000);
 }
 return {show,dismiss,history:()=>records.map(r=>({...r}))};
};
