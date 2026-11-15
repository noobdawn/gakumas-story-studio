param([string]$DataDirectory,[string]$Project)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if ($DataDirectory) { $env:CREATOR_LIBRARY_DIR = [IO.Path]::GetFullPath($DataDirectory) }
$electron = Join-Path $repoRoot 'build\GSS.exe'
if (!(Test-Path -LiteralPath $electron)) {throw 'Build missing. Run scripts/update-build.ps1 first.'}
$arguments = @()
if ($Project) { $arguments += @('--project',[IO.Path]::GetFullPath($Project)) }
& $electron @arguments
