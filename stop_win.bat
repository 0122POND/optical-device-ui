@echo off
title Stop 3D Surface Measurement UI

echo ========================================
echo   Stopping 3D Surface Measurement UI
echo ========================================
echo.

REM Kill backend by window title
taskkill /fi "WINDOWTITLE eq Backend-Server" /f > nul 2>&1

REM Kill processes by port
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do taskkill /pid %%a /f > nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do taskkill /pid %%a /f > nul 2>&1

REM Kill main window (start_win.bat window)
taskkill /fi "WINDOWTITLE eq 3D Surface Measurement UI" /f > nul 2>&1

echo   All processes stopped.
echo.
