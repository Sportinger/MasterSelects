Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$shortcutName = 'MasterSelects Visitor Tray.lnk'
$startupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$shortcutPath = Join-Path $startupDir $shortcutName

if (Test-Path -LiteralPath $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath -Force
  Write-Host "Startup shortcut removed: $shortcutPath"
} else {
  Write-Host "No startup shortcut found at: $shortcutPath"
}
