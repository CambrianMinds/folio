$ErrorActionPreference = 'Stop'
$root = (Split-Path $PSScriptRoot -Parent).TrimEnd('\')
$target = Join-Path $root 'src-tauri/resources/folio-source.zip'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
# Explicit source directories keep build outputs and local documents out of the archive.
$directories = 'src','samples','tests','scripts','templates','.github','src-tauri/src','src-tauri/icons','src-tauri/capabilities'
$files = @()
foreach ($directory in $directories) {
  $files += Get-ChildItem -LiteralPath (Join-Path $root $directory) -File -Recurse |
    Where-Object { $_.Extension -ne '.pyc' -and $_.FullName -notmatch '[\\/]__pycache__[\\/]' }
}
$names = 'package.json','package-lock.json','tsconfig.json','vite.config.ts','rust-toolchain.toml','.gitignore','.prettierrc.json','index.html','README.md','LICENSE','NOTICE','CONTRIBUTING.md','SECURITY.md','THIRD-PARTY-NOTICES.md','DEPENDENCIES.json','folio.md','src-tauri/Cargo.toml','src-tauri/Cargo.lock','src-tauri/build.rs','src-tauri/tauri.conf.json','src-tauri/resources/layout.typ','src-tauri/resources/licenses/README.md'
foreach ($name in $names) { $files += Get-Item -LiteralPath (Join-Path $root $name) }
$stream = [System.IO.File]::Open($target,[System.IO.FileMode]::Create)
$zip = New-Object System.IO.Compression.ZipArchive($stream,[System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($root.Length + 1).Replace('\','/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$file.FullName,$relative,[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $zip.Dispose(); $stream.Dispose() }
Write-Host 'Prepared complete Folio source archive for redistribution.'
