(function(root){root.CreatorSettingsFileLinks={
 async mount({api,connection,pronunciation,reloadPrompt,reloadRules}){
  if(!api)return;const paths=await api.files();
  for(const [kind,parent,reload,label,hint] of [['prompt',connection,reloadPrompt,'提示词文件','UTF-8 纯文本，可直接编写多行提示词。'],['rules',pronunciation,reloadRules,'替换词文件','JSON：在 rules 数组中编辑 from（原词）和 to（读音），保留双引号与逗号。']]){
   if(!parent.isConnected)continue;const box=document.createElement('div');box.className='config-file-guide';
   const title=document.createElement('strong');title.textContent=label;box.append(title);
   const file=document.createElement('a');file.href='#';file.className='config-file-path';file.textContent=paths[kind];file.title='使用系统默认编辑器打开';box.append(file);
   const actions=document.createElement('div');actions.className='config-file-actions';box.append(actions);
   const reveal=document.createElement('a');reveal.href='#';reveal.textContent='在文件夹中显示';actions.append(reveal);
   const refresh=document.createElement('a');refresh.href='#';refresh.textContent='从文件重载（覆盖当前草稿）';actions.append(refresh);
   const help=document.createElement('p');help.className='hint';help.textContent=hint+' 保存文件后，下次翻译或生成配音自动读取；无需重启。';box.append(help);
   const error=document.createElement('p');error.className='error';error.setAttribute('role','status');box.append(error);
   const run=action=>async e=>{e.preventDefault();error.textContent='';try{await action();}catch(e){if(error.isConnected)error.textContent=e.message;}};
   file.onclick=run(()=>api.open(kind));reveal.onclick=run(()=>api.open(kind,true));refresh.onclick=run(reload);
   parent.querySelector('.section-title').after(box);
  }
 }
};})(globalThis);
