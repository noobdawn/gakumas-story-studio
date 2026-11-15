(() => {
  const html = `<section data-settings-page="assets" id="asset-settings-page">
    <div class="section-title">资产</div>
    <section class="asset-settings-block" aria-labelledby="asset-directory-heading">
      <h3 id="asset-directory-heading">目录设置</h3>
      <div class="asset-directory-row"><div><label>游戏安装目录</label><div class="asset-settings-path" id="asset-game-path">正在读取…</div></div><button id="asset-game-choose">切换目录</button></div>
      <p class="hint" id="asset-game-state"></p>
      <div class="asset-directory-row"><div><label>缓存目录</label><div class="asset-settings-path" id="asset-cache-path">正在读取…</div></div><button id="asset-cache-choose">切换目录</button></div>
      <p class="hint asset-managed-hint">解包文件存放于 <span id="asset-cache-managed"></span></p>
    </section>
    <section class="asset-settings-block" aria-labelledby="asset-size-heading">
      <div class="asset-block-heading"><h3 id="asset-size-heading">资产大小</h3><button id="asset-cache-refresh">刷新</button></div>
      <div class="asset-size-total"><strong id="asset-cache-total">—</strong><span>当前缓存合计</span></div>
      <div id="asset-size-bar" class="asset-size-bar" aria-label="各类资源占比"></div>
      <div id="asset-cache-sizes" class="asset-size-legend">正在统计…</div>
      <p class="hint">按文件大小统计，包含旧批次与未完成批次，不含工程素材。</p>
      <p class="hint">最近成功更新：<span id="asset-cache-updated">—</span></p><p class="hint" id="asset-cache-skipped" hidden></p>
    </section>
    <section class="asset-settings-block" aria-labelledby="asset-operation-heading">
      <h3 id="asset-operation-heading">操作</h3>
      <p class="hint">清理与解包只处理缓存，保留工程、导入音频、生成配音和用户设置。</p>
      <div class="asset-operation-actions"><button id="asset-cache-clear">清除缓存</button><button id="asset-cache-start" class="asset-primary-action">重新解包</button></div>
      ${window.CreatorTaskProgress.html("asset-progress","游戏资源解包进度")}
      <div class="asset-operation-status"><p id="asset-settings-status" role="status"></p><p class="hint" id="asset-visual-status"></p><p class="hint" id="asset-cleanup-status" hidden></p></div>
      <details id="asset-result-details" hidden><summary>解包结果与缺失明细</summary><p class="hint" id="asset-partial-status"></p><pre></pre></details>
      <p class="error" id="asset-settings-error" role="alert" hidden></p>
    </section>
  </section>`;
  function bind({api,refreshCatalog,wizard=false}) {
    const page=document.querySelector('#asset-settings-page');if(!page)return;
    const $=selector=>page.querySelector(selector),status=$('#asset-settings-status'),error=$('#asset-settings-error');
    const game=$('#asset-game-choose'),cache=$('#asset-cache-choose'),clear=$('#asset-cache-clear'),start=$('#asset-cache-start'),refresh=$('#asset-cache-refresh'),details=$('#asset-result-details');
    const buttons=[game,cache,clear,start,refresh];
    if(wizard){page.classList.add('asset-wizard');const extra=document.createElement('details'),summary=document.createElement('summary');summary.textContent='目录与缓存详情';extra.append(summary,...[...page.querySelectorAll(':scope>.asset-settings-block')].slice(0,2));page.append(extra);}

    if(!api?.settingsInfo){status.textContent='当前会话不支持资产设置';buttons.forEach(b=>b.disabled=true);return;}
    const colors=['#79b6d8','#86c6b0','#c4a2d8','#d9b879','#dc929b','#8f9cab'];
    const sizes=n=>{n=Math.max(0,Number(n)||0);if(!n)return '0 B';const i=Math.min(3,Math.floor(Math.log(n)/Math.log(1024)));return (n/1024**i).toFixed(i?2:0)+' '+['B','KiB','MiB','GiB'][i];};
    const date=v=>v&&!Number.isNaN(Date.parse(v))?new Date(v).toLocaleString('zh-CN',{hour12:false}):'尚无成功更新';
    const percent=v=>v>0&&v<0.1?'< 0.1%':v.toFixed(1)+'%';
    let waiting=false,scanning=false,polling=false,timer=null,lastState='',lastInfo=null,notice='',reviewedRun=null;
    function controls(){const running=lastInfo?.job?.state==='running';game.disabled=cache.disabled=clear.disabled=waiting||scanning||running;start.disabled=waiting||scanning;start.textContent=running?'停止解包':wizard&&!lastInfo?.visualNext?'开始解包':'重新解包';refresh.disabled=waiting||scanning||running;}
    function failure(message){error.textContent=message||'';error.hidden=!message;}
    async function stats(){
      if(!page.isConnected||scanning)return;scanning=true;controls();
      try{const r=await api.settingsStats();if(!page.isConnected)return;
        const rows=$('#asset-cache-sizes'),bar=$('#asset-size-bar');rows.replaceChildren();bar.replaceChildren();
        const total=Math.max(0,Number(r.totalBytes)||0),categories=(r.categories||[]).slice().sort((a,b)=>b.bytes-a.bytes);
        categories.forEach((row,i)=>{
          const ratio=total?Math.max(0,Number(row.bytes)||0)/total*100:0,color=colors[i%colors.length];
          const segment=document.createElement('span');segment.style.width=ratio+'%';segment.style.background=color;segment.title=`${row.category} · ${sizes(row.bytes)} · ${percent(ratio)}`;bar.append(segment);
          const item=document.createElement('div');item.className='asset-size-item';const dot=document.createElement('i'),name=document.createElement('span'),value=document.createElement('strong'),share=document.createElement('small');
          dot.style.background=color;name.textContent=row.category;value.textContent=sizes(row.bytes);share.textContent=percent(ratio);item.append(dot,name,value,share);rows.append(item);
        });
        if(!categories.length)rows.textContent='暂无解包缓存';bar.setAttribute('aria-label',categories.map(row=>`${row.category} ${percent(total?row.bytes/total*100:0)}`).join('，')||'暂无解包缓存');
        $('#asset-cache-total').textContent=sizes(total);$('#asset-cache-updated').textContent=date(r.lastUpdated);
        $('#asset-cache-skipped').textContent=r.skipped?`${r.skipped} 项未识别内容未计入，也不会清理。`:'';$('#asset-cache-skipped').hidden=!r.skipped;
      }catch(e){if(page.isConnected)failure('统计失败：'+e.message);}finally{scanning=false;if(page.isConnected)controls();}
    }
    function render(info){
      lastInfo=info;window.CreatorTaskProgress.render($('#asset-progress'),info.job,'assets');page.dispatchEvent(new CustomEvent('asset-job-change',{bubbles:true,detail:{running:info.job?.state==='running'}}));$('#asset-game-path').textContent=info.game?.path||'尚未选择';$('#asset-game-state').textContent=info.game?.state==='valid'?'目录已验证 · 游戏文件只读':info.game?.message||'请先选择游戏安装目录';
      $('#asset-cache-path').textContent=info.root||'尚未选择';$('#asset-cache-managed').textContent=info.managedPath||'';$('#asset-cache-updated').textContent=date(info.lastUpdated);
      const running=info.job?.state==='running';status.textContent=[running?null:notice,info.warning].filter(Boolean).join(' · ')||'可以重新解包，准备本地游戏资源。';status.classList.toggle('is-running',running);
      $('#asset-visual-status').textContent=info.visualNext?(info.visualUpdatePending||!info.visualActive?'新 Player 资源已准备，重启工作台后生效。':'Player 缓存已就绪。'):(info.visualActive?'当前 Player 继续使用已加载的资源；重新解包后重启工作台生效。':'尚无可用 Player 缓存，请重新解包。');
      $('#asset-cleanup-status').hidden=!info.pendingCleanup;$('#asset-cleanup-status').textContent=info.pendingCleanup?`${info.pendingCleanup} 个使用中的旧批次将在工作台正常退出后清理。清理前仍占用磁盘空间。`:'';
      details.hidden=!(info.issueItems?.length||info.partialAudioPending);$('#asset-partial-status').textContent=info.partialAudioPending?'本批次有成功解码的音频待确认；展开此项可选择是否使用。':'';
      // Older reports used one error for missing, unreadable and mismatched files.
      // Do not relabel those historical entries as proven corruption or absence.
      const describeIssue=x=>x.error==='ValueError: no local candidate matches manifest MD5'?'本地未找到符合当前清单的可用文件（可能未下载、无法读取或版本不匹配）':x.error;
      details.querySelector('pre').textContent=(info.issueItems||[]).map(x=>x.source+(x.index?' #'+x.index:'')+'：'+describeIssue(x)).join('\n');controls();
    }
    async function update(){
      clearTimeout(timer);if(!page.isConnected||polling)return;polling=true;let review=false;
      try{const info=await api.settingsInfo();if(!page.isConnected)return;render(info);
        if(lastState==='running'&&info.job?.state!=='running'){await stats();await refreshCatalog();}
        lastState=info.job?.state||'';review=!page.hidden&&info.partialAudioPending&&info.partialAudioRun!==reviewedRun&&!waiting&&!scanning&&info.job?.state!=='running';
      }catch(e){if(page.isConnected)failure('读取资产设置失败：'+e.message);}finally{polling=false;if(page.isConnected)timer=setTimeout(update,1000);}
      if(review&&api.settingsReview){reviewedRun=lastInfo.partialAudioRun;void action(()=>api.settingsReview());}
    }
    async function action(fn,afterStats=false){
      if(waiting||scanning)return;waiting=true;controls();failure('');
      try{const result=await fn();await refreshCatalog();if(!page.isConnected)return;if(result&&!result.cancelled){notice=result.message||'';if(result.skipped)notice+=` ${result.skipped} 项未识别内容已保留。`;if(afterStats)await stats();}}
      catch(e){if(page.isConnected)failure(e.message);}finally{waiting=false;if(page.isConnected){controls();void update();}}
    }
    game.onclick=()=>action(()=>api.settingsGame(),true);cache.onclick=()=>action(()=>api.settingsCache(),true);clear.onclick=()=>action(()=>api.settingsClear(),true);
    start.onclick=()=>action(()=>lastInfo?.job?.state==='running'?api.settingsCancel():api.settingsStart());refresh.onclick=()=>{failure('');void stats();};
    details.ontoggle=()=>{if(details.open&&lastInfo?.partialAudioPending&&api.settingsReview){reviewedRun=lastInfo.partialAudioRun;void action(()=>api.settingsReview({force:true}));}};
    void stats();void update();
  }
  window.creatorAssetSettings={html,bind};
})();
