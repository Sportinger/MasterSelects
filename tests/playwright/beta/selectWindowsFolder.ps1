param([Parameter(Mandatory=$true)][string]$ChromeProfile, [Parameter(Mandatory=$true)][string]$TargetDirectory,
  [Parameter(Mandatory=$true)][string]$ReadyFile)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -Path (Join-Path $PSScriptRoot 'WindowsDesktop.cs')
[BetaDesktop]::Init()
$target = [IO.Path]::GetFullPath($TargetDirectory)
$parent = (Resolve-Path -LiteralPath (Split-Path -Parent $target)).Path
$leaf = Split-Path -Leaf $target
$chromeRoot = (Resolve-Path -LiteralPath $ChromeProfile).Path
if(Test-Path -LiteralPath $target){throw 'A fresh native project folder is required.'}
$owners = [int[]]@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($chromeRoot) } | ForEach-Object { [int]$_.ProcessId })
$browserWindows = @([BetaDesktop]::Windows($owners) | Where-Object { [BetaDesktop]::Class($_) -eq 'Chrome_WidgetWin_1' -and [BetaDesktop]::Title($_) -like 'MasterSelects*Google Chrome' })
if ($browserWindows.Count -ne 1) { throw 'Expected one dedicated Chrome window before opening the picker.' }
[BetaDesktop]::Activate($browserWindows[0])
[IO.File]::WriteAllText($ReadyFile, 'ready')
$deadline = [DateTime]::UtcNow.AddSeconds(25)
$dialogHandle = 0L
while ([DateTime]::UtcNow -lt $deadline -and $dialogHandle -eq 0) {
  $owners = [int[]]@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($chromeRoot) } | ForEach-Object { [int]$_.ProcessId })
  foreach ($window in [BetaDesktop]::Windows($owners)) {
    if ([BetaDesktop]::Class($window) -eq '#32770') { $dialogHandle = $window; break }
  }
  if ($dialogHandle -eq 0) { Start-Sleep -Milliseconds 150 }
}
if ($dialogHandle -eq 0) { throw 'Owned Chrome folder dialog did not appear.' }
[BetaDesktop]::Activate($dialogHandle)
$dialog = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$dialogHandle)
$edit = [BetaDesktop]::Control($dialogHandle, 1152)
$accept = [BetaDesktop]::Control($dialogHandle, 1)
[BetaDesktop]::Click($edit)
[BetaDesktop]::RequireFocus($dialogHandle)
[BetaDesktop]::Chord(17,65)
[BetaDesktop]::Text($parent)
[BetaDesktop]::Key(13)
$deadline = [DateTime]::UtcNow.AddSeconds(10)
$newFolder = $null
while ($null -eq $newFolder -and [DateTime]::UtcNow -lt $deadline) {
  $newFolder = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'{E44616AD-6DF1-4B94-85A4-E465AE8A19DB}')))
  if ($null -eq $newFolder) { Start-Sleep -Milliseconds 150 }
}
if($null -eq $newFolder){throw 'Native New Folder button unavailable.'}
$rect=$newFolder.Current.BoundingRectangle
[BetaDesktop]::ClickAt([int]($rect.X+$rect.Width/2),[int]($rect.Y+$rect.Height/2))
$deadline = [DateTime]::UtcNow.AddSeconds(5)
$rename = 0L
while ([DateTime]::UtcNow -lt $deadline) {
  $rename = [BetaDesktop]::FocusedControl($dialogHandle)
  if ($rename -ne $edit -and [BetaDesktop]::Class($rename) -eq 'Edit') { break }
  Start-Sleep -Milliseconds 100
}
if ($rename -eq $edit -or [BetaDesktop]::Class($rename) -ne 'Edit') { throw 'New folder rename field did not receive focus.' }
[BetaDesktop]::RequireFocus($dialogHandle)
[BetaDesktop]::Text($leaf)
[BetaDesktop]::Key(13)
$deadline=[DateTime]::UtcNow.AddSeconds(5)
while(-not (Test-Path -LiteralPath $target) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 100}
if(-not (Test-Path -LiteralPath $target)){throw 'Folder creation through the native dialog was not confirmed.'}
[BetaDesktop]::Click($edit)
[BetaDesktop]::RequireFocus($dialogHandle)
[BetaDesktop]::Chord(17,65)
[BetaDesktop]::Text($target)
[BetaDesktop]::Click($accept)
$deadline = [DateTime]::UtcNow.AddSeconds(15)
$granted = $false
while (-not $granted -and [DateTime]::UtcNow -lt $deadline) {
  foreach ($handle in [BetaDesktop]::Windows($owners)) {
    if ([BetaDesktop]::Class($handle) -ne 'Chrome_WidgetWin_1') { continue }
    try {
      $window = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$handle)
      $controls = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    } catch {
      if ($_.Exception.InnerException -is [System.Windows.Automation.ElementNotAvailableException]) { continue }
      throw
    }
    $names = @($controls | ForEach-Object { $_.Current.Name }) -join "`n"
    if (-not $names.Contains('127.0.0.1:4187') -or -not $names.Contains($leaf)) { continue }
    foreach ($control in $controls) {
      if ($control.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $control.Current.Name -in @('Zulassen', 'Allow')) {
        # Chrome suppresses early input on newly shown security prompts.
        # Let the prompt settle, then re-read its live enabled state and bounds.
        Start-Sleep -Milliseconds 1000
        if (-not $control.Current.IsEnabled -or $control.Current.IsOffscreen) { continue }
        $rect = $control.Current.BoundingRectangle
        # Clicking the title bar here dismisses Chrome's permission bubble.
        # Verify the hit belongs to this Chrome profile, then click Allow directly.
        [BetaDesktop]::ClickOwnedAt($owners, [int]($rect.X+$rect.Width/2), [int]($rect.Y+$rect.Height/2))
        $dismissed = $false
        $dismissDeadline = [DateTime]::UtcNow.AddSeconds(5)
        while ([DateTime]::UtcNow -lt $dismissDeadline) {
          try {
            $remaining = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
              (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Zulassen')))
            $remainingEnglish = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
              (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Allow')))
            $dismissed = $null -eq $remaining -and $null -eq $remainingEnglish
          }
          catch {
            if ($_.Exception.InnerException -is [System.Windows.Automation.ElementNotAvailableException]) { $dismissed = $true }
            else { throw }
          }
          if ($dismissed) { break }
          Start-Sleep -Milliseconds 100
        }
        if (-not $dismissed) { throw 'Chrome permission stayed open after the native click.' }
        $granted = $true
        break
      }
    }
    if ($granted) { break }
  }
  if (-not $granted) { Start-Sleep -Milliseconds 150 }
}
if (-not $granted) { throw 'Scoped Chrome folder permission did not appear.' }
Write-Output '{"nativeDialog":"folder","createdThroughUI":true,"input":"native mouse and keyboard","selectionSubmitted":true,"permissionClicked":true}'
