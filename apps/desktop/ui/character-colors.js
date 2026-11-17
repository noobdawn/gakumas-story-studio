(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.CreatorCharacterColors=api;})(globalThis,()=>{
 'use strict';
 // ADVCharacterSettingAsset / CharacterData.gradientColor1, gradientColor2,
 // labelTextColor. These are dialogue gradients, not the website theme colors.
 // Source and extraction notes: docs/developer/character-colors.md.
 const presets={
  ttmr:['#26b4eb','#87e9e2','#ffffff','月村手毬','月村手球','月村手鞠','手毬','手球','手鞠','てまり','Temari'],
  hski:['#ff5064','#ffbba7','#ffffff','花海咲季','咲季','Saki'],
  fktn:['#f8d721','#ffb5da','#333333','藤田ことね','藤田琴音','ことね','琴音','Kotone'],
  amao:['#c45dc9','#fdafa6','#ffffff','有村麻央','麻央','Mao'],
  kllj:['#d2e3e5','#94ccd9','#333333','葛城リーリヤ','葛城莉莉娅','リーリヤ','莉莉娅','Lilja'],
  kcna:['#ff8a22','#ff5d57','#ffffff','倉本千奈','仓本千奈','千奈','China'],
  ssmk:['#92de5a','#cee21d','#333333','紫雲清夏','紫云清夏','清夏','Sumika'],
  shro:['#00bed8','#577dff','#ffffff','篠澤広','篠泽广','篠泽広','Hiro'],
  hrnm:['#fd7ec2','#f4b9ff','#ffffff','姫崎莉波','姬崎莉波','莉波','Rinami'],
  hume:['#f74b2c','#f0cb4f','#ffffff','花海佑芽','佑芽','Ume'],
  jsna:['#ffad29','#f5eb6e','#333333','十王星南','星南','Sena'],
  hmsz:['#6ea4fc','#d4afff','#ffffff','秦谷美鈴','秦谷美铃','美鈴','美铃','Misuzu'],
  atbm:['#8874ff','#c8baff','#ffffff','雨夜燕','Tsubame'],
  nasr:['#988d83','#988d83','#ffffff','根緒亜紗里','根绪亚纱里','根绪亚沙里','あさり先生','Asari'],
  // No dedicated entry in the verified settings; use the game's otherCharacter.
  krnh:['#988d83','#988d83','#ffffff','賀陽燐羽','贺阳燐羽','燐羽','りんは','Rinha'],
 };
 const neutral=['#988d83','#988d83','#ffffff'];
 const valid=x=>typeof x==='string'&&/^#[0-9a-f]{6}$/i.test(x);
 const custom=a=>valid(a?.nameColor)&&valid(a?.nameColorEnd);
 const normalize=x=>String(x||'').replace(/\s/g,'').toLowerCase();
 function code(a){const id=a?.assetId||a?.id;return id==='asset-actor-1'?'ttmr':id?.startsWith('asset-actor-')?id.slice(12):null;}
 function defaults(a){return (presets[code(a)]||neutral).slice(0,2);}
 function colors(a){return custom(a)?[a.nameColor,a.nameColorEnd]:defaults(a);}
 function character(s,speaker){
  const name=normalize(speaker);if(!name)return null;
  const assets=(s.assets||[]).filter(a=>a.type==='角色');
  const ids=new Set(assets.filter(a=>[a.alias,a.source].some(n=>n&&normalize(n)===name)).map(a=>a.id));
  for(const o of s.objects||[])if(o.type==='角色'&&normalize(o.name)===name)ids.add(o.assetId||(o.id==='ttmr'?'asset-actor-1':null));
  ids.delete(null);ids.delete(undefined);
  if(ids.size>1)return null;
  let id=[...ids][0];
  if(!id){const entry=Object.entries(presets).find(([c,p])=>[c,...p.slice(3)].some(n=>normalize(n)===name));if(entry)id=entry[0]==='ttmr'?'asset-actor-1':'asset-actor-'+entry[0];}
  return id?(assets.find(a=>a.id===id)||{id,type:'角色'}):null;
 }
 function resolve(s,d){return custom(d)?[d.nameColor,d.nameColorEnd]:colors(character(s,d?.speaker));}
 function contrast(pair){const luminance=hex=>{const v=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];};return (luminance(pair[0])+luminance(pair[1]))/2>.4?'#333333':'#ffffff';}
 function label(s,d){const a=character(s,d?.speaker);return custom(d)||custom(a)?contrast(resolve(s,d)):(presets[code(a)]||neutral)[2];}
 function set(s,a,left,right){
  if(a?.type!=='角色')throw Error('仅角色素材支持姓名条颜色');
  const reset=left===null&&right===null;if(!reset&&(!valid(left)||!valid(right)))throw Error('姓名条颜色须为六位十六进制颜色');
  let target=s.assets.find(x=>x.id===a.id);
  if(reset){if(!target||target.nameColor===undefined&&target.nameColorEnd===undefined)return false;delete target.nameColor;delete target.nameColorEnd;return true;}
  if(target?.nameColor===left&&target?.nameColorEnd===right)return false;
  if(!target){target={...a};s.assets.push(target);}target.nameColor=left;target.nameColorEnd=right;return true;
 }
 return {valid,custom,code,defaults,colors,character,resolve,label,contrast,set};
});
