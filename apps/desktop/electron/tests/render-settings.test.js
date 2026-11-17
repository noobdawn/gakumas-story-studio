'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const settings=require('../../ui/render-settings');
const store=require('../project-store');
const vm=require('node:vm');
function project(render){return {format:store.FORMAT,version:1,resources:{character:'ttmr-casl-0002-prepared'},state:{version:1,current:0,fov:35,selected:null,selectedClip:null,objects:[{id:'scene',name:'场景',type:'场景',icon:'box',parent:null,components:[]},{id:'ttmr',name:'角色',type:'角色',icon:'user',parent:'scene',components:[]},{id:'cam',name:'相机',type:'相机',icon:'camera',parent:'scene',components:[]}],assets:[],dialogues:[],tracks:[],globalSettings:{outlineEnabled:true,outlineWidth:.15,physicsEnabled:false,...(render===undefined?{}:{render})}}};}
test('旧工程保持可读，补齐渲染默认值且不修改原对象',()=>{
 const old=project(),serialized=JSON.stringify(old);assert.deepEqual(store.parse(serialized),old);
 const defaults=settings.normalize(old.state.globalSettings.render);
 assert.equal(defaults.reflections,true);assert.equal(defaults.reflectionProbes,true);assert.equal(defaults.ssr,false);
 assert.equal(defaults.antialiasing,2);assert.equal(defaults.tonemapping,1);assert.equal(defaults.indirectLight,.85);
 assert.equal(JSON.stringify(old),serialized);
 const partial={reflectionIntensity:.4};assert.equal(settings.normalize(partial).reflectionIntensity,.4);assert.deepEqual(partial,{reflectionIntensity:.4});
});
test('反射、光照和后处理参数可随工程保存重开',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'creator-render-settings-')),file=path.join(dir,'project.json');
 try{
  let value=settings.normalize();for(const [key,v] of Object.entries({ssr:true,reflectionIntensity:1.4,reflectionSmoothness:.35,ssrQuality:2,exposure:-1.5,eyeHighlight:.7,decals:false,bloom:false,antialiasing:1}))value=settings.change(value,key,v);
  const doc=project(value);await store.writeNew(file,doc);assert.deepEqual((await store.read(file)).doc,doc);
 }finally{await fs.unlink(file).catch(()=>{});await fs.rmdir(dir);}
});
test('拒绝损坏渲染参数、空值、非法枚举和越界数值',()=>{
 for(const v of [null,[],true,'bad'])assert.throws(()=>settings.normalize(v));
 for(const [key,s] of Object.entries(settings.schema)){
  const invalid=typeof s.value==='boolean'?[1,'true',null]:['1',null,NaN,Infinity,...(s.choices?[-1,.5,Math.max(...s.choices)+1]:[s.min-1,s.max+1])];
  for(const v of invalid)assert.throws(()=>store.validate(project({[key]:v})),/渲染/, `${key}=${v}`);
 }
 assert.throws(()=>settings.change({},'exposure',''));assert.throws(()=>settings.change({},'unknown',1));
});
test('关闭反射或子效果不丢失已调参数，恢复默认值不修改此前快照',()=>{
 const value=settings.normalize({ssr:true,ssrQuality:2,reflectionIntensity:1.8,bloomIntensity:.75});
 const off=settings.change(value,'reflections',false);
 assert.equal(off.ssrQuality,2);assert.equal(off.reflectionIntensity,1.8);assert.equal(value.reflections,true);
 for(const key of ['reflectionProbes','reflectionIntensity','ssr','ssrQuality'])assert.equal(settings.disabled(off,key),true);
 assert.equal(settings.disabled(off,'exposure'),false);
 const restored=settings.change(off,'reflections',true);assert.deepEqual(restored,value);
 assert.equal(settings.disabled(settings.change(restored,'ssr',false),'ssrQuality'),true);
 assert.equal(settings.normalize().reflectionIntensity,1);assert.equal(value.reflectionIntensity,1.8);
});
test('界面字段与协议 schema 一致，SSR 参数不会冒充环境反射开关',()=>{
 const html=settings.fields(),keys=[...html.matchAll(/data-render-key="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(keys.sort(),Object.keys(settings.schema).sort());assert.equal(new Set(keys).size,keys.length);
 assert.match(html,/<legend>反射<\/legend>/);assert.match(html,/场景自带的环境反射/);assert.match(html,/补充动态反射/);
});
test('设置页所有控件均能绑定，修改、恢复与撤销快照保留其他设置',async()=>{
 const app=await fs.readFile(path.join(__dirname,'../../ui/app.js'),'utf8');
 const source=app.match(/  function renderGlobalProperties\(\)\{[\s\S]*?(?=\n  function openProjectSettings)/)[0];
 // Structural fixture only: no browser, Electron, Player or rendering is started.
 const nodes=new Map(),renderNodes=[],state=project(settings.normalize()).state,history=[];let synced=0;
 Object.assign(state.globalSettings,{duration:30,fps:30,aspect:'16:9'});
 nodes.set('#modal',{dataset:{settingsCurrent:'render'}});
 const container={querySelectorAll:()=>renderNodes,set innerHTML(html){
   this.html=html;renderNodes.length=0;
   for(const match of html.matchAll(/<(input|select|button|output)\b([^>]*)>/g)){
    const attrs=match[2],id=attrs.match(/\bid="([^"]+)"/)?.[1],key=attrs.match(/data-render-key="([^"]+)"/)?.[1];
    const node={dataset:{renderKey:key},type:attrs.match(/type="([^"]+)"/)?.[1],value:attrs.match(/value="([^"]*)"/)?.[1],checked:/\bchecked\b/.test(attrs),disabled:/\bdisabled\b/.test(attrs)};
    if(id)nodes.set('#'+id,node);if(key)renderNodes.push(node);
   }
 }};nodes.set('#project-settings-content',container);
 const context=vm.createContext({state,CreatorStory:require('../../ui/story-timeline'),CreatorRenderSettings:settings,$:selector=>nodes.get(selector)||null,globalSettingsSupported:true,renderSettingsSupported:true,performance:true,costumePhysics:true,selectSettingsPage(){},copyState:()=>structuredClone(state),remember:before=>history.push(before),syncPlayer:()=>synced++,notify:message=>{throw Error(message);}});
 vm.runInContext(source+';renderGlobalProperties();',context);
 for(const id of ['#outline-enabled','#outline-width','#cloth-enabled','#reset-render-settings'])assert(nodes.get(id)?.onchange||nodes.get(id)?.onclick,id);
 nodes.get('#global-supersampling').onchange({target:{value:'2'}});
 assert.equal(state.globalSettings.exportSupersampling,2);assert.equal(history.at(-1).globalSettings.exportSupersampling,undefined);
 const aa=renderNodes.find(n=>n.dataset.renderKey==='antialiasing');aa.onchange({target:{value:'6',type:'select-one'}});
 assert.equal(state.globalSettings.render.antialiasing,6);assert.equal(history.at(-1).globalSettings.render.antialiasing,2);
 let intensity=renderNodes.find(n=>n.dataset.renderKey==='reflectionIntensity');intensity.onchange({target:{value:'1.7',type:'number'}});
 assert.equal(state.globalSettings.render.reflectionIntensity,1.7);assert.equal(history.at(-1).globalSettings.render.reflectionIntensity,1);assert.equal(synced,2);
 nodes.get('#reset-render-settings').onclick();assert.equal(state.globalSettings.render.reflectionIntensity,1);assert.equal(history.at(-1).globalSettings.render.reflectionIntensity,1.7);
 assert.equal(state.globalSettings.render.antialiasing,2);assert.equal(state.globalSettings.exportSupersampling,2);
 assert.equal(state.globalSettings.outlineWidth,.15);assert.equal(state.globalSettings.physicsEnabled,false);
 state.globalSettings=structuredClone(history.at(-1).globalSettings);vm.runInContext('renderGlobalProperties();',context);
 assert.equal(renderNodes.find(n=>n.dataset.renderKey==='reflectionIntensity').value,'1.7');
 context.renderSettingsSupported=false;vm.runInContext('renderGlobalProperties();',context);assert(renderNodes.every(n=>n.disabled));
});


test('MSAA 与超采样独立保存，拒绝损坏导出设置',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gss-aa-settings-'));
 try{
  for(const aa of [0,1,2,3,4,5,6])for(const scale of [1,2]){
   const doc=project(settings.normalize({antialiasing:aa}));doc.state.globalSettings.exportSupersampling=scale;
   const file=path.join(dir,`${aa}-${scale}.json`);await store.writeNew(file,doc);
   assert.deepEqual((await store.read(file)).doc,doc);
  }
  for(const value of [null,true,'2',0,1.5,3,4]){
   const doc=project();doc.state.globalSettings.exportSupersampling=value;
   assert.throws(()=>store.validate(doc),/超采样/);
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});


test('控制入口应用 AA 与导出设置后重绘，非法输入不修改工程',async()=>{
 const app=await fs.readFile(path.join(__dirname,'../../ui/app.js'),'utf8');
 const source=app.match(/    if\(command==='project.settings'\)\{[\s\S]*?(?=    if\(command==='project.physics')/)[0];
 const state=project(settings.normalize()).state;Object.assign(state.globalSettings,{duration:30,fps:30,aspect:'16:9'});
 let rendered=0,remembered=0;
 const context=vm.createContext({state,structuredClone,CreatorRenderSettings:settings,CreatorStory:require('../../ui/story-timeline'),copyState:()=>structuredClone(context.state),number:(v,lo,hi)=>{assert(v>=lo&&v<=hi);return v;},setPlaying(){},remember(){remembered++;},render(){rendered++;}});
 vm.runInContext('function apply(args){const command="project.settings";'+source+'}',context);
 const result=context.apply({duration:30,fps:30,aspect:'16:9',render:{antialiasing:5},exportSupersampling:2});
 assert.equal(result.settings.render.antialiasing,5);assert.equal(result.settings.exportSupersampling,2);assert.equal(rendered,1);assert.equal(remembered,1);
 const before=JSON.stringify(context.state);
 for(const patch of [{exportSupersampling:'2'},{exportSupersampling:4},{render:null},{render:{antialiasing:7}}])assert.throws(()=>context.apply({duration:30,fps:30,aspect:'16:9',...patch}));
 assert.equal(JSON.stringify(context.state),before);assert.equal(rendered,1);assert.equal(remembered,1);
});
