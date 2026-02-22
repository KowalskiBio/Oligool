@echo off
:: Set up root path
pushd "%~dp0\.."
set "ROOT=%CD%"
echo.
echo ==================================================
echo   Oligoool Windows App Builder
echo ==================================================
echo Project ROOT: %ROOT%

:: --- 1. Static Frontend ---
echo [1/5] Building static React frontend...
cd /d "%ROOT%\frontend"
call npm install
if %ERRORLEVEL% neq 0 ( set "FAIL_STEP=npm install" & goto :error )
call npm run build
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
curl -L "https://mafft.cbrc.jp/alignment/software/mafft-7.505-win64.zip" -o "%ROOT%\mafft_win.zip"
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

pyinstaller --noconfirm --clean "%ROOT%\oligool.spec"
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
