$ErrorActionPreference = 'Stop'
$root=Split-Path $PSScriptRoot -Parent
$cache=Join-Path $root '.downloads'
$zip=Join-Path $cache 'llama-b12445-cpu.zip'
if(!(Test-Path -LiteralPath $zip)){Invoke-WebRequest 'https://github.com/ggml-org/llama.cpp/releases/download/b12445/llama-b12445-bin-win-cpu-x64.zip' -OutFile $zip -UseBasicParsing}
if((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne '2a224215f248cd32eab5f79a0478ed36492dfeb0c05ac85a82884d6afb386ffc'){throw 'CPU runtime checksum mismatch.'}
$expanded=Join-Path $cache 'llama-b12445'
if(!(Test-Path -LiteralPath $expanded)){Expand-Archive -LiteralPath $zip -DestinationPath $expanded}
$output=Join-Path $root 'src-tauri/resources/bin/cpu'
$licenses=Join-Path $root 'src-tauri/resources/licenses/llama.cpp'
New-Item -ItemType Directory -Force -Path $output,$licenses|Out-Null
Get-ChildItem -LiteralPath $expanded -File | Where-Object {$_.Name -match '^(ggml(?!-rpc).*\.dll|llama\.dll|llama-common\.dll|llama-completion(-impl\.dll|\.exe)|libomp\.dll)$'} | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $output -Force}
Get-ChildItem -LiteralPath $expanded -File | Where-Object {$_.Name -match '^(LICENSE|NOTICE|COPYING)'} | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $licenses -Force}
foreach($name in @('LICENSE','licenses/LICENSE-jsonhpp','vendor/cpp-httplib/LICENSE')){
 $target=Join-Path $licenses ($name.Replace('/','-'))
 if(!(Test-Path -LiteralPath $target)){Invoke-WebRequest ('https://raw.githubusercontent.com/ggml-org/llama.cpp/b12445/'+$name) -OutFile $target -UseBasicParsing}
}
Write-Host 'Prepared llama.cpp b12445, CPU-only runtime. Model weights are optional and separate.'
