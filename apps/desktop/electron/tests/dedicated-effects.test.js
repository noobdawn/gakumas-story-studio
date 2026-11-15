const test=require('node:test'),assert=require('node:assert/strict'),P=require('../../ui/post-effects'),C=require('../../ui/composition');
test('each algorithm carries its own schema through all scopes',()=>{
 for(const type of Object.keys(P.schemas))for(const scope of ['below','clips','categories']){
  const v={...P.visual(type),scope,targets:['background'],clipIds:['picture']},clip={id:'fx',name:'fx',start:0,len:5,visualEffect:v};
  const s={compositionVersion:1,transitions:[],objects:[],dialogues:[],tracks:[{id:'fx',type:P.trackType(type),clips:[clip]},{id:'media',type:'media',clips:[{id:'picture',start:0,len:5}]}]};
  P.validate(s);const node=C.packet(s,2).nodes,packet=P.packet(s,2),layers=scope==='categories'?packet.targets[0].layers:scope==='clips'?node[0].effects:node.at(-1).effects;
  assert.equal(layers[0].effectVersion,2);assert.equal(layers[0].effectType,type);assert.deepEqual(layers[0].parameters,v.parameters);assert.equal(layers[0].saturation,undefined);
 }
});
test('unknown, missing, extra, non-finite and out-of-range algorithm parameters rejected',()=>{
 for(const type of Object.keys(P.schemas))for(const mutate of [v=>v.effectType='oops',v=>v.preset='oops',v=>delete v.parameters[Object.keys(v.parameters)[0]],v=>v.parameters.unused=1,v=>v.parameters[Object.keys(v.parameters)[0]]=Infinity,v=>v.parameters[Object.keys(v.parameters)[0]]=-1]){const v=P.visual(type);mutate(v);assert.throws(()=>P.validateVisual(v));}
});
test('new effects survive JSON roundtrip without generic toggle data',()=>{for(const type of Object.keys(P.schemas)){const v=JSON.parse(JSON.stringify(P.visual(type)));P.validateVisual(v);assert.equal(v.disabled,undefined);assert.deepEqual(Object.keys(v.parameters),Object.keys(P.schemas[type]));}});
