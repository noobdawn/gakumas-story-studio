'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{generate}=require('../batch-lipsync');
test('新口型采用音素时间，保留重叠嘴形并跳过内心',()=>{
 const dur=1,timing={frameRate:100,frameCount:100,phonemes:[{phoneme:'k',startFrame:0,endFrame:10},{phoneme:'a',startFrame:10,endFrame:30},{phoneme:'i',startFrame:40,endFrame:80}]};
 const dialogs=[{id:'a',speaker:'甲',text:'你好',voice:'v1'},{id:'b',speaker:'甲',text:'惊讶',voice:'v2'},{id:'c',speaker:'甲',text:'（想法）',voice:'v3'}],clips=dialogs.map((d,i)=>({id:'c'+i,dialogue:d.id,start:i*3,len:2}));
 const doc={state:{projectId:'p',globalSettings:{fps:30},objects:[{id:'actor',components:[]}],dialogues:dialogs,assets:dialogs.map(d=>({id:d.voice,voiceTiming:timing})),tracks:[{type:'audio',target:'actor',clips},{type:'expression',target:'actor',clips:[{assetId:'asset-face-b_mouth.mouth_007',start:3,len:2}]}]}};
 const result=generate(doc,{'甲':'actor'},{v1:dur,v2:dur,v3:dur});assert.deepEqual(result.created,['a']);assert.equal(result.skipped.length,2);assert.equal(doc.state.tracks.length,2);assert.equal(result.document.state.tracks.length,3);const lip=result.document.state.tracks[2].clips[0];assert.equal(lip.lipSyncSource.audioClipId,'c0');assert.ok(Object.values(lip.propertyKeys).some(k=>k.some(v=>v.value>0)));
});
