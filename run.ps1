$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = "C:\Users\alanj\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if (-not (Test-Path -LiteralPath $python)) {
  $python = "python"
}

& $python "$root\backend\app.py" --host 127.0.0.1 --port 8008
