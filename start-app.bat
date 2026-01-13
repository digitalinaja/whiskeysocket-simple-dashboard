@echo off
title Whiskey Socket Dashboard
echo Starting Whiskey Socket Dashboard...
echo.
echo Starting server and opening browser...
start /b node src/index.js
timeout /t 3 /nobreak >nul
start http://localhost:3000
echo.
echo Browser opened to http://localhost:3000
echo Press Ctrl+C to stop the server, or close this window to exit.
echo.
pause
