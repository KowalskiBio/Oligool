# Oligool

Multiple Sequence Alignment Viewer using React, FastAPI, and MAFFT.

## Prerequisites

- Node.js
- Python 3.8+
- MAFFT (`brew install mafft`)

## Getting Started

### macOS

1. Navigate to the `dist/` folder and double-click the **`Oligool.app`** application icon.
2. The application will launch instantly as a native desktop application with a custom dock icon.

**Building for macOS:**
To compile the native PyInstaller macOS application bundle yourself (including MAFFT binaries):
```bash
./scripts/build_mac.sh
```
This will compile the React frontend, bundle the FastAPI backend, and generate the native macOS `Oligool.app` inside the `dist/` directory.

### Windows

1. Double-click **`start.bat`** in the project root.
2. The script will automatically install Node.js (if missing), install backend and frontend dependencies, and launch the application as a standalone desktop window entirely offline.

---

## Development / Manual Setup

If you prefer to run the raw source code manually:

```bash
# 1. Start the Frontend (Vite)
cd frontend
npm install
npm run dev

# 2. Start the Backend (FastAPI) in a separate terminal
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
python3 webview_app.py
```
