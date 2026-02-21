#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
#  Oligool – one-click launcher (macOS / Linux)
# ──────────────────────────────────────────────────────────
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# ── colours ────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}▸${NC} $1"; }
ok()    { echo -e "${GREEN}✔${NC} $1"; }
fail()  { echo -e "${RED}✖ $1${NC}"; exit 1; }

# ── setup local paths ──────────────────────────────────────
NODE_DIR="$ROOT/.bin/node"
MAFFT_DIR="$ROOT/.bin/mafft"

if [ -d "$NODE_DIR/bin" ]; then
    export PATH="$NODE_DIR/bin:$PATH"
fi

if [ -d "$MAFFT_DIR" ]; then
    OS="$(uname -s)"
    if [ "$OS" = "Darwin" ]; then
        export PATH="$MAFFT_DIR/mafft-mac:$PATH"
        export MAFFT_BINARIES="$MAFFT_DIR/mafft-mac/mafftdir/libexec"
    elif [ "$OS" = "Linux" ]; then
        export PATH="$MAFFT_DIR/mafft-linux64:$PATH"
        export MAFFT_BINARIES="$MAFFT_DIR/mafft-linux64/mafftdir/libexec"
    fi
fi

# ── prerequisite checks ───────────────────────────────────
command -v python3 >/dev/null 2>&1 || fail "Python 3 is required but not found. Install from https://python.org"

if ! command -v node >/dev/null 2>&1; then
    info "Node.js not found. Downloading portable Node.js..."
    NODE_VERSION="v22.14.0"
    OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
    ARCH="$(uname -m)"
    if [ "$ARCH" = "x86_64" ]; then ARCH="x64"; fi
    if [ "$ARCH" = "aarch64" ]; then ARCH="arm64"; fi
    mkdir -p "$NODE_DIR"
    curl -sL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${OS}-${ARCH}.tar.gz" | tar -xz -C "$NODE_DIR" --strip-components=1
    export PATH="$NODE_DIR/bin:$PATH"
fi

if ! command -v mafft >/dev/null 2>&1; then
    info "MAFFT not found. Downloading portable MAFFT..."
    mkdir -p "$MAFFT_DIR"
    OS="$(uname -s)"
    if [ "$OS" = "Darwin" ]; then
        curl -sL "https://mafft.cbrc.jp/alignment/software/mafft-7.520-mac.zip" -o "$MAFFT_DIR/mafft.zip"
        unzip -q "$MAFFT_DIR/mafft.zip" -d "$MAFFT_DIR"
        rm "$MAFFT_DIR/mafft.zip"
        export PATH="$MAFFT_DIR/mafft-mac:$PATH"
        export MAFFT_BINARIES="$MAFFT_DIR/mafft-mac/mafftdir/libexec"
    elif [ "$OS" = "Linux" ]; then
        curl -sL "https://mafft.cbrc.jp/alignment/software/mafft-7.520-linux.tgz" | tar -xz -C "$MAFFT_DIR"
        export PATH="$MAFFT_DIR/mafft-linux64:$PATH"
        export MAFFT_BINARIES="$MAFFT_DIR/mafft-linux64/mafftdir/libexec"
    fi
fi

ok "Python $(python3 --version 2>&1 | awk '{print $2}')"
ok "Node   $(node --version)"
ok "MAFFT  installed"
# ── Python virtual-env & dependencies ─────────────────────
if [ ! -d "$ROOT/.venv" ]; then
    info "Creating Python virtual environment…"
    python3 -m venv "$ROOT/.venv"
fi
source "$ROOT/.venv/bin/activate"
info "Installing Python dependencies…"
pip install -q -r "$ROOT/backend/requirements.txt"
ok "Python packages ready"

# ── Node dependencies ─────────────────────────────────────
if [ ! -d "$ROOT/frontend/node_modules" ]; then
    info "Installing Node dependencies (first run)…"
    (cd "$ROOT/frontend" && npm install)
fi
ok "Node packages ready"

# ── cleanup on exit ───────────────────────────────────────
BACKEND_PID=""
FRONTEND_PID=""
cleanup() {
    echo ""
    info "Shutting down…"
    [ -n "$BACKEND_PID"  ] && kill "$BACKEND_PID"  2>/dev/null && ok "Backend stopped"
    [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null && ok "Frontend stopped"
    exit 0
}
trap cleanup INT TERM

# ── start backend ─────────────────────────────────────────
info "Starting backend on http://localhost:8000 …"
(cd "$ROOT" && python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000) &
BACKEND_PID=$!

# ── start frontend ────────────────────────────────────────
info "Starting frontend on http://localhost:5173 …"
(cd "$ROOT/frontend" && npm run dev -- --host 0.0.0.0) &
FRONTEND_PID=$!

# ── start native desktop window ───────────────────────────
info "Opening application window…"
(cd "$ROOT" && python3 webview_app.py)

echo ""

# When the pywebview window closes, we shut down the servers automatically
cleanup
