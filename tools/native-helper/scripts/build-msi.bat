@echo off
REM ============================================================
REM  Build MSI installer for MasterSelects Native Helper
REM
REM  Prerequisites:
REM    - WiX Toolset v6 dotnet tool, or cargo-wix:
REM        dotnet tool install --global wix
REM        wix extension add WixToolset.UI.wixext
REM      Optional legacy path:
REM        cargo install cargo-wix
REM ============================================================

setlocal enabledelayedexpansion

set "PROJECT_DIR=%~dp0.."
cd /d "%PROJECT_DIR%"

for /f "tokens=3 delims= " %%v in ('findstr /b /c:"version = " Cargo.toml') do (
    if not defined HELPER_VERSION set "HELPER_VERSION=%%~v"
)
if "%HELPER_VERSION%"=="" (
    echo ERROR: Could not read helper version from Cargo.toml
    exit /b 1
)

echo.
echo ========================================
echo  MasterSelects Helper - MSI Build
echo  Version: %HELPER_VERSION%
echo ========================================
echo.

REM --- Step 1: Build release binary ---
echo [1/4] Building release binary...
cargo build --release
if errorlevel 1 (
    echo ERROR: cargo build failed!
    exit /b 1
)
echo       OK

REM --- Step 2: Download bundled yt-dlp ---
set "RELEASE_DIR=target\release"
set "YTDLP_EXE=%RELEASE_DIR%\yt-dlp.exe"
set "YTDLP_URL=https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"

echo [2/4] Preparing bundled yt-dlp...
if not exist "%YTDLP_EXE%" (
    echo       Downloading %YTDLP_URL%
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%YTDLP_URL%' -OutFile '%YTDLP_EXE%'"
    if errorlevel 1 (
        echo ERROR: Failed to download yt-dlp.exe
        exit /b 1
    )
) else (
    echo       Reusing existing %YTDLP_EXE%
)

"%YTDLP_EXE%" --version >nul 2>nul
if errorlevel 1 (
    echo ERROR: Bundled yt-dlp.exe is not executable: %YTDLP_EXE%
    exit /b 1
)
echo       OK

REM --- Step 3: Verify release payload ---
echo [3/4] Verifying release payload...
if not exist "%RELEASE_DIR%\masterselects-helper.exe" (
    echo ERROR: Missing release binary: %RELEASE_DIR%\masterselects-helper.exe
    exit /b 1
)
if not exist "%YTDLP_EXE%" (
    echo ERROR: Missing bundled dependency: %YTDLP_EXE%
    exit /b 1
)
echo       OK

REM --- Build MSI ---
echo [4/4] Building MSI installer...
if not exist "target\wix" mkdir "target\wix"

cargo wix --version >nul 2>nul
if not errorlevel 1 (
    echo Building MSI installer with cargo-wix...
    cargo wix --no-build --nocapture
    if errorlevel 1 (
        echo ERROR: cargo wix failed!
        exit /b 1
    )
) else (
    where wix >nul 2>nul
    if errorlevel 1 (
        echo ERROR: Neither cargo-wix nor wix.exe was found.
        echo        Install WiX with: dotnet tool install --global wix
        echo        Then install UI extension: wix extension add WixToolset.UI.wixext
        exit /b 1
    )

    echo Building MSI installer with WiX Toolset...
    wix build wix\main.wxs -ext WixToolset.UI.wixext -d Version=%HELPER_VERSION% -arch x64 -out target\wix\MasterSelects-NativeHelper-v%HELPER_VERSION%-windows-x64.msi
    if errorlevel 1 (
        echo ERROR: wix build failed!
        exit /b 1
    )
)

echo.
echo ========================================
echo  MSI built successfully!
echo  Output: target\wix\*.msi
echo ========================================
echo.

dir /b target\wix\*.msi 2>nul
