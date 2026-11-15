'use strict';
// Lightweight, read-only installation check. Full manifest verification belongs to import.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const inside=(parent,child)=>{const p=path.resolve(parent).toLowerCase(),c=path.resolve(child).toLowerCase();return c===p||c.startsWith(p+path.sep);};
async function validate(input){
 if(typeof input!=='string'||!path.isAbsolute(input))throw Error('请选择游戏安装目录');
 let game;try{game=await fs.realpath(input);if(!(await fs.stat(game)).isDirectory())throw Error();
  if(!(await fs.stat(path.join(game,'gakumas.exe'))).isFile())throw Error();
  if(!(await fs.stat(path.join(game,'gakumas_Data'))).isDirectory())throw Error();
  const base=path.join(game,'octo','pdb');let count=0;
  async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(entry.isDirectory())await walk(path.join(dir,entry.name));else if(entry.isFile()&&entry.name==='octocacheevai')count++;}}
  await walk(base);if(count!==1)throw Error();
 }catch{throw Error('游戏目录不可用或缺少游戏程序、数据目录或唯一清单，请重新选择');}
 return game;
}
function create(dataRoot){
 const config=path.join(dataRoot,'game-directory.json');
 async function status(){let game;try{const value=JSON.parse(await fs.readFile(config,'utf8'));if(typeof value.game!=='string')throw Error();game=value.game;}catch(e){return {state:e.code==='ENOENT'?'missing':'invalid',message:e.code==='ENOENT'?'尚未选择游戏目录':'游戏目录设置无法读取，请重新选择'};}
  try{return {state:'valid',path:await validate(game)};}catch(e){return {state:'invalid',path:game,message:e.message};}}
 async function save(input){const game=await validate(input);let ancestor=path.resolve(dataRoot),realAncestor;while(true){try{realAncestor=await fs.realpath(ancestor);break;}catch(e){if(e.code!=='ENOENT')throw e;const next=path.dirname(ancestor);if(next===ancestor)throw e;ancestor=next;}}
  const resolved=path.resolve(realAncestor,path.relative(ancestor,path.resolve(dataRoot)));if(inside(game,resolved))throw Error('创作器数据目录不能位于游戏目录');
  await fs.mkdir(resolved,{recursive:true});const real=await fs.realpath(resolved);if(inside(game,real))throw Error('创作器数据目录不能位于游戏目录');
  const target=path.join(real,'game-directory.json'),temp=target+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify({game}),{encoding:'utf8',flag:'wx'});try{await fs.rename(temp,target);}catch(e){await fs.unlink(temp).catch(()=>{});throw e;}return game;}
 return {status,save};
}
module.exports={create,validate};
