#!/bin/bash
set -e

echo "================================================="
echo "       Oligool Ubuntu Server Setup Script        "
echo "================================================="

# Must be run from the root of the project
if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
    echo "ERROR: Please run this script from the root of the Oligool project folder."
    exit 1
fi

echo ">> [1/5] Installing system dependencies (requires sudo)..."
sudo apt-get update
sudo apt-get install -y curl python3 python3-venv python3-pip build-essential wget

# Remove apt mafft if present (it lacks multithreading support)
sudo apt-get remove -y mafft 2>/dev/null || true

echo ">> [2/5] Building MAFFT from source (with multithreading)..."
MAFFT_VERSION="7.525"
ORIG_DIR=$(pwd)
cd /tmp
wget -q "https://mafft.cbrc.jp/alignment/software/mafft-${MAFFT_VERSION}-without-extensions-src.tgz"
tar xzf "mafft-${MAFFT_VERSION}-without-extensions-src.tgz"
cd "mafft-${MAFFT_VERSION}-without-extensions/core"
# Enable multithreading (pthread) — this is what the apt package is missing
sed -i 's/^#\s*ENABLE_MULTITHREAD/ENABLE_MULTITHREAD/' Makefile
make clean
make -j$(nproc)
sudo make install
cd /tmp
rm -rf "mafft-${MAFFT_VERSION}-without-extensions" "mafft-${MAFFT_VERSION}-without-extensions-src.tgz"
cd "$ORIG_DIR"

# Ensure Node.js is installed
if ! command -v node &> /dev/null || [[ $(node -v) != v20* && $(node -v) != v22* && $(node -v) != v18* ]]; then
    echo ">> Installing/Updating Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo ">> [3/5] Building the Frontend (Vite/React)..."
cd frontend
npm install
npm run build
cd ..

echo ">> [4/5] Setting up the Python Virtual Environment & Backend..."
python3 -m venv backend/venv
source backend/venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt
# Uvicorn is needed for serving via systemd
pip install uvicorn

echo ">> [5/5] Configuring systemd service (oligool.service)..."
CURRENT_DIR=$(pwd)
CURRENT_USER=$USER

# Create the systemd service file
cat <<EOF | sudo tee /etc/systemd/system/oligool.service > /dev/null
[Unit]
Description=Oligool Server (FastAPI + Vite Static)
After=network.target

[Service]
User=$CURRENT_USER
WorkingDirectory=$CURRENT_DIR
ExecStart=$CURRENT_DIR/backend/venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the service
sudo systemctl daemon-reload
sudo systemctl enable oligool
sudo systemctl restart oligool

echo "================================================="
echo "✅ Setup Complete!"
echo "Oligool is now running securely in the background."
echo ""
echo "🌐 Access it at: http://<YOUR_VM_IP>:8000"
echo ""
echo "Useful Commands:"
echo " - View live logs: sudo journalctl -u oligool -f"
echo " - Restart server: sudo systemctl restart oligool"
echo " - Stop server:    sudo systemctl stop oligool"
echo "================================================="
