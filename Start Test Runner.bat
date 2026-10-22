@echo off
rem Double-click to start the Test Runner (Windows). Keep the window open while you use it.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then double-click this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First start: installing everything ^(this takes a few minutes, only once^)...
  call npm install
  call npx playwright install chromium
)
call npm start
pause
