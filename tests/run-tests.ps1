$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  (Join-Path $root 'EmbeddedBridge.ps1'),
  [ref]$tokens,
  [ref]$errors
) | Out-Null
if ($errors.Count -gt 0) {
  throw ('EmbeddedBridge.ps1: ' + (($errors | ForEach-Object Message) -join '; '))
}

Get-ChildItem -LiteralPath (Join-Path $root 'app') -Filter '*.js' -File |
  Sort-Object Name |
  ForEach-Object {
    & node --check $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "JavaScript-Syntaxfehler: $($_.Name)" }
  }

Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.test.js' -File |
  Sort-Object Name |
  ForEach-Object {
    & node $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Test fehlgeschlagen: $($_.Name)" }
  }

Write-Host 'Alle FreakShow-Tests: OK'
