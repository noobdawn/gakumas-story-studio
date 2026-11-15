'use strict';
// Windows user-scoped DPAPI is independent of Electron's temporary browser profile.
// Values travel only through anonymous stdin/stdout pipes, never command arguments.
const {spawn}=require('node:child_process');
const script=String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
[Console]::InputEncoding = New-Object Text.UTF8Encoding $false
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($request.mode -eq 'encrypt') {
  $bytes = [Text.Encoding]::UTF8.GetBytes([string]$request.value)
  $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($result))
} elseif ($request.mode -eq 'decrypt') {
  $bytes = [Convert]::FromBase64String([string]$request.value)
  $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($result))
} else { throw 'Invalid mode' }
`;
function execute(mode,value){return new Promise((resolve,reject)=>{
 const p=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});let chunks=[],size=0,settled=false;
 const fail=()=>{if(!settled){settled=true;reject(Error('Windows 用户密钥保护不可用'));}};
 p.on('error',fail);p.stdout.on('data',chunk=>{size+=chunk.length;if(size>16384){p.kill();fail();}else chunks.push(chunk)});p.stderr.resume();p.on('close',code=>{if(settled)return;if(code!==0)return fail();try{const output=Buffer.from(Buffer.concat(chunks).toString('ascii').trim(),'base64');if(!output.length)throw Error();settled=true;resolve(output);}catch{fail();}});p.stdin.on('error',fail);p.stdin.end(JSON.stringify({mode,value}));
});}
async function encrypt(value){return execute('encrypt',value);}
async function decrypt(buffer){return (await execute('decrypt',buffer.toString('base64'))).toString('utf8');}
function isProtected(buffer){return buffer.length>4&&buffer.readUInt32LE(0)===1;}
module.exports={encrypt,decrypt,isProtected};
