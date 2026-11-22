const test=require('node:test');
const assert=require('node:assert/strict');
const {create,samples}=require('../../ui/code-ui-preview');
const U=require('../../ui/code-ui');
const C=require('../../ui/composition');

const still={html:'<div class="card"><strong>标题</strong></div>',css:'.card{color:#fff}',js:''};
const clip=(codeUI=U.template,more={})=>({id:'ui-1',start:0,len:1,uiKind:'code',codeUI,...more});
const state=(...clips)=>({compositionVersion:1,globalSettings:{duration:7,aspect:'16:9',fps:30},
  current:0,objects:[],dialogues:[],transitions:[],tracks:[{id:'layer',type:'ui',clips}]});
const args=(code=U.template,time=0)=>({code,time,duration:1,width:1280,height:720});
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function fixture(s,limits={},overrides={}){
  const log={render:[],warm:[],cancel:0,resets:0,status:[],errors:[]};
  let clock=1000,blocked=false;
  const frame=({code,time,width,height,duration})=>JSON.stringify([code,time,width,height,duration]);
  const api=create({state:()=>s,now:()=>clock,blocked:()=>blocked,
    render:async a=>{log.render.push(a);return frame(a);},warm:async a=>{log.warm.push(a);return frame(a);},
    cancelWarm:()=>log.cancel++,reset:()=>log.resets++,status:x=>log.status.push(x),error:x=>log.errors.push(x),
    ...overrides},limits);
  return {api,log,advance:()=>{clock+=800;},block:v=>{blocked=v;}};
}
test('auto sampling only treats plain, resource-free markup as static and sees in-place edits',()=>{
  const c=structuredClone(still);
  assert(U.isStatic(c));c.css+=' @keyframes late{0%{opacity:0}}';assert(!U.isStatic(c));
  c.css=still.css;assert(U.isStatic(c));c.js='function render(t){}';assert(!U.isStatic(c));
  assert(U.isStatic(c,'static'));assert(!U.isStatic(still,'dynamic'));
  for(const html of ['<img src="data:image/gif;base64,a">','<svg></svg>','<span style="color:red">x</span>'])assert(!U.isStatic({...still,html}));
  for(const css of ['div{animation:late 1s 3s}','@media(min-width:600px){div{color:red}}','div{background:url(data:image/png;base64,a)}'])assert(!U.isStatic({...still,css}));
  const s=state(clip());s.tracks[0].clips[0].codeUISampling='sometimes';assert.throws(()=>C.validate(s),/取样/);
  assert.throws(()=>U.validateSampling(null),/取样/);assert.doesNotThrow(()=>U.validateSampling(undefined));
});
test('idle samples match actual composition at fractional starts, offsets, ends and disabled tracks',()=>{
  const a=clip(U.template,{start:31/30,len:4/30,sourceOffset:.375}),s=state(a,clip(still,{id:'card'}));
  s.tracks.push({id:'off',enabled:false,type:'ui',clips:[clip(U.template,{start:0,len:5})]});
  const rows=[...samples(s,32,30)];
  const times=rows.filter(r=>r.codeUI===U.template).map(r=>r.localTime).sort((x,y)=>x-y);
  const expected=[];
  for(let i=0;i<90;i++){const node=C.packet(s,i/30).nodes.find(n=>n.id===a.id&&n.codeUI===U.template);if(node)expected.push(node.localTime);}
  assert.deepEqual(times,expected);assert.equal(rows.filter(r=>r.codeUI===still).length,1);
  assert.equal(U.sample({...a,codeUISampling:'static'},1.1).localTime,.375);
  assert.deepEqual(U.dimensions('9:16'),{width:1080,height:1920});assert.deepEqual(U.dimensions('16:9',1920,1080),{width:1920,height:1080});
});
test('foreground reuses cloned content and placement edits, respects all pixel inputs and undo',async()=>{
  const {api,log}=fixture(state(clip()));const a=args(structuredClone(U.template));
  const [first,second]=await Promise.all([api.render(a),api.render(structuredClone(a))]);
  assert.equal(first,second);assert.equal(log.render.length,1);
  api.changed();assert.equal(await api.render({...a,x:.25}),first);
  for(const modified of [{time:.25},{duration:2},{width:640},{height:640}])assert.notEqual(await api.render({...a,...modified}),first);
  a.code.css+=' div{opacity:.5}';assert.notEqual(await api.render(a),first);
  a.code.css=U.template.css;assert.equal(await api.render(a),first);assert.equal(log.render.length,6);
});
test('warmup waits for idle, never seeks, and exact prepared layers bypass foreground IPC',async()=>{
  const s=state(clip(U.template,{len:2/30}),clip(still,{id:'card'}));s.current=1/30;
  const {api,log,advance,block}=fixture(s);
  await api.step();assert.equal(log.warm.length,0);advance();block(true);await api.step();
  assert.equal(log.warm.length,0);block(false);
  for(let i=0;i<6;i++)await api.step();
  assert.equal(log.status.at(-1),'ready');assert.equal(log.warm.length,3);assert.equal(s.current,1/30);
  for(const a of log.warm)await api.render(a);assert.equal(log.render.length,0);
  api.interrupt();assert.equal(log.status.at(-1),'');await api.step();assert.equal(log.warm.length,3);
});
test('an interrupted warm sample cannot publish stale pixels, and project reset discards late foreground results',async()=>{
  const warm=deferred(),called=deferred(),fg=deferred(),started=deferred();
  const {api,log,advance}=fixture(state(clip()),{},{warm:()=>{called.resolve();return warm.promise;},
    render:()=>{started.resolve();return fg.promise;}});
  advance();const warming=api.step();await called.promise;api.changed();assert.equal(log.cancel,1);
  warm.resolve('old idle output');await warming;assert.equal(log.status.at(-1),'');
  const a=args();const old=api.render(a);await started.promise;api.reset();fg.resolve('foreground');await old;
  a.code={...a.code};assert.equal(await api.render(a),'foreground');assert.equal(log.resets,1);
  const first=deferred(),queued=deferred();let calls=0;
  const isolated=fixture(state(),{},{render:async()=>{if(++calls===1){queued.resolve();return first.promise;}return 'new';}}).api;
  const late=isolated.render(a);await queued.promise;isolated.reset();first.resolve('before reset');await late;
  assert.equal(await isolated.render(a),'new');assert.equal(calls,2);
});
test('bounded warmup protects nearby frames, reports partial, and renders misses on demand',async()=>{
  const s=state(clip());let attempts=0,live=0;
  const {api,log,advance}=fixture(s,{maxFrames:2,maxBytes:4},{warm:async()=>{attempts++;return 'xx';},render:async()=>{live++;return 'yy';}});
  advance();for(let i=0;i<12;i++)await api.step();
  assert.equal(attempts,3);assert.equal(log.status.at(-1),'partial');
  assert.equal(await api.render(args(U.template,0)),'xx');assert.equal(await api.render(args(U.template,3/30)),'yy');assert.equal(live,1);
});
test('a broken layer cannot prevent preparation of remaining layers or swallow a foreground error',async()=>{
  const s=state(clip(),clip(still,{id:'good'}));
  const {api,log,advance}=fixture(s,{},{warm:async a=>{if(a.code.js)throw Error('bad source');return 'good';},
    render:async()=>{throw Error('bad source');}});
  advance();for(let i=0;i<10;i++)await api.step();
  assert.equal(log.errors.length,1);assert.equal(log.status.at(-1),'partial');assert.equal(await api.render(args(still)),'good');
  await assert.rejects(api.render(args()),/bad source/);
});
