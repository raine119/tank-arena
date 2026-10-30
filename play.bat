@echo off
title Tank Arena
cd /d "%~dp0"
echo ==============================================
echo Starting Tank Arena Dev Server...
echo Opening http://localhost:3000 in your browser...
echo ==============================================
start http://localhost:3000
npm run dev
pause
