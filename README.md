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

**Building for macOS (.app / .dmg):**
To compile the native application and disk image (including MAFFT binaries):
1. Run the automated packager:
   ```bash
   ./scripts/build_mac.sh
   ```
2. The standalone **`Oligool.app`** and a distributable **`Oligool.dmg`** will be generated in the `dist/` directory.

**Building for Windows (.exe):**
To generate a standalone Windows executable, you must run the build on a Windows machine:
1. Install dependencies: `pip install -r backend/requirements.txt pyinstaller pywebview`
2. Build the frontend: `cd frontend && npm install && npm run build && cd ..`
3. Run PyInstaller:
   ```bash
   pyinstaller --noconfirm --clean oligool.spec
   ```
4. **Important:** Distribute the entire `dist/Oligool/` folder (zip it). The `Oligool.exe` inside requires the surrounding library files to function.

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
