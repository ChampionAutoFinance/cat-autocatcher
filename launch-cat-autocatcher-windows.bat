@echo off
setlocal

set "APP_DIR=%~dp0"
set "URL=%~1"
if "%URL%"=="" set "URL=about:blank"

cd /d "%APP_DIR%"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js/npm is required to launch this temporary Firefox extension.
  echo Install Node.js from https://nodejs.org, then run this file again.
  pause
  exit /b 1
)

if not exist "%APP_DIR%node_modules\.bin\web-ext.cmd" (
  echo Installing launcher dependency...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

set "FIREFOX=%ProgramFiles%\Mozilla Firefox\firefox.exe"
if not exist "%FIREFOX%" set "FIREFOX=%ProgramFiles(x86)%\Mozilla Firefox\firefox.exe"
if not exist "%FIREFOX%" (
  echo Firefox was not found.
  echo Install Firefox, then run this file again.
  pause
  exit /b 1
)

echo Launching Firefox with Cat Auto Catcher...
call "%APP_DIR%node_modules\.bin\web-ext.cmd" run --source-dir "%APP_DIR%" --firefox "%FIREFOX%" --url "%URL%" --profile-create-if-missing --firefox-profile "%APP_DIR%.firefox-cat-autocatcher-profile"
pause
