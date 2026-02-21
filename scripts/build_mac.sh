#!/bin/bash
set -e

# ==========================================
# Oligool macOS App Builder
# ==========================================
# This script bundles the Oligool application into a standalone macOS .app
# and prepares a distributable .dmg disk image using PyInstaller and Vite.

cd "$(dirname "$0")/.."
ROOT=$(pwd)

echo "Starting Oligool macOS build process..."

# 1. Build the Node.js Frontend statically
# ------------------------------------------
echo "Building the static React frontend..."
cd frontend
npm install
npm run build
cd ..

# 2. Set up Python build environment
# ------------------------------------------
echo "Setting up Python packaging environment..."
python3 -m venv build_venv
source build_venv/bin/activate
python3 -m pip install --upgrade pip
pip install -r backend/requirements.txt
pip install pyinstaller Pillow pywebview

# 3. Download Portable MAFFT
# ------------------------------------------
echo "Downloading portable MAFFT to embed in application..."
mkdir -p .bin/mafft/mafft-mac
if [ ! -f .bin/mafft/mafft-mac/mafft-mac/mafft ]; then
    # The official repo migrated their version numbers. 7.505 is still active.
    curl -sL "https://mafft.cbrc.jp/alignment/software/mafft-7.505-mac.zip" -o mafft.zip
    unzip -q mafft.zip -d .bin/mafft/mafft-mac
    rm mafft.zip
fi

# 4. Convert raw logo to .icns format
# ------------------------------------------
echo "Converting logo to .icns natively via sips and iconutil..."
ICON_PNG="frontend/public/rabbit_oligool.png"
ICON_ICNS="frontend/public/rabbit_oligool.icns"
ICONSET="frontend/public/rabbit_oligool.iconset"

mkdir -p "$ICONSET"
sips -z 16 16     "$ICON_PNG" --out "$ICONSET/icon_16x16.png" >/dev/null
sips -z 32 32     "$ICON_PNG" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
sips -z 32 32     "$ICON_PNG" --out "$ICONSET/icon_32x32.png" >/dev/null
sips -z 64 64     "$ICON_PNG" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
sips -z 128 128   "$ICON_PNG" --out "$ICONSET/icon_128x128.png" >/dev/null
sips -z 256 256   "$ICON_PNG" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256   "$ICON_PNG" --out "$ICONSET/icon_256x256.png" >/dev/null
sips -z 512 512   "$ICON_PNG" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512   "$ICON_PNG" --out "$ICONSET/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$ICON_PNG" --out "$ICONSET/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$ICONSET" -o "$ICON_ICNS" || echo "Native icon generation failed."
rm -rf "$ICONSET"

# clean up old pyinstaller builds
rm -rf build dist
mkdir -p dist

# 4. Run PyInstaller
# ------------------------------------------
echo "Bundling Oligool with PyInstaller... (This will take a while)"
# We compile the Python code, the Vite `dist` folder, and pywebview into one
pyinstaller --noconfirm --clean oligool.spec

# 5. Create DMG (Optional but recommended)
# ------------------------------------------
echo "Packaging complete! Generating .dmg file..."

# Force natively inject the transparent icon directly to the bundle resource fork (similar to Get Info -> Paste)
python3 -c "import Cocoa; ws = Cocoa.NSWorkspace.sharedWorkspace(); img = Cocoa.NSImage.alloc().initWithContentsOfFile_('frontend/public/rabbit_oligool.png'); ws.setIcon_forFile_options_(img, 'dist/Oligool.app', 0)" || echo "Native Icon override failed."

mkdir -p dist/dmg_stage
cp -r dist/Oligool.app dist/dmg_stage/
rm -f dist/Oligool.dmg
hdiutil create -volname "Oligool Installer" -srcfolder dist/dmg_stage -ov -format UDZO dist/Oligool.dmg || (echo "DMG creation failed, skipping..." && true)
rm -rf dist/dmg_stage

echo "=========================================="
echo "Build finished successfully!"
echo "Find your native application bundle and dmg at:"
echo "  - dist/Oligool.app"
echo "  - dist/Oligool.dmg"
echo "=========================================="
