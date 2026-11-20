(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CreatorRenderSettings=api;})(globalThis,()=>{
  const schema={
    eyeHighlight:{value:1,min:0,max:3},directLight:{value:1,min:0,max:3},indirectLight:{value:.85,min:0,max:3},emission:{value:1,min:0,max:3},
    shadows:{value:true},decals:{value:true},ao:{value:true},aoStrength:{value:.5,min:0,max:1},aoRadius:{value:.5,min:.05,max:2},
    reflections:{value:true},reflectionProbes:{value:true},ssr:{value:false},reflectionIntensity:{value:1,min:0,max:2},reflectionSmoothness:{value:.6,min:0,max:.99},ssrDistance:{value:25,min:1,max:100},ssrThickness:{value:.2,min:.01,max:1},ssrQuality:{value:1,choices:[0,1,2]},
    tonemapping:{value:1,choices:[0,1,2]},exposure:{value:0,min:-4,max:4},bloom:{value:true},bloomIntensity:{value:.15,min:0,max:2},bloomThreshold:{value:1,min:0,max:5},antialiasing:{value:2,choices:[0,1,2,3,4,5,6]}
  };
  function normalize(input){
    if(input!==undefined&&(!input||typeof input!=='object'||Array.isArray(input)))throw Error('渲染设置格式无效');
    const result={};for(const [key,s] of Object.entries(schema)){
      const v=input?.[key]===undefined?s.value:input[key];
      if(typeof s.value==='boolean'?typeof v!=='boolean':typeof v!=='number'||!Number.isFinite(v)||(s.choices?!s.choices.includes(v):v<s.min||v>s.max))throw Error('渲染参数无效：'+key);
      result[key]=v;
    }return result;
  }
  const modes = {
    none: {label:'无', description:'只播放角色动画。'},
    gss: {label:'GSS', description:'使用经典 GSS 骨链与碰撞约束。'},
    quartz: {label:'Quartz', description:'按服装和发型的模型驱动计算摆动。'},
    hybrid: {label:'Hybrid', description:'保留模型驱动的衣摆与后发摆动，限制刘海和鬓角的过度运动。'}
  };
  function physicsSettings(mode) {
    if(typeof mode!=='string' || !Object.hasOwn(modes,mode))throw Error('未知的物理方式');
    return {physicsMode:mode,physicsEnabled:mode!=='none'};
  }
  function physicsMode(settings, legacyActorEnabled=false) {
    if(settings?.physicsMode!==undefined)return physicsSettings(settings.physicsMode).physicsMode;
    return (settings ? settings.physicsEnabled : legacyActorEnabled)===true ? 'quartz' : 'none';
  }
  function physicsPacket(settings,performance,supportsModes) {
    if(!performance)return {physicsEnabled:false};
    const mode=physicsMode(settings);
    if(supportsModes)return physicsSettings(mode);
    if(mode==='hybrid'||mode==='gss')throw Error('当前 Player 不支持所选物理方式，请更新 Player 或在渲染设置中选择 Quartz 或无');
    return {physicsEnabled:mode!=='none'};
  }
  const tabs=[['actor','角色与物理'],['light','光照与阴影'],['reflection','反射'],['output','后期与画质']];
  function fields(value,options={}) {
    const s=normalize(value);
    const g=options.global||{outlineEnabled:true,outlineWidth:.15,physicsMode:'hybrid'};
    const method=physicsMode(g);
    const active=tabs.some(([id])=>id===options.tab)?options.tab:'actor';
    const row=(name,label,control)=>`<div class="render-row"><label for="${name}">${label}</label><div class="render-control">${control}</div></div>`;
    const check=(key,label)=>row('render-'+key,label,`<input id="render-${key}" class="render-switch" type="checkbox" data-render-key="${key}" ${s[key]?'checked':''}>`);
    const number=(key,label,step='.05')=>row('render-'+key,label,`<input id="render-${key}" class="input render-number" type="number" data-render-key="${key}" min="${schema[key].min}" max="${schema[key].max}" step="${step}" value="${s[key]}">`);
    const select=(key,label,labels)=>row('render-'+key,label,`<select id="render-${key}" data-render-key="${key}">${labels.map((text,i)=>`<option value="${i}" ${s[key]===i?'selected':''}>${text}</option>`).join('')}</select>`);
    const group=(title,body)=>`<fieldset class="render-group"><legend>${title}</legend><div class="render-rows">${body}</div></fieldset>`;
    const panel=(id,body)=>`<section role="tabpanel" id="render-panel-${id}" aria-labelledby="render-tab-${id}" data-render-panel="${id}" ${id===active?'':'hidden'}>${body}</section>`;
    const choices=Object.entries(modes).map(([id,item])=>{
      const unavailable=!options.performance || (!options.physicsModes && !['none','quartz'].includes(id));
      return `<label class="physics-option"><input id="physics-${id}" type="radio" name="physics-method" value="${id}" ${method===id?'checked':''} ${unavailable?'disabled':''}><span>${item.label}</span></label>`;
    }).join('');
    const physics=`<div class="physics-setting"><fieldset class="physics-choice" aria-describedby="physics-help"><legend>物理方式</legend><div class="physics-segments">${choices}</div></fieldset><p id="physics-help">${!options.performance?'当前会话未加载角色物理资源。':!options.physicsModes?'当前 Player 仅支持无与 Quartz。':modes[method].description}</p></div>`;
    const outline=row('outline-enabled','角色描边',`<input type="checkbox" id="outline-enabled" class="render-switch" ${g.outlineEnabled?'checked':''} ${options.outline?'':'disabled'}>`)+
      row('outline-width','描边宽度',`<div class="render-slider"><input id="outline-width" type="range" min="0" max="0.3" step="0.01" value="${g.outlineWidth}" ${options.outline&&g.outlineEnabled?'':'disabled'}><output id="outline-value" for="outline-width">${g.outlineWidth.toFixed(2)}</output></div>`);
    return `<header class="render-head"><h2>渲染设置</h2><button type="button" id="reset-render-settings" class="render-reset" title="恢复光照、反射、后处理、抗锯齿和眼部高光的默认值" ${options.render?'':'disabled'}>恢复画质默认值</button></header>
      <div role="tablist" class="render-tabs" aria-label="渲染设置分类">${tabs.map(([id,label])=>`<button type="button" role="tab" id="render-tab-${id}" aria-selected="${id===active}" aria-controls="render-panel-${id}" tabindex="${id===active?0:-1}" data-render-tab="${id}">${label}</button>`).join('')}</div>
      ${panel('actor',group('角色动态',physics)+group('角色外观',outline+number('eyeHighlight','眼部高光强度')))}
      ${panel('light',group('场景光照',number('directLight','主光倍率')+number('indirectLight','间接光强度')+number('emission','自发光倍率')+check('decals','场景贴花'))+
                      group('阴影与环境遮蔽',check('shadows','场景阴影与角色发影')+check('ao','环境遮蔽（AO）')+number('aoStrength','遮蔽强度')+number('aoRadius','遮蔽半径')))}
      ${panel('reflection',group('反射',check('reflections','启用反射')+check('reflectionProbes','场景自带的环境反射')+number('reflectionIntensity','反射强度')+number('reflectionSmoothness','最低材质平滑度'))+
                           group('屏幕空间反射',check('ssr','补充动态反射（SSR）')+select('ssrQuality','追踪质量',['快速 · 半分辨率 / 32 步','标准 · 半分辨率 / 64 步','精细 · 全分辨率 / 96 步'])+number('ssrDistance','最大追踪距离（米）','1')+number('ssrThickness','深度容差（米）','.01')))}
      ${panel('output',group('色调与曝光',select('tonemapping','色调映射',['关闭','Neutral','ACES'])+number('exposure','曝光补偿（EV）','.1'))+
                       group('泛光',check('bloom','启用泛光（Bloom）')+number('bloomIntensity','泛光强度')+number('bloomThreshold','泛光阈值'))+
                       group('抗锯齿',select('antialiasing','抗锯齿方式',['关闭','FXAA','SMAA High','MSAA 2×','MSAA 4×','MSAA 8×','MSAA 4× + SMAA High'])))}
      `;
  }
  function bindTabs(container) {
    const buttons=Array.from(container.querySelectorAll('[data-render-tab]'));
    const panels=container.querySelectorAll('[data-render-panel]');
    function activate(button) {
      const id=button.dataset.renderTab;
      container.dataset.renderTab=id;
      for(const tab of buttons){
        tab.setAttribute('aria-selected',String(tab===button));tab.tabIndex=tab===button?0:-1;
      }
      for(const panel of panels)panel.hidden=panel.dataset.renderPanel!==id;
      container.scrollTop=0;button.focus({preventScroll:true});
    }
    for(const [i,button] of buttons.entries()){
      button.onclick=()=>activate(button);
      button.onkeydown=e=>{
        const target={ArrowLeft:(i+buttons.length-1)%buttons.length,ArrowRight:(i+1)%buttons.length,Home:0,End:buttons.length-1}[e.key];
        if(target!==undefined){e.preventDefault();activate(buttons[target]);}
      };
    }
  }
  function change(value,key,raw){
    if(!Object.hasOwn(schema,key))throw Error('未知的渲染参数');
    if(typeof schema[key].value==='number'&&(typeof raw==='string'&&raw.trim()===''))throw Error('渲染参数不能为空');
    return normalize({...normalize(value),[key]:typeof schema[key].value==='boolean'?raw:Number(raw)});
  }
  function disabled(value,key){
    const s=normalize(value);
    if(['aoStrength','aoRadius'].includes(key))return !s.ao;
    if(['bloomIntensity','bloomThreshold'].includes(key))return !s.bloom;
    if(key.startsWith('ssr')&&key!=='ssr')return !s.reflections||!s.ssr;
    if(['reflectionProbes','reflectionIntensity','reflectionSmoothness','ssr'].includes(key))return !s.reflections;
    return false;
  }
  return {schema,normalize,fields,change,disabled,bindTabs,physicsMode,physicsSettings,physicsPacket};
});
