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
# DRY BY DEFAULT when called manually. Without -Send the run composes the
# email and writes email.eml, but never contacts SMTP. GitHub Actions is now the
# sole live Saturday scheduler, so the local SyntheticDataWeekly task was removed
# (`schedule_task.py --delete`); only re-register with `--send` if switching back:
#
#     uv run python schedule_task.py --register --send
#
# -PipelineArgs is a test hook: `-PipelineArgs '--help'` exercises the wrapper
# without running the pipeline.

param(
    [switch]$Send,
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

$arguments = @("main.py", "--pipeline")
if (-not $Send) {
    $arguments += "--dry-run"
}
$arguments += $PipelineArgs
$mode = if ($Send) { "send" } else { "dry-run" }

"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') weekly run (mode: $mode) ===" | Out-File -Append $log
">>> $python $($arguments -join ' ')" | Out-File -Append $log
# PowerShell 5.1 turns native stderr lines into terminating NativeCommandError
# records when $ErrorActionPreference is "Stop". Temporarily switch to
# "Continue" so stderr is logged without aborting before $LASTEXITCODE.
$prevErrorAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    & $python @arguments 2>&1 | ForEach-Object { $_.ToString() } | Out-File -Append $log
    $code = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $prevErrorAction
}
"=== exit $code ===" | Out-File -Append $log
exit $code
