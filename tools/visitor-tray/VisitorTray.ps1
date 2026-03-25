Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'VisitorTray.ps1 only supports Windows.'
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$script:ToolRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:RepoRoot = (Resolve-Path (Join-Path $script:ToolRoot '..\..')).Path
$script:LogUi = $null

function Read-KeyValueFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $values = @{}

  if (-not (Test-Path -LiteralPath $Path)) {
    return $values
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) {
      continue
    }

    $eqIndex = $trimmed.IndexOf('=')
    if ($eqIndex -lt 1) {
      continue
    }

    $key = $trimmed.Substring(0, $eqIndex).Trim()
    $value = $trimmed.Substring($eqIndex + 1).Trim()

    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    $values[$key] = $value
  }

  return $values
}

function Get-ConfigMap {
  $config = @{}
  $paths = @(
    (Join-Path $script:RepoRoot '.dev.vars'),
    (Join-Path $script:RepoRoot '.dev.vars.local'),
    (Join-Path $script:ToolRoot '.env.local')
  )

  foreach ($path in $paths) {
    foreach ($entry in (Read-KeyValueFile -Path $path).GetEnumerator()) {
      $config[$entry.Key] = $entry.Value
    }
  }

  foreach ($name in @(
      'SITE_URL',
      'VISITOR_NOTIFY_SECRET',
      'POLL_INTERVAL_MS',
      'MAX_VISITS_PER_POLL',
      'ALERT_SECONDS',
      'ENABLE_SOUND',
      'ENABLE_BALLOON',
      'OPEN_SITE_ON_BALLOON_CLICK',
      'HISTORY_LIMIT'
    )) {
    $envPath = "Env:$name"
    if (Test-Path $envPath) {
      $config[$name] = (Get-Item $envPath).Value
    }
  }

  return $config
}

function Get-ConfigInt {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Config,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [int]$Default,
    [Parameter(Mandatory = $true)]
    [int]$Min,
    [Parameter(Mandatory = $true)]
    [int]$Max
  )

  $rawValue = $Config[$Name]
  if ($null -eq $rawValue -or [string]::IsNullOrWhiteSpace([string]$rawValue)) {
    return $Default
  }

  $parsed = 0
  if (-not [int]::TryParse([string]$rawValue, [ref]$parsed)) {
    throw ('Invalid integer for {0}: {1}' -f $Name, $rawValue)
  }

  if ($parsed -lt $Min -or $parsed -gt $Max) {
    throw "$Name must be between $Min and $Max. Received: $parsed"
  }

  return $parsed
}

function Get-ConfigBool {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Config,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [bool]$Default
  )

  $rawValue = $Config[$Name]
  if ($null -eq $rawValue -or [string]::IsNullOrWhiteSpace([string]$rawValue)) {
    return $Default
  }

  switch -Regex (([string]$rawValue).Trim().ToLowerInvariant()) {
    '^(1|true|yes|on)$' { return $true }
    '^(0|false|no|off)$' { return $false }
    default { throw ('Invalid boolean for {0}: {1}' -f $Name, $rawValue) }
  }
}

function Get-RequiredConfigValue {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Config,
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $value = [string]$Config[$Name]
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required config value: $Name"
  }

  return $value.Trim()
}

function Get-ResolvedSiteUrl {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Config
  )

  $value = [string]$Config['SITE_URL']
  if ([string]::IsNullOrWhiteSpace($value)) {
    $value = 'https://www.masterselects.com'
  }

  return $value.TrimEnd('/')
}

function Get-BaseIcon {
  $preferredPath = Join-Path $script:RepoRoot 'masterselects.ico'
  if (Test-Path -LiteralPath $preferredPath) {
    return New-Object System.Drawing.Icon($preferredPath)
  }

  return [System.Drawing.SystemIcons]::Application
}

function Get-UiFont {
  param(
    [float]$Size = 9
  )

  try {
    return New-Object System.Drawing.Font('Segoe UI Emoji', $Size)
  } catch {
    return New-Object System.Drawing.Font('Segoe UI', $Size)
  }
}

function Get-TrimmedText {
  param(
    [string]$Value,
    [int]$MaxLength
  )

  if ([string]::IsNullOrEmpty($Value)) {
    return ''
  }

  if ($Value.Length -le $MaxLength) {
    return $Value
  }

  if ($MaxLength -le 3) {
    return $Value.Substring(0, $MaxLength)
  }

  return $Value.Substring(0, $MaxLength - 3) + '...'
}

function Get-VisitCountryCode {
  param($Visit)

  if ($Visit -and $Visit.PSObject.Properties.Name -contains 'country' -and -not [string]::IsNullOrWhiteSpace([string]$Visit.country)) {
    return ([string]$Visit.country).Trim().ToUpperInvariant()
  }

  return ''
}

function Get-CountryFlag {
  param(
    [string]$CountryCode
  )

  $code = ([string]$CountryCode).Trim().ToUpperInvariant()
  if ($code -notmatch '^[A-Z]{2}$') {
    return ''
  }

  $firstCodePoint = 0x1F1E6 + ([int][char]$code[0] - [int][char]'A')
  $secondCodePoint = 0x1F1E6 + ([int][char]$code[1] - [int][char]'A')

  return [System.Char]::ConvertFromUtf32($firstCodePoint) + [System.Char]::ConvertFromUtf32($secondCodePoint)
}

function Get-VisitLocation {
  param($Visit)

  $parts = @()
  if ($Visit.PSObject.Properties.Name -contains 'city' -and -not [string]::IsNullOrWhiteSpace([string]$Visit.city)) {
    $parts += [string]$Visit.city
  }
  if ($Visit.PSObject.Properties.Name -contains 'country' -and -not [string]::IsNullOrWhiteSpace([string]$Visit.country)) {
    $parts += [string]$Visit.country
  }

  if ($parts.Count -gt 0) {
    return ($parts -join ', ')
  }

  return 'unknown location'
}

function Get-VisitPath {
  param($Visit)

  $path = '/'
  if ($Visit -and $Visit.PSObject.Properties.Name -contains 'path' -and -not [string]::IsNullOrWhiteSpace([string]$Visit.path)) {
    $path = [string]$Visit.path
  }

  if (-not $path.StartsWith('/')) {
    $path = "/$path"
  }

  return $path
}

function Get-VisitUrl {
  param($Visit)

  return '{0}{1}' -f $script:Config.SiteUrl, (Get-VisitPath -Visit $Visit)
}

function Get-VisitTimeText {
  param($Visit)

  if (-not $Visit -or -not ($Visit.PSObject.Properties.Name -contains 'ts')) {
    return '--:--:--'
  }

  return [DateTimeOffset]::FromUnixTimeMilliseconds([long]$Visit.ts).ToLocalTime().ToString('HH:mm:ss')
}

function Get-VisitRefererHost {
  param($Visit)

  if (-not $Visit -or -not ($Visit.PSObject.Properties.Name -contains 'referer')) {
    return ''
  }

  $referer = [string]$Visit.referer
  if ([string]::IsNullOrWhiteSpace($referer)) {
    return ''
  }

  try {
    return ([Uri]$referer).Host
  } catch {
    return $referer
  }
}

function Get-VisitGroupKey {
  param($Visit)

  if ($Visit -and $Visit.PSObject.Properties.Name -contains 'visitorId' -and -not [string]::IsNullOrWhiteSpace([string]$Visit.visitorId)) {
    return 'visitor:' + ([string]$Visit.visitorId)
  }

  $bucket = 0
  if ($Visit -and $Visit.PSObject.Properties.Name -contains 'ts') {
    $bucket = [math]::Floor(([double][long]$Visit.ts) / 300000)
  }

  return 'fallback:{0}|{1}|{2}|{3}|{4}' -f (
    (Get-VisitCountryCode -Visit $Visit),
    [string]$Visit.city,
    (Get-VisitRefererHost -Visit $Visit),
    [string]$Visit.ua,
    $bucket
  )
}

function New-VisitFingerprint {
  param($Visit)

  return '{0}|{1}|{2}|{3}|{4}|{5}|{6}' -f (
    [long]$Visit.ts,
    (Get-VisitPath -Visit $Visit),
    [string]$Visit.visitorId,
    [string]$Visit.country,
    [string]$Visit.city,
    [string]$Visit.ua,
    [string]$Visit.referer
  )
}

function Get-VisitSummaryText {
  param(
    $Visit,
    [switch]$IncludeTime,
    [switch]$IncludeLocation,
    [switch]$IncludeFlag
  )

  $parts = @()

  if ($IncludeTime) {
    $parts += (Get-VisitTimeText -Visit $Visit)
  }

  if ($IncludeFlag) {
    $flag = Get-CountryFlag -CountryCode (Get-VisitCountryCode -Visit $Visit)
    if ($flag) {
      $parts += $flag
    }
  }

  $parts += (Get-VisitPath -Visit $Visit)

  if ($IncludeLocation) {
    $parts += (Get-VisitLocation -Visit $Visit)
  }

  $refererHost = Get-VisitRefererHost -Visit $Visit
  if ($refererHost) {
    $parts += "via $refererHost"
  }

  return ($parts -join ' | ')
}

function Get-VisitTooltip {
  param($Visit)

  $lines = @(
    ('Time: {0}' -f (Get-VisitTimeText -Visit $Visit)),
    ('Path: {0}' -f (Get-VisitPath -Visit $Visit)),
    ('Location: {0}' -f (Get-VisitLocation -Visit $Visit))
  )

  $refererHost = Get-VisitRefererHost -Visit $Visit
  if ($refererHost) {
    $lines += ('Referer: {0}' -f $refererHost)
  }

  if ($Visit.PSObject.Properties.Name -contains 'ua' -and -not [string]::IsNullOrWhiteSpace([string]$Visit.ua)) {
    $lines += ('UA: {0}' -f (Get-TrimmedText -Value ([string]$Visit.ua) -MaxLength 180))
  }

  return ($lines -join [Environment]::NewLine)
}

function Open-Url {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url
  )

  Start-Process $Url | Out-Null
}

function Add-VisitsToHistory {
  param(
    [Parameter(Mandatory = $true)]
    [object[]]$Visits
  )

  if ($Visits.Count -eq 0) {
    return
  }

  $seen = @{}
  $merged = New-Object System.Collections.ArrayList

  foreach ($visit in @($script:State.VisitHistory)) {
    $fingerprint = New-VisitFingerprint -Visit $visit
    if (-not $seen.ContainsKey($fingerprint)) {
      $seen[$fingerprint] = $true
      [void]$merged.Add($visit)
    }
  }

  foreach ($visit in @($Visits)) {
    if ($null -eq $visit) {
      continue
    }

    $fingerprint = New-VisitFingerprint -Visit $visit
    if (-not $seen.ContainsKey($fingerprint)) {
      $seen[$fingerprint] = $true
      [void]$merged.Add($visit)
    }
  }

  $script:State.VisitHistory = @(
    $merged |
      Sort-Object { [long]$_.ts } -Descending |
      Select-Object -First $script:Config.HistoryLimit
  )

  if ($script:State.VisitHistory.Count -gt 0) {
    $script:State.LastVisit = $script:State.VisitHistory[0]
  }
}

function Build-VisitsUri {
  param(
    [long]$Since,
    [int]$Limit
  )

  return '{0}/api/visits?since={1}&limit={2}' -f $script:Config.SiteUrl, $Since, $Limit
}

function Invoke-VisitApi {
  param(
    [long]$Since,
    [int]$Limit
  )

  $headers = @{
    'x-visitor-secret' = $script:Config.Secret
    'User-Agent'       = 'MasterSelects-VisitorTray/2.0'
  }

  return Invoke-RestMethod -Method Get -Uri (Build-VisitsUri -Since $Since -Limit $Limit) -Headers $headers -TimeoutSec 15
}

function Convert-VisitApiResponse {
  param(
    [Parameter(Mandatory = $true)]
    $Response
  )

  if ($Response -is [string]) {
    $trimmed = $Response.TrimStart()

    if ($trimmed.StartsWith('<!doctype html', [System.StringComparison]::OrdinalIgnoreCase) -or
        $trimmed.StartsWith('<html', [System.StringComparison]::OrdinalIgnoreCase)) {
      throw '/api/visits is not deployed on the target site yet. Production is serving the app HTML instead.'
    }

    try {
      $Response = $Response | ConvertFrom-Json -ErrorAction Stop
    } catch {
      throw 'Unexpected non-JSON response from /api/visits.'
    }
  }

  if (-not ($Response.PSObject.Properties.Name -contains 'visits')) {
    throw 'Unexpected /api/visits payload. Expected a JSON object with a visits field.'
  }

  return $Response
}

function Get-GroupedVisits {
  $buckets = @{}

  foreach ($visit in @($script:State.VisitHistory)) {
    $key = Get-VisitGroupKey -Visit $visit
    if (-not $buckets.ContainsKey($key)) {
      $buckets[$key] = New-Object System.Collections.ArrayList
    }

    [void]$buckets[$key].Add($visit)
  }

  $groups = New-Object System.Collections.ArrayList
  foreach ($entry in $buckets.GetEnumerator()) {
    $visits = @($entry.Value | Sort-Object { [long]$_.ts } -Descending)
    [void]$groups.Add([pscustomobject]@{
        Key    = $entry.Key
        Visits = $visits
        Count  = $visits.Count
        Latest = $visits[0]
      })
  }

  return @($groups | Sort-Object { [long]$_.Latest.ts } -Descending)
}

function Get-SelectedVisit {
  if ($script:LogUi -and $script:LogUi.Tree.SelectedNode -and $script:LogUi.Tree.SelectedNode.Tag -and $script:LogUi.Tree.SelectedNode.Tag.Visit) {
    return $script:LogUi.Tree.SelectedNode.Tag.Visit
  }

  return $script:State.LastVisit
}

function Update-SelectionState {
  if (-not $script:LogUi) {
    return
  }

  $script:LogUi.OpenSelectedButton.Enabled = ($null -ne (Get-SelectedVisit))
}

function Populate-VisitTree {
  if (-not $script:LogUi -or $script:LogUi.Tree.IsDisposed) {
    return
  }

  $tree = $script:LogUi.Tree
  $tree.BeginUpdate()

  try {
    $tree.Nodes.Clear()
    $groups = @(Get-GroupedVisits)

    if ($groups.Count -eq 0) {
      [void]$tree.Nodes.Add((New-Object System.Windows.Forms.TreeNode('No visits in the current log window.')))
      return
    }

    $groupIndex = 0
    foreach ($group in $groups) {
      $latest = $group.Latest

      if ($group.Count -le 1) {
        $singleNode = New-Object System.Windows.Forms.TreeNode((Get-VisitSummaryText -Visit $latest -IncludeTime -IncludeFlag -IncludeLocation))
        $singleNode.Tag = [pscustomobject]@{
          Kind  = 'visit'
          Visit = $latest
        }
        $singleNode.ToolTipText = Get-VisitTooltip -Visit $latest
        [void]$tree.Nodes.Add($singleNode)
        continue
      }

      $flag = Get-CountryFlag -CountryCode (Get-VisitCountryCode -Visit $latest)
      $prefix = if ($flag) { "$flag " } else { '' }
      $parentText = '{0}{1} | {2} hits | latest {3} | {4}' -f $prefix, (Get-VisitLocation -Visit $latest), $group.Count, (Get-VisitTimeText -Visit $latest), (Get-VisitPath -Visit $latest)

      $parentNode = New-Object System.Windows.Forms.TreeNode($parentText)
      $parentNode.Tag = [pscustomobject]@{
        Kind  = 'group'
        Visit = $latest
      }
      $parentNode.ToolTipText = Get-VisitTooltip -Visit $latest

      foreach ($visit in @($group.Visits)) {
        $childNode = New-Object System.Windows.Forms.TreeNode((Get-VisitSummaryText -Visit $visit -IncludeTime -IncludeFlag))
        $childNode.Tag = [pscustomobject]@{
          Kind  = 'visit'
          Visit = $visit
        }
        $childNode.ToolTipText = Get-VisitTooltip -Visit $visit
        [void]$parentNode.Nodes.Add($childNode)
      }

      if ($groupIndex -lt 3) {
        $parentNode.Expand()
      }

      [void]$tree.Nodes.Add($parentNode)
      $groupIndex++
    }
  } finally {
    $tree.EndUpdate()
  }

  Update-SelectionState
}

function Refresh-VisitLogUi {
  if (-not $script:LogUi) {
    return
  }

  Populate-VisitTree
}

function Update-UiState {
  $status = if ($script:State.Paused) {
    'paused'
  } elseif ($script:State.LastError) {
    'error'
  } else {
    'watching'
  }

  $tooltip = "MasterSelects visitors: $status"
  if ($script:State.VisitHistory.Count -gt 0) {
    $tooltip = "MasterSelects visitors: $($script:State.VisitHistory.Count) in log"
  }
  $script:NotifyIcon.Text = Get-TrimmedText -Value $tooltip -MaxLength 63

  if (-not $script:LogUi) {
    return
  }

  $summaryParts = @(
    ('Status: {0}' -f $status),
    ('Watching: {0}' -f $script:Config.SiteUrl),
    ('In log: {0}' -f $script:State.VisitHistory.Count)
  )

  if ($script:State.LastVisit) {
    $summaryParts += ('Latest: {0}' -f (Get-VisitSummaryText -Visit $script:State.LastVisit -IncludeTime -IncludeFlag -IncludeLocation))
  }

  $script:LogUi.SummaryLabel.Text = $summaryParts -join '    '
  $script:LogUi.PauseButton.Text = if ($script:State.Paused) { 'Resume' } else { 'Pause' }

  if ($script:State.LastError) {
    $script:LogUi.ErrorLabel.Text = 'Last error: ' + $script:State.LastError
    $script:LogUi.ErrorLabel.Visible = $true
  } else {
    $script:LogUi.ErrorLabel.Text = ''
    $script:LogUi.ErrorLabel.Visible = $false
  }

  Update-SelectionState
}

function Show-Balloon {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Title,
    [Parameter(Mandatory = $true)]
    [string]$Text,
    [System.Windows.Forms.ToolTipIcon]$Icon = [System.Windows.Forms.ToolTipIcon]::Info
  )

  if (-not $script:Config.EnableBalloon) {
    return
  }

  $script:NotifyIcon.BalloonTipTitle = Get-TrimmedText -Value $Title -MaxLength 63
  $script:NotifyIcon.BalloonTipText = Get-TrimmedText -Value $Text -MaxLength 255
  $script:NotifyIcon.BalloonTipIcon = $Icon
  $script:NotifyIcon.ShowBalloonTip(4000)
}

function Start-AlertVisual {
  $script:NotifyIcon.Icon = $script:Icons.Alert
  $script:State.AlertUntil = (Get-Date).AddSeconds($script:Config.AlertSeconds)
  if ($script:Config.AlertSeconds -gt 0) {
    $script:AlertTimer.Start()
  }
}

function Play-AlertSound {
  if (-not $script:Config.EnableSound) {
    return
  }

  [System.Media.SystemSounds]::Exclamation.Play()
}

function Prime-VisitHistory {
  try {
    $response = Convert-VisitApiResponse -Response (Invoke-VisitApi -Since 0 -Limit $script:Config.HistoryLimit)
    $visits = @($response.visits | Sort-Object { [long]$_.ts } -Descending)
    $script:State.VisitHistory = @()
    Add-VisitsToHistory -Visits $visits

    if ($script:State.VisitHistory.Count -gt 0) {
      $script:State.LastSeenTs = [long]$script:State.VisitHistory[0].ts
    } else {
      $script:State.LastSeenTs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }

    $script:State.LastError = $null
    Refresh-VisitLogUi
  } catch {
    $script:State.LastSeenTs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $script:State.LastError = $_.Exception.Message
    Show-Balloon -Title 'MasterSelects visitor tray' -Text 'Startup poll failed. Check VISITOR_NOTIFY_SECRET or SITE_URL.' -Icon Warning
  }
}

function Open-SelectedVisit {
  $visit = Get-SelectedVisit
  if ($visit) {
    Open-Url -Url (Get-VisitUrl -Visit $visit)
  }
}

function Ensure-LogForm {
  if ($script:LogUi -and -not $script:LogUi.Form.IsDisposed) {
    return
  }

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'MasterSelects live log'
  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $form.Size = New-Object System.Drawing.Size(640, 520)
  $form.MinimumSize = New-Object System.Drawing.Size(480, 320)
  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::SizableToolWindow
  $form.ShowInTaskbar = $false
  $form.TopMost = $true
  $form.KeyPreview = $true

  $buttonPanel = New-Object System.Windows.Forms.FlowLayoutPanel
  $buttonPanel.Dock = [System.Windows.Forms.DockStyle]::Top
  $buttonPanel.AutoSize = $true
  $buttonPanel.WrapContents = $false
  $buttonPanel.Padding = New-Object System.Windows.Forms.Padding(8, 8, 8, 4)

  $openSiteButton = New-Object System.Windows.Forms.Button
  $openSiteButton.Text = 'Open site'
  $openSiteButton.AutoSize = $true

  $openSelectedButton = New-Object System.Windows.Forms.Button
  $openSelectedButton.Text = 'Open selected'
  $openSelectedButton.AutoSize = $true

  $pollButton = New-Object System.Windows.Forms.Button
  $pollButton.Text = 'Poll now'
  $pollButton.AutoSize = $true

  $pauseButton = New-Object System.Windows.Forms.Button
  $pauseButton.Text = 'Pause'
  $pauseButton.AutoSize = $true

  $hideButton = New-Object System.Windows.Forms.Button
  $hideButton.Text = 'Hide'
  $hideButton.AutoSize = $true

  $exitButton = New-Object System.Windows.Forms.Button
  $exitButton.Text = 'Exit'
  $exitButton.AutoSize = $true

  foreach ($button in @($openSiteButton, $openSelectedButton, $pollButton, $pauseButton, $hideButton, $exitButton)) {
    [void]$buttonPanel.Controls.Add($button)
  }

  $summaryLabel = New-Object System.Windows.Forms.Label
  $summaryLabel.Dock = [System.Windows.Forms.DockStyle]::Top
  $summaryLabel.Height = 40
  $summaryLabel.Padding = New-Object System.Windows.Forms.Padding(8, 4, 8, 2)
  $summaryLabel.AutoEllipsis = $true
  $summaryLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft

  $errorLabel = New-Object System.Windows.Forms.Label
  $errorLabel.Dock = [System.Windows.Forms.DockStyle]::Top
  $errorLabel.Height = 22
  $errorLabel.Padding = New-Object System.Windows.Forms.Padding(8, 0, 8, 4)
  $errorLabel.ForeColor = [System.Drawing.Color]::DarkRed
  $errorLabel.Visible = $false
  $errorLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft

  $tree = New-Object System.Windows.Forms.TreeView
  $tree.Dock = [System.Windows.Forms.DockStyle]::Fill
  $tree.HideSelection = $false
  $tree.FullRowSelect = $true
  $tree.ShowNodeToolTips = $true
  $tree.Font = Get-UiFont -Size 9

  $form.Controls.Add($tree)
  $form.Controls.Add($errorLabel)
  $form.Controls.Add($summaryLabel)
  $form.Controls.Add($buttonPanel)

  $script:LogUi = @{
    Form               = $form
    Tree               = $tree
    SummaryLabel       = $summaryLabel
    ErrorLabel         = $errorLabel
    OpenSiteButton     = $openSiteButton
    OpenSelectedButton = $openSelectedButton
    PollButton         = $pollButton
    PauseButton        = $pauseButton
    HideButton         = $hideButton
    ExitButton         = $exitButton
  }

  $form.add_FormClosing({
      param($sender, $eventArgs)
      if (-not $script:State.IsExiting) {
        $eventArgs.Cancel = $true
        $sender.Hide()
      }
    })

  $form.add_KeyDown({
      param($sender, $eventArgs)
      if ($eventArgs.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
        $sender.Hide()
      }
    })

  $tree.add_AfterSelect({
      Update-SelectionState
    })

  $tree.add_NodeMouseDoubleClick({
      Open-SelectedVisit
    })

  $openSiteButton.add_Click({
      Open-Url -Url $script:Config.SiteUrl
    })

  $openSelectedButton.add_Click({
      Open-SelectedVisit
    })

  $pollButton.add_Click({
      Poll-Visits
    })

  $pauseButton.add_Click({
      $script:State.Paused = -not $script:State.Paused
      Update-UiState
    })

  $hideButton.add_Click({
      $script:LogUi.Form.Hide()
    })

  $exitButton.add_Click({
      Exit-VisitorTray
    })

  Refresh-VisitLogUi
  Update-UiState
}

function Position-LogFormNearCursor {
  Ensure-LogForm

  $form = $script:LogUi.Form
  $cursor = [System.Windows.Forms.Cursor]::Position
  $screen = [System.Windows.Forms.Screen]::FromPoint($cursor)
  $workingArea = $screen.WorkingArea

  $x = [Math]::Min($cursor.X - $form.Width + 20, $workingArea.Right - $form.Width)
  $x = [Math]::Max($workingArea.Left, $x)

  $y = [Math]::Min($cursor.Y - 8, $workingArea.Bottom - $form.Height)
  $y = [Math]::Max($workingArea.Top, $y)

  $form.Location = New-Object System.Drawing.Point($x, $y)
}

function Show-LogForm {
  Ensure-LogForm
  Refresh-VisitLogUi
  Update-UiState
  Position-LogFormNearCursor

  if (-not $script:LogUi.Form.Visible) {
    $script:LogUi.Form.Show()
  }

  $script:LogUi.Form.Activate()
  $script:LogUi.Tree.Focus()
}

function Handle-NewVisits {
  param(
    [Parameter(Mandatory = $true)]
    [object[]]$Visits
  )

  if ($Visits.Count -eq 0) {
    return
  }

  $orderedVisits = @($Visits | Sort-Object { [long]$_.ts })
  Add-VisitsToHistory -Visits $orderedVisits
  $script:State.LastVisit = $orderedVisits[-1]
  $script:State.LastSeenTs = [long]$script:State.LastVisit.ts
  $script:State.LastError = $null

  Refresh-VisitLogUi
  Start-AlertVisual
  Play-AlertSound

  if ($orderedVisits.Count -eq 1) {
    $visit = $orderedVisits[0]
    $message = Get-VisitSummaryText -Visit $visit -IncludeFlag -IncludeLocation
    Show-Balloon -Title 'New MasterSelects visitor' -Text $message -Icon Info
  } else {
    $latest = $orderedVisits[-1]
    $message = '{0} new visits | latest {1}' -f $orderedVisits.Count, (Get-VisitSummaryText -Visit $latest -IncludeFlag -IncludeLocation)
    Show-Balloon -Title 'New MasterSelects visitors' -Text $message -Icon Info
  }
}

function Poll-Visits {
  if ($script:State.Paused -or $script:State.PollInFlight) {
    return
  }

  $script:State.PollInFlight = $true

  try {
    $response = Convert-VisitApiResponse -Response (Invoke-VisitApi -Since $script:State.LastSeenTs -Limit $script:Config.MaxVisitsPerPoll)
    $visits = @($response.visits)
    $newVisits = @(
      $visits |
        Where-Object { [long]$_.ts -gt $script:State.LastSeenTs } |
        Sort-Object { [long]$_.ts }
    )

    if ($newVisits.Count -gt 0) {
      Handle-NewVisits -Visits $newVisits
    } else {
      $script:State.LastError = $null
    }

    $script:State.HasShownErrorBalloon = $false
  } catch {
    $script:State.LastError = $_.Exception.Message
    if (-not $script:State.HasShownErrorBalloon) {
      Show-Balloon -Title 'MasterSelects visitor tray error' -Text $script:State.LastError -Icon Warning
      $script:State.HasShownErrorBalloon = $true
    }
  } finally {
    $script:State.PollInFlight = $false
    Update-UiState
  }
}

function Exit-VisitorTray {
  $script:State.IsExiting = $true
  $script:PollTimer.Stop()
  $script:PollTimer.Dispose()
  $script:AlertTimer.Stop()
  $script:AlertTimer.Dispose()

  if ($script:LogUi -and $script:LogUi.Form -and -not $script:LogUi.Form.IsDisposed) {
    $script:LogUi.Form.Close()
    $script:LogUi.Form.Dispose()
  }

  $script:NotifyIcon.Visible = $false
  $script:NotifyIcon.Dispose()
  $script:ApplicationContext.ExitThread()
}

$configMap = Get-ConfigMap

$script:Config = @{
  SiteUrl                = Get-ResolvedSiteUrl -Config $configMap
  Secret                 = Get-RequiredConfigValue -Config $configMap -Name 'VISITOR_NOTIFY_SECRET'
  PollIntervalMs         = Get-ConfigInt -Config $configMap -Name 'POLL_INTERVAL_MS' -Default 5000 -Min 1000 -Max 300000
  MaxVisitsPerPoll       = Get-ConfigInt -Config $configMap -Name 'MAX_VISITS_PER_POLL' -Default 25 -Min 1 -Max 200
  AlertSeconds           = Get-ConfigInt -Config $configMap -Name 'ALERT_SECONDS' -Default 10 -Min 1 -Max 120
  EnableSound            = Get-ConfigBool -Config $configMap -Name 'ENABLE_SOUND' -Default $true
  EnableBalloon          = Get-ConfigBool -Config $configMap -Name 'ENABLE_BALLOON' -Default $true
  OpenSiteOnBalloonClick = Get-ConfigBool -Config $configMap -Name 'OPEN_SITE_ON_BALLOON_CLICK' -Default $true
  HistoryLimit           = Get-ConfigInt -Config $configMap -Name 'HISTORY_LIMIT' -Default 200 -Min 20 -Max 500
}

$script:State = @{
  AlertUntil           = $null
  HasShownErrorBalloon = $false
  IsExiting            = $false
  LastError            = $null
  LastSeenTs           = [long]0
  LastVisit            = $null
  Paused               = $false
  PollInFlight         = $false
  VisitHistory         = @()
}

$script:Icons = @{
  Alert  = [System.Drawing.SystemIcons]::Warning
  Normal = Get-BaseIcon
}

$script:NotifyIcon = New-Object System.Windows.Forms.NotifyIcon
$script:NotifyIcon.Icon = $script:Icons.Normal
$script:NotifyIcon.Text = 'MasterSelects visitors'
$script:NotifyIcon.Visible = $true

$script:NotifyIcon.add_DoubleClick({
    Open-Url -Url $script:Config.SiteUrl
  })

$script:NotifyIcon.add_MouseClick({
    param($sender, $eventArgs)
    if ($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Right) {
      Show-LogForm
    }
  })

$script:NotifyIcon.add_BalloonTipClicked({
    if ($script:Config.OpenSiteOnBalloonClick -and $script:State.LastVisit) {
      Open-Url -Url (Get-VisitUrl -Visit $script:State.LastVisit)
    }
  })

$script:AlertTimer = New-Object System.Windows.Forms.Timer
$script:AlertTimer.Interval = 500
$script:AlertTimer.add_Tick({
    if ($script:State.AlertUntil -and (Get-Date) -ge $script:State.AlertUntil) {
      $script:State.AlertUntil = $null
      $script:NotifyIcon.Icon = $script:Icons.Normal
      $script:AlertTimer.Stop()
    }
  })

$script:PollTimer = New-Object System.Windows.Forms.Timer
$script:PollTimer.Interval = $script:Config.PollIntervalMs
$script:PollTimer.add_Tick({
    Poll-Visits
  })

$script:ApplicationContext = New-Object System.Windows.Forms.ApplicationContext

Ensure-LogForm
Prime-VisitHistory
Update-UiState
Show-Balloon -Title 'MasterSelects visitor tray' -Text ("Watching {0}. Right-click the tray icon for the live log." -f $script:Config.SiteUrl) -Icon Info
$script:PollTimer.Start()

[System.Windows.Forms.Application]::Run($script:ApplicationContext)
