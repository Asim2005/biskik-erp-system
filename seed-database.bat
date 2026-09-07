@echo off
title Biscuit ERP - Seed demo data
cd /d "%~dp0"
echo This wipes the database in server\.env and rebuilds the demo company.
pause
call npm run seed
pause
