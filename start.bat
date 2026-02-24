@echo off
title Oligool
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo [..] Checking dependencies...

REM -- 1. Python -------------------------
set "PYTHON_CMD="
python --version >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=python"
    goto python_done
)
py --version >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=py"
    goto python_done
)
echo [INFO] Python is not installed or the Windows Store alias is interfering.
echo [INFO] Commencing automatic Python 3.12 installation...
winget --version >nul 2>&1
if not errorlevel 1 (
    winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
) else (
    powershell -command "Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.9/python-3.12.9-amd64.exe' -OutFile '%TEMP%\python_installer.exe'"
    start /wait %TEMP%\python_installer.exe /passive PrependPath=1
)

:: Re-check python
python --version >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=python"
    goto python_done
)
py --version >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=py"
    goto python_done
)

:: Try explicit paths
set "PYTHON_EXE="
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if exist "%PROGRAMFILES%\Python312\python.exe" set "PYTHON_EXE=%PROGRAMFILES%\Python312\python.exe"

if defined PYTHON_EXE (
    set "PYTHON_CMD=%PYTHON_EXE%"
    goto python_done
)

echo [ERROR] Python installation failed or python executable could not be found.
echo Please install Python manually from https://python.org.
pause
exit /b 1
:python_done

REM -- 2. MAFFT --------------------------
if exist "%ROOT%.bin\mafft\mafft-win\mafft.bat" (
    set "PATH=%ROOT%.bin\mafft\mafft-win;%PATH%"
)

where mafft >nul 2>&1
if not errorlevel 1 goto mafft_done
echo [..] MAFFT not found. Downloading portable MAFFT...
if not exist "%ROOT%.bin\mafft" mkdir "%ROOT%.bin\mafft"
powershell -command "Invoke-WebRequest -Uri 'https://mafft.cbrc.jp/alignment/software/mafft-7.520-win64-signed.zip' -OutFile '%ROOT%.bin\mafft\mafft.zip'"
powershell -command "Expand-Archive -Path '%ROOT%.bin\mafft\mafft.zip' -DestinationPath '%ROOT%.bin\mafft' -Force"
del "%ROOT%.bin\mafft\mafft.zip"

set "PATH=%ROOT%.bin\mafft\mafft-win;%PATH%"
:mafft_done

REM -- 3. Node.js ------------------------
if exist "%ROOT%.bin\node\node-v22.14.0-win-x64\node.exe" (
    set "PATH=%ROOT%.bin\node\node-v22.14.0-win-x64;%PATH%"
)

where node >nul 2>&1
if not errorlevel 1 goto node_done
echo [..] Node.js not found. Downloading portable Node.js v22.14.0...
if exist "%ROOT%.bin\node" rmdir /s /q "%ROOT%.bin\node"
mkdir "%ROOT%.bin\node"
powershell -command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip' -OutFile '%ROOT%.bin\node\node.zip'"
powershell -command "Expand-Archive -Path '%ROOT%.bin\node\node.zip' -DestinationPath '%ROOT%.bin\node' -Force"
del "%ROOT%.bin\node\node.zip"

set "PATH=%ROOT%.bin\node\node-v22.14.0-win-x64;%PATH%"
:node_done

for /f "tokens=*" %%v in ('%PYTHON_CMD% --version 2^>^&1') do echo [OK] %%v
for /f "tokens=*" %%v in ('node --version 2^>^&1') do echo [OK] Node %%v
echo [OK] MAFFT installed

REM -- 4. Python Environment -------------
if exist "%ROOT%.venv" goto venv_done
echo [..] Creating Python virtual environment...
%PYTHON_CMD% -m venv "%ROOT%.venv"
:venv_done

echo [..] Installing Python dependencies...
"%ROOT%.venv\Scripts\python.exe" -m pip install -q -r "%ROOT%backend\requirements.txt"
echo [OK] Python packages ready

REM -- 5. Node Environment ---------------
if exist "%ROOT%frontend\node_modules" goto npm_done
echo [..] Installing Node dependencies (first run)...
cd /d "%ROOT%frontend"
call npm.cmd install
cd /d "%ROOT%"
:npm_done
echo [OK] Node packages ready

REM -- 6. Start Services -----------------
echo [..] Starting backend on http://localhost:8000 ...
start "Oligool-Backend" /D "%ROOT%" /min "%ROOT%.venv\Scripts\python.exe" -m uvicorn backend.main:app --host 0.0.0.0 --port 8000

echo [..] Starting frontend on http://localhost:5173 ...
start "Oligool-Frontend" /D "%ROOT%frontend" /min npm.cmd run dev -- --host 0.0.0.0

echo [..] Opening application window...
"%ROOT%.venv\Scripts\python.exe" webview_app.py

echo.
echo +-----------------------------------------------+
echo ^|  Oligool is running!                          ^|
echo ^|  Frontend -^> http://localhost:5173              ^|
echo ^|  Backend  -^> http://localhost:8000              ^|
echo ^|  Close this window to stop                    ^|
echo +-----------------------------------------------+
echo.
echo [..] Shutting down...
taskkill /fi "WINDOWTITLE eq Oligool-Backend*" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Oligool-Frontend*" /f >nul 2>&1
echo [OK] Stopped.
