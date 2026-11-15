param([string]$DataDirectory,[string]$Project)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if ($DataDirectory) { $env:CREATOR_LIBRARY_DIR = [IO.Path]::GetFullPath($DataDirectory) }
$electron = Join-Path $repoRoot 'apps\desktop\electron\node_modules\electron\dist\electron.exe'
$entry = Join-Path $repoRoot 'apps\desktop\electron'
$arguments = @($entry)
if ($Project) { $arguments += @('--project',[IO.Path]::GetFullPath($Project)) }
& $electron @arguments
