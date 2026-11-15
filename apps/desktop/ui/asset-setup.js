 'use strict';
const $=s=>document.querySelector(s);let step=0,busy=false,assetsBusy=false;
function controls(){$("#previous").disabled=step===0||busy||assetsBusy;$("#next").disabled=busy||assetsBusy;$("#choose-data").disabled=busy||assetsBusy;$("#choose-game").disabled=busy||assetsBusy;$("#engine").disabled=busy;$("#setup-restart").disabled=busy||assetsBusy;}
function show(){document.querySelectorAll('[data-step]').forEach(e=>e.hidden=Number(e.dataset.step)!==step);document.querySelectorAll('#steps span').forEach((e,i)=>e.classList.toggle('active',i===step));$('#next').hidden=step===3;$('#setup-restart').hidden=step!==3;$('.setup-content').scrollTop=0;const heading=document.querySelector(`[data-step="${step}"] h2`);heading.tabIndex=-1;heading.focus({preventScroll:true});controls();}
async function act(fn){$('#setup-error').textContent='';try{await fn();}catch(e){$('#setup-error').textContent=e.message;}}
$('#setup-assets').innerHTML=window.creatorAssetSettings.html;
$('#setup-assets').addEventListener('asset-job-change',event=>{assetsBusy=event.detail.running;controls();});
window.creatorAssetSettings.bind({api:window.assetAPI,refreshCatalog:async()=>{},wizard:true});
$('#voice-progress-slot').innerHTML=window.CreatorTaskProgress.html('voice-progress','语音下载与安装进度');
window.assetAPI.setupStatus().then(message=>$('#setup-reason').textContent=message);
$('#choose-data').onclick=()=>act(()=>window.setupAPI.data());
$('#choose-game').onclick=()=>act(async()=>{await window.assetAPI.settingsGame();await refresh();});
$('#previous').onclick=()=>{step=Math.max(0,step-1);show();};
$('#next').onclick=()=>act(async()=>{if(busy||assetsBusy)throw Error('请等待当前任务结束或取消');if(step===0){const info=await window.assetAPI.settingsInfo();if(info.game?.state!=='valid')throw Error('请先选择有效的游戏目录');}step=Math.min(3,step+1);show();});
$('#engine').onchange=()=>{$('#voicevox-options').hidden=$('#engine').value!=='voicevox';$('#sovits-hint').hidden=$('#engine').value!=='sovits';};
$('#download-voices').onclick=()=>act(async()=>{busy=true;controls();$('#download-voices').disabled=true;try{await window.setupAPI.download([...document.querySelectorAll('#model-options input:checked')].map(x=>x.value),$('#voice-accepted').checked);}finally{await refresh();$('#voice-progress').scrollIntoView({block:'nearest'});}});
$('#cancel-voices').onclick=()=>act(async()=>{await window.setupAPI.cancel();await refresh();});
$('#setup-restart').onclick=()=>act(async()=>{const info=await window.assetAPI.settingsInfo();if(!info.visualNext)throw Error('请先完成游戏资源准备');await window.setupAPI.finish($('#engine').value);await window.assetAPI.setupRestart();});
async function refresh(){const [info,assets]=await Promise.all([window.setupAPI.info(),window.assetAPI.settingsInfo()]);$('#data-path').textContent='数据目录：'+info.data;$('#game-path').textContent='游戏目录：'+(assets.game?.path||'尚未选择');busy=['running','cancelling'].includes(info.status.state);$('#download-voices').disabled=busy;$('#cancel-voices').disabled=!busy;window.CreatorTaskProgress.render($('#voice-progress'),info.status,'voice');controls();return info;}
act(async()=>{const info=await refresh();$('#engine').value=info.settings.engine||'none';$('#engine').onchange();$('#voice-terms').textContent='声库与使用条款：'+info.terms;for(const model of info.models){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.value=model.id;label.append(box,document.createTextNode(' '+model.name+' · '+Math.round(model.bytes/1024/1024)+' MB'));$('#model-options').append(label);}show();});
const timer=setInterval(()=>refresh().catch(e=>$('#setup-error').textContent=e.message),1200);window.addEventListener('pagehide',()=>clearInterval(timer));
