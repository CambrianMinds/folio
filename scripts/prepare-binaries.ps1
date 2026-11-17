$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$cache = Join-Path $root '.downloads'
$bin = Join-Path $root 'src-tauri/resources/bin'
$licenses = Join-Path $root 'src-tauri/resources/licenses'
New-Item -ItemType Directory -Force -Path $cache,$bin,$licenses | Out-Null
$packages = @(
  @{Name='pandoc';Version='3.10.1';Url='https://github.com/jgm/pandoc/releases/download/3.10.1/pandoc-3.10.1-windows-x86_64.zip';Sha='4725a1883e2171c2e181e6fd45003acb59ca4e9cbe031fdd3b79ef0d697d36aa'},
  @{Name='typst';Version='0.14.2';Url='https://github.com/typst/typst/releases/download/v0.14.2/typst-x86_64-pc-windows-msvc.zip';Sha='51353994ac83218c3497052e89b2c432c53b9d4439cdc1b361e2ea4798ebfc13'}
)
foreach ($p in $packages) {
  $zip = Join-Path $cache ($p.Name + '-' + $p.Version + '.zip')
  if (!(Test-Path -LiteralPath $zip)) { Invoke-WebRequest $p.Url -OutFile $zip -UseBasicParsing }
  if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $p.Sha) { throw "Checksum mismatch: $zip" }
  $expanded = Join-Path $cache ($p.Name + '-' + $p.Version)
  if (!(Test-Path -LiteralPath $expanded)) { Expand-Archive -LiteralPath $zip -DestinationPath $expanded }
  $exe = Get-ChildItem -LiteralPath $expanded -Recurse -Filter ($p.Name + '.exe') | Select-Object -First 1
  Copy-Item -LiteralPath $exe.FullName -Destination (Join-Path $bin ($p.Name + '.exe'))
  $notice = Join-Path $licenses $p.Name
  New-Item -ItemType Directory -Force -Path $notice | Out-Null
  Get-ChildItem -LiteralPath $expanded -Recurse -File | Where-Object {$_.Name -match '^(COPYING|LICENSE|NOTICE|COPYRIGHT)'} | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $notice }
}
& $PSScriptRoot/prepare-qpdf.ps1
# The complete GPL-covered Pandoc source accompanies every distribution.
$source = Join-Path $licenses 'pandoc-3.10.1-source.tar.gz'
if (!(Test-Path -LiteralPath $source)) { Invoke-WebRequest 'https://hackage.haskell.org/package/pandoc-3.10.1/pandoc-3.10.1.tar.gz' -OutFile $source -UseBasicParsing }
$typstLicense = Join-Path $licenses 'typst/LICENSE'
if (!(Test-Path -LiteralPath $typstLicense)) { Invoke-WebRequest 'https://raw.githubusercontent.com/typst/typst/v0.14.2/LICENSE' -OutFile $typstLicense -UseBasicParsing }
Write-Host 'Prepared Pandoc 3.10.1 and Typst 0.14.2 (SHA-256 verified).'
& $PSScriptRoot/prepare-cpu.ps1
