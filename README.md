# 🐰 Oligool

Oligool is a native desktop application for molecular biologists designed to streamline the design, alignment, and analysis of genetic sequences and oligos.

## Core Capabilities

### 1. Dual-Source Search & Fetch
- **NCBI & Ensembl Integration**: Toggle between data sources to find genes, transcripts, and sequences across thousands of organisms.
- **Smart Filtering**: Persistent search parameters (E-value, Identity %, Organism) that survive application restarts.

### 2. Interactive MSA Viewer
- **High-Performance Alignment**: Powered by MAFFT for rapid multiple sequence alignment.
- **2D Navigation**: Interactive minimap for scrubbing through massive alignments and identifying conservation patterns and variations.

### 3. "Oligize!" Design
- **Precision Splitting**: Pivot genomic regions into two contiguous oligos with exact control over shift and lengths.
- **Real-time Delta G**: Live integration with IDT OligoAnalyzer to analyze hairpin formation and self-dimerization (requires IDT API credentials).

### 4. "Primerize!" Schematic
- **Visual Assembly**: A high-fidelity SVG schematic of your design, showing Forward and Reverse Primer Binding Sites (PBS) and TAG sequences.
- **🔡 Seq Mode**: Toggle high-detail view to see base-by-base lettering along the schematic's architecture.
- **Persistence**: Your TAGs, PBS sequences, and design preferences are remembered automatically.

---

## Setup & Development

### Local Development
```bash
# 1. Start the Frontend (Vite)
cd frontend
npm install
npm run dev

# 2. Start the Backend (FastAPI) in a separate terminal
# The backend uses a virtual environment and launches the native webview
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
python3 webview_app.py
```

### Native Application Bundling

#### macOS (.app / .dmg)
Build a standalone Mac bundle with a native transparent icon:
```bash
./scripts/build_mac.sh
```
Find the output in `dist/Oligool.app`.

#### Windows (.exe)
Build a single-file executable for Windows (must run on Windows):
```batch
scripts\build_win.bat
```
Find the output in `dist\Oligool.exe`. 

*Note: If you do not have Python, Node.js, or MAFFT installed, the build script will automatically download and install everything required to package the application.*

#### Running from Source (Windows)
Double-click `start.bat`. This script will automatically check for Python, Node.js, and MAFFT. If any are missing, it will silently download and install them in the background before launching the application.

---

## Privacy & Persistence
All credentials (NCBI Key, IDT API) and design configurations are stored locally on your machine via `localStorage`. No sensitive data is transmitted to the cloud except for direct API calls to NCBI/IDT.
