@echo off
:: Set up root path
pushd "%~dp0\.."
set "ROOT=%CD%"
echo.
echo ==================================================
echo   Oligoool Windows App Builder
echo ==================================================
echo Project ROOT: %ROOT%

:: --- 0. Node.js Environment (if needed) ---
echo [0/5] Checking for Node.js...
if exist "%ROOT%\.bin\node\node-v22.14.0-win-x64\node.exe" (
    set "PATH=%ROOT%\.bin\node\node-v22.14.0-win-x64;%PATH%"
)
where node >nul 2>&1
if not errorlevel 1 goto node_done
echo Downloading portable Node.js v22.14.0...
if exist "%ROOT%\.bin\node" rmdir /s /q "%ROOT%\.bin\node"
mkdir "%ROOT%\.bin\node"
powershell -command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip' -OutFile '%ROOT%\.bin\node\node.zip'"
if %ERRORLEVEL% neq 0 ( set "FAIL_STEP=node download" & goto :error )
powershell -command "Expand-Archive -Path '%ROOT%\.bin\node\node.zip' -DestinationPath '%ROOT%\.bin\node' -Force"
if %ERRORLEVEL% neq 0 ( set "FAIL_STEP=node extraction" & goto :error )
del "%ROOT%\.bin\node\node.zip"
set "PATH=%ROOT%\.bin\node\node-v22.14.0-win-x64;%PATH%"
:node_done

:: --- 1. Static Frontend ---
echo [1/5] Building static React frontend...
cd /d "%ROOT%\frontend"
call npm.cmd install
if %ERRORLEVEL% neq 0 ( set "FAIL_STEP=npm install" & goto :error )
call npm.cmd run build
if %ERRORLEVEL% neq 0 ( set "FAIL_STEP=npm run build" & goto :error )

:: --- 2. Python Environment ---
echo [2/5] Setting up Python packaging environment...
cd /d "%ROOT%"
if exist build_venv rmdir /s /q build_venv
python -m venv build_venv
if %ERRORLEVEL% neq 0 ( set "FAIL_STEP=python venv creation" & goto :error )
call "%ROOT%\build_venv\Scripts\activate.bat"

python -m pip install --upgrade pip
pip install -r backend\requirements.txt
if %ERRORLEVEL% neq 0 ( set "FAIL_STEP=pip backend requirements" & goto :error )
pip install pyinstaller Pillow pywebview
if %ERRORLEVEL% neq 0 ( set "FAIL_STEP=pip packaging dependencies" & goto :error )

:: --- 3. Portable MAFFT ---
echo [3/5] Checking for portable MAFFT...
if not exist "%ROOT%\.bin\mafft" mkdir "%ROOT%\.bin\mafft"
if exist "%ROOT%\.bin\mafft\mafft-win\mafft.bat" goto :skip_mafft

echo Downloading MAFFT from official source...
curl -L "https://mafft.cbrc.jp/alignment/software/mafft-7.526-win64-signed.zip" -o "%ROOT%\mafft_win.zip"
if %ERRORLEVEL% neq 0 ( set "FAIL_STEP=curl download mafft" & goto :error )

echo Extracting MAFFT...
powershell -command "Expand-Archive -Force '%ROOT%\mafft_win.zip' '%ROOT%\.bin\mafft'"
if %ERRORLEVEL% neq 0 ( set "FAIL_STEP=mafft extraction" & goto :error )
del "%ROOT%\mafft_win.zip"

:skip_mafft
echo MAFFT is ready.

:: --- 4. Native Icons ---
echo [4/5] Generating native Windows icons...
python -c "from PIL import Image; img=Image.open('frontend/public/rabbit_oligool.png').convert('RGBA'); img.save('frontend/public/rabbit_oligool.ico', format='ICO', sizes=[(256,256), (128,128), (64,64), (32,32)])"
if %ERRORLEVEL% neq 0 ( set "FAIL_STEP=icon generation" & goto :error )

:: --- 5. PyInstaller ---
echo [5/5] Bundling application with PyInstaller...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

set "SPEC_FILE="
if exist "%ROOT%\oligool.spec" (
    set "SPEC_FILE=%ROOT%\oligool.spec"
) else if exist "%ROOT%\primerool.spec" (
    set "SPEC_FILE=%ROOT%\primerool.spec"
)

if not defined SPEC_FILE (
    echo [ERROR] Neither oligool.spec nor primerool.spec found!
    set "FAIL_STEP=finding pyinstaller spec file"
    goto :error
)

pyinstaller --noconfirm --clean "%SPEC_FILE%"
if %ERRORLEVEL% neq 0 ( set "FAIL_STEP=pyinstaller bundling" & goto :error )

echo.
echo ==================================================
echo   BUILD SUCCESSFUL!
echo   Location: %ROOT%\dist\Oligool
echo ==================================================
pause
popd
exit /b 0

:error
echo.
echo !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
echo   BUILD FAILED at step: %FAIL_STEP%
echo !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
pause
popd
exit /b 1
