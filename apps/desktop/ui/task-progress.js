(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CreatorTaskProgress=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const phases=['扫描游戏清单','解包角色、动作、场景和音频','准备 Player 资源','准备 2D 场景和对白界面','准备面部动画与特效','解码音频库','解码 Unity 音频','检查解包结果'];
  const voicePhases={download:'下载文件',verify:'校验文件',unpack:'解压引擎',install:'安装文件'};
  function model(job={},kind='assets'){
    const state=job.state||'idle',active=['running','cancelling'].includes(state);
    const terminal={complete:'已完成',partial:'已结束，部分资源未完成',cancelled:'已取消',error:'失败，可重试',cancelling:'正在取消，请稍候'};
    let title=terminal[state]||job.phase||'等待开始',value=state==='complete'?1:0,detail='';
    if(active&&state!=='cancelling'){
      if(kind==='voice'){
        title=voicePhases[job.phase]||'准备语音引擎与声库';
        const known=job.phase==='download'&&Number.isFinite(job.total)&&job.total>0&&Number.isFinite(job.received);
        value=known?Math.max(0,Math.min(.99,job.received/job.total)):null;
        detail=[job.itemIndex&&job.itemTotal?`文件 ${job.itemIndex} / ${job.itemTotal}`:'',known?`${Math.round(value*100)}% · ${(job.received/1048576).toFixed(1)} / ${(job.total/1048576).toFixed(1)} MiB`:'正在处理，暂无法计算百分比'].filter(Boolean).join(' · ');
      }else{
        const index=phases.indexOf(job.phase);value=index<0?null:index/phases.length;
        detail=index<0?'正在处理，暂无法计算进度':`阶段 ${index+1} / ${phases.length} · 进度按阶段估算，不代表剩余时间`;
      }
    }else if(state==='cancelling'){value=null;}
    if(!active&&state!=='complete'&&job.phase)detail='结束时阶段：'+(voicePhases[job.phase]||job.phase);
    return {state,title,value,detail,message:job.message||''};
  }
  function html(id,label){return `<div class="task-progress" id="${id}"><p data-progress-title>${label}</p><progress max="1" value="0" aria-label="${label}"></progress><small data-progress-detail></small><p data-progress-message></p></div>`;}
  function render(el,job,kind){if(!el)return;const m=model(job,kind);el.dataset.state=m.state;el.querySelector('[data-progress-title]').textContent=m.title;const bar=el.querySelector('progress');if(m.value===null)bar.removeAttribute('value');else bar.value=m.value;bar.setAttribute('aria-valuetext',[m.title,m.detail].filter(Boolean).join(' · '));el.querySelector('[data-progress-detail]').textContent=m.detail;el.querySelector('[data-progress-message]').textContent=m.message;}
  return {html,model,render};
});
