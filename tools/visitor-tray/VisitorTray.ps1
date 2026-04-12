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
$script:ToastUi = $null
$script:FlagImageCache = @{}
$script:AlertSoundPlayer = $null

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
      'ALERT_SOUND_PATH',
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

function Get-ResolvedAlertSoundPath {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Config
  )

  $configured = [string]$Config['ALERT_SOUND_PATH']
  if (-not [string]::IsNullOrWhiteSpace($configured)) {
    try {
      $candidate = [Environment]::ExpandEnvironmentVariables($configured.Trim())
      if (-not [System.IO.Path]::IsPathRooted($candidate)) {
        $candidate = Join-Path $script:ToolRoot $candidate
      }
      if (Test-Path -LiteralPath $candidate) {
        return (Resolve-Path $candidate).Path
      }
    } catch {
    }
  }

  $bundledSound = Join-Path $script:ToolRoot 'assets\masterselects-alert.wav'
  if (Test-Path -LiteralPath $bundledSound) {
    return (Resolve-Path $bundledSound).Path
  }

  foreach ($candidate in @(
      'C:\Windows\Media\Windows Notify Messaging.wav',
      'C:\Windows\Media\Windows Notify Email.wav',
      'C:\Windows\Media\Windows Notify System Generic.wav',
      'C:\Windows\Media\notify.wav',
      'C:\Windows\Media\chimes.wav'
    )) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  return $null
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

function New-ThemeColor {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Hex
  )

  return [System.Drawing.ColorTranslator]::FromHtml($Hex)
}

function Set-ButtonStyle {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Forms.Button]$Button,
    [switch]$Primary,
    [switch]$Danger,
    [switch]$Compact
  )

  $Button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $Button.FlatAppearance.BorderSize = 1
  $Button.FlatAppearance.MouseDownBackColor = $script:Theme.SurfaceHover
  $Button.FlatAppearance.MouseOverBackColor = $script:Theme.SurfaceHover
  $Button.ForeColor = $script:Theme.Text
  $Button.BackColor = if ($Primary) { $script:Theme.Accent } elseif ($Danger) { $script:Theme.Danger } else { $script:Theme.SurfaceAlt }
  $Button.FlatAppearance.BorderColor = if ($Primary) { $script:Theme.AccentSoft } elseif ($Danger) { $script:Theme.DangerSoft } else { $script:Theme.Border }
  $Button.Font = if ($Compact) { Get-UiFont -Size 8.5 } else { Get-UiFont -Size 9 }
  $Button.Padding = if ($Compact) { New-Object System.Windows.Forms.Padding(8, 4, 8, 4) } else { New-Object System.Windows.Forms.Padding(12, 7, 12, 7) }
  $Button.Margin = if ($Compact) { New-Object System.Windows.Forms.Padding(0, 0, 8, 0) } else { New-Object System.Windows.Forms.Padding(0, 0, 10, 0) }
  $Button.Cursor = [System.Windows.Forms.Cursors]::Hand
  $Button.UseVisualStyleBackColor = $false
}

function Set-HeaderButtonStyle {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Forms.Button]$Button
  )

  $Button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $Button.FlatAppearance.BorderSize = 0
  $Button.FlatAppearance.MouseDownBackColor = $script:Theme.SurfaceHover
  $Button.FlatAppearance.MouseOverBackColor = $script:Theme.SurfaceHover
  $Button.BackColor = $script:Theme.Back
  $Button.ForeColor = $script:Theme.Text
  $Button.Font = Get-UiFont -Size 10
  $Button.Cursor = [System.Windows.Forms.Cursors]::Hand
  $Button.UseVisualStyleBackColor = $false
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

function Get-VisitPropertyValue {
  param(
    $Visit,
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  if ($Visit -and $Visit.PSObject.Properties.Name -contains $Name) {
    return $Visit.$Name
  }

  return $null
}

function Get-VisitCountryCode {
  param($Visit)

  $country = [string](Get-VisitPropertyValue -Visit $Visit -Name 'country')
  if (-not [string]::IsNullOrWhiteSpace($country)) {
    return $country.Trim().ToUpperInvariant()
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

function Get-FlagCacheDirectory {
  $path = Join-Path $env:LOCALAPPDATA 'MasterSelectsVisitorTray\flags'
  if (-not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
  }

  return $path
}

function Get-FlagImage {
  param(
    [string]$CountryCode,
    [int]$PixelWidth = 40
  )

  $code = ([string]$CountryCode).Trim().ToLowerInvariant()
  if ($code -notmatch '^[a-z]{2}$') {
    return $null
  }

  $cacheKey = '{0}-{1}' -f $code, $PixelWidth
  if ($script:FlagImageCache.ContainsKey($cacheKey)) {
    return $script:FlagImageCache[$cacheKey]
  }

  $cachePath = Join-Path (Get-FlagCacheDirectory) "$cacheKey.png"
  if (-not (Test-Path -LiteralPath $cachePath)) {
    try {
      $client = New-Object System.Net.WebClient
      $client.DownloadFile("https://flagcdn.com/w$PixelWidth/$code.png", $cachePath)
      $client.Dispose()
    } catch {
      return $null
    }
  }

  try {
    $bytes = [System.IO.File]::ReadAllBytes($cachePath)
    $stream = New-Object System.IO.MemoryStream(,$bytes)
    $image = [System.Drawing.Image]::FromStream($stream)
    $bitmap = New-Object System.Drawing.Bitmap($image)
    $image.Dispose()
    $stream.Dispose()
    $script:FlagImageCache[$cacheKey] = $bitmap
    return $bitmap
  } catch {
    return $null
  }
}

function Set-FlagVisual {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Forms.PictureBox]$PictureBox,
    [Parameter(Mandatory = $true)]
    [System.Windows.Forms.Label]$FallbackLabel,
    [string]$CountryCode,
    [int]$PixelWidth = 40,
    [string]$FallbackText = ''
  )

  $image = Get-FlagImage -CountryCode $CountryCode -PixelWidth $PixelWidth
  if ($image) {
    $PictureBox.Image = $image
    $PictureBox.Visible = $true
    $FallbackLabel.Visible = $false
    return
  }

  $PictureBox.Image = $null
  $PictureBox.Visible = $false
  $FallbackLabel.Text = if ($FallbackText) { $FallbackText } elseif ($CountryCode) { $CountryCode.ToUpperInvariant() } else { '--' }
  $FallbackLabel.Visible = $true
}

function Get-VisitLocation {
  param($Visit)

  $parts = @()
  $city = [string](Get-VisitPropertyValue -Visit $Visit -Name 'city')
  if (-not [string]::IsNullOrWhiteSpace($city)) {
    $parts += $city
  }
  $country = [string](Get-VisitPropertyValue -Visit $Visit -Name 'country')
  if (-not [string]::IsNullOrWhiteSpace($country)) {
    $parts += $country
  }

  if ($parts.Count -gt 0) {
    return ($parts -join ', ')
  }

  return 'unknown location'
}

function Get-VisitPath {
  param($Visit)

  $path = '/'
  $rawPath = [string](Get-VisitPropertyValue -Visit $Visit -Name 'path')
  if (-not [string]::IsNullOrWhiteSpace($rawPath)) {
    $path = $rawPath
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

  $ts = Get-VisitPropertyValue -Visit $Visit -Name 'ts'
  if ($null -eq $ts) {
    return '--:--:--'
  }

  return [DateTimeOffset]::FromUnixTimeMilliseconds([long]$ts).ToLocalTime().ToString('HH:mm:ss')
}

function Get-VisitRefererHost {
  param($Visit)

  $referer = [string](Get-VisitPropertyValue -Visit $Visit -Name 'referer')
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

  $visitorId = [string](Get-VisitPropertyValue -Visit $Visit -Name 'visitorId')
  if (-not [string]::IsNullOrWhiteSpace($visitorId)) {
    return 'visitor:' + $visitorId
  }

  $bucket = 0
  $ts = Get-VisitPropertyValue -Visit $Visit -Name 'ts'
  if ($null -ne $ts) {
    $bucket = [math]::Floor(([double][long]$ts) / 300000)
  }

  return 'fallback:{0}|{1}|{2}|{3}|{4}' -f (
    (Get-VisitCountryCode -Visit $Visit),
    [string](Get-VisitPropertyValue -Visit $Visit -Name 'city'),
    (Get-VisitRefererHost -Visit $Visit),
    [string](Get-VisitPropertyValue -Visit $Visit -Name 'ua'),
    $bucket
  )
}

function New-VisitFingerprint {
  param($Visit)

  return '{0}|{1}|{2}|{3}|{4}|{5}|{6}' -f (
    [long](Get-VisitPropertyValue -Visit $Visit -Name 'ts'),
    (Get-VisitPath -Visit $Visit),
    [string](Get-VisitPropertyValue -Visit $Visit -Name 'visitorId'),
    [string](Get-VisitPropertyValue -Visit $Visit -Name 'country'),
    [string](Get-VisitPropertyValue -Visit $Visit -Name 'city'),
    [string](Get-VisitPropertyValue -Visit $Visit -Name 'ua'),
    [string](Get-VisitPropertyValue -Visit $Visit -Name 'referer')
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

  $ua = [string](Get-VisitPropertyValue -Visit $Visit -Name 'ua')
  if (-not [string]::IsNullOrWhiteSpace($ua)) {
    $lines += ('UA: {0}' -f (Get-TrimmedText -Value $ua -MaxLength 180))
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

function Toggle-VisitNode {
  param(
    [System.Windows.Forms.TreeNode]$Node
  )

  if (-not $Node -or $Node.Nodes.Count -eq 0) {
    return
  }

  if ($Node.IsExpanded) {
    $Node.Collapse()
  } else {
    $Node.Expand()
  }
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
  $images = $script:LogUi.FlagImages
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
        $singleNode = New-Object System.Windows.Forms.TreeNode(('{0}  {1}  {2}' -f (Get-VisitTimeText -Visit $latest), (Get-VisitPath -Visit $latest), (Get-VisitLocation -Visit $latest)))
        $singleNode.Tag = [pscustomobject]@{
          Kind  = 'visit'
          Visit = $latest
        }
        $singleNode.ToolTipText = Get-VisitTooltip -Visit $latest
        $imageKey = [string](Get-VisitCountryCode -Visit $latest)
        if ($imageKey) {
          if (-not $images.Images.ContainsKey($imageKey)) {
            $image = Get-FlagImage -CountryCode $imageKey -PixelWidth 20
            if ($image) {
              $images.Images.Add($imageKey, $image)
            }
          }
          if ($images.Images.ContainsKey($imageKey)) {
            $singleNode.ImageKey = $imageKey
            $singleNode.SelectedImageKey = $imageKey
          }
        }
        [void]$tree.Nodes.Add($singleNode)
        continue
      }

      $parentText = '{0}  {1} hits  latest {2}  {3}' -f (Get-VisitLocation -Visit $latest), $group.Count, (Get-VisitTimeText -Visit $latest), (Get-VisitPath -Visit $latest)

      $parentNode = New-Object System.Windows.Forms.TreeNode($parentText)
      $parentNode.Tag = [pscustomobject]@{
        Kind  = 'group'
        Visit = $latest
      }
      $parentNode.ToolTipText = Get-VisitTooltip -Visit $latest
      $parentImageKey = [string](Get-VisitCountryCode -Visit $latest)
      if ($parentImageKey) {
        if (-not $images.Images.ContainsKey($parentImageKey)) {
          $image = Get-FlagImage -CountryCode $parentImageKey -PixelWidth 20
          if ($image) {
            $images.Images.Add($parentImageKey, $image)
          }
        }
        if ($images.Images.ContainsKey($parentImageKey)) {
          $parentNode.ImageKey = $parentImageKey
          $parentNode.SelectedImageKey = $parentImageKey
        }
      }

      foreach ($visit in @($group.Visits)) {
        $childText = '{0}  {1}' -f (Get-VisitTimeText -Visit $visit), (Get-VisitPath -Visit $visit)
        $refererHost = Get-VisitRefererHost -Visit $visit
        if ($refererHost) {
          $childText = '{0}  via {1}' -f $childText, $refererHost
        }

        $childNode = New-Object System.Windows.Forms.TreeNode($childText)
        $childNode.Tag = [pscustomobject]@{
          Kind  = 'visit'
          Visit = $visit
        }
        $childNode.ToolTipText = Get-VisitTooltip -Visit $visit
        $childImageKey = [string](Get-VisitCountryCode -Visit $visit)
        if ($childImageKey) {
          if (-not $images.Images.ContainsKey($childImageKey)) {
            $image = Get-FlagImage -CountryCode $childImageKey -PixelWidth 20
            if ($image) {
              $images.Images.Add($childImageKey, $image)
            }
          }
          if ($images.Images.ContainsKey($childImageKey)) {
            $childNode.ImageKey = $childImageKey
            $childNode.SelectedImageKey = $childImageKey
          }
        }
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

function Ensure-ToastForm {
  if ($script:ToastUi -and -not $script:ToastUi.Form.IsDisposed) {
    return
  }

  $form = New-Object System.Windows.Forms.Form
  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $form.ShowInTaskbar = $false
  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $form.TopMost = $true
  $form.BackColor = $script:Theme.Surface
  $form.ForeColor = $script:Theme.Text
  $form.Size = New-Object System.Drawing.Size(380, 112)

  $accentPanel = New-Object System.Windows.Forms.Panel
  $accentPanel.Dock = [System.Windows.Forms.DockStyle]::Left
  $accentPanel.Width = 4
  $accentPanel.BackColor = $script:Theme.Accent

  $contentPanel = New-Object System.Windows.Forms.Panel
  $contentPanel.Dock = [System.Windows.Forms.DockStyle]::Fill
  $contentPanel.Padding = New-Object System.Windows.Forms.Padding(14, 12, 14, 12)
  $contentPanel.BackColor = $script:Theme.Surface

  $iconPanel = New-Object System.Windows.Forms.Panel
  $iconPanel.Location = New-Object System.Drawing.Point(0, 6)
  $iconPanel.Size = New-Object System.Drawing.Size(56, 56)
  $iconPanel.BackColor = $script:Theme.AccentSoft

  $flagPicture = New-Object System.Windows.Forms.PictureBox
  $flagPicture.Location = New-Object System.Drawing.Point(6, 12)
  $flagPicture.Size = New-Object System.Drawing.Size(44, 32)
  $flagPicture.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::StretchImage
  $flagPicture.Visible = $false

  $flagFallback = New-Object System.Windows.Forms.Label
  $flagFallback.Location = New-Object System.Drawing.Point(0, 0)
  $flagFallback.Size = New-Object System.Drawing.Size(56, 56)
  $flagFallback.Font = Get-UiFont -Size 15
  $flagFallback.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
  $flagFallback.ForeColor = $script:Theme.Text

  [void]$iconPanel.Controls.Add($flagPicture)
  [void]$iconPanel.Controls.Add($flagFallback)

  $titleLabel = New-Object System.Windows.Forms.Label
  $titleLabel.Location = New-Object System.Drawing.Point(64, 4)
  $titleLabel.Size = New-Object System.Drawing.Size(286, 24)
  $titleLabel.Font = Get-UiFont -Size 10.5
  $titleLabel.ForeColor = $script:Theme.Text

  $bodyLabel = New-Object System.Windows.Forms.Label
  $bodyLabel.Location = New-Object System.Drawing.Point(64, 32)
  $bodyLabel.Size = New-Object System.Drawing.Size(286, 42)
  $bodyLabel.Font = Get-UiFont -Size 9
  $bodyLabel.ForeColor = $script:Theme.Muted

  $footerLabel = New-Object System.Windows.Forms.Label
  $footerLabel.Location = New-Object System.Drawing.Point(64, 76)
  $footerLabel.Size = New-Object System.Drawing.Size(286, 18)
  $footerLabel.Font = Get-UiFont -Size 8
  $footerLabel.ForeColor = $script:Theme.Subtle

  foreach ($control in @($iconPanel, $titleLabel, $bodyLabel, $footerLabel)) {
    [void]$contentPanel.Controls.Add($control)
  }

  $form.Controls.Add($contentPanel)
  $form.Controls.Add($accentPanel)

  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 5000
  $timer.add_Tick({
      if ($script:ToastUi -and $script:ToastUi.Form -and -not $script:ToastUi.Form.IsDisposed) {
        $script:ToastUi.Form.Hide()
      }
      $script:ToastUi.Timer.Stop()
    })

  $script:ToastUi = @{
    Form        = $form
    AccentPanel = $accentPanel
    IconPanel   = $iconPanel
    FlagPicture = $flagPicture
    FlagFallback = $flagFallback
    TitleLabel  = $titleLabel
    BodyLabel   = $bodyLabel
    FooterLabel = $footerLabel
    Timer       = $timer
    OpenUrl     = $null
  }

  $clickHandler = {
    if ($script:ToastUi.OpenUrl) {
      Open-Url -Url $script:ToastUi.OpenUrl
    }
    $script:ToastUi.Form.Hide()
  }

  foreach ($control in @($form, $contentPanel, $iconPanel, $flagPicture, $flagFallback, $titleLabel, $bodyLabel, $footerLabel)) {
    $control.add_Click($clickHandler)
  }
}

function Position-ToastForm {
  Ensure-ToastForm

  $form = $script:ToastUi.Form
  $workingArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $x = $workingArea.Right - $form.Width - 18
  $y = $workingArea.Bottom - $form.Height - 18
  $form.Location = New-Object System.Drawing.Point($x, $y)
}

function Show-Balloon {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Title,
    [Parameter(Mandatory = $true)]
    [string]$Text,
    [System.Windows.Forms.ToolTipIcon]$Icon = [System.Windows.Forms.ToolTipIcon]::Info,
    $Visit = $null
  )

  if (-not $script:Config.EnableBalloon) {
    return
  }

  Ensure-ToastForm
  Position-ToastForm

  $accent = switch ($Icon) {
    ([System.Windows.Forms.ToolTipIcon]::Warning) { $script:Theme.Danger }
    ([System.Windows.Forms.ToolTipIcon]::Error) { $script:Theme.Danger }
    default { $script:Theme.Accent }
  }

  $accentSoft = switch ($Icon) {
    ([System.Windows.Forms.ToolTipIcon]::Warning) { $script:Theme.DangerSoft }
    ([System.Windows.Forms.ToolTipIcon]::Error) { $script:Theme.DangerSoft }
    default { $script:Theme.AccentSoft }
  }

  $countryCode = if ($Visit) { Get-VisitCountryCode -Visit $Visit } else { '' }
  $iconText = if ($Icon -eq [System.Windows.Forms.ToolTipIcon]::Warning -or $Icon -eq [System.Windows.Forms.ToolTipIcon]::Error) { '!' } elseif ($countryCode) { $countryCode } else { 'i' }
  $footer = if ($Visit) { '{0}  {1}' -f (Get-VisitTimeText -Visit $Visit), (Get-VisitLocation -Visit $Visit) } else { $script:Config.SiteUrl }
  $openUrl = if ($Visit -and $script:Config.OpenSiteOnBalloonClick) { Get-VisitUrl -Visit $Visit } elseif ($script:Config.OpenSiteOnBalloonClick) { $script:Config.SiteUrl } else { $null }

  $script:ToastUi.AccentPanel.BackColor = $accent
  $script:ToastUi.Form.BackColor = $script:Theme.Surface
  $script:ToastUi.IconPanel.BackColor = $accentSoft
  Set-FlagVisual -PictureBox $script:ToastUi.FlagPicture -FallbackLabel $script:ToastUi.FlagFallback -CountryCode $countryCode -PixelWidth 40 -FallbackText $iconText
  $script:ToastUi.TitleLabel.Text = Get-TrimmedText -Value $Title -MaxLength 80
  $script:ToastUi.BodyLabel.Text = Get-TrimmedText -Value $Text -MaxLength 150
  $script:ToastUi.FooterLabel.Text = Get-TrimmedText -Value $footer -MaxLength 80
  $script:ToastUi.OpenUrl = $openUrl

  if (-not $script:ToastUi.Form.Visible) {
    $script:ToastUi.Form.Show()
  }

  $script:ToastUi.Form.BringToFront()
  $script:ToastUi.Timer.Stop()
  $script:ToastUi.Timer.Start()
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

  if ($script:Config.AlertSoundPath -and (Test-Path -LiteralPath $script:Config.AlertSoundPath)) {
    try {
      if (-not $script:AlertSoundPlayer -or $script:AlertSoundPlayer.SoundLocation -ne $script:Config.AlertSoundPath) {
        if ($script:AlertSoundPlayer) {
          $script:AlertSoundPlayer.Dispose()
        }

        $script:AlertSoundPlayer = New-Object System.Media.SoundPlayer($script:Config.AlertSoundPath)
        $script:AlertSoundPlayer.Load()
      }

      $script:AlertSoundPlayer.Play()
      return
    } catch {
    }
  }

  [System.Media.SystemSounds]::Asterisk.Play()
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
  $form.Text = 'MasterSelects'
  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $form.Size = New-Object System.Drawing.Size(430, 620)
  $form.MinimumSize = New-Object System.Drawing.Size(430, 620)
  $form.MaximumSize = New-Object System.Drawing.Size(430, 900)
  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $form.ControlBox = $false
  $form.ShowInTaskbar = $false
  $form.TopMost = $true
  $form.KeyPreview = $true
  $form.BackColor = $script:Theme.Back
  $form.ForeColor = $script:Theme.Text
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false

  $shellPanel = New-Object System.Windows.Forms.Panel
  $shellPanel.Dock = [System.Windows.Forms.DockStyle]::Fill
  $shellPanel.Padding = New-Object System.Windows.Forms.Padding(1)
  $shellPanel.BackColor = $script:Theme.Border

  $innerPanel = New-Object System.Windows.Forms.Panel
  $innerPanel.Dock = [System.Windows.Forms.DockStyle]::Fill
  $innerPanel.BackColor = $script:Theme.Back

  $titleBar = New-Object System.Windows.Forms.Panel
  $titleBar.Dock = [System.Windows.Forms.DockStyle]::Top
  $titleBar.Height = 34
  $titleBar.BackColor = $script:Theme.Back
  $titleBar.Padding = New-Object System.Windows.Forms.Padding(10, 6, 8, 6)

  $titleLabel = New-Object System.Windows.Forms.Label
  $titleLabel.Dock = [System.Windows.Forms.DockStyle]::Left
  $titleLabel.Width = 220
  $titleLabel.Text = 'MasterSelects'
  $titleLabel.Font = Get-UiFont -Size 10
  $titleLabel.ForeColor = $script:Theme.Text
  $titleLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft

  $closeButton = New-Object System.Windows.Forms.Button
  $closeButton.Dock = [System.Windows.Forms.DockStyle]::Right
  $closeButton.Width = 28
  $closeButton.Text = 'X'
  Set-HeaderButtonStyle -Button $closeButton

  [void]$titleBar.Controls.Add($closeButton)
  [void]$titleBar.Controls.Add($titleLabel)

  $buttonPanel = New-Object System.Windows.Forms.FlowLayoutPanel
  $buttonPanel.Dock = [System.Windows.Forms.DockStyle]::Top
  $buttonPanel.AutoSize = $true
  $buttonPanel.WrapContents = $true
  $buttonPanel.Padding = New-Object System.Windows.Forms.Padding(12, 12, 12, 10)
  $buttonPanel.BackColor = $script:Theme.Back
  $buttonPanel.FlowDirection = [System.Windows.Forms.FlowDirection]::LeftToRight

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
  $summaryLabel.Height = 48
  $summaryLabel.Padding = New-Object System.Windows.Forms.Padding(12, 8, 12, 4)
  $summaryLabel.AutoEllipsis = $true
  $summaryLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
  $summaryLabel.BackColor = $script:Theme.Back
  $summaryLabel.ForeColor = $script:Theme.Text
  $summaryLabel.Font = Get-UiFont -Size 9.5

  $errorLabel = New-Object System.Windows.Forms.Label
  $errorLabel.Dock = [System.Windows.Forms.DockStyle]::Top
  $errorLabel.Height = 28
  $errorLabel.Padding = New-Object System.Windows.Forms.Padding(12, 0, 12, 8)
  $errorLabel.ForeColor = $script:Theme.Danger
  $errorLabel.Visible = $false
  $errorLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
  $errorLabel.BackColor = $script:Theme.Back
  $errorLabel.Font = Get-UiFont -Size 8.5

  $tree = New-Object System.Windows.Forms.TreeView
  $tree.Dock = [System.Windows.Forms.DockStyle]::Fill
  $tree.HideSelection = $false
  $tree.FullRowSelect = $true
  $tree.ShowNodeToolTips = $true
  $tree.Font = Get-UiFont -Size 9
  $tree.BackColor = $script:Theme.Surface
  $tree.ForeColor = $script:Theme.Text
  $tree.BorderStyle = [System.Windows.Forms.BorderStyle]::None
  $tree.ItemHeight = 24
  $tree.Indent = 20
  $tree.ShowLines = $false
  $tree.ShowRootLines = $false
  $tree.ShowPlusMinus = $true

  $flagImages = New-Object System.Windows.Forms.ImageList
  $flagImages.ColorDepth = [System.Windows.Forms.ColorDepth]::Depth32Bit
  $flagImages.ImageSize = New-Object System.Drawing.Size(20, 14)
  $tree.ImageList = $flagImages

  foreach ($button in @($openSiteButton, $openSelectedButton, $pollButton, $pauseButton, $hideButton, $exitButton)) {
    $button.Size = New-Object System.Drawing.Size(120, 44)
  }

  foreach ($button in @($openSiteButton, $openSelectedButton, $pollButton, $pauseButton, $hideButton)) {
    Set-ButtonStyle -Button $button
  }
  Set-ButtonStyle -Button $exitButton -Danger

  $innerPanel.Controls.Add($tree)
  $innerPanel.Controls.Add($errorLabel)
  $innerPanel.Controls.Add($summaryLabel)
  $innerPanel.Controls.Add($buttonPanel)
  $innerPanel.Controls.Add($titleBar)
  $shellPanel.Controls.Add($innerPanel)
  $form.Controls.Add($shellPanel)

  $script:LogUi = @{
    Form               = $form
    ShellPanel         = $shellPanel
    InnerPanel         = $innerPanel
    TitleBar           = $titleBar
    TitleLabel         = $titleLabel
    CloseButton        = $closeButton
    Tree               = $tree
    SummaryLabel       = $summaryLabel
    ErrorLabel         = $errorLabel
    OpenSiteButton     = $openSiteButton
    OpenSelectedButton = $openSelectedButton
    PollButton         = $pollButton
    PauseButton        = $pauseButton
    HideButton         = $hideButton
    ExitButton         = $exitButton
    FlagImages         = $flagImages
    DragOrigin         = $null
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

  $tree.add_NodeMouseClick({
      param($sender, $eventArgs)
      if (-not $eventArgs.Node) {
        return
      }

      $sender.SelectedNode = $eventArgs.Node

      if ($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left -and
          $eventArgs.Node -and
          $eventArgs.Node.Nodes.Count -gt 0) {
        $textRegionStart = [Math]::Max(0, $eventArgs.Node.Bounds.Left - 18)
        if ($eventArgs.Location.X -ge $textRegionStart) {
          Toggle-VisitNode -Node $eventArgs.Node
        }
      }
    })

  $tree.add_NodeMouseDoubleClick({
      param($sender, $eventArgs)
      if ($eventArgs.Node -and $eventArgs.Node.Nodes.Count -eq 0) {
        Open-SelectedVisit
      }
    })

  $titleDragStart = {
    param($sender, $eventArgs)
    if ($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
      $script:LogUi.DragOrigin = New-Object System.Drawing.Point($eventArgs.X, $eventArgs.Y)
    }
  }

  $titleDragMove = {
    param($sender, $eventArgs)
    if ($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left -and $script:LogUi.DragOrigin) {
      $screenPoint = $sender.PointToScreen((New-Object System.Drawing.Point($eventArgs.X, $eventArgs.Y)))
      $script:LogUi.Form.Location = New-Object System.Drawing.Point(
        ($screenPoint.X - $script:LogUi.DragOrigin.X),
        ($screenPoint.Y - $script:LogUi.DragOrigin.Y)
      )
    }
  }

  $titleDragEnd = {
    $script:LogUi.DragOrigin = $null
  }

  foreach ($control in @($titleBar, $titleLabel)) {
    $control.add_MouseDown($titleDragStart)
    $control.add_MouseMove($titleDragMove)
    $control.add_MouseUp($titleDragEnd)
  }

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

  $closeButton.add_Click({
      $script:LogUi.Form.Hide()
    })

  Refresh-VisitLogUi
  Update-UiState
}

function Position-LogFormNearTray {
  Ensure-LogForm

  $form = $script:LogUi.Form
  $workingArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $x = $workingArea.Right - $form.Width - 14
  $y = $workingArea.Bottom - $form.Height - 14

  $form.Location = New-Object System.Drawing.Point($x, $y)
}

function Show-LogForm {
  Ensure-LogForm
  Refresh-VisitLogUi
  Update-UiState
  Position-LogFormNearTray

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
    Show-Balloon -Title 'New MasterSelects visitor' -Text $message -Icon Info -Visit $visit
  } else {
    $latest = $orderedVisits[-1]
    $message = '{0} new visits | latest {1}' -f $orderedVisits.Count, (Get-VisitSummaryText -Visit $latest -IncludeFlag -IncludeLocation)
    Show-Balloon -Title 'New MasterSelects visitors' -Text $message -Icon Info -Visit $latest
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

  if ($script:ToastUi -and $script:ToastUi.Form -and -not $script:ToastUi.Form.IsDisposed) {
    $script:ToastUi.Timer.Stop()
    $script:ToastUi.Timer.Dispose()
    $script:ToastUi.Form.Close()
    $script:ToastUi.Form.Dispose()
  }

  if ($script:AlertSoundPlayer) {
    $script:AlertSoundPlayer.Stop()
    $script:AlertSoundPlayer.Dispose()
    $script:AlertSoundPlayer = $null
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
  AlertSoundPath         = Get-ResolvedAlertSoundPath -Config $configMap
}

$script:Theme = @{
  Back         = New-ThemeColor -Hex '#0f1216'
  Surface      = New-ThemeColor -Hex '#171b21'
  SurfaceAlt   = New-ThemeColor -Hex '#1f252d'
  SurfaceHover = New-ThemeColor -Hex '#26303b'
  Border       = New-ThemeColor -Hex '#2d3742'
  Accent       = New-ThemeColor -Hex '#2f9cf4'
  AccentSoft   = New-ThemeColor -Hex '#173a56'
  Danger       = New-ThemeColor -Hex '#e05d5d'
  DangerSoft   = New-ThemeColor -Hex '#4d2426'
  Text         = New-ThemeColor -Hex '#f2f5f7'
  Muted        = New-ThemeColor -Hex '#a9b4bf'
  Subtle       = New-ThemeColor -Hex '#7c8894'
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
