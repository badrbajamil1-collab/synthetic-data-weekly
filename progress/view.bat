@echo off
setlocal
cd /d "%~dp0"
set PORT=8899
set PAGE=http://127.0.0.1:%PORT%/review/review.html

powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing '%PAGE%' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  echo Starting local server on port %PORT% ...
  start "progress-server" /min "%~dp0..\.venv\Scripts\python.exe" -m http.server %PORT% --bind 127.0.0.1
  timeout /t 2 >nul
)

start "" "%PAGE%"
echo.
echo   %PAGE%
echo.
echo   Close the minimised "progress-server" window to stop the server.
timeout /t 4 >nul
