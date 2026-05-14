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

### 5. Flanking Primers Pipeline
- **Automated Design**: Integrates with Primer3 for precise generation of flanking primers upstream and downstream of your MOLigo targets based on user-defined thermodynamic parameters.
- **Manual Mode Bypass**: Allows explicit highlighted selection directly within the sequence viewer to instantly test specific primer regions, bypassing Primer3 algorithms.
- **Per-Primer QC Diagnostics**: Triggers granular, on-demand IDT structural analysis (hairpins, self-dimers, and pairwise heterodimers) for each individual primer candidate directly within the UI, ensuring production-ready selections.

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

### Ubuntu Server Setup

To instantly deploy Oligool on a fresh Ubuntu VM:

1. Copy or clone the `Oligool` project folder onto your VM.
2. Navigate into the root of the project:
   ```bash
   cd Oligool
   ```
3. Run the automated setup script (requires `sudo` privileges to install system dependencies and set up the service):
   ```bash
   chmod +x scripts/setup_ubuntu.sh
   sudo bash scripts/setup_ubuntu.sh
   ```

*What the script does:*
- Installs all system dependencies (Python, Node.js, `mafft`, etc.).
- Builds the Vite frontend.
- Sets up a Python virtual environment and installs the FastAPI backend.
- Automatically creates and starts an `oligool.service` systemd daemon so the app runs in the background on port 8000 and restarts on boot.

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

## Remote Access (Cloudflare Tunnel)

Since Oligool runs as a standard web service on port `8000`, you can easily expose it securely to the internet without opening router ports.

**If you already have a Cloudflare Tunnel (e.g., on a Raspberry Pi):**
The easiest method is to go to your **Cloudflare Zero Trust Dashboard** -> **Access** -> **Tunnels**. Click your existing tunnel, go to **Public Hostname**, and add a new hostname:
- **Subdomain**: `oligool`
- **Domain**: `yourdomain.com`
- **Service Type**: `HTTP`
- **URL**: `YOUR_VM_IP:8000` (e.g., `192.168.1.100:8000`)

**To run a dedicated tunnel directly on the Ubuntu VM:**
1. Install `cloudflared` on the VM.
2. Authenticate: `cloudflared tunnel login`
3. Create a tunnel: `cloudflared tunnel create oligool-tunnel`
4. Route traffic: `cloudflared tunnel route dns oligool-tunnel oligool.yourdomain.com`
5. Run the tunnel: `cloudflared tunnel run --url http://localhost:8000 oligool-tunnel`

---

## Privacy & Persistence
All credentials (NCBI Key, IDT API) and design configurations are stored locally on your machine via `localStorage`. No sensitive data is transmitted to the cloud except for direct API calls to NCBI/IDT.
