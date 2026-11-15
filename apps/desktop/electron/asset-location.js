'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const safeName=x=>typeof x==='string'&&/^[A-Za-z0-9_.-]+$/.test(x)&&!x.includes('..');
async function containedFile(root,file){
 const base=await fs.realpath(root),real=await fs.realpath(path.resolve(base,file)),relative=path.relative(base,real);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!(await fs.stat(real)).isFile())throw Error('素材文件不在当前资源目录内');return real;
}
function create({catalog,mediaFile,filmEntries,reveal}){
 let cachedRoot=null,rows=[];
 async function json(root,rel){return JSON.parse(await fs.readFile(await containedFile(root,rel),'utf8'));}
 async function resolve(a){
  if(!a||typeof a.id!=='string')throw Error('素材标识无效');
  if(a.scope)return mediaFile(a);
  if(a.voiceProvider||a.effectKind||a.id.startsWith('effect-'))throw Error('此素材由音源服务或内置预设提供，没有独立素材文件');
  if(a.filmCatalogId)return (await filmEntries([a.filmCatalogId]))[0].file;
  const root=catalog();if(!root)throw Error('当前解包批次未启用，请先准备资源');
  if(a.id.startsWith('asset-face-motion-')){const dir='player-view/face-effects/face-animation',data=await json(root,dir+'/catalog.json'),row=data.motions?.find(r=>r.id===a.id);if(!row)throw Error('当前批次没有该面部动画');return containedFile(root,row.file?dir+'/clips/'+row.file:dir+'/catalog.json');}
  if(a.sceneId?.startsWith('2d-')){const source=a.sceneId.slice(3);if(!safeName(source))throw Error('场景标识无效');return containedFile(root,'player-view/backgrounds/'+source+'.png');}
  if(a.type==='表情'&&!a.id.startsWith('asset-face-motion-')){
    const source=a.source||'';let file;
    if(/^b_(brow|eye|iris|mouth)\.[a-z]+_\d{3}$/.test(source))file='face/mdl_chr_ttmr-base-0000_face.json';
    else if(source.startsWith('decal.'))file='player-view/face-effects/face-decals/ttmr.json';
    else if(source.startsWith('bone.'))file='player-view/face-effects/face-bones/ttmr.json';
    else if(/^eyeMaterial\.[A-Za-z]+$/.test(source))file='player-view/face-effects/eye-materials/ttmr-'+source.split('.')[1]+'.json';
    else if(/^effect\.(Gloom|Drool)$/.test(source))file='player-view/face-effects/head-effects/ttmr-'+source.split('.')[1]+'.bundle';
    else if(source==='effect.RoundEyes')file='player-view/face-effects/round-eyes/ttmr-l.bundle';
    if(file)return containedFile(root,file);
  }
  if(a.type==='UI')return containedFile(root,'player-view/ui-transitions-v2/catalog.json');
  if(cachedRoot!==root){rows=(await fs.readFile(await containedFile(root,'bundles.jsonl'),'utf8')).split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));cachedRoot=root;}
  let source=a.source;
  if(a.type==='角色'){const code=a.id==='asset-actor-1'?'ttmr':a.id.replace(/^asset-actor-/,'');if(!/^[a-z]{4}$/.test(code))throw Error('角色标识无效');source='mdl_chr_'+code+'-base-0000_face';}
  const row=rows.find(r=>r.name===source||r.clips?.some(c=>c.name===source));
  if(row)return containedFile(root,a.type==='动作'&&row.exposed?row.exposed:row.file);
  if(a.type==='动作'){const data=await json(root,'player-view/animation-layers-v1/catalog.json'),item=data.builtinMotions?.find(r=>'asset-'+r.id===a.id);if(item)return containedFile(root,'player-view/animation-layers-v1/'+item.file);}
  throw Error('当前解包批次未找到该素材的文件');
 }
 async function open(a){const file=await resolve(a);await reveal(file);return {file};}
 return {resolve,open};
}
module.exports={create,containedFile};
