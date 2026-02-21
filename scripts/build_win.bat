@echo off
cd /d "%~dp0\.."

echo Building Windows executable...

:: 1. Build the Node.js Frontend statically
echo Building the static React frontend...
cd frontend
call npm install
call npm run build
cd ..

:: 2. Create a clean packaging environment
echo Setting up Python packaging environment...
python -m venv build_venv
call build_venv\Scripts\activate.bat

:: Upgrade pip to suppress warnings
python -m pip install --upgrade pip

:: Install dependencies needed for compiling
pip install -r backend\requirements.txt
pip install pyinstaller Pillow pywebview

:: 3. Download Portable MAFFT (Windows)
echo Downloading portable MAFFT to embed in application...
if not exist .bin\mafft mkdir .bin\mafft
if not exist .bin\mafft\mafft-win\mafft.bat (
    :: Note: Windows requires a slightly different URL typically, or pulling the zip.
    :: We'll use the official Windows port of MAFFT.
    curl -sL "https://mafft.cbrc.jp/alignment/software/mafft-7.505-win64.zip" -o mafft_win.zip
    powershell -command "Expand-Archive -Force mafft_win.zip .bin\mafft"
    del mafft_win.zip
)

:: 4. Generate ICO file natively ensuring Windows transparency is retained
echo Converting logo to .ico...
python -c "from PIL import Image; import os; img=Image.open('frontend/public/rabbit_oligool.png').convert('RGBA'); img.save('frontend/public/rabbit_oligool.ico', format='ICO', sizes=[(256,256), (128,128), (64,64), (32,32)])"

:: Clean up old builds
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

:: 5. Run PyInstaller
echo Bundling Oligool with PyInstaller...
pyinstaller --noconfirm --clean oligool.spec

echo Build complete. Executable is in dist\Oligool.exe
pause
