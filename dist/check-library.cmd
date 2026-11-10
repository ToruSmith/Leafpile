@echo off
chcp 65001 >nul
where node >nul 2>nul || (echo 需要先安裝 Node.js:https://nodejs.org/ / Please install Node.js first. & pause & exit /b 1)
node "%~dp0leafpile-check.mjs" "%~dp0." --slides
echo.
pause
