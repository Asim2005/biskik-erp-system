@echo off
title Biscuit ERP - Web client
cd /d "%~dp0"
if not exist node_modules ( echo Installing dependencies for the whole project... && call npm install )
echo.
echo Starting the web app on http://localhost:5173
echo.
call npm run dev:client
pause
