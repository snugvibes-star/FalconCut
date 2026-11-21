@echo off
rem FalconCut launcher - double-click this file.
rem Why not index.html: a web app cannot run from file:// (ES modules, service
rem workers and IndexedDB need an http origin). This starts the local server,
rem opens the app in your browser, and from there you can install it as an app.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required: https://nodejs.org  ^(LTS^)
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo First run: installing dependencies and building - this takes a minute...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
  call npm run build
  if errorlevel 1 ( pause & exit /b 1 )
)

rem Rebuild if any source file is newer than the built app.
for /f %%i in ('powershell -NoProfile -Command "$b=(Get-Item 'dist\index.html').LastWriteTime; $n=Get-ChildItem -Recurse -File src,engine,ai,tools,styles,exporter,public -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $b } | Measure-Object; if ($n.Count -gt 0) { '1' } else { '0' }"') do set NEEDS_BUILD=%%i
if "%NEEDS_BUILD%"=="1" (
  echo Sources changed - rebuilding...
  call npm run build
  if errorlevel 1 ( pause & exit /b 1 )
)

rem Start the server detached (no console window left behind).
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath node -ArgumentList 'scripts/serve.mjs' -WorkingDirectory '%CD%'"

rem Give the server a moment, then open the app. Chrome/Edge get an app window
rem (no address bar, own taskbar entry) so it behaves like an installed app.
timeout /t 2 /nobreak >nul
set "APPURL=http://localhost:4173"
set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if defined BROWSER goto appwindow
start "" "%APPURL%"
goto opened
:appwindow
start "" "%BROWSER%" --app=%APPURL% --window-size=1440,960
:opened

echo.
echo FalconCut is running at http://localhost:4173
echo For a permanent desktop icon, run "Install FalconCut.ps1" once.
echo.
echo To stop the server later, open Task Manager and end the "node" process,
echo or run: taskkill /IM node.exe /F
timeout /t 8 >nul
