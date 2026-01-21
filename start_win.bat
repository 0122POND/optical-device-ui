@echo off
title 3D Surface Measurement UI

echo ========================================
echo   3D Surface Measurement UI
echo ========================================
echo.
echo   Starting... Please wait
echo.

cd /d "%~dp0"

REM Kill any existing processes from previous run
taskkill /fi "WINDOWTITLE eq Backend-Server" /f > nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do taskkill /pid %%a /f > nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do taskkill /pid %%a /f > nul 2>&1

REM Start backend (minimized window)
echo (1/2) Starting backend...
start "Backend-Server" /min cmd /c "cd /d "%~dp0backend" && python -m uvicorn app:app --host 0.0.0.0 --port 8000"

REM Wait before starting frontend
timeout /t 2 /nobreak > nul

echo (2/2) Starting frontend...
echo.

REM Open browser after a short delay
timeout /t 3 /nobreak > nul
start http://localhost:5173

echo ----------------------------------------
echo   Browser will open automatically
echo ----------------------------------------
echo.
echo   Press Ctrl+C to exit
echo.

cd /d "%~dp0frontend"
call npm run dev

REM Cleanup when frontend exits
echo.
echo Shutting down...
taskkill /fi "WINDOWTITLE eq Backend-Server" /f > nul 2>&1

echo Done.
