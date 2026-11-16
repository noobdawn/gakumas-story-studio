param([Parameter(Mandatory)][string]$Output)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$nativeSource = Join-Path $repoRoot 'native/gpu-export'
$outputPath = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $outputPath) { throw 'Choose a new native build directory.' }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$installation) { throw 'Visual Studio x64 C++ tools are required.' }
$toolchain = (Get-ChildItem -LiteralPath (Join-Path $installation 'VC/Tools/MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName
$kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10'
$sdk = (Get-ChildItem -LiteralPath (Join-Path $kits 'Lib') -Directory | Sort-Object Name -Descending | Select-Object -First 1).Name
$compiler = Join-Path $toolchain 'bin/Hostx64/x64/cl.exe'
$env:PATH = (Split-Path -Parent $compiler) + ';' + $env:PATH
$env:INCLUDE = (Join-Path $toolchain 'include') + ';' + ((@('ucrt','shared','um','winrt') | ForEach-Object { Join-Path $kits "Include/$sdk/$_" }) -join ';')
$env:LIB = (Join-Path $toolchain 'lib/x64') + ';' + (Join-Path $kits "Lib/$sdk/ucrt/x64") + ';' + (Join-Path $kits "Lib/$sdk/um/x64")
New-Item -ItemType Directory -Path $outputPath | Out-Null
Push-Location $outputPath
try {
 & $compiler /nologo /std:c++17 /O2 /EHsc /MD /LD /W4 /utf-8 (Join-Path $nativeSource 'GssGpuExport.cpp') /link d3d11.lib dxgi.lib /OUT:GSSGpuExport.dll
 if ($LASTEXITCODE -ne 0) { throw 'Native GPU export build failed.' }
} finally { Pop-Location }
