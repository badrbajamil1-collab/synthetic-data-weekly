# Weekly scheduled entry point (Phase 5).
#
# Task Scheduler calls this script every Saturday at the time in config.yaml.
# It runs the LangGraph pipeline from the repo root and appends stdout/stderr
# to logs\weekly.log, so an unattended run leaves evidence even when the
# terminal is closed.
#
# The venv has the package installed editable, so `main.py` imports
# `synthetic_data` without PYTHONPATH. The full path is used because Task
# Scheduler does not inherit the user's PATH.
#
# -PipelineArgs is a test hook: `-PipelineArgs '--help'` exercises the wrapper
# without running the pipeline. The scheduled task passes no arguments, so a
# real run sends the report.

param(
    [string[]]$PipelineArgs = @()
)

$ErrorActionPreference = "Stop"
$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$python = Join-Path $repo ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Error "Python not found at $python"
    exit 1
}

$logDir = Join-Path $repo "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "weekly.log"

"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') weekly run ===" | Out-File -Append -Encoding utf8 $log
$arguments = @("main.py", "--pipeline") + $PipelineArgs
& $python @arguments *>> $log
$code = $LASTEXITCODE
"=== exit $code ===" | Out-File -Append -Encoding utf8 $log
exit $code
