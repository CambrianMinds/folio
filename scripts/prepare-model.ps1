$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$target=Join-Path $env:LOCALAPPDATA 'Folio/models'
New-Item -ItemType Directory -Force -Path $target|Out-Null
$model=Join-Path $target 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf'
$cached=Join-Path $root 'verification/models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf'
if(!(Test-Path -LiteralPath $model)){
 if(Test-Path -LiteralPath $cached){Copy-Item -LiteralPath $cached -Destination $model}
 else{Invoke-WebRequest 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q4_K_M.gguf' -OutFile $model -UseBasicParsing}
}
if((Get-FileHash -LiteralPath $model -Algorithm SHA256).Hash.ToLowerInvariant() -ne '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597'){throw 'Model checksum mismatch.'}
Invoke-WebRequest 'https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507/resolve/main/LICENSE' -OutFile (Join-Path $target 'Qwen3-LICENSE') -UseBasicParsing
Write-Host "Prepared optional CPU style model: $model"
Write-Host 'Folio uses deterministic commands for measurements; the model selects only known styles.'
