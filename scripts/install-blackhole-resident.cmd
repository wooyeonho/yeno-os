@echo off
setlocal
rem Self-locating: works from any clone location, not a hardcoded path.
set "SCRIPTDIR=%~dp0"
set "INSTALLER=%SCRIPTDIR%blackhole-resident.ps1"

if not exist "%INSTALLER%" (
  echo ERROR: Installer not found next to this file:
  echo "%INSTALLER%"
  echo.
  pause
  exit /b 2
)

echo Starting the reviewed BLACKHOLE resident-v2 installer.
echo A pairing key is generated automatically and stored under your
echo Windows user profile with owner-only permissions. It is never shown
echo here and never needs to be typed.
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%" -Action install -InitializeNewStore
set "INSTALL_RESULT=%ERRORLEVEL%"

echo.
echo Installer exit code: %INSTALL_RESULT%
if not "%INSTALL_RESULT%"=="0" echo Review the installer output above. The task may be incomplete.
echo.
pause
exit /b %INSTALL_RESULT%
