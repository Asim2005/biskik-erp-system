@echo off
title Biscuit ERP - API server
cd /d "%~dp0"
if not exist node_modules ( echo Installing dependencies for the whole project... && call npm install )
echo.
echo Starting the API on http://localhost:5000
echo.
call npm run dev:server
pause
