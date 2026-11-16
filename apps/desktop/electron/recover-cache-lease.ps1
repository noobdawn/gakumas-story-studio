param([Parameter(Mandatory=$true)][string]$ManagedPath,[Parameter(Mandatory=$true)][int]$ExpectedPid,[Parameter(Mandatory=$true)][string]$ExpectedId,[Parameter(Mandatory=$true)][int]$RequesterPid)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
if($ExpectedPid -le 0 -or $RequesterPid -le 0 -or $ExpectedId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'){throw 'Invalid lease identity'}
$managed=[IO.Path]::GetFullPath($ManagedPath).TrimEnd('\')
$directory=Get-Item -LiteralPath $managed -Force
if(!$directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Invalid cache directory'}
$marker=Get-Content -LiteralPath (Join-Path $managed '.creator-asset-cache.json') -Raw | ConvertFrom-Json
if($marker.format -ne 'gakumas-creator-asset-cache' -or $marker.version -ne 1){throw 'Unrecognized cache'}
$file=Join-Path $managed '.creator-cache.lock'
$hasher=[Security.Cryptography.SHA256]::Create()
try{$key=[BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($managed.ToLowerInvariant()))).Replace('-','')}finally{$hasher.Dispose()}
$mutex=[Threading.Mutex]::new($false,('Global\GSS.CacheLease.'+$key))
$locked=$false
function Uses-Cache([string]$commandLine){
 $normalized=$commandLine.Replace('/','\').ToLowerInvariant()
 if($normalized.Contains($managed.ToLowerInvariant()) -or $normalized.Contains($ManagedPath.TrimEnd('\').Replace('/','\').ToLowerInvariant())){return $true}
 # Windows command lines may use an 8.3 spelling (e.g. ADMINI~1). Normalize
 # absolute arguments as well as matching the original spelling.
 foreach($match in [regex]::Matches($commandLine,'"([^"]*)"|(\S+)')){
  $argument=if($match.Groups[1].Success){$match.Groups[1].Value}else{$match.Groups[2].Value}
  $argument=$argument -replace '^--[^=]+=',''
  if($argument -match '^[a-zA-Z]:[\\/]'){try{if([IO.Path]::GetFullPath($argument).ToLowerInvariant().Contains($managed.ToLowerInvariant())){return $true}}catch{}}
 }
 return $false
}
function Recover-Lease {
 if(!(Test-Path -LiteralPath $file)){return @{state='missing'}}
 $entry=Get-Item -LiteralPath $file -Force
 if($entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Invalid lease file'}
 $original=[IO.File]::ReadAllText($file);$previous=$original | ConvertFrom-Json
 if($previous.pid -ne $ExpectedPid -or $previous.id -ne $ExpectedId){return @{state='changed'}}
 $processes=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine)
 if($processes | Where-Object {$_.ProcessId -eq $ExpectedPid}){return @{state='active';pid=$ExpectedPid}}
 # A dead workbench can leave its host, importer or Player alive. Also catch readers
 # from a different process tree that explicitly opened this cache.
 $descendants=[Collections.Generic.HashSet[int]]::new();[void]$descendants.Add($ExpectedPid)
 do{$added=$false;foreach($record in $processes){if($descendants.Contains([int]$record.ParentProcessId) -and $descendants.Add([int]$record.ProcessId)){$added=$true}}}while($added)
 foreach($record in $processes){
  if($record.ProcessId -eq $PID){continue}
  if($descendants.Contains([int]$record.ProcessId)){return @{state='active';pid=$record.ProcessId}}
  if($record.ProcessId -eq $RequesterPid){continue}
  if($record.CommandLine){
   $command=$record.CommandLine.Replace('/','\').ToLowerInvariant()
   if($record.Name -ieq 'powershell.exe' -and $command.Contains($PSCommandPath.ToLowerInvariant())){continue}
   if(Uses-Cache $record.CommandLine){return @{state='active';pid=$record.ProcessId}}
  }elseif($record.Name -match '^(GSS|electron|CreatorPlayer|Unity|python|pythonw|ffmpeg|vgmstream-cli)\.exe$'){
   return @{state='unknown';pid=$record.ProcessId}
  }
 }
 # All recoverers share the mutex. If another instance acquired a newer lease,
 # its identity differs and must remain untouched.
 if(!(Test-Path -LiteralPath $file)){return @{state='missing'}}
 if([IO.File]::ReadAllText($file) -cne $original){return @{state='changed'}}
 Remove-Item -LiteralPath $file
 return @{state='recovered'}
}
try{
 try{$locked=$mutex.WaitOne(10000)}catch [Threading.AbandonedMutexException]{$locked=$true}
 if($locked){$result=Recover-Lease}else{$result=@{state='busy'}}
 $result | ConvertTo-Json -Compress
}finally{if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()}
