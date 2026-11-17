const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const temp=fs.mkdtempSync(path.join(process.env.GSS_UI_CHECK_TEMP||app.getPath('temp'),'gss-ui-editor-'));
app.setPath('userData',path.join(temp,'profile'));
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,width:800,height:500,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false}});
 try{const ui=path.resolve(__dirname,'../../ui');const html=path.join(temp,'test.html');
  fs.writeFileSync(html,'<style>*{box-sizing:border-box}body{margin:0;width:260px}input,textarea{width:100%}</style><div id="modal"></div><div id="inspector"></div>'+['code-ui','post-effects','character-colors','composition','composition-editor','ui-transition-editor'].map(n=>`<script src="${require('node:url').pathToFileURL(path.join(ui,n+'.js'))}"></script>`).join(''));
  await w.loadFile(html);const result=await w.webContents.executeJavaScript(`(async()=>{
   const s={compositionVersion:1,transitions:[],tracks:[],objects:[],dialogues:[],globalSettings:{aspect:'16:9'},current:0};let selected=null,serial=0;const history=[],errors=[];const esc=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
   globalThis.CreatorUITransitions={choices:()=>[]};
   const env={state:()=>s,copy:()=>structuredClone(s),id:()=>String(++serial),esc,notify:x=>errors.push(x),entries:()=>[],supported:()=>true,ready:async()=>{},pause(){},duration:()=>10,fps:()=>30,remember:b=>history.push(b),render(){},showModal:h=>document.querySelector('#modal').innerHTML=h,modal:h=>document.querySelector('#modal').innerHTML=h,closeModal(){},close(){},reveal(){},select:x=>selected=x,error:()=>''};
   const u=CreatorUITransitionEditor(env),c=CreatorCompositionEditor(env);await u.picker();document.querySelector('#ui-code-insert').click();const t=s.tracks[0],clip=t.clips[0];if(selected!==clip.id||clip.uiKind!=='code')throw Error('insert');
   document.querySelector('#inspector').innerHTML=u.fields(clip)+c.fields(t,clip);u.bind(clip);c.bind(t,clip);
   document.querySelector('[data-ui-code="html"]').value='<h1>测试</h1>';document.querySelector('#ui-code-apply').click();if(clip.codeUI.html!=='<h1>测试</h1>'||history.at(-1).tracks[0].clips[0].codeUI.html===clip.codeUI.html)throw Error('code/history');
   const opacity=document.querySelector('[data-composition-layout="opacity"]');opacity.value='45';opacity.dispatchEvent(new Event('change'));if(clip.compositionLayout.opacity!==.45)throw Error('opacity');
   t.locked=true;opacity.value='20';opacity.dispatchEvent(new Event('change'));if(clip.compositionLayout.opacity!==.45||errors.length!==1)throw Error('lock');
   const world={type:'world',clips:[]};document.querySelector('#inspector').innerHTML=c.fields(world,world);c.bind(world,world);const x=document.querySelector('[data-composition-layout="x"]');x.value='12';x.dispatchEvent(new Event('change'));if(world.compositionLayout.x!==.12)throw Error('world');
   return {insert:true,codeApply:true,undoSnapshot:true,opacity:true,lock:true,world:true,overflow:document.body.scrollWidth>800};
  })()`);assert.equal(result.overflow,false);console.log(JSON.stringify(result));
 }finally{w.destroy();}
}).then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1);});
