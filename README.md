# Oligool

Oligool is a desktop app for molecular biologists. It fetches gene and transcript sequences from NCBI or Ensembl, aligns them with MAFFT, and designs oligos and primers on the aligned result. The backend is FastAPI served in a native webview window. The frontend is React with Vite.

## Download (beta)

The current release is **v0.9.8 beta**. Everything the app needs (Python, the backend, MAFFT, the interface) is inside the installer; nothing else has to be installed first.

🪟 **[Windows 10/11 (64-bit)](https://github.com/KowalskiBio/Oligool/releases/download/v0.9.8/Oligool-Setup-0.9.8-windows-x86_64.exe)** · 🍎 **[macOS (Apple Silicon)](https://github.com/KowalskiBio/Oligool/releases/download/v0.9.8/Oligool-0.9.8-macos-arm64.pkg)** · 💻 **[macOS (Intel)](https://github.com/KowalskiBio/Oligool/releases/download/v0.9.8/Oligool-0.9.8-macos-x86_64.pkg)** · 🐧 **[Linux (Debian/Ubuntu)](https://github.com/KowalskiBio/Oligool/releases/download/v0.9.8/Oligool-linux-x86_64.tar.gz)**

**Windows.** Run the setup file and follow the wizard; no admin rights are needed. If SmartScreen shows "Windows protected your PC", click **More info → Run anyway** (the installer is not code-signed yet). On the rare PC without the Microsoft WebView2 runtime, the wizard installs it automatically. Oligool then starts from the Start menu or the desktop shortcut.

**macOS.** Pick the package for your chip: Apple Silicon (M1 and newer) or Intel. Double-click it and follow the installer; macOS asks for your password to place Oligool in Applications. If macOS blocks the package as coming from an unidentified developer, right-click it and choose **Open**.

**Linux.** Extract the archive (`tar -xzf Oligool-linux-x86_64.tar.gz`), install the windowing runtime once (`sudo apt install gir1.2-webkit2-4.1`), and run `./Oligool/Oligool`.

All files are also listed on the [Releases page](https://github.com/KowalskiBio/Oligool/releases). Releases are marked *Pre-release* while Oligool is in beta; please report problems through [GitHub Issues](https://github.com/KowalskiBio/Oligool/issues).

## Features

- Sequence search against NCBI or Ensembl, with organism, E-value, and identity filters that persist between sessions.
- MSA viewer built on an anchor grid over the query sequence: minimap with GC track, zoom and pan, and per-row markers for mismatches, deletions, and insertions.
- Oligize: split a region into two contiguous oligos with exact control over shift and length. Hairpin and self-dimer ΔG comes live from IDT OligoAnalyzer (requires IDT API credentials).
- Primerize schematic: SVG view of the design with forward and reverse primer binding sites and TAG sequences, plus a seq mode with base-by-base lettering.
- Flanking primers: Primer3 designs them upstream and downstream of MOLigo targets, or you select the regions directly in the MSA viewer. Each candidate runs on-demand IDT QC for hairpins, self-dimers, and heterodimers.
- Standalone design reports with pasted images and notes, exportable to PDF and TXT.

## Run from source

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Backend, in a second terminal. This also opens the app window:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
python3 webview_app.py
```

You need Python 3, Node.js, and MAFFT installed. On Windows, `start.bat` checks for all three and installs whatever is missing.

## Ubuntu server

Clone the repo on the VM and from its root run:

```bash
chmod +x scripts/setup_ubuntu.sh
sudo bash scripts/setup_ubuntu.sh
```

The script installs system dependencies (Python, Node.js, MAFFT), builds the frontend, creates a virtualenv with the backend, and registers an `oligool.service` systemd unit that serves the app on port 8000 and restarts on boot.

## Desktop bundles

macOS:

```bash
./scripts/build_mac.sh
```

Output is `dist/Oligool.app`.

Windows, from a Windows machine:

```batch
scripts\build_win.bat
```

Output is `dist\Oligool.exe`. The Windows scripts download Python, Node.js, and MAFFT when missing.

## Remote access

Oligool is a web service on port 8000, so a Cloudflare Tunnel exposes it without opening router ports. If you already run a tunnel, add a public hostname in the Zero Trust dashboard: subdomain `oligool`, service type HTTP, URL `YOUR_VM_IP:8000`.

For a dedicated tunnel on the VM:

```bash
cloudflared tunnel login
cloudflared tunnel create oligool
cloudflared tunnel route dns oligool oligool.yourdomain.com
cloudflared tunnel run --url http://localhost:8000
```

## Design

`frontend/DESIGN.md` specifies the interface design system: IBM Plex typography, zinc palette, shared tokens.

## What's new

The version button in the top right of the app opens the changelog for the current release.

## Privacy

Credentials (NCBI key, IDT API) and design settings stay in `localStorage` on your machine. Data leaves the machine only for direct API calls to NCBI and IDT.

## License

GPL-3.0. See `LICENSE`.
