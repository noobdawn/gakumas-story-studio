 'use strict';
const $=s=>document.querySelector(s);let step=0,busy=false;
function show(){document.querySelectorAll('[data-step]').forEach(e=>e.hidden=Number(e.dataset.step)!==step);document.querySelectorAll('#steps span').forEach((e,i)=>e.classList.toggle('active',i===step));$('#previous').disabled=step===0;$('#next').hidden=step===3;}
async function act(fn){$('#setup-error').textContent='';try{await fn();}catch(e){$('#setup-error').textContent=e.message;}}
$('#setup-assets').innerHTML=window.creatorAssetSettings.html;
window.creatorAssetSettings.bind({api:window.assetAPI,refreshCatalog:async()=>{}});
window.assetAPI.setupStatus().then(message=>$('#setup-reason').textContent=message);
$('#choose-data').onclick=()=>act(()=>window.setupAPI.data());
$('#choose-game').onclick=()=>act(async()=>{await window.assetAPI.settingsGame();await refresh();});
$('#previous').onclick=()=>{step=Math.max(0,step-1);show();};
$('#next').onclick=()=>act(async()=>{if(busy)throw Error('请等待下载结束或取消');if(step===0){const info=await window.assetAPI.settingsInfo();if(info.game?.state!=='valid')throw Error('请先选择有效的游戏目录');}step=Math.min(3,step+1);show();});
$('#engine').onchange=()=>{$('#voicevox-options').hidden=$('#engine').value!=='voicevox';$('#sovits-hint').hidden=$('#engine').value!=='sovits';};
$('#download-voices').onclick=()=>act(()=>window.setupAPI.download([...document.querySelectorAll('#model-options input:checked')].map(x=>x.value),$('#voice-accepted').checked));
$('#cancel-voices').onclick=()=>act(()=>window.setupAPI.cancel());
$('#setup-restart').onclick=()=>act(async()=>{const info=await window.assetAPI.settingsInfo();if(!info.visualNext)throw Error('请先完成游戏资源准备');await window.setupAPI.finish($('#engine').value);await window.assetAPI.setupRestart();});
async function refresh(){const [info,assets]=await Promise.all([window.setupAPI.info(),window.assetAPI.settingsInfo()]);$('#data-path').textContent='数据目录：'+info.data;$('#game-path').textContent='游戏目录：'+(assets.game?.path||'尚未选择');busy=['running','cancelling'].includes(info.status.state);$('#download-voices').disabled=busy;$('#cancel-voices').disabled=!busy;$('#download-status').textContent=info.status.message+(info.status.total?' · '+Math.round(100*info.status.received/info.status.total)+'%':'');return info;}
act(async()=>{const info=await refresh();$('#engine').value=info.settings.engine||'none';$('#engine').onchange();$('#voice-terms').textContent='声库与使用条款：'+info.terms;for(const model of info.models){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.value=model.id;label.append(box,document.createTextNode(' '+model.name+' · '+Math.round(model.bytes/1024/1024)+' MB'));$('#model-options').append(label);}show();});
const timer=setInterval(()=>refresh().catch(e=>$('#setup-error').textContent=e.message),1200);window.addEventListener('pagehide',()=>clearInterval(timer));
