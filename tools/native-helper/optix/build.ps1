param(
  [string]$OptixSdk = "$env:TEMP/masterselects-optix-sdk-9.1",
  [string]$OutputDirectory = "$PSScriptRoot/../target/debug"
)
$ErrorActionPreference = 'Stop'
# SDK stays outside the public source tree. Install NVIDIA's official optix-dev v9.1.0 headers separately.
if (!(Test-Path "$OptixSdk/include/optix.h")) { throw 'Set -OptixSdk to an OptiX 9.1 headers checkout (github.com/NVIDIA/optix-dev, v9.1.0).' }
if (!(Test-Path "$env:CUDA_PATH/bin/nvcc.exe")) { throw 'CUDA Toolkit with nvcc is required.' }
$vswhere = "${env:ProgramFiles(x86)}/Microsoft Visual Studio/Installer/vswhere.exe"
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vs) { throw 'Visual Studio C++ Build Tools are required.' }
# Import the compiler environment without passing file operations between shells.
$environment = & cmd.exe /d /c "call `"$vs/VC/Auxiliary/Build/vcvars64.bat`" >nul && set"
if ($LASTEXITCODE) { throw 'Cannot initialize the MSVC environment.' }
foreach ($line in $environment) { if ($line -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1],$matches[2],'Process') } }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$out = (Resolve-Path $OutputDirectory).Path
& "$env:CUDA_PATH/bin/nvcc.exe" --ptx --std=c++17 --gpu-architecture=compute_89 --fmad=false --allow-unsupported-compiler -I "$OptixSdk/include" "$PSScriptRoot/path.cu" -o "$out/masterselects-optix.ptx"
if ($LASTEXITCODE) { throw 'CUDA device compilation failed.' }
& cl.exe /nologo /std:c++17 /EHsc /O2 /MD /DNOMINMAX /I "$OptixSdk/include" /I "$env:CUDA_PATH/include" "$PSScriptRoot/renderer.cpp" "/Fo$out/optix-renderer.obj" "/Fe$out/masterselects-optix.exe" /link "/LIBPATH:$env:CUDA_PATH/lib/x64" cudart.lib cuda.lib Advapi32.lib
if ($LASTEXITCODE) { throw 'OptiX host compilation failed.' }
Write-Output "Built $out/masterselects-optix.exe"
