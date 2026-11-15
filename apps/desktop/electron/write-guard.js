'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const inside=(parent,child)=>{const p=path.resolve(parent).toLowerCase(),c=path.resolve(child).toLowerCase();return c===p||c.startsWith(p+path.sep);};
async function resolvedTarget(target){let ancestor=path.resolve(target);for(;;){try{return path.resolve(await fs.realpath(ancestor),path.relative(ancestor,path.resolve(target)));}catch(e){if(e.code!=='ENOENT')throw e;const next=path.dirname(ancestor);if(next===ancestor)throw e;ancestor=next;}}}
function create(dataRoot){
 async function assertWritable(target){
  if(typeof target!=='string'||!path.isAbsolute(target))throw Error('写入路径无效');
  let value;try{value=JSON.parse(await fs.readFile(path.join(dataRoot,'game-directory.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('游戏目录设置无法读取，请重新选择后再保存');}
  if(value!==undefined&&(!value||typeof value.game!=='string'||!path.isAbsolute(value.game)))throw Error('游戏目录设置无效，请重新选择后再保存');
  const roots=value?[value.game]:[],resolved=await resolvedTarget(target);
  for(const root of roots){let actual;try{actual=await fs.realpath(root);}catch(e){if(e.code!=='ENOENT')throw e;actual=path.resolve(root);}if(inside(root,target)||inside(root,resolved)||inside(actual,resolved))throw Error('不能向只读游戏目录写入');}
  return resolved;
 }
 return {assertWritable};
}
module.exports={create,resolvedTarget};
