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

echo ">> [1/4] Installing system dependencies (requires sudo)..."
sudo apt-get update
sudo apt-get install -y curl python3 python3-venv python3-pip mafft build-essential

# Ensure Node.js is installed
if ! command -v node &> /dev/null || [[ $(node -v) != v20* && $(node -v) != v22* && $(node -v) != v18* ]]; then
    echo ">> Installing/Updating Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo ">> [2/4] Building the Frontend (Vite/React)..."
cd frontend
npm install
npm run build
cd ..

echo ">> [3/4] Setting up the Python Virtual Environment & Backend..."
python3 -m venv backend/venv
source backend/venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt
# Uvicorn is needed for serving via systemd
pip install uvicorn

echo ">> [4/4] Configuring systemd service (oligool.service)..."
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
