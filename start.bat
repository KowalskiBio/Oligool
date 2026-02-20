@echo off
REM ==========================================================
REM  Oligool - one-click launcher (Windows)
REM ==========================================================
setlocal enabledelayedexpansion
title Oligool

set "ROOT=%~dp0"
cd /d "%ROOT%"

REM -- setup local paths ------------------------------------
set "NODE_DIR=%ROOT%.bin\node"
set "MAFFT_DIR=%ROOT%.bin\mafft"

REM -- prerequisite checks ----------------------------------
where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is required but not found. Install from https://python.org
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    if not exist "%NODE_DIR%\node.exe" (
        echo [..] Node.js not found. Downloading portable Node.js...
        if not exist "%ROOT%.bin" mkdir "%ROOT%.bin"
        powershell -command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip' -OutFile '%ROOT%.bin\node.zip'"
        powershell -command "Expand-Archive -Path '%ROOT%.bin\node.zip' -DestinationPath '%ROOT%.bin' -Force"
        ren "%ROOT%.bin\node-v20.11.1-win-x64" "node"
        del "%ROOT%.bin\node.zip"
    )
)

where mafft >nul 2>&1
if errorlevel 1 (
    if not exist "%MAFFT_DIR%\mafft-win\mafft.bat" (
        echo [..] MAFFT not found. Downloading portable MAFFT...
        if not exist "%MAFFT_DIR%" mkdir "%MAFFT_DIR%"
        powershell -command "Invoke-WebRequest -Uri 'https://mafft.cbrc.jp/alignment/software/mafft-7.520-win64-signed.zip' -OutFile '%MAFFT_DIR%\mafft.zip'"
        powershell -command "Expand-Archive -Path '%MAFFT_DIR%\mafft.zip' -DestinationPath '%MAFFT_DIR%' -Force"
        del "%MAFFT_DIR%\mafft.zip"
    )
)

if exist "%NODE_DIR%\node.exe" (
    set "PATH=%NODE_DIR%;!PATH!"
)

if exist "%MAFFT_DIR%\mafft-win\mafft.bat" (
    set "PATH=%MAFFT_DIR%\mafft-win;!PATH!"
)

for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo [OK] %%v
for /f "tokens=*" %%v in ('node --version 2^>^&1') do echo [OK] Node %%v
echo [OK] MAFFT installed

REM -- Python virtual-env ^& dependencies --------------------
if not exist "%ROOT%.venv" (
    echo [..] Creating Python virtual environment...
    python -m venv "%ROOT%.venv"
)
call "%ROOT%.venv\Scripts\activate.bat"
echo [..] Installing Python dependencies...
pip install -q -r "%ROOT%backend\requirements.txt"
echo [OK] Python packages ready

REM -- Node dependencies ------------------------------------
if not exist "%ROOT%frontend\node_modules" (
    echo [..] Installing Node dependencies (first run)...
    cd /d "%ROOT%frontend"
    call npm install
    cd /d "%ROOT%"
)
echo [OK] Node packages ready

REM -- start backend ----------------------------------------
echo [..] Starting backend on http://localhost:8000 ...
start "Oligool-Backend" /min cmd /c "cd /d "%ROOT%" && "%ROOT%.venv\Scripts\python.exe" -m uvicorn backend.main:app --host 0.0.0.0 --port 8000"

REM -- start frontend ---------------------------------------
echo [..] Starting frontend on http://localhost:5173 ...
start "Oligool-Frontend" /min cmd /c "cd /d "%ROOT%frontend" && npm run dev -- --host 0.0.0.0"

REM -- open browser after a short delay ---------------------
timeout /t 4 /nobreak >nul
start http://localhost:5173

echo.
echo +-----------------------------------------------+
echo ^|  Oligool is running!                          ^|
echo ^|  Frontend -^> http://localhost:5173              ^|
echo ^|  Backend  -^> http://localhost:8000              ^|
echo ^|  Close this window to stop                    ^|
echo +-----------------------------------------------+
echo.
echo Press any key to stop all servers and exit...
pause >nul

REM -- cleanup ----------------------------------------------
echo [..] Shutting down...
taskkill /fi "WINDOWTITLE eq Oligool-Backend*" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Oligool-Frontend*" /f >nul 2>&1
echo [OK] Stopped.
