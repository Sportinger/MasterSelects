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
      'OPEN_SITE_ON_BALLOON_CLICK'
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

function Open-Url {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url
  )

  Start-Process $Url | Out-Null
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
  if ($script:State.TotalVisits -gt 0) {
    $tooltip = "MasterSelects visitors: $($script:State.TotalVisits) seen"
  }
  $script:NotifyIcon.Text = Get-TrimmedText -Value $tooltip -MaxLength 63

  $script:Menu.Status.Text = "Status: $status"
  $script:Menu.Pause.Text = if ($script:State.Paused) { 'Resume polling' } else { 'Pause polling' }

  if ($script:State.LastVisit) {
    $location = Get-VisitLocation -Visit $script:State.LastVisit
    $path = Get-VisitPath -Visit $script:State.LastVisit
    $script:Menu.LastVisit.Text = Get-TrimmedText -Value ("Latest: {0} ({1})" -f $path, $location) -MaxLength 90
    $script:Menu.LastVisit.Enabled = $true
    $script:Menu.OpenLast.Enabled = $true
  } else {
    $script:Menu.LastVisit.Text = 'Latest: none yet'
    $script:Menu.LastVisit.Enabled = $false
    $script:Menu.OpenLast.Enabled = $false
  }

  if ($script:State.LastError) {
    $script:Menu.Error.Text = Get-TrimmedText -Value ("Last error: {0}" -f $script:State.LastError) -MaxLength 90
    $script:Menu.Error.Visible = $true
  } else {
    $script:Menu.Error.Text = 'Last error: none'
    $script:Menu.Error.Visible = $false
  }
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
    'User-Agent'       = 'MasterSelects-VisitorTray/1.0'
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

function Prime-LastSeenTimestamp {
  try {
    $response = Convert-VisitApiResponse -Response (Invoke-VisitApi -Since 0 -Limit 1)
    $visits = @($response.visits)
    if ($visits.Count -gt 0) {
      $script:State.LastSeenTs = [long]$visits[0].ts
      $script:State.LastVisit = $visits[0]
    } else {
      $script:State.LastSeenTs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }
    $script:State.LastError = $null
  } catch {
    $script:State.LastSeenTs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $script:State.LastError = $_.Exception.Message
    Show-Balloon -Title 'MasterSelects visitor tray' -Text 'Startup poll failed. Check VISITOR_NOTIFY_SECRET or SITE_URL.' -Icon Warning
  }
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
  $script:State.TotalVisits += $orderedVisits.Count
  $script:State.LastVisit = $orderedVisits[-1]
  $script:State.LastSeenTs = [long]$script:State.LastVisit.ts
  $script:State.LastError = $null

  Start-AlertVisual
  Play-AlertSound

  if ($orderedVisits.Count -eq 1) {
    $visit = $orderedVisits[0]
    $message = '{0} from {1}' -f (Get-VisitPath -Visit $visit), (Get-VisitLocation -Visit $visit)
    Show-Balloon -Title 'New MasterSelects visitor' -Text $message -Icon Info
  } else {
    $latest = $orderedVisits[-1]
    $message = '{0} new visits. Latest: {1}' -f $orderedVisits.Count, (Get-VisitPath -Visit $latest)
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
  $script:PollTimer.Stop()
  $script:PollTimer.Dispose()
  $script:AlertTimer.Stop()
  $script:AlertTimer.Dispose()
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
}

$script:State = @{
  AlertUntil           = $null
  HasShownErrorBalloon = $false
  LastError            = $null
  LastSeenTs           = [long]0
  LastVisit            = $null
  Paused               = $false
  PollInFlight         = $false
  TotalVisits          = 0
}

$script:Icons = @{
  Alert  = [System.Drawing.SystemIcons]::Warning
  Normal = Get-BaseIcon
}

$script:NotifyIcon = New-Object System.Windows.Forms.NotifyIcon
$script:NotifyIcon.Icon = $script:Icons.Normal
$script:NotifyIcon.Text = 'MasterSelects visitors'
$script:NotifyIcon.Visible = $true

$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$script:Menu = @{
  Status   = New-Object System.Windows.Forms.ToolStripMenuItem 'Status: starting'
  LastVisit = New-Object System.Windows.Forms.ToolStripMenuItem 'Latest: none yet'
  Error    = New-Object System.Windows.Forms.ToolStripMenuItem 'Last error: none'
  Open     = New-Object System.Windows.Forms.ToolStripMenuItem 'Open MasterSelects'
  OpenLast = New-Object System.Windows.Forms.ToolStripMenuItem 'Open latest visited path'
  Poll     = New-Object System.Windows.Forms.ToolStripMenuItem 'Poll now'
  Pause    = New-Object System.Windows.Forms.ToolStripMenuItem 'Pause polling'
  Exit     = New-Object System.Windows.Forms.ToolStripMenuItem 'Exit'
}

$script:Menu.Status.Enabled = $false
$script:Menu.LastVisit.Enabled = $false
$script:Menu.Error.Enabled = $false
$script:Menu.Error.Visible = $false
$script:Menu.OpenLast.Enabled = $false

[void]$contextMenu.Items.Add($script:Menu.Status)
[void]$contextMenu.Items.Add($script:Menu.LastVisit)
[void]$contextMenu.Items.Add($script:Menu.Error)
[void]$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$contextMenu.Items.Add($script:Menu.Open)
[void]$contextMenu.Items.Add($script:Menu.OpenLast)
[void]$contextMenu.Items.Add($script:Menu.Poll)
[void]$contextMenu.Items.Add($script:Menu.Pause)
[void]$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$contextMenu.Items.Add($script:Menu.Exit)

$script:NotifyIcon.ContextMenuStrip = $contextMenu

$script:NotifyIcon.add_DoubleClick({
  Open-Url -Url $script:Config.SiteUrl
})

$script:NotifyIcon.add_BalloonTipClicked({
  if ($script:Config.OpenSiteOnBalloonClick -and $script:State.LastVisit) {
    Open-Url -Url (Get-VisitUrl -Visit $script:State.LastVisit)
  }
})

$script:Menu.Open.add_Click({
  Open-Url -Url $script:Config.SiteUrl
})

$script:Menu.OpenLast.add_Click({
  if ($script:State.LastVisit) {
    Open-Url -Url (Get-VisitUrl -Visit $script:State.LastVisit)
  }
})

$script:Menu.Poll.add_Click({
  Poll-Visits
})

$script:Menu.Pause.add_Click({
  $script:State.Paused = -not $script:State.Paused
  Update-UiState
})

$script:Menu.Exit.add_Click({
  Exit-VisitorTray
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

Prime-LastSeenTimestamp
Update-UiState
Show-Balloon -Title 'MasterSelects visitor tray' -Text ("Watching {0}" -f $script:Config.SiteUrl) -Icon Info
$script:PollTimer.Start()

[System.Windows.Forms.Application]::Run($script:ApplicationContext)
