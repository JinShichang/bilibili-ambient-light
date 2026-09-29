# Packs the extension into dist/bilibili-ambient-light-<version>.zip for the Chrome Web Store.
# Usage (from the project root): pwsh tools/pack.ps1
# Only runtime files are included; tools/ and dist/ are left out.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$include = @('manifest.json', 'src', 'popup', 'icons', 'assets')

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$zipPath = Join-Path $dist "bilibili-ambient-light-$($manifest.version).zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($item in $include) {
    $path = Join-Path $root $item
    $files = if (Test-Path $path -PathType Container) { Get-ChildItem $path -Recurse -File } else { Get-Item $path }
    foreach ($file in $files) {
      # Zip entries must use forward slashes, otherwise the store can't find manifest paths.
      $entry = [System.IO.Path]::GetRelativePath($root, $file.FullName).Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entry, 'Optimal') | Out-Null
    }
  }
} finally {
  $zip.Dispose()
}

Write-Host "Created $zipPath"
