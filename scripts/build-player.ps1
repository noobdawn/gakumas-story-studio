param([Parameter(Mandatory)][string]$Unity,[Parameter(Mandatory)][string]$Output,[string]$Report)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$project = Join-Path $repoRoot 'unity\CreatorPlayer'
if (!$Report) { $Report = Join-Path $repoRoot '.local\build' }
$Output = [IO.Path]::GetFullPath($Output)
$occupied = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Unity.exe' -and $_.CommandLine -like ('*' + $project + '*') }
if ($occupied) { throw 'Unity project is open; close it before building.' }
if (Test-Path -LiteralPath $Output) { throw 'Choose a new output directory.' }
New-Item -ItemType Directory -Path $Report -Force | Out-Null
$env:GSS_PLAYER_OUTPUT = $Output
$env:GSS_CHECK_REPORT = Join-Path $Report 'unity-checks.json'
$process = Start-Process -FilePath $Unity -ArgumentList @('-batchmode','-force-d3d11','-buildTarget','Win64','-projectPath',('"'+$project+'"'),'-executeMethod','CreatorBuild.Run','-logFile',('"'+(Join-Path $Report 'unity.log')+'"')) -WindowStyle Hidden -PassThru
# Wait for this Editor, not the inherited Windows job and unrelated helpers.
$process.WaitForExit()
if ($process.ExitCode -ne 0) { throw "Unity build failed: $($process.ExitCode)" }
if (!(Select-String -LiteralPath (Join-Path $Output 'build-report.txt') -Pattern '^errors=0$')) { throw 'Build report is not clean' }
