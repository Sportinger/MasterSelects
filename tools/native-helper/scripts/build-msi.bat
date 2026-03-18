@echo off
REM ============================================================
REM  Build MSI installer for MasterSelects Native Helper
REM
REM  Prerequisites:
REM    - WiX Toolset v3: winget install WiXToolset.WiXToolset
REM    - cargo-wix:      cargo install cargo-wix
REM ============================================================

setlocal enabledelayedexpansion

set "PROJECT_DIR=%~dp0.."
cd /d "%PROJECT_DIR%"

echo.
echo ========================================
echo  MasterSelects Helper - MSI Build
echo ========================================
echo.

REM --- Step 1: Build release binary ---
echo [1/3] Building release binary...
cargo build --release
if errorlevel 1 (
    echo ERROR: cargo build failed!
    exit /b 1
)
echo       OK

REM --- Step 2: Verify release payload ---
echo [2/2] Verifying release payload...
set "RELEASE_DIR=target\release"

if not exist "%RELEASE_DIR%\masterselects-helper.exe" (
    echo ERROR: Missing release binary: %RELEASE_DIR%\masterselects-helper.exe
    exit /b 1
)
echo       OK

REM --- Build MSI ---
echo Building MSI installer...
cargo wix --no-build --nocapture
if errorlevel 1 (
    echo ERROR: cargo wix failed!
    exit /b 1
)

echo.
echo ========================================
echo  MSI built successfully!
echo  Output: target\wix\*.msi
echo ========================================
echo.

dir /b target\wix\*.msi 2>nul
