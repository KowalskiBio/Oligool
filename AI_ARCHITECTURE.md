# Oligool — AI Architecture Reference

This file exists so an AI assistant can orient itself quickly without re-reading every source file.

---

## What the App Does

Oligool is a **DNA oligo design desktop tool** for molecular biologists. The workflow is:

1. User pastes a DNA sequence → NCBI BLAST runs to find homologs.
2. Hits are aligned with MAFFT (MSA).
3. The MSA is displayed interactively; the user picks a conserved region.
4. The app auto-designs primers (MOLigo-style internal oligos, or flanking PCR primers).
5. Thermodynamic properties are evaluated via IDT API and `strider-dna` (Mg²⁺-aware secondary structure / ΔG).
6. Results can be exported as a report.

The app ships as a **desktop app** (PyInstaller + pywebview) and also works as a local web app.

---

## Repo Structure

```
Oligool/
├── backend/                  # Python FastAPI server
│   ├── main.py               # ALL API endpoints (source of truth for backend logic)
│   ├── alignment.py          # MAFFT wrapper (run_msa)
│   ├── blast.py              # NCBI BLAST polling wrapper (run_blast)
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── App.tsx           # Root: all global state, layout, step machine
│       ├── components/
│       │   ├── MSAViewer.tsx         # Canvas-based MSA alignment viewer (largest file ~1733 lines)
│       │   ├── QueryViewer.tsx       # Lower panel: query sequence + IDT primer analysis (~1770 lines)
│       │   ├── FlankingPrimersPanel.tsx  # Flanking PCR primer design panel (~1010 lines)
│       │   ├── MOLigoPanel.tsx       # MOLigo (internal splint) oligo designer
│       │   ├── QueryReport.tsx       # Hidden printable complete design report for PDF generation
  │       │   ├── BlastResults.tsx      # BLAST hit table + filtering UI
  │       │   ├── DimerSVG.tsx          # SVG renderer for dimer secondary structures
  │       │   ├── HairpinSVG.tsx        # SVG renderer for hairpin secondary structures
  │       │   └── RabbitGame.tsx        # Easter egg: rabbit game shown during BLAST wait
│       ├── utils/dna.ts              # DNA utility functions (GC%, Tm, reverse complement, etc.)
│       ├── utils/report.ts           # Complete design report text builder + download helper
│       └── constants/tags.ts         # Shared tag/label constants
├── webview_app.py            # Desktop entry point (pywebview wrapping the FastAPI server)
├── oligool.spec              # PyInstaller spec for building .app / .exe
└── scripts/                  # Build scripts (Mac, Windows, Ubuntu)
```

---

## Backend API (`backend/main.py`)

All endpoints are at `http://localhost:8000` (or the value of `VITE_API_BASE`).

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/search` | POST | Kick off BLAST + MAFFT pipeline (SSE streaming response) |
| `/align` | POST | Run MAFFT alignment on provided sequences |
| `/moligize` | POST | Design MOLigo internal splint oligos from a target region |
| `/idt/token` | POST | Get IDT OAuth2 token |
| `/idt/analyze` | POST | Analyze oligos via IDT API (Tm, hairpin, dimer ΔG) — also runs `strider-dna` for Mg²⁺-aware folding |
| `/flanking_primers/design` | POST | Auto-design flanking PCR primers for a region |

**Key internal functions in `main.py`:**
- `find_best_len()` (line ~269) — finds optimal oligo lengths by iterating ΔG
- `get_stats()` (line ~315) — computes GC%, Tm for a sequence window
- `add_strider_analysis()` (line ~600) — appends Mg²⁺-aware ΔG from `strider-dna`
- `find_dg_and_raw()` (line ~711) — extracts ΔG from IDT response
- `design_flanking_primers()` (line ~817) — uses `primer3-py` to design PCR flanking primers

---

## Frontend State Machine (`App.tsx`)

`step` drives the UI: `'input' → 'blasting' → 'aligning' → 'done'`

**Key state in `App`:**
- `alignment` — raw FASTA string of MSA result, passed to `MSAViewer`
- `selectedSequence` — the currently focused sequence (id, seq, start, end in query coordinates)
- `selectedPrimers` — `{ p1, p2 }` MOLigo primer positions (gapped column indices)
- `selectedFlankingPrimers` — `{ fwd, rev }` flanking primer positions
- `navigateTarget` — `{ colStart, colEnd, ts }` — triggers MSAViewer to zoom/pan to a region
- `oligoRegion` — column range user drag-selected in MSA for oligo placement
- IDT credentials stored in `localStorage` and passed down as props

---

## Component Roles & Key Interfaces

### `MSAViewer` (canvas-based, ~1733 lines)
- Renders the multiple sequence alignment using `<canvas>` elements.
- **Props:** `alignment` (FASTA), `primers`, `flankingPrimers`, `navigateTarget`, `onOligoRegionSelect`, `onFlankingPrimerClick`, `isDarkMode`
- **Emits:** `onVisibleQueryChange(data)` — fires whenever the viewport scrolls, giving the visible query subsequence (used to sync `QueryViewer`)
- **Interaction:** User drag-selects on the MSA ruler → calls `onOligoRegionSelect(startCol, endCol)`. Clicking flanking primer bars in minimap → calls `onFlankingPrimerClick(colStart, colEnd)`.
- **Coordinate system:** All primer/region coordinates are **gapped MSA column indices** (0-based). The first sequence in the FASTA is assumed to be the query.
- Important constants: `ROW_HEIGHT=18`, `MINIMAP_HEIGHT`, `BP_THRESHOLD=100` (zoom threshold).

### `QueryViewer` (~1770 lines)
- Lower-left panel showing the visible query window + IDT analysis (hairpin, dimer, Tm).
- **Props:** `data` (visible subsequence from MSAViewer), `oligoRegion`, `idtCredentials`, `alignment`, `navigateTarget`, `isDarkMode`, `onPrimersUpdate`, `onFlankingPrimersUpdate`, `onNavigateTo`
- Hosts the MOLigo primer display, IDT API calls, and a `FlankingPrimersPanel` toggle.
- Emits `window.dispatchEvent(new CustomEvent('idt-mg-change', ...))` when Mg²⁺ input changes (App listens).

### `FlankingPrimersPanel` (~1010 lines)
- Designs flanking PCR primers by calling `/flanking_primers/design`.
- **Props:** `querySeq`, `oligoPrimers` (the current MOLigo start/end), `alignment`, `onDesigned`, `isDarkMode`, `onFlankingPrimerClick`
- Coordinate mapping: converts oligo gapped-column positions to ungapped query positions before calling the backend.

### `MOLigoPanel` (~535 lines)
- UI for designing internal MOLigo splint oligos by calling `/moligize`.
- **Props:** defined in `MOLigoProps` interface (line 5).

### `MOLigoReport`
- Hidden printable component for MOLigo design report PDF generation.
- Uses `@media print` CSS to ensure only the report content prints.
- **Props:** `jobName`, `templateSeq`, `moligo1Seq`, `moligo2Seq`, `tagSeq`, `fwdPrimer`, `revPrimer`, `moligoIdtResults`.

### `DimerSVG` / `HairpinSVG`
- Pure SVG renderers. Take a dot-bracket secondary structure string and render it.

### `dna.ts` utils
- `reverseComplement(seq)`, `calcTm(seq)`, `calcGC(seq)`, `parseAlignment(fasta)` — utility belt, no API calls.

---

## External Tools / Dependencies

| Tool | Where Used | Notes |
|------|-----------|-------|
| MAFFT | `backend/alignment.py` | Bundled in `.bin/` for distribution; resolved via `shutil.which` fallback |
| NCBI BLAST | `backend/blast.py` | Remote API (no local install needed) |
| `primer3-py` | `backend/main.py` `/flanking_primers/design` | PCR primer design |
| `strider-dna` | `backend/main.py` `add_strider_analysis()` | Mg²⁺-aware RNA/DNA folding ΔG (replaced ViennaRNA) |
| IDT API | `backend/main.py` `/idt/*` | OAuth2; credentials stored in browser `localStorage` |
| Tailwind CSS v4 | Frontend | Via `@tailwindcss/vite` plugin |
| pywebview | `webview_app.py` | Desktop window wrapper |

---

## Coordinate Systems — Critical to Understand

There are **two coordinate systems** in play. Confusing them is the #1 source of bugs:

1. **Gapped MSA column index** — position in the aligned FASTA (includes `-` gap characters). Used in: `MSAViewer`, `selectedPrimers`, `selectedFlankingPrimers`, `navigateTarget`, `oligoRegion`.
2. **Ungapped query position** — position in the raw query sequence (no gaps). Used in: `/flanking_primers/design` API request, `QueryViewer` display, IDT analysis.

`FlankingPrimersPanel` performs the conversion (look for `ungappedOffset` logic there and `ParsedSequence.ungappedOffset` in `MSAViewer`).

---

## Dev Setup

```bash
# Backend
cd /Users/kowalski/Oligool
source .venv/bin/activate        # or venv/
uvicorn backend.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev                      # Vite dev server on :5173
```

`VITE_API_BASE` in `frontend/.env.development` should be `http://localhost:8000`.

---

## Current Branch

Branch `mfold` — recent work: switched secondary structure engine from ViennaRNA → `strider-dna` for Mg²⁺-aware folding. MSAViewer lower panel now supports clicking flanking primer bars to navigate, and users can adjust primer length/position in context window.
