param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
& $Python -m venv (Join-Path $repoRoot '.venv')
if ($LASTEXITCODE) { throw 'Python environment creation failed' }
$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'
& $venvPython -m pip install -r (Join-Path $repoRoot 'requirements-lock.txt')
if ($LASTEXITCODE) { throw 'Python dependency installation failed' }
Push-Location (Join-Path $repoRoot 'apps\desktop\electron')
try { npm.cmd ci; if ($LASTEXITCODE) { throw 'npm ci failed' } } finally { Pop-Location }
Write-Host 'Dependencies ready. Build the Player before starting the workbench.'
