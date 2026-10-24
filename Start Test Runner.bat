@echo off
rem Double-click to start the Test Runner and the ShopEase website (Windows).
rem Keep this window open while you use them; closing it stops both.
cd /d "%~dp0"
echo Automated Bug Reporting - starting...
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then double-click this file again.
  goto :end
)
for /f %%v in ('node -p "parseInt(process.versions.node)"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo Your Node.js version is too old. Install the LTS version from https://nodejs.org, then double-click this file again.
  goto :end
)
set NEED_INSTALL=0
if not exist "node_modules\.bin\tsx.cmd" set NEED_INSTALL=1
if not exist "node_modules\better-sqlite3" set NEED_INSTALL=1
if "%NEED_INSTALL%"=="1" (
  echo First start: installing everything ^(a few minutes, only once^). Please wait...
  call npm install
  if errorlevel 1 ( echo. & echo Installation FAILED - see the messages above. Check the internet connection and try again. & goto :end )
  call npx playwright install chromium
  if errorlevel 1 ( echo. & echo Installing the test browser FAILED - see above. Check the internet connection and try again. & goto :end )
)
call npm start
echo.
echo The Test Runner has stopped. If that happened straight away, the reason is in the messages above.
:end
echo.
pause
