param([switch]$SkipVerify)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$env:PATH = (Join-Path $env:USERPROFILE '.cargo/bin') + ';' + $env:PATH
function Check-Exit { if ($LASTEXITCODE -ne 0) { throw "Build step failed ($LASTEXITCODE)." } }
& npm.cmd ci
Check-Exit
& $PSScriptRoot/prepare-binaries.ps1
if (!$SkipVerify) {
  & npm.cmd test
  Check-Exit
  & cargo test --locked --manifest-path src-tauri/Cargo.toml
  Check-Exit
  & cargo build --locked --manifest-path src-tauri/Cargo.toml --bin folio-render
  Check-Exit
  & python scripts/verify-pdfs.py
  Check-Exit
  & node scripts/export-templates.mjs
  & python scripts/verify-spacing.py
  Check-Exit
}
& node scripts/collect-licenses.mjs
Check-Exit
& node scripts/export-templates.mjs
Check-Exit
& $PSScriptRoot/prepare-source.ps1
& npm.cmd run tauri build -- --bundles nsis
Check-Exit
$portable = Join-Path $root 'dist/Folio-0.2.0-portable'
New-Item -ItemType Directory -Force -Path $portable | Out-Null
Copy-Item -LiteralPath 'src-tauri/target/release/folio.exe' -Destination $portable
Copy-Item -LiteralPath 'src-tauri/resources' -Destination $portable -Recurse -Force
Copy-Item -LiteralPath 'README.md','LICENSE','NOTICE','THIRD-PARTY-NOTICES.md','DEPENDENCIES.json' -Destination $portable
& python scripts/package-portable.py
Check-Exit
Get-ChildItem -Path 'src-tauri/target/release/bundle/nsis/*-setup.exe','dist/*portable.zip' | Get-FileHash -Algorithm SHA256 | Format-Table
