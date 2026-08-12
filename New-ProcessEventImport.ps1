param(
  [string]$SourcePath = (Join-Path $PSScriptRoot 'streamerbot-process-event.cs'),
  [string]$JustChattingSourcePath = (Join-Path $PSScriptRoot 'streamerbot-just-chatting.cs'),
  [string]$OutputPath = (Join-Path $PSScriptRoot 'FreakShow-Process-Event.sb')
)

$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText($SourcePath, [Text.Encoding]::UTF8)
$justChattingSource = [IO.File]::ReadAllText($JustChattingSourcePath, [Text.Encoding]::UTF8)
$actionId = '6b99b0b0-e72c-46a4-900d-a09c89483de1'
$subActionId = '76850621-0124-46a6-bc6c-cb86211b27b8'
$justChattingActionId = 'f5c3bfa8-4ac8-445e-830d-683392d22566'
$justChattingSubActionId = 'dd6d97d2-2ca8-4577-9902-7bdca6c20bf0'
$import = [ordered]@{
  meta = [ordered]@{
    name = 'FreakShow Process Event'
    author = 'kappiderfreak'
    version = '1.0.0'
    description = 'Zentrale FreakShow-Aktionen: automatischer Kategorienwechsel bei erkannten EXE-Dateien sowie manueller Wechsel zu Just Chatting per Hotkey oder Stream Deck.'
    autoRunAction = $null
    minimumVersion = $null
  }
  data = [ordered]@{
    actions = @([ordered]@{
      id = $actionId
      queue = '00000000-0000-0000-0000-000000000000'
      enabled = $true
      excludeFromHistory = $false
      excludeFromPending = $false
      name = 'FreakShow - Process Event'
      group = 'FreakShow'
      alwaysRun = $false
      randomAction = $false
      concurrent = $false
      triggers = @()
      subActions = @([ordered]@{
        name = $null
        description = $null
        references = @('C:\Windows\Microsoft.NET\Framework64\v4.0.30319\mscorlib.dll')
        byteCode = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($source))
        precompile = $false
        delayStart = $false
        saveResultToVariable = $false
        saveToVariable = $null
        id = $subActionId
        weight = 0
        type = 99999
        parentId = $null
        enabled = $true
        index = 0
      })
      collapsedGroups = @()
    }, [ordered]@{
      id = $justChattingActionId
      queue = '00000000-0000-0000-0000-000000000000'
      enabled = $true
      excludeFromHistory = $false
      excludeFromPending = $false
      name = 'FreakShow - Just Chatting'
      group = 'FreakShow'
      alwaysRun = $false
      randomAction = $false
      concurrent = $false
      triggers = @()
      subActions = @([ordered]@{
        name = $null
        description = $null
        references = @('C:\Windows\Microsoft.NET\Framework64\v4.0.30319\mscorlib.dll')
        byteCode = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($justChattingSource))
        precompile = $false
        delayStart = $false
        saveResultToVariable = $false
        saveToVariable = $null
        id = $justChattingSubActionId
        weight = 0
        type = 99999
        parentId = $null
        enabled = $true
        index = 0
      })
      collapsedGroups = @()
    })
    queues = @()
    commands = @()
    websocketServers = @()
    websocketClients = @()
    timers = @()
  }
  version = 24
  exportedFrom = '1.0.4'
  minimumVersion = '1.0.0'
}

$json = $import | ConvertTo-Json -Depth 100 -Compress
$jsonBytes = [Text.Encoding]::UTF8.GetBytes($json)
$output = [IO.MemoryStream]::new()
try {
  $prefix = [Text.Encoding]::ASCII.GetBytes('SBAE')
  $output.Write($prefix, 0, $prefix.Length)
  $gzip = [IO.Compression.GZipStream]::new($output, [IO.Compression.CompressionMode]::Compress, $true)
  try { $gzip.Write($jsonBytes, 0, $jsonBytes.Length) }
  finally { $gzip.Dispose() }
  [IO.File]::WriteAllText($OutputPath, [Convert]::ToBase64String($output.ToArray()), [Text.Encoding]::UTF8)
} finally {
  $output.Dispose()
}

Write-Host "Created: $OutputPath"
