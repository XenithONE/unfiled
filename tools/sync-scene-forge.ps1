param(
    [string]$SourcePath = (Join-Path $PSScriptRoot '../../../Film/scene-forge/dist-pages')
)

$ErrorActionPreference = 'Stop'
$siteRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sourceRoot = (Resolve-Path -LiteralPath $SourcePath).Path
$destination = [IO.Path]::GetFullPath((Join-Path $siteRoot 'public/tools/scene-forge'))
$sitePrefix = $siteRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

if (-not $destination.StartsWith($sitePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The destination must remain inside the UNFILED repository.'
}
if ($sourceRoot.Equals($destination, [StringComparison]::OrdinalIgnoreCase) -or
    $sourceRoot.StartsWith($destination + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The source build must be outside the destination.'
}

# Refuse junctions/symlinks so copying and cleanup cannot leave the checked paths.
$destinationCursor = $destination
while ($destinationCursor -and $destinationCursor.Length -ge $siteRoot.Length) {
    if (Test-Path -LiteralPath $destinationCursor) {
        $item = Get-Item -LiteralPath $destinationCursor -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Destination path contains a junction or symlink: $destinationCursor"
        }
    }
    if ($destinationCursor -eq $siteRoot) { break }
    $destinationCursor = Split-Path -Parent $destinationCursor
}

if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'index.html') -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $sourceRoot 'assets') -PathType Container)) {
    throw 'Run the Scene Forge Pages build first; index.html and assets/ are required.'
}
$allowedTopLevel = @('index.html', 'assets', 'LICENSE', 'LICENSE.txt', 'LICENSE.md', 'THIRD_PARTY_NOTICES.txt', 'THIRD_PARTY_NOTICES.md')
$topLevel = @(Get-ChildItem -LiteralPath $sourceRoot -Force)
foreach ($item in $topLevel) {
    if ($allowedTopLevel -notcontains $item.Name) {
        throw "Unexpected build entry: $($item.Name). Only public static assets and license notices may be published."
    }
}
$payload = @(Get-ChildItem -LiteralPath $sourceRoot -Recurse -Force)
foreach ($item in $payload) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Build contains a junction or symlink: $($item.FullName)"
    }
    if ($item.Name.StartsWith('.') -or $item.Name -in @('node_modules', 'server')) {
        throw "Private or development entry found in build: $($item.FullName)"
    }
}

# This folder contains only the generated Scene Forge distribution.
# Remove it after all checks so old hashed assets cannot accumulate.
if (Test-Path -LiteralPath $destination) {
    $existing = @(Get-ChildItem -LiteralPath $destination -Recurse -Force)
    if ($existing | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) {
        throw 'Existing distribution contains a junction or symlink; refusing cleanup.'
    }
    Remove-Item -LiteralPath $destination -Recurse -Force
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach ($item in $topLevel) {
    Copy-Item -LiteralPath $item.FullName -Destination $destination -Recurse -Force
}
Write-Output "Synced public Scene Forge build to $destination"
