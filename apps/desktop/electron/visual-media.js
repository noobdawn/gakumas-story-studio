'use strict';
const {spawn,execFile}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const os=require('node:os');
const pending=new Map();
const children=new Set(),waiting=[];let active=0,closed=false;
async function limited(run){if(active<2)active++;else await new Promise(resolve=>waiting.push(resolve));try{if(closed)throw Error('创作器正在关闭');return await run();}finally{if(waiting.length)waiting.shift()();else active--;}}
function stop(child){if(child.exitCode!==null||child.signalCode!==null)return;if(process.platform==='win32'&&child.pid)execFile('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});else child.kill();}
function prepare(file){
 if(pending.has(file))return pending.get(file);
 const task=limited(()=>new Promise((resolve,reject)=>{const bundled=require('./runtime-paths').python();const child=spawn(process.env.CREATOR_PYTHON||(fs.existsSync(bundled)?bundled:'python'),['-X','utf8',path.join(require('./runtime-paths').host,'visual_media.py'),file],{windowsHide:true,stdio:['ignore','pipe','pipe']});children.add(child);let output='',error='',timedOut=false;const timer=setTimeout(()=>{timedOut=true;stop(child);},35*60*1000);child.stdout.on('data',b=>output=(output+b).slice(-100000));child.stderr.on('data',b=>error=(error+b).slice(-5000));child.on('error',e=>{clearTimeout(timer);children.delete(child);reject(e);});child.on('close',code=>{clearTimeout(timer);children.delete(child);if(timedOut)return reject(Error('画面准备超时，请使用较短的视频'));if(code!==0)return reject(Error('画面准备失败：'+error));try{resolve(JSON.parse(output));}catch(e){reject(e);}});})).finally(()=>pending.delete(file));pending.set(file,task);return task;
}
function close(){closed=true;for(const child of children)stop(child);}
module.exports={prepare,close};
