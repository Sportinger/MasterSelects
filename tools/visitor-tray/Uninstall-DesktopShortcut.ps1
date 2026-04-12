Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$shortcutName = 'MasterSelects Visitor Tray.lnk'
$desktopDir = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopDir $shortcutName

if (Test-Path -LiteralPath $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath -Force
  Write-Host "Desktop shortcut removed: $shortcutPath"
} else {
  Write-Host "No desktop shortcut found at: $shortcutPath"
}
