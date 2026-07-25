param(
  [string]$RuntimeRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime\AutoHotkey'),
  [switch]$Quiet
)

$script:FreakShowAutoHotkeyVersion = '2.0.26'
$script:FreakShowAutoHotkeyArchiveUrl = 'https://github.com/AutoHotkey/AutoHotkey/releases/download/v2.0.26/AutoHotkey_2.0.26.zip'
$script:FreakShowAutoHotkeyArchiveSha256 = '43522AA3122A57784AC5DB30ABF85C2244475C36ACD7796E2C993355F9E926AE'
$script:FreakShowAutoHotkeyExeSha256 = 'A2A54B8ABC476D7671D4DE0771BB54BF5F2373D79FF6871D0BA6A62C3B88AE00'

function Write-FreakShowAutoHotkeyLog {
  param([string]$TargetRoot, [string]$Message)
  try {
    $appRoot = Split-Path -Parent (Split-Path -Parent $TargetRoot)
    $logRoot = Join-Path $appRoot 'Logs'
    if (-not (Test-Path -LiteralPath $logRoot)) { New-Item -ItemType Directory -Path $logRoot -Force | Out-Null }
    $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff') + '  ' + $Message + [Environment]::NewLine
    [IO.File]::AppendAllText((Join-Path $logRoot 'AutoHotkey-runtime.log'), $line, [Text.UTF8Encoding]::new($false))
  } catch {}
}

function Get-FreakShowSha256 {
  param([string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Save-FreakShowDownload {
  param([string]$Uri, [string]$Destination)
  $request = [Net.HttpWebRequest]::Create($Uri)
  $request.Method = 'GET'
  $request.UserAgent = 'FreakShow AutoHotkey bootstrap/1.0'
  $request.AllowAutoRedirect = $true
  $request.Timeout = 30000
  $request.ReadWriteTimeout = 30000
  $response = $null
  $source = $null
  $target = $null
  try {
    $response = $request.GetResponse()
    if ($response.ContentLength -gt (25MB)) { throw 'Der AutoHotkey-Download ist unerwartet groß.' }
    $source = $response.GetResponseStream()
    $target = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $source.CopyTo($target)
  } finally {
    if ($null -ne $target) { $target.Dispose() }
    if ($null -ne $source) { $source.Dispose() }
    if ($null -ne $response) { $response.Dispose() }
  }
}

function Export-FreakShowZipEntry {
  param([IO.Compression.ZipArchive]$Archive, [string]$EntryName, [string]$Destination)
  $entry = $Archive.GetEntry($EntryName)
  if ($null -eq $entry -or $entry.Length -le 0 -or $entry.Length -gt (10MB)) {
    throw "AutoHotkey-Archiv enthält keine gültige Datei: $EntryName"
  }
  $source = $null
  $target = $null
  try {
    $source = $entry.Open()
    $target = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $source.CopyTo($target)
  } finally {
    if ($null -ne $target) { $target.Dispose() }
    if ($null -ne $source) { $source.Dispose() }
  }
}

function Install-FreakShowAutoHotkeyRuntime {
  param([string]$TargetRoot = $RuntimeRoot)

  if ([string]::IsNullOrWhiteSpace($TargetRoot)) { throw 'AutoHotkey-Zielordner fehlt.' }
  $TargetRoot = [IO.Path]::GetFullPath($TargetRoot)
  $runtimeExe = Join-Path $TargetRoot 'AutoHotkey64.exe'
  $mutex = New-Object Threading.Mutex($false, 'Local\FreakShow.AutoHotkeyRuntime.v2')
  $locked = $false
  $download = $null
  $newExe = $null
  $newLicense = $null
  try {
    try { $locked = $mutex.WaitOne(60000) }
    catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'Die AutoHotkey-Einrichtung wird bereits ausgeführt und antwortet nicht.' }

    if (Test-Path -LiteralPath $runtimeExe -PathType Leaf) {
      if ((Get-FreakShowSha256 $runtimeExe) -eq $script:FreakShowAutoHotkeyExeSha256) { return $runtimeExe }
      Write-FreakShowAutoHotkeyLog $TargetRoot 'Vorhandene portable Runtime hatte eine unerwartete Prüfsumme und wird sicher ersetzt.'
    }

    if (-not (Test-Path -LiteralPath $TargetRoot)) { New-Item -ItemType Directory -Path $TargetRoot -Force | Out-Null }
    $id = [Guid]::NewGuid().ToString('N')
    $download = Join-Path $TargetRoot ('.AutoHotkey-' + $id + '.zip')
    $newExe = Join-Path $TargetRoot ('.AutoHotkey64-' + $id + '.exe')
    $newLicense = Join-Path $TargetRoot ('.license-' + $id + '.txt')

    Write-FreakShowAutoHotkeyLog $TargetRoot ('Lade offizielle AutoHotkey-Version ' + $script:FreakShowAutoHotkeyVersion + ' herunter.')
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Save-FreakShowDownload -Uri $script:FreakShowAutoHotkeyArchiveUrl -Destination $download
    if ((Get-FreakShowSha256 $download) -ne $script:FreakShowAutoHotkeyArchiveSha256) {
      throw 'SHA-256-Prüfung des AutoHotkey-Archivs fehlgeschlagen.'
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = $null
    try {
      $archive = [IO.Compression.ZipFile]::OpenRead($download)
      Export-FreakShowZipEntry -Archive $archive -EntryName 'AutoHotkey64.exe' -Destination $newExe
      Export-FreakShowZipEntry -Archive $archive -EntryName 'license.txt' -Destination $newLicense
    } finally {
      if ($null -ne $archive) { $archive.Dispose() }
    }
    if ((Get-FreakShowSha256 $newExe) -ne $script:FreakShowAutoHotkeyExeSha256) {
      throw 'SHA-256-Prüfung von AutoHotkey64.exe fehlgeschlagen.'
    }

    if (Test-Path -LiteralPath $runtimeExe) { [IO.File]::Replace($newExe, $runtimeExe, $null, $true) }
    else { [IO.File]::Move($newExe, $runtimeExe) }
    $newExe = $null
    $licensePath = Join-Path $TargetRoot 'license.txt'
    if (Test-Path -LiteralPath $licensePath) { [IO.File]::Replace($newLicense, $licensePath, $null, $true) }
    else { [IO.File]::Move($newLicense, $licensePath) }
    $newLicense = $null

    $metadata = [ordered]@{
      version = $script:FreakShowAutoHotkeyVersion
      source = $script:FreakShowAutoHotkeyArchiveUrl
      archiveSha256 = $script:FreakShowAutoHotkeyArchiveSha256
      executableSha256 = $script:FreakShowAutoHotkeyExeSha256
      installedAt = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $TargetRoot 'runtime-info.json'), $metadata, [Text.UTF8Encoding]::new($false))
    Write-FreakShowAutoHotkeyLog $TargetRoot ('Portable AutoHotkey-Version ' + $script:FreakShowAutoHotkeyVersion + ' ist einsatzbereit.')
    return $runtimeExe
  } catch {
    Write-FreakShowAutoHotkeyLog $TargetRoot ('FEHLER: ' + $_.Exception.Message)
    throw
  } finally {
    foreach ($temporary in @($download, $newExe, $newLicense)) {
      try { if ($temporary -and (Test-Path -LiteralPath $temporary)) { Remove-Item -LiteralPath $temporary -Force } } catch {}
    }
    if ($locked) { try { $mutex.ReleaseMutex() } catch {} }
    $mutex.Dispose()
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  try {
    Install-FreakShowAutoHotkeyRuntime -TargetRoot $RuntimeRoot | Out-Null
    exit 0
  } catch {
    if (-not $Quiet) { Write-Error $_ }
    exit 1
  }
}
