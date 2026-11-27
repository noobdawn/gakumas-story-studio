(function(root){
  'use strict';
  const G=CreatorGaze;
  const directionLabels={down:'正下',downLeft:'左下',downRight:'右下',left:'正左',right:'正右',up:'正上',upLeft:'左上',upRight:'右上'};
  function fields(g,armed){
    const rows=[];
    function select(key,label,choices,value){
      rows.push('<label class="field">'+label+'<select data-gaze="'+key+'">'+Object.entries(choices).map(([id,text])=>'<option value="'+id+'" '+(id===value?'selected':'')+'>'+text+'</option>').join('')+'</select></label>');
    }
    function number(key,label,value,lo,hi,step){
      rows.push('<label class="field">'+label+'<input class="input" data-gaze="'+key+'" type="number" min="'+lo+'" max="'+hi+'" step="'+step+'" value="'+value+'"></label>');
    }
    const numeric=(key,label,step=1)=>number(key,label,g[key],...G.limits[key],step);
    if(g.kind==='look'){
      select('target','注视目标',G.targets,g.target);
      if(g.target==='point'){
        rows.push('<button id="gaze-pick" class="add-component">'+(armed?'取消拾取':'在预览中拾取场景点')+'</button><p class="hint">点击场景表面设定落点，拖动三轴箭头可微调。</p>');
        for(let i=0;i<3;i++)number('point'+i,'世界坐标 '+'XYZ'[i],g.point[i],-10000,10000,.01);
      }
      const preset=Object.keys(G.presets).find(k=>G.presets[k].every((v,i)=>v===[g.eyes,g.head,g.body][i]));
      select('preset','表现方式',{eyes:'只动眼睛',natural:'自然转头',upper:'上身跟随',...(!preset?{custom:'自定义'}:{})},preset||'custom');
    }else{
      select('style','表现类型',G.styles,g.style);
      if(g.style!=='wander')select('direction','角色朝向',Object.fromEntries(Object.entries(directionLabels).filter(([k])=>g.style!=='sky'||k.startsWith('up'))),g.direction);
      numeric('horizontal','水平幅度（度）');numeric('vertical','垂直幅度（度）');
      if(g.style==='wander'){
        numeric('holdMin','最短停留（秒）',.01);numeric('holdMax','最长停留（秒）',.01);numeric('move','移动时间（秒）',.01);
        rows.push('<button id="gaze-roll" class="add-component">换一组落点</button>');
      }
      if(g.style==='sky')numeric('delay','抬头延迟（秒）',.01);
    }
    rows.push('<details><summary>眼睛、头颈和上身参与度</summary>');
    numeric('eyes','眼睛（%）');numeric('head','头颈（%）');numeric('body','上身（%）');
    rows.push('</details>');
    return rows.join('');
  }
  const seed=()=>crypto.getRandomValues(new Uint32Array(1))[0];
  function bind(track,clip,e){
    const g=clip.gaze;
    document.querySelectorAll('[data-gaze]').forEach(input=>input.onchange=()=>{
      if(track.locked)return;
      const copy=structuredClone(g),key=input.dataset.gaze;
      if(key==='preset')[copy.eyes,copy.head,copy.body]=G.presets[input.value];
      else if(key==='style')G.setStyle(copy,input.value);
      else if(key.startsWith('point'))copy.point[Number(key.slice(-1))]=input.valueAsNumber;
      else copy[key]=input.type==='number'?input.valueAsNumber:input.value;
      if(!G.valid(copy)){e.notify('请检查数值范围，最短停留须小于或等于最长停留。');e.render();return;}
      e.change(()=>{if(!clip.nameEdited&&clip.name===G.name(g))clip.name=G.name(copy);clip.gaze=copy;});
    });
    const roll=document.querySelector('#gaze-roll'),pick=document.querySelector('#gaze-pick');
    if(roll)roll.onclick=()=>{if(!track.locked)e.change(()=>g.seed=seed());};
    if(pick)pick.onclick=()=>{if(!track.locked)e.pick();};
  }
  root.CreatorGazeEditor={fields,bind,seed};
})(globalThis);
