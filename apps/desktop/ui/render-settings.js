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
  function fields(value){
    const s=normalize(value);
    const check=(key,label)=>`<label class="dialogue-link"><input type="checkbox" data-render-key="${key}" ${s[key]?'checked':''}> ${label}</label>`;
    const number=(key,label,step='.05')=>`<div class="field"><label for="render-${key}">${label}</label><input id="render-${key}" class="input" type="number" data-render-key="${key}" min="${schema[key].min}" max="${schema[key].max}" step="${step}" value="${s[key]}"></div>`;
    const select=(key,label,labels)=>`<div class="field"><label for="render-${key}">${label}</label><select id="render-${key}" data-render-key="${key}">${labels.map((x,i)=>`<option value="${i}" ${s[key]===i?'selected':''}>${x}</option>`).join('')}</select></div>`;
    return `<fieldset class="render-category"><legend>角色</legend>${number('eyeHighlight','眼部高光强度')}</fieldset><fieldset class="render-category"><legend>场景光照</legend>${number('directLight','场景主光倍率')}${number('indirectLight','间接光强度')}${number('emission','自发光倍率')}${check('decals','场景贴花')}</fieldset>
    <fieldset class="render-category"><legend>阴影与环境遮蔽</legend>${check('shadows','场景阴影')}${check('ao','环境遮蔽（AO）')}${number('aoStrength','AO 强度')}${number('aoRadius','AO 半径')}</fieldset>
    <fieldset class="render-category"><legend>反射</legend>${check('reflections','启用反射')}${check('reflectionProbes','场景自带的环境反射')}${number('reflectionIntensity','反射强度')}${number('reflectionSmoothness','最低材质平滑度')}<p class="hint">使用解包场景中的烘焙反射，遵循原材质平滑度；烘焙内容不包含后来添加的角色。</p>${check('ssr','补充动态反射（SSR）')}${select('ssrQuality','追踪质量',['快速 · 半分辨率 / 32 步','标准 · 半分辨率 / 64 步','精细 · 全分辨率 / 96 步'])}${number('ssrDistance','最大追踪距离（米）','1')}${number('ssrThickness','深度容差（米）','.01')}<p class="hint">作用于光滑的 3D 场景表面。动态反射只能反射屏幕内已有的可见内容；屏幕边缘会淡出，透明物体和屏幕外物体不参与追踪。</p></fieldset>
    <fieldset class="render-category"><legend>后处理</legend>${select('tonemapping','色调映射',['关闭','Neutral','ACES'])}${number('exposure','曝光补偿（EV）','.1')}${check('bloom','泛光（Bloom）')}${number('bloomIntensity','泛光强度')}${number('bloomThreshold','泛光阈值')}<p class="hint">2D 背景下自动停用后处理与反射，切回 3D 后恢复设置。</p></fieldset>
    <fieldset class="render-category"><legend>抗锯齿</legend>${select('antialiasing','方式',['关闭','FXAA','SMAA High','MSAA 2×','MSAA 4×','MSAA 8×','MSAA 4× + SMAA High'])}<p class="hint">预览和导出共用这些工程设置。</p></fieldset>`;
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
  return {schema,normalize,fields,change,disabled};
});
