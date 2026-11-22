param([string]$Unity,[string]$Message='Update local build',[string]$Tools,[string]$PythonRuntime,[switch]$ReusePlayer,[switch]$StagedCheckpoint)
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$build=Join-Path $repoRoot 'build'
$checkPython=Join-Path $repoRoot '.venv/Scripts/python.exe'
if (!(Test-Path -LiteralPath $checkPython)) {$checkPython=Join-Path $build 'runtime/python/python.exe'}
if (!(Test-Path -LiteralPath $checkPython)) {throw 'Run scripts/bootstrap.ps1 first.'}
if (!$ReusePlayer -and !$Unity) {throw 'Specify -Unity, or -ReusePlayer for desktop/host-only updates.'}
if ($ReusePlayer) {
 $unityChanges=git -C $repoRoot status --porcelain -- unity
 if($LASTEXITCODE -or $unityChanges){throw 'Commit and rebuild Unity changes before reusing a Player.'}
 if(!(Test-Path -LiteralPath (Join-Path $build 'runtime/player/creator-dedicated-effects-v2'))){throw 'No existing compatible Player to reuse.'}
 if(!(Test-Path -LiteralPath (Join-Path $build 'runtime/player/creator-thought-filter-v1'))){throw 'Rebuild Player to include the thought vignette filter.'}
}
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
$previousLibrary=$env:CREATOR_LIBRARY_DIR
$previousPath=$env:PATH
$previousUITemp=$env:GSS_UI_CHECK_TEMP
try {
 $env:PATH="$Tools;$env:PATH"
 $env:CREATOR_LIBRARY_DIR=Join-Path $stage 'test-data'
 & $checkPython (Join-Path $PSScriptRoot 'check.py');if($LASTEXITCODE){throw 'Source checks failed'}
 Push-Location $repoRoot
 try {node --test --test-concurrency=1 apps/desktop/electron/tests/*.test.js;if($LASTEXITCODE){throw 'Node checks failed'}} finally {Pop-Location}
 Push-Location (Join-Path $repoRoot 'services/host')
 try {& $checkPython -m unittest discover -v;if($LASTEXITCODE){throw 'Python checks failed'}} finally {Pop-Location}
 $reportPath=Join-Path $stage 'report'
 New-Item -ItemType Directory -Path $reportPath -Force | Out-Null
 $electron=Join-Path $repoRoot 'apps/desktop/electron/node_modules/electron/dist/electron.exe'
 $harness=Join-Path $repoRoot 'apps/desktop/electron/tests/ui-layout-check.cjs'
 $env:GSS_UI_CHECK_TEMP=Join-Path $stage 'ui-test'
 New-Item -ItemType Directory -Path $env:GSS_UI_CHECK_TEMP | Out-Null
 $uiCheck=Start-Process -FilePath $electron -ArgumentList ('"'+$harness+'"') -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $reportPath 'ui-check.log') -RedirectStandardError (Join-Path $reportPath 'ui-check-error.log')
 if($uiCheck.ExitCode){throw 'Headless UI layout checks failed'}
 $codeHarness=Join-Path $repoRoot 'apps/desktop/electron/tests/code-ui-check.cjs'
 $codeCheck=Start-Process -FilePath $electron -ArgumentList ('"'+$codeHarness+'"') -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $reportPath 'code-ui-check.log') -RedirectStandardError (Join-Path $reportPath 'code-ui-check-error.log')
 if($codeCheck.ExitCode){throw 'Code UI rendering checks failed'}
 $pickerHarness=Join-Path $repoRoot 'apps/desktop/electron/tests/color-picker-check.cjs'
 $pickerCheck=Start-Process -FilePath $electron -ArgumentList ('"'+$pickerHarness+'"') -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $reportPath 'color-picker-check.log') -RedirectStandardError (Join-Path $reportPath 'color-picker-check-error.log')
 if($pickerCheck.ExitCode){throw 'Headless color picker checks failed'}
 if($ReusePlayer){$player=Join-Path $build 'runtime/player';Set-Content -LiteralPath (Join-Path $reportPath 'player.txt') -Value 'Reused existing Player; desktop/host-only update.'}
 else { $player=Join-Path $stage 'player'; & (Join-Path $PSScriptRoot 'build-player.ps1') -Unity $Unity -Output $player -Report $reportPath -GpuExportPrototype }
 & $checkPython (Join-Path $PSScriptRoot 'package.py') --python $PythonRuntime --tools $Tools --player $player --output $candidate --no-archive
 if($LASTEXITCODE){throw 'Package failed'}
 & $checkPython (Join-Path $PSScriptRoot 'verify-package.py') $candidate;if($LASTEXITCODE){throw 'Portable check failed'}
 $checkpointArgs=@('--message',$Message)
 if($StagedCheckpoint){$checkpointArgs+='--staged'}
 & $checkPython (Join-Path $PSScriptRoot 'checkpoint.py') @checkpointArgs;if($LASTEXITCODE){throw 'Source checkpoint failed'}
 AssertIdle
 foreach($target in @($build,$candidate,$previous)){AssertLocalPath $target}
 if (Test-Path -LiteralPath $build) {Move-Item -LiteralPath $build -Destination $previous}
 try {Move-Item -LiteralPath $candidate -Destination $build;$promoted=$true}
 catch {if(Test-Path -LiteralPath $previous){Move-Item -LiteralPath $previous -Destination $build};throw}
 Write-Host "Verified build ready: $build/GSS.exe"
} finally {
 $env:CREATOR_LIBRARY_DIR=$previousLibrary
 $env:PATH=$previousPath
 $env:GSS_UI_CHECK_TEMP=$previousUITemp
 $report=Join-Path $repoRoot '.local/last-build-report'
 if(Test-Path -LiteralPath (Join-Path $stage 'report')) {
  if(Test-Path -LiteralPath $report){RemoveStage $report}
  Move-Item -LiteralPath (Join-Path $stage 'report') -Destination $report
 }
 # Failed builds keep the previous usable build; there is no accumulating version archive.
 if(!(Test-Path -LiteralPath $previous) -or $promoted){RemoveStage $stage}
}
