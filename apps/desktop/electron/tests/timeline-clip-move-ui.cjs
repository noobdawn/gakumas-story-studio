'use strict';
const assert = require('node:assert/strict');

module.exports = async function ({win,js,snapshot,load,doc}) {
  const project = structuredClone(doc), s = project.state;
  const front=s.tracks.find(t=>t.id==='front'), back=s.tracks.find(t=>t.id==='back');
  const video={id:'moving-video',name:'A 视频',start:2,len:4,assetId:'movie',sourceOffset:.25,mediaLink:'av',
    mediaLayout:{x:.16},mediaKeys:{opacity:[{time:0,value:.7},{time:4,value:1}]}};
  const audio={id:'moving-sound',name:'A 声音',assetId:'movie',start:2,len:4,sourceOffset:.25,mediaLink:'av',volume:.42};
  front.clips=[video];back.clips[0].start=9;
  s.tracks.push({id:'first-sound',type:'audio',name:'一轨视频声音',target:front.target,clips:[audio]});
  const get=async()=>(await snapshot()).state;
  const row=(s,id)=>s.tracks.find(t=>t.clips.some(c=>c.id===id));
  const clip=(s,id)=>row(s,id)?.clips.find(c=>c.id===id);
  const frames=()=>js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const mouse=(type,x,y)=>win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',
    {type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:type==='mouseMoved'?0:1});
  async function drag(id,target,shift=0,cancel=false){
    await js(`q('#tab-timeline').click();
      for(let b=q('[data-group-toggle][aria-expanded="false"]');b;b=q('[data-group-toggle][aria-expanded="false"]'))b.click();
      q('[data-clip="'+${JSON.stringify(id)}+'"]').scrollIntoView({block:'center',inline:'center'});`);
    await frames();
    const start=await js(`(()=>{const el=q('[data-clip="'+${JSON.stringify(id)}+'"]'),r=el.getBoundingClientRect(),lane=q('#ruler').getBoundingClientRect();
      const x=Math.round(r.left+r.width*.42),y=Math.round(r.top+r.height/2);
      return {x,y,id:document.elementFromPoint(x,y)?.closest('[data-clip]')?.dataset.clip,at:(x-lane.left)/lane.width*30};})()`);
    assert.equal(start.id,id,'Mouse must start on the clip body');
    await mouse('mousePressed',start.x,start.y);
    await js(`q('[data-lane="'+${JSON.stringify(target)}+'"]').scrollIntoView({block:'nearest',inline:'nearest'});`);
    await frames();
    const end=await js(`(()=>{const r=q('#ruler').getBoundingClientRect(),t=q('[data-lane="'+${JSON.stringify(target)}+'"]').getBoundingClientRect();
      const x=Math.round(r.left+r.width*${start.at+shift}/30),y=Math.round(t.top+t.height/2);
      return {x,y,id:document.elementFromPoint(x,y)?.closest('[data-track]')?.dataset.track};})()`);
    assert.equal(end.id,target,'Mouse must end on the requested row');
    await mouse('mouseMoved',end.x,end.y);await frames();
    const hint=await js("q('.timeline-asset-drop')?.textContent||''");
    if(cancel)await js("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await mouse('mouseReleased',end.x,end.y);await frames();
    return hint;
  }
  await load(project);
  const original=await get();
  const toThird=await drag(video.id,'back');
  const moved=await get();
  assert.equal(row(moved,video.id)?.id,'back','Vertical drag from the first video track must move A to the third. Hint: '+toThird);
  assert.match(toThird,/back/);
  assert.deepEqual(clip(moved,video.id),video);assert.deepEqual(clip(moved,audio.id),audio);
  assert.equal(row(moved,audio.id).target,back.target);
  assert(!moved.tracks.some(t=>t.id==='front'||t.id==='first-sound'));
  assert.equal(moved.selectedClip,video.id);
  await js("command('history.undo')");assert.deepEqual((await get()).tracks,original.tracks);
  await js("command('history.redo')");assert.deepEqual((await get()).tracks,moved.tracks);
  await load(await snapshot());assert.deepEqual((await get()).tracks,moved.tracks);

  await load(project);
  const over=await drag(video.id,'back',7),collision=await get(),above=row(collision,video.id);
  assert.match(over,/正上方/);assert.equal(collision.tracks[collision.tracks.indexOf(above)+1].id,'back');
  assert(Math.abs(clip(collision,video.id).start-9)<.04);
  assert.equal(clip(collision,audio.id).start,clip(collision,video.id).start);
  assert.deepEqual(collision.tracks.find(t=>t.id==='back').clips,back.clips);
  await js("command('history.undo')");assert.deepEqual((await get()).tracks,original.tracks);

  await drag(video.id,'back',0,true);assert.deepEqual((await get()).tracks,original.tracks);
  await js("q('[data-track-lock=\"back\"]').click()");const locked=await get();
  await drag(video.id,'back',1);assert.deepEqual((await get()).tracks,locked.tracks);
  await js("command('history.undo')");assert.deepEqual((await get()).tracks,original.tracks);
  return 'passed';
};
