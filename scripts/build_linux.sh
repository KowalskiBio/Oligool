#!/bin/bash
set -e

# ==========================================
# Oligool Linux Bundle Builder
# ==========================================
# Bundles Oligool with PyInstaller into dist/Oligool and packs it as
# dist/Oligool-linux-x86_64.tar.gz. Mirrors build_mac.sh / build_win.bat.
# Desktop note: pywebview's Linux backend needs GTK/WebKitGTK at RUNTIME.
# End users must have them installed (Debian/Ubuntu: gir1.2-webkit2-4.1).

cd "$(dirname "$0")/.."
ROOT=$(pwd)

echo "Starting Oligool Linux build process..."

# 1. Build the Node.js Frontend statically
# ------------------------------------------
echo "Building the static React frontend..."
cd frontend
npm install --no-audit --no-fund --legacy-peer-deps || echo "[WARNING] npm install returned non-zero code. Continuing..."
npm run build
cd ..

# 2. Set up Python build environment
# ------------------------------------------
# --system-site-packages: pywebview imports `gi` (PyGObject), which comes from
# the system packages python3-gi + gir1.2-webkit2-4.1 and is impractical to
# build from pip. Requires the distro python (CI: noble ships 3.12).
echo "Setting up Python packaging environment..."
python3 -m venv --system-site-packages build_venv
source build_venv/bin/activate
python3 -m pip install --upgrade pip
pip install -r backend/requirements.txt
pip install pyinstaller Pillow pywebview

# 3. Portable MAFFT
# ------------------------------------------
# Extract the Debian/Ubuntu mafft package. Its layout matches the convention
# used by the mac/win bundles: a bash driver plus helper binaries in a single
# dir, which alignment.py exposes via MAFFT_BINARIES when frozen.
echo "Extracting portable MAFFT from the Debian package..."
mkdir -p .bin/mafft/mafft-linux/bin .bin/mafft/mafft-linux/libexec
if [ ! -f .bin/mafft/mafft-linux/bin/mafft ]; then
    TMPD=$(mktemp -d)
    ( cd "$TMPD" && apt-get download mafft )
    dpkg-deb -x "$TMPD"/mafft_*_amd64.deb "$TMPD/pkg"
    cp "$TMPD/pkg/usr/bin/mafft" .bin/mafft/mafft-linux/bin/mafft
    cp -R "$TMPD/pkg/usr/lib/mafft/lib/mafft/." .bin/mafft/mafft-linux/libexec/
    chmod +x .bin/mafft/mafft-linux/bin/mafft
    rm -rf "$TMPD"
fi

# The Debian package omits the tiny `version` helper the driver uses to verify
# helper binaries match (it aborts with "v0.000 != vX" without it). Regenerate
# it from the driver's own version string; upstream prints the bare number
# (e.g. "7.505", no leading v, no date).
MAFFT_VER=$(grep -m1 '^version=' .bin/mafft/mafft-linux/bin/mafft | cut -d'"' -f2)
MAFFT_NUM="${MAFFT_VER#v}"
printf '#!/bin/sh\necho "%s"\n' "${MAFFT_NUM%% *}" > .bin/mafft/mafft-linux/libexec/version
chmod +x .bin/mafft/mafft-linux/libexec/version

# The driver must honor MAFFT_BINARIES so it can find helpers after relocation.
grep -q 'MAFFT_BINARIES' .bin/mafft/mafft-linux/bin/mafft \
    || { echo "ERROR: MAFFT driver lacks MAFFT_BINARIES support"; exit 1; }

echo "Smoke-testing bundled MAFFT..."
SMOKE_DIR=$(mktemp -d)
printf '>seq1\nACGTACGTACGT\n>seq2\nACGTACGAACGT\n' > "$SMOKE_DIR/t.fa"
MAFFT_BINARIES="$ROOT/.bin/mafft/mafft-linux/libexec" \
TMPDIR="$SMOKE_DIR" MAFFT_TMPDIR="$SMOKE_DIR" \
    "$ROOT/.bin/mafft/mafft-linux/bin/mafft" --auto --quiet "$SMOKE_DIR/t.fa" > /dev/null
rm -rf "$SMOKE_DIR"

# 4. Run PyInstaller
# ------------------------------------------
echo "Bundling Oligool with PyInstaller... (This will take a while)"
rm -rf build dist
mkdir -p dist
pyinstaller --noconfirm --clean oligool.spec

# 5. Create tarball
# ------------------------------------------
echo "Packaging dist/Oligool as tarball..."
tar -czf dist/Oligool-linux-x86_64.tar.gz -C dist Oligool -C "$ROOT" LICENSE

echo "=========================================="
echo "Build finished successfully!"
echo "  - dist/Oligool/Oligool (onedir bundle)"
echo "  - dist/Oligool-linux-x86_64.tar.gz"
echo "=========================================="
