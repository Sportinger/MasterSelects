Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$shortcutName = 'MasterSelects Visitor Tray.lnk'
$desktopDir = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopDir $shortcutName
$toolRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherPath = (Resolve-Path (Join-Path $toolRoot 'start.vbs')).Path
$iconPath = (Resolve-Path (Join-Path $toolRoot '..\..\masterselects.ico')).Path

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = (Join-Path $env:WINDIR 'System32\wscript.exe')
$shortcut.Arguments = ('"{0}"' -f $launcherPath)
$shortcut.WorkingDirectory = $toolRoot
$shortcut.IconLocation = $iconPath
$shortcut.Description = 'MasterSelects visitor tray notifier'
$shortcut.Save()

Write-Host "Desktop shortcut created: $shortcutPath"
