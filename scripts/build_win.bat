@echo off
setlocal enabledelayedexpansion

:: Set ROOT to the project base directory
cd /d "%~dp0\.."
set "ROOT=%CD%"
echo Project ROOT is: %ROOT%

echo Building Windows executable...

:: 1. Build the Node.js Frontend statically
echo Building the static React frontend...
cd /d "%ROOT%\frontend"
call npm install
if %ERRORLEVEL% neq 0 (echo Frontend install failed! && exit /b 1)
call npm run build
if %ERRORLEVEL% neq 0 (echo Frontend build failed! && exit /b 1)

:: 2. Create a clean packaging environment
echo Setting up Python packaging environment...
cd /d "%ROOT%"
if exist build_venv rmdir /s /q build_venv
python -m venv build_venv
call "%ROOT%\build_venv\Scripts\activate.bat"

:: Upgrade pip and install dependencies
python -m pip install --upgrade pip
pip install -r backend\requirements.txt
pip install pyinstaller Pillow pywebview

:: 3. Download Portable MAFFT (Windows)
echo Downloading portable MAFFT to embed in application...
if not exist "%ROOT%\.bin\mafft" mkdir "%ROOT%\.bin\mafft"
if not exist "%ROOT%\.bin\mafft\mafft-win\mafft.bat" (
    echo Fetching MAFFT from official source...
    curl -L "https://mafft.cbrc.jp/alignment/software/mafft-7.505-win64.zip" -o "%ROOT%\mafft_win.zip"
    if %ERRORLEVEL% neq 0 (
        echo Curl failed to download MAFFT! Check your internet connection.
        exit /b 1
    )
    if exist "%ROOT%\mafft_win.zip" (
        powershell -command "Expand-Archive -Force '%ROOT%\mafft_win.zip' '%ROOT%\.bin\mafft'"
        del "%ROOT%\mafft_win.zip"
    ) else (
        echo MAFFT zip was not found after download!
        exit /b 1
    )
)

:: 4. Generate ICO file natively
echo Converting logo to .ico...
python -c "from PIL import Image; img=Image.open('frontend/public/rabbit_oligool.png').convert('RGBA'); img.save('frontend/public/rabbit_oligool.ico', format='ICO', sizes=[(256,256), (128,128), (64,64), (32,32)])"

:: Clean up old builds
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

:: 5. Run PyInstaller
echo Bundling Oligool with PyInstaller...
pyinstaller --noconfirm --clean "%ROOT%\oligool.spec"

echo Build complete. Executable is in dist\Oligool.exe
pause
