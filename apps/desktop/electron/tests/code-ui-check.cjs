// Artificial HTML only; hidden Chromium, no host/Player or user projects.
const {app,nativeImage}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
app.setPath('userData',path.join(process.env.GSS_UI_CHECK_TEMP||app.getPath('temp'),'gss-code-ui-check'));
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 let windows=0;app.on('browser-window-created',()=>{windows++;});
 const renderer=require('../code-ui-renderer').create();
 try{
  const code={html:'<div id="box"></div>',css:'html,body{margin:0}#box{position:absolute;width:40px;height:40px;background:#ff0000}',js:'function render(time){document.getElementById("box").style.left=(time*50)+"px";if(typeof require!=="undefined"||window.projectAPI)throw Error("bridge leaked");}'};
  const args={code,width:320,height:180,time:0,duration:5};
  const first=await renderer.render(args),next=await renderer.render({...args,time:2}),again=await renderer.render(args);
  assert.equal(first,again);assert.notEqual(first,next);
  const img=nativeImage.createFromBuffer(Buffer.from(first,'base64')),p=img.toBitmap();assert.deepEqual(img.getSize(),{width:320,height:180});assert.equal(p[(10*320+10)*4+3],255);assert.equal(p[(100*320+200)*4+3],0);assert.equal(p[(10*320+10)*4+2],255);
  const blue={...code,css:code.css.replace('#ff0000','#0000ff')};
  const other=await renderer.render({...args,code:blue});
  assert.notEqual(other,first);
  for(const time of [.5,.75,1]){await renderer.render({...args,time});await renderer.render({...args,code:blue,time});}
  assert.equal(windows,2,'overlapping code layers reuse two offscreen surfaces');
  const stuck=renderer.render({...args,code:{...code,js:'async function render(){await new Promise(()=>{});}' }},true);
  await new Promise(resolve=>setTimeout(resolve,200));
  const resumed=renderer.render({...args,purpose:'export'});
  assert.equal(await stuck,null,'foreground cancels unfinished idle JavaScript');
  assert.equal(await resumed,first);
  await assert.rejects(renderer.render({...args,code:{...code,js:'throw Error("authored error")'}}),/authored error/);
  await assert.rejects(renderer.render({...args,code:{...code,js:'while(true){}'}}),/超时/);
  assert.equal(await renderer.render(args),first);
  const safe={...code,js:'async function render(){let denied=false;try{await fetch("https://example.com")}catch{denied=true}if(!denied)throw Error("network allowed");}'};
  await renderer.render({...args,code:safe});
  console.log('Code UI: alpha/color, time samples, seek repeat, two surfaces, foreground priority, isolation, errors, timeout and recovery passed');
 }finally{renderer.close();}
}).then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1);});
