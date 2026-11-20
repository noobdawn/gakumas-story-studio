'use strict';
const assert=require('node:assert/strict');

// Exercise Chromium drop targeting on the actual workbench opened by clip-inspector-ui.
module.exports=async function({win,fixture,load,js,snapshot}){
  const doc=structuredClone(fixture),s=doc.state,object=s.objects.find(o=>o.id==='picture-layer');
  const picture=(id,start,len)=>({id,assetId:'picture',name:id,start,len});
  function layer(id,start,len){
    const target=id+'-object';
    s.objects.push({...structuredClone(object),id:target,name:id});
    return {id,name:id,type:'media',target,clips:[picture(id+'-clip',start,len)]};
  }
  const camera=s.tracks.find(t=>t.type==='camera'),world=s.tracks.find(t=>t.type==='world');
  s.tracks=[layer('front',0,2),layer('middle',5,2),layer('back',1,2),world,camera,
    {id:'old-empty',name:'旧空轨道',type:'audio',target:'scene',clips:[]}];
  s.clipGroups=[];s.current=0;s.selectedClip=null;
  const state=async()=>(await snapshot()).state;
  const media=state=>state.tracks.filter(t=>t.type==='media');
  const track=(state,id)=>state.tracks.find(t=>t.id===id);
  const frames=()=>js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const keyboard=async(key,ctrl=false)=>{
    await js("document.activeElement.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',"+JSON.stringify({key,code:key.length===1?'Key'+key.toUpperCase():key,ctrlKey:ctrl,bubbles:true})+'))');
    await frames();
  };
  async function point(id,at){
    await js(`q('#tab-timeline').click();
      for(let b=q('[data-group-toggle][aria-expanded="false"]');b;b=q('[data-group-toggle][aria-expanded="false"]'))b.click();
      q('[data-track="'+${JSON.stringify(id)}+'"]').scrollIntoView({block:'center'});
      {const v=q('.timeline-scroll'),box=v.getBoundingClientRect(),r=q('#ruler').getBoundingClientRect();
       v.scrollLeft+=r.left+r.width*${at}/30-(box.left+box.width*.65);}`);
    await frames();
    const result=await js(`(()=>{const r=q('#ruler').getBoundingClientRect(),lane=q('[data-lane="'+${JSON.stringify(id)}+'"]').getBoundingClientRect();
      const x=Math.round(r.left+r.width*${at}/30),y=Math.round(lane.top+lane.height/2);
      return {x,y,id:document.elementFromPoint(x,y)?.closest('[data-track]')?.dataset.track,time:Math.round((x-r.left)/r.width*30*30)/30};})()`);
    assert.equal(result.id,id,'drop coordinates must hit '+id);
    return result;
  }
  async function drop(id,at,asset='movie',options={}){
    await js(`q('#tab-assets').click();
      q('#asset-browser-search').value=${JSON.stringify(asset==='movie'?'movie.mp4':'still.png')};
      q('#asset-browser-search').dispatchEvent(new Event('input',{bubbles:true}));
      {const d=new DataTransfer(),a=q('[data-asset="'+${JSON.stringify(asset)}+'"]');
       if(!a)throw Error('Asset missing from browser: '+${JSON.stringify(asset)});
       a.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:d}));
       q('#tab-timeline').dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:d}));}`);
    const p=await point(id,at),data={items:[{mimeType:'application/x-creator-asset',data:asset}],dragOperationsMask:1};
    const dispatch=type=>win.webContents.debugger.sendCommand('Input.dispatchDragEvent',{type,x:p.x,y:p.y,data});
    const frame=Math.round(p.time*30),stamp='00:00:'+String(Math.floor(frame/30)).padStart(2,'0')+':'+String(frame%30).padStart(2,'0');
    for(const type of ['dragEnter','dragOver']){
      await dispatch(type);
      const hint=await js("q('.timeline-asset-drop')?.textContent||''");
      if(!options.blocked){assert.match(hint,options.create?/正上方新建/:/添加到/);assert.ok(hint.endsWith(stamp),hint);}
    }
    await dispatch('drop');await frames();return p.time;
  }
  await load(doc);
  await js(`window.observedDrops=[];document.addEventListener('drop',ev=>observedDrops.push({type:ev.type,data:ev.dataTransfer.getData('application/x-creator-asset'),target:ev.target.className}),true);`);
  assert.deepEqual((await state()).tracks.filter(t=>!t.clips.length).map(t=>t.id),[world.id]);
  const firstAt=await drop('middle',8),first=await state(),firstVideo=track(first,'middle').clips.find(c=>c.assetId==='movie');
  assert.equal(media(first).length,3);
  assert.ok(firstVideo,await js("JSON.stringify({drops:observedDrops,toast:q('#toast')?.textContent,messages:q('#message-log')?.textContent,hint:q('.timeline-asset-drop')?.textContent})"));
  assert.equal(firstVideo.start,firstAt);
  const sound=first.tracks.find(t=>t.type==='audio');assert.equal(sound.clips[0].mediaLink,firstVideo.mediaLink);
  const secondAt=await drop('middle',19),second=await state();
  assert.equal(media(second).length,3);assert.equal(second.tracks.filter(t=>t.type==='audio').length,1);
  assert.equal(track(second,sound.id).clips[1].start,secondAt);
  const collisionAt=await drop('middle',10,'movie',{create:true}),overlay=await state();
  const created=media(overlay).find(t=>!track(second,t.id));
  assert.deepEqual(media(overlay).map(t=>t.id),['front',created.id,'middle','back']);
  assert.deepEqual(track(overlay,'middle'),track(second,'middle'));
  assert.equal(created.clips[0].start,collisionAt);
  const newSound=overlay.tracks.find(t=>t.type==='audio'&&t.target===created.target);
  assert.equal(newSound.clips[0].mediaLink,created.clips[0].mediaLink);
  const selection=overlay.selectedClip;assert.equal(selection,created.clips[0].id);
  await keyboard('c',true);await keyboard('Delete');
  const removed=await state();assert.ok(!track(removed,created.id)&&!track(removed,newSound.id));
  assert.ok(track(removed,world.id));assert.equal(await js(`!!q('[data-track="'+${JSON.stringify(created.id)}+'"]')`),false);
  await js("command('history.undo')");assert.deepEqual((await state()).tracks,overlay.tracks);
  await js("command('history.redo')");await keyboard('v',true);
  const pasted=await state();
  assert.deepEqual(media(pasted).map(t=>t.id),['front',created.id,'middle','back']);
  assert.notEqual(track(pasted,created.id).clips[0].id,selection);
  assert.equal(track(pasted,created.id).clips[0].mediaLink,track(pasted,newSound.id).clips[0].mediaLink);

  const atCamera=await drop(camera.id,4,'picture',{create:true}),cross=await state();
  const attached=media(cross).find(t=>t.timelineAnchor===camera.id);
  assert.equal(attached.clips[0].start,atCamera);
  const adjacent=()=>js(`q('[data-track="'+${JSON.stringify(camera.id)}+'"]').previousElementSibling?.dataset.track`);
  assert.equal(await adjacent(),attached.id);
  await js("q('#timeline-grouping').click()");assert.equal(await adjacent(),attached.id);
  await load(await snapshot());assert.equal(await adjacent(),attached.id);
  await js("q('[data-track-lock=\"middle\"]').click()");
  const locked=await state();await drop('middle',10,'movie',{blocked:true});assert.deepEqual((await state()).tracks,locked.tracks);

  // The file-manager route imports first and posts exactly one clip at the captured midpoint.
  await load(doc);
  await js(`window.importCount=0;assetAPI.pathForFile=file=>file.name;
    const info=assetAPI.visualInfo;
    assetAPI.visualInfo=a=>a.id==='external-video'?Promise.resolve(a.visual):info(a);
    assetAPI.importDropped=async(paths,projectId)=>{window.importCount++;
      return {assets:[{id:'external-video',projectId,scope:'project',type:'视频',source:paths[0],alias:'拖入文件',
        extension:'.mp4',visual:{kind:'video',width:160,height:90,fps:30,duration:1,hasAudio:false}}],errors:[]};};void 0;`);
  const p=await point('middle',5.5);
  await js(`{const d=new DataTransfer();d.items.add(new File(['fixture'],'external.mp4',{type:'video/mp4'}));
    document.elementFromPoint(${p.x},${p.y}).dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d,clientX:${p.x},clientY:${p.y}}));}`);
  await frames();
  const external=await state(),newLayer=media(external).find(t=>t.clips.some(c=>c.assetId==='external-video'));
  assert.equal(await js('importCount'),1);assert.equal(newLayer.clips[0].start,p.time);
  assert.deepEqual(media(external).map(t=>t.id),['front',newLayer.id,'middle','back']);
  // An empty lane is never needed as a placeholder to add the first clip of its type.
  const fresh=structuredClone(doc);fresh.state.tracks=[world,camera];await load(fresh);
  const click=selector=>js('q('+JSON.stringify(selector)+').click()');
  async function chooseComponent(owner,type){
    await click('[data-object="'+owner+'"]');await click('#add-track');
    await click('[data-component="'+type+'"]');await frames();
  }
  await chooseComponent('ttmr','animation');await click('#modal [data-close]');
  assert.equal((await state()).tracks.length,2);
  await chooseComponent('ttmr','animation');await click('[data-expression-pick="asset-local-idle"]');await frames();
  assert.equal((await state()).tracks.find(t=>t.type==='animation').layerRole,'base');
  await chooseComponent('ttmr','expression');await click('[data-expression-pick="asset-face-motion-fixture_smile_f"]');await frames();
  assert.equal((await state()).tracks.find(t=>t.type==='expression').layerRole,'base');
  for(const [type,asset] of [['scene','scene-classroom'],['audio','sound-a']]){
    const count=(await state()).tracks.length;await chooseComponent('scene',type);
    await click('#track-source-picker-cancel');assert.equal((await state()).tracks.length,count);
    await chooseComponent('scene',type);await click('[data-track-source-pick="'+asset+'"]');
    await js("q('#track-source-picker-apply').onclick()");
    assert.equal((await state()).tracks.find(t=>t.type===type).clips[0].assetId,asset);
  }
  assert.deepEqual((await state()).tracks.filter(t=>!t.clips.length).map(t=>t.id),[world.id]);
  await require('./timeline-clip-move-ui.cjs')({win,js,snapshot,load,doc});
  return 'passed';
};
