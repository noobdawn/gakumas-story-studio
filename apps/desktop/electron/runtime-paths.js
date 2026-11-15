'use strict';
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const root=path.resolve(__dirname,'../../..');
const base=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'GakumasStoryStudio');
const data=()=>{if(process.env.CREATOR_LIBRARY_DIR)return process.env.CREATOR_LIBRARY_DIR;try{const v=JSON.parse(fs.readFileSync(path.join(base,'location.json'),'utf8'));if(typeof v.directory!=='string'||!path.isAbsolute(v.directory))throw Error('数据目录配置无效');return v.directory;}catch(e){if(e.code==='ENOENT')return base;throw e;}};
const host=path.join(root,'services','host'),importer=path.join(root,'services','importer'),ui=path.join(root,'apps','desktop','ui');
const python=()=>process.env.CREATOR_PYTHON||[path.join(root,'runtime','python','python.exe'),path.join(root,'.venv','Scripts','python.exe')].find(fs.existsSync)||'python';
function configure(){process.env.CREATOR_LIBRARY_DIR=data();process.env.CREATOR_APP_ROOT=root;process.env.CREATOR_PYTHON=python();const bin=path.join(root,'runtime','tools');process.env.PATH=bin+path.delimiter+(process.env.PATH||'');}
module.exports={base,root,host,importer,ui,data,python,configure,player:path.join(root,'runtime','player','CreatorPlayer.exe'),common:path.join(root,'resources','common'),voice:()=>path.join(data(),'voice-engines')};
