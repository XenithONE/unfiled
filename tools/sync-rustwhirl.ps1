param([string]$GameProject=(Join-Path $PSScriptRoot '../../../game/rustwhirl'))
$ErrorActionPreference='Stop'
$gameRoot=[IO.Path]::GetFullPath($GameProject)
$siteRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$payload=Join-Path $gameRoot 'builds/web'
$destination=Join-Path $siteRoot 'public/games/rustwhirl'
$cover=Join-Path $gameRoot 'builds/web-captures/menu.png'
foreach($name in @('index.html','index.js','index.wasm','index.pck','THIRD_PARTY_NOTICES.txt','CHECKSUMS.sha256')){
    if(-not(Test-Path -LiteralPath (Join-Path $payload $name))){throw "Missing Web build file: $name"}
}
if(-not(Test-Path -LiteralPath $cover)){throw 'Capture the current menu before syncing the cover.'}
foreach($line in (Get-Content -LiteralPath (Join-Path $payload 'CHECKSUMS.sha256'))){
    $entry=$line -split '  ',2
    if($entry.Count -ne 2 -or $entry[1] -notmatch '^[A-Za-z0-9_.-]+$'){throw 'Invalid checksum manifest'}
    $hash=(Get-FileHash -LiteralPath (Join-Path $payload $entry[1]) -Algorithm SHA256).Hash
    if($hash -ne $entry[0]){throw "Checksum mismatch: $($entry[1])"}
}
New-Item -ItemType Directory -Force -Path $destination | Out-Null
Get-ChildItem -LiteralPath $payload -File -Force | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $destination -Force}
Copy-Item -LiteralPath $cover -Destination (Join-Path $siteRoot 'public/images/rustwhirl.png') -Force
Write-Output "Copied verified Web build to $destination"
