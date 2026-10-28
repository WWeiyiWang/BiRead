param([string]$InstallDirectory = "$PSScriptRoot/../.biread-layout-engine")
$ErrorActionPreference = 'Stop'
$engineDirectory = [IO.Path]::GetFullPath($InstallDirectory)
$uvCommand = Get-Command uv -ErrorAction Stop
& $uvCommand.Source venv --python 3.12 "$engineDirectory/.venv"
if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated Python environment' }
$enginePython = Join-Path $engineDirectory '.venv/Scripts/python.exe'
& $uvCommand.Source pip install --python $enginePython 'pdf2zh-next==2.9.0' 'babeldoc==0.6.2' 'bitstring==4.3.1'
if ($LASTEXITCODE -ne 0) { throw 'Could not install layout dependencies' }
& $enginePython -c 'import json,sys;from pathlib import Path;from babeldoc.assets.assets import get_doclayout_onnx_model_path;p=Path(sys.argv[1]);p.write_text(json.dumps({"python":sys.executable,"model":str(get_doclayout_onnx_model_path())}),encoding="utf-8")' "$engineDirectory/layout-engine.json"
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare layout model' }
Write-Output "配置文件：$engineDirectory/layout-engine.json"
