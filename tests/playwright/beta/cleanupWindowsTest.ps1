param(
  [Parameter(Mandatory=$true)][string]$ChromeProfile,
  [string]$CaseDirectory,
  [string]$Workspace
)
$ErrorActionPreference = 'Stop'
$betaRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../output/windows-beta')).TrimEnd('\')
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')

function Assert-ChildPath([string]$BaseDirectory, [string]$Candidate) {
  $full = [IO.Path]::GetFullPath($Candidate).TrimEnd('\')
  if (-not $full.StartsWith($BaseDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Cleanup target is outside the permitted directory: $full"
  }
  # Resolve existing ancestors and reject junctions/symlinks before deleting.
  $cursor = $full
  while ($cursor -and $cursor.Length -ge $BaseDirectory.Length) {
    if (Test-Path -LiteralPath $cursor) {
      $item = Get-Item -LiteralPath $cursor -Force
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Cleanup refuses a reparse point: $cursor" }
      if ((Resolve-Path -LiteralPath $cursor).Path -ne $cursor) { throw "Cleanup path did not resolve exactly: $cursor" }
    }
    $cursor = Split-Path -Parent $cursor
  }
  return $full
}

$profile = [IO.Path]::GetFullPath($ChromeProfile).TrimEnd('\')
if ((Split-Path -Parent $profile) -eq $tempRoot -and (Split-Path -Leaf $profile) -like 'masterselects-beta-chrome-*') {
  $profile = Assert-ChildPath $tempRoot $profile
} elseif ($profile.StartsWith($betaRoot + '\', [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $profile) -like 'chrome-*') {
  $profile = Assert-ChildPath $betaRoot $profile
} else { throw 'Cleanup requires an explicitly owned beta-test Chrome profile.' }

$targets = @($profile)
if ($Workspace) {
  $work = [IO.Path]::GetFullPath($Workspace).TrimEnd('\')
  if ((Split-Path -Parent $work) -eq $tempRoot -and (Split-Path -Leaf $work) -like 'ms-beta-work-*') {
    $work = Assert-ChildPath $tempRoot $work
  } elseif ((Split-Path -Parent $work) -eq $betaRoot -and (Split-Path -Leaf $work) -like 'work-*') {
    $work = Assert-ChildPath $betaRoot $work
  } else { throw 'Cleanup requires an explicitly owned beta-test workspace.' }
  $targets += $work
}
if ($CaseDirectory) {
  $case = Assert-ChildPath $betaRoot $CaseDirectory
  foreach ($leaf in @('native-project-root', 'media')) { $targets += Assert-ChildPath $case (Join-Path $case $leaf) }
}

function Get-ProfileProcesses {
  @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object {
    $match = [regex]::Match([string]$_.CommandLine, '(?:"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\s"]+))')
    $value = @($match.Groups[1].Value, $match.Groups[2].Value, $match.Groups[3].Value) | Where-Object { $_ } | Select-Object -First 1
    $value -and [IO.Path]::GetFullPath($value).TrimEnd('\').Equals($profile, [StringComparison]::OrdinalIgnoreCase)
  })
}

# Matching the complete profile argument excludes the user's ordinary Chrome.
$stopped = @()
foreach ($process in (Get-ProfileProcesses)) {
  $live = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ProcessId)"
  if ($live -and $live.CreationDate -eq $process.CreationDate) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    $stopped += $process.ProcessId
  }
}
$deadline = [DateTime]::UtcNow.AddSeconds(10)
while (@(Get-ProfileProcesses).Count -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
if (@(Get-ProfileProcesses).Count) { throw 'Owned Chrome processes remained alive; profile deletion stopped.' }

$removed = @()
foreach ($target in $targets) {
  if (-not (Test-Path -LiteralPath $target)) { continue }
  # Walk without traversing reparse points; never let recursive deletion escape.
  $pending = New-Object 'Collections.Generic.Stack[string]'
  $pending.Push($target)
  while ($pending.Count) {
    foreach ($item in (Get-ChildItem -LiteralPath $pending.Pop() -Force)) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Cleanup refuses a nested reparse point: $($item.FullName)" }
      if ($item.PSIsContainer) { $pending.Push($item.FullName) }
    }
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    try { Remove-Item -LiteralPath $target -Recurse -Force; break }
    catch { if ([DateTime]::UtcNow -ge $deadline) { throw }; Start-Sleep -Milliseconds 150 }
  } while ($true)
  if (Test-Path -LiteralPath $target) { throw "Cleanup did not remove $target" }
  $removed += $target
}
@{ stoppedProcessIds = $stopped; removedDirectories = $removed; verified = $true } | ConvertTo-Json -Compress
