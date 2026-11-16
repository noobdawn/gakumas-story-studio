'use strict';
const path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
// Recovery is serialized by an OS mutex; a crashing recoverer cannot leave another disk lock.
async function recover(managed,previous){
 if(process.platform!=='win32')throw Error('当前平台无法安全核对缓存使用进程，已保留占用标记');
 const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 let result;
 try{
  const command='& $env:GSS_LEASE_SCRIPT -ManagedPath $env:GSS_LEASE_PATH -ExpectedPid $env:GSS_LEASE_PID -ExpectedId $env:GSS_LEASE_ID -RequesterPid $env:GSS_LEASE_REQUESTER';
  const operation=run(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,timeout:20000,maxBuffer:16384,env:{...process.env,GSS_LEASE_SCRIPT:path.join(__dirname,'recover-cache-lease.ps1'),GSS_LEASE_PATH:managed,GSS_LEASE_PID:String(previous.pid),GSS_LEASE_ID:previous.id,GSS_LEASE_REQUESTER:String(process.pid)}});
  operation.child.stdin.end();const {stdout}=await operation;
  result=JSON.parse(stdout.trim());
 }catch(cause){throw Error('无法确认缓存是否仍被使用，已保留占用标记，请稍后重试',{cause});}
 if(['recovered','changed','missing'].includes(result.state))return result;
 if(result.state==='active')throw Error('缓存仍被进程 '+result.pid+' 使用，请先关闭对应的创作器或 Player');
 if(result.state==='unknown')throw Error('无法读取可能使用缓存的进程 '+result.pid+'，已保留占用标记');
 throw Error('缓存占用正在核对，请稍后重试');
}
module.exports={recover};
