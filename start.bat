@echo off
chcp 65001 > nul
title 3D Surface Measurement UI

echo ========================================
echo   3D Surface Measurement UI
echo ========================================
echo.
echo   起動中... しばらくお待ちください
echo.

cd /d "%~dp0"

REM バックエンドを起動（別ウィンドウ、最小化）
echo [1/2] バックエンドを起動しています...
start "Backend-Server" /min cmd /c "cd /d "%~dp0backend" && python -m uvicorn app:app --host 0.0.0.0 --port 8000"

REM 少し待機してからフロントエンドを起動
timeout /t 2 /nobreak > nul

echo [2/2] フロントエンドを起動しています...
echo.
echo ----------------------------------------
echo   ブラウザで http://localhost:5173 を
echo   開いてください
echo ----------------------------------------
echo.
echo   終了するには Ctrl+C を押してください
echo.

cd /d "%~dp0frontend"
call npm run dev

REM フロントエンドが終了したらバックエンドも終了
echo.
echo 終了処理中...
taskkill /fi "WINDOWTITLE eq Backend-Server" /f > nul 2>&1

echo 終了しました。
