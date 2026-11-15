param([Parameter(Mandatory)][string]$Unity,[string]$Message='Update local build',[string]$Tools,[string]$PythonRuntime)
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$build=Join-Path $repoRoot 'build'
$venv=Join-Path $repoRoot '.venv/Scripts/python.exe'
if (!(Test-Path -LiteralPath $venv)) {throw 'Run scripts/bootstrap.ps1 first.'}
if (!$Tools) {$Tools=Join-Path $build 'runtime/tools'}
if (!$PythonRuntime) {$PythonRuntime=Join-Path $build 'runtime/python'}
function AssertLocalPath([string]$target) {
 $resolved=[IO.Path]::GetFullPath($target)
 if(!$resolved.StartsWith($repoRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Target escapes the repository'}
 $ancestor=$resolved
 while($ancestor) {
  if(Test-Path -LiteralPath $ancestor){if((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Build paths cannot pass through links'}}
  if($ancestor -eq $repoRoot){break}
  $ancestor=Split-Path -Parent $ancestor
 }
}
function AssertIdle {
 $active=Get-CimInstance Win32_Process | Where-Object {
  ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($build+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) -or
  ($_.Name -eq 'Unity.exe' -and $_.CommandLine -like ('*'+(Join-Path $repoRoot 'unity/CreatorPlayer')+'*'))
 }
 if ($active) {throw 'Close the current build and its Unity source project before updating.'}
}
function RemoveStage([string]$target) {
 AssertLocalPath $target
 $resolved=[IO.Path]::GetFullPath($target)
 $allowed=Join-Path $repoRoot '.local'
 if (!$resolved.StartsWith($allowed+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {throw 'Unexpected staging path'}
 if (Test-Path -LiteralPath $resolved) {Remove-Item -LiteralPath $resolved -Recurse -Force}
}
AssertIdle
$stage=Join-Path $repoRoot ('.local/build-'+[guid]::NewGuid().ToString('N'))
$candidate=Join-Path $stage 'candidate'
$previous=Join-Path $stage 'previous'
foreach($target in @($build,$stage,$candidate,$previous)){AssertLocalPath $target}
New-Item -ItemType Directory -Path $stage | Out-Null
$promoted=$false
try {
 $env:PATH="$Tools;$env:PATH"
 & $venv (Join-Path $PSScriptRoot 'check.py');if($LASTEXITCODE){throw 'Source checks failed'}
 Push-Location $repoRoot
 try {node --test apps/desktop/electron/tests/*.test.js;if($LASTEXITCODE){throw 'Node checks failed'}} finally {Pop-Location}
 Push-Location (Join-Path $repoRoot 'services/host')
 try {& $venv -m unittest discover -v;if($LASTEXITCODE){throw 'Python checks failed'}} finally {Pop-Location}
 & (Join-Path $PSScriptRoot 'build-player.ps1') -Unity $Unity -Output (Join-Path $stage 'player') -Report (Join-Path $stage 'report')
 & $venv (Join-Path $PSScriptRoot 'package.py') --python $PythonRuntime --tools $Tools --player (Join-Path $stage 'player') --output $candidate --no-archive
 if($LASTEXITCODE){throw 'Package failed'}
 & $venv (Join-Path $PSScriptRoot 'verify-package.py') $candidate;if($LASTEXITCODE){throw 'Portable check failed'}
 & $venv (Join-Path $PSScriptRoot 'checkpoint.py') --message $Message;if($LASTEXITCODE){throw 'Source checkpoint failed'}
 AssertIdle
 foreach($target in @($build,$candidate,$previous)){AssertLocalPath $target}
 if (Test-Path -LiteralPath $build) {Move-Item -LiteralPath $build -Destination $previous}
 try {Move-Item -LiteralPath $candidate -Destination $build;$promoted=$true}
 catch {if(Test-Path -LiteralPath $previous){Move-Item -LiteralPath $previous -Destination $build};throw}
 Write-Host "Verified build ready: $build/GSS.exe"
} finally {
 $report=Join-Path $repoRoot '.local/last-build-report'
 if(Test-Path -LiteralPath (Join-Path $stage 'report')) {
  if(Test-Path -LiteralPath $report){RemoveStage $report}
  Move-Item -LiteralPath (Join-Path $stage 'report') -Destination $report
 }
 # Failed builds keep the previous usable build; there is no accumulating version archive.
 if(!(Test-Path -LiteralPath $previous) -or $promoted){RemoveStage $stage}
}
