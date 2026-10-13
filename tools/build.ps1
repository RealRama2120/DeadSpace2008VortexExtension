$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$output = Join-Path (Split-Path $project -Parent) 'outputs'
$info = Get-Content -LiteralPath (Join-Path $project 'info.json') -Raw | ConvertFrom-Json
if ($info.name -ne 'Dead Space (2008)' -or $info.author -ne 'Rama2120' -or
    $info.version -notmatch '^\d+\.\d+\.\d+$' -or
    ($info.gameId -isnot [long] -and $info.gameId -isnot [int]) -or
    $info.gameId -ne 1656) { throw 'Invalid extension metadata or numeric Nexus game ID.' }
$sources = [ordered]@{
  'index.js' = 'index.js'; 'info.json' = 'info.json'; 'gameart.png' = 'gameart.png'
  'README.md' = 'docs\INSTALLATION.md'; 'CHANGELOG.md' = 'CHANGELOG.md'
  'LICENSE.txt' = 'LICENSE.txt'; 'THIRD_PARTY_NOTICES.txt' = 'THIRD_PARTY_NOTICES.txt'
}
foreach ($source in $sources.Values) {
  if (-not (Test-Path -LiteralPath (Join-Path $project $source) -PathType Leaf)) { throw "Missing package source: $source" }
}
if ((Get-Content -Raw (Join-Path $project 'docs\INSTALLATION.md')) -notmatch ('Version ' + [regex]::Escape($info.version))) {
  throw 'The installation guide version does not match info.json.'
}
& node --check (Join-Path $project 'index.js')
if ($LASTEXITCODE -ne 0) { throw 'JavaScript syntax check failed.' }
Add-Type -AssemblyName System.Drawing
$art = [Drawing.Image]::FromFile((Join-Path $project 'gameart.png'))
try { if ($art.Width -ne 640 -or $art.Height -ne 360) { throw 'The game tile must be 640 by 360.' } }
finally { $art.Dispose() }
if ((Get-Item -LiteralPath (Join-Path $project 'gameart.png')).Length -gt 1MB) { throw 'The game tile exceeds 1 MB.' }
New-Item -ItemType Directory -Force -Path $output | Out-Null
$zipPath = Join-Path $output "dead-space-2008-vortex-extension-$($info.version).zip"
if (Test-Path -LiteralPath $zipPath) { throw "Refusing to overwrite an existing release: $zipPath" }
$stage = Join-Path $project ('test-artifacts\stage-' + [guid]::NewGuid().ToString('N'))
$verified = Join-Path $project ('test-artifacts\zip-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
foreach ($name in $sources.Keys) { Copy-Item -LiteralPath (Join-Path $project $sources[$name]) -Destination (Join-Path $stage $name) }
Compress-Archive -LiteralPath @($sources.Keys | ForEach-Object { Join-Path $stage $_ }) -DestinationPath $zipPath -CompressionLevel Optimal
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $actual = @($archive.Entries.FullName | Sort-Object)
  if (Compare-Object $actual @($sources.Keys | Sort-Object)) { throw 'Unexpected ZIP contents.' }
} finally { $archive.Dispose() }
Expand-Archive -LiteralPath $zipPath -DestinationPath $verified
foreach ($name in $sources.Keys) {
  if ((Get-FileHash -LiteralPath (Join-Path $verified $name)).Hash -ne
      (Get-FileHash -LiteralPath (Join-Path $project $sources[$name])).Hash) { throw "Extracted hash mismatch: $name" }
}
$previousSource = $env:EXTENSION_UNDER_TEST
try {
  $env:EXTENSION_UNDER_TEST = Join-Path $verified 'index.js'
  $testOutput = & node (Join-Path $project 'tests\extension.test.cjs') 2>&1
  $testResult = $LASTEXITCODE
  $testOutput | Set-Content -LiteralPath (Join-Path $output "dead-space-2008-vortex-extension-$($info.version)-tests.txt") -Encoding utf8
  if ($testResult -ne 0) { throw 'Packaged-source regression tests failed.' }
} finally { $env:EXTENSION_UNDER_TEST = $previousSource }
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($zipPath))" | Set-Content -LiteralPath ($zipPath + '.sha256') -Encoding ascii
[pscustomobject]@{ ZIP=$zipPath; Bytes=(Get-Item $zipPath).Length; SHA256=$hash; Entries=@($sources.Keys); VerifiedSource=$verified } | ConvertTo-Json
