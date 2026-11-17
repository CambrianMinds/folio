$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$cache = Join-Path $root '.downloads'
$zip = Join-Path $cache 'qpdf-12.4.2.zip'
New-Item -ItemType Directory -Force -Path $cache | Out-Null
if (!(Test-Path -LiteralPath $zip)) { Invoke-WebRequest 'https://github.com/qpdf/qpdf/releases/download/v12.4.2/qpdf-12.4.2-mingw64.zip' -OutFile $zip }
if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne '773d2fa0c7d161e2271430734338e560a07b25d0edf11ceee8e53de435012766') { throw 'qpdf checksum mismatch' }
$expanded = Join-Path $cache 'qpdf-12.4.2'
if (!(Test-Path -LiteralPath $expanded)) { Expand-Archive -LiteralPath $zip -DestinationPath $expanded }
$package = Join-Path $expanded 'qpdf-12.4.2-mingw64'
$bin = Join-Path $root 'src-tauri/resources/bin/qpdf'
$notice = Join-Path $root 'src-tauri/resources/licenses/qpdf'
New-Item -ItemType Directory -Force -Path $bin,$notice | Out-Null
Copy-Item -Path (Join-Path $package 'bin/*') -Destination $bin -Force
Get-ChildItem -LiteralPath $package -File -Recurse | Where-Object { $_.Name -match '^(COPYING|LICENSE|NOTICE|COPYRIGHT)' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $notice -Force }
Write-Host 'Prepared qpdf 12.4.2 and its Windows runtime dependencies (SHA-256 verified).'
$notices = @{
 'LICENSE.txt'='https://raw.githubusercontent.com/qpdf/qpdf/v12.4.2/LICENSE.txt'
 'NOTICE.md'='https://raw.githubusercontent.com/qpdf/qpdf/v12.4.2/NOTICE.md'
 'GCC-COPYING3'='https://raw.githubusercontent.com/gcc-mirror/gcc/releases/gcc-15.2.0/COPYING3'
 'GCC-RUNTIME-EXCEPTION'='https://raw.githubusercontent.com/gcc-mirror/gcc/releases/gcc-15.2.0/COPYING.RUNTIME'
 'MINGW-COPYING'='https://raw.githubusercontent.com/mingw-w64/mingw-w64/v13.0.0/COPYING'
}
foreach ($entry in $notices.GetEnumerator()) {
  $file = Join-Path $notice $entry.Key
  if (!(Test-Path -LiteralPath $file)) { Invoke-WebRequest $entry.Value -OutFile $file }
}
