@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the supported LTS from https://nodejs.org/en/download
  echo Then open this file again. See START_HERE_KO.md.
  pause
  exit /b 1
)
node launch.mjs
if errorlevel 1 pause
endlocal
