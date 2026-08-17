import sys
import os
# Robustly add project root to sys.path
root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Literal, Optional
from backend.alignment import run_msa
from backend.blast import run_blast
import json
import threading as _threading
from collections import OrderedDict
from functools import lru_cache
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
import asyncio
import logging
import math
import requests


def _load_env_file(path: str) -> None:
    """Load KEY=VALUE lines from a local .env file into os.environ (no-op if absent)."""
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


_load_env_file(os.path.join(os.path.dirname(__file__), ".env"))

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_frontend_dir():
    if getattr(sys, 'frozen', False):
        if sys.platform == 'darwin' and '.app/Contents/MacOS' in sys.executable:
            base_path = os.path.abspath(os.path.join(os.path.dirname(sys.executable), '..', 'Resources'))
        else:
            base_path = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
    else:
        base_path = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    return os.path.join(base_path, "frontend", "dist")

frontend_dir = get_frontend_dir()
if os.path.exists(os.path.join(frontend_dir, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dir, "assets")), name="assets")

    wallpapers_dir = os.path.join(frontend_dir, "wallpapers")
    if os.path.exists(wallpapers_dir):
        app.mount("/wallpapers", StaticFiles(directory=wallpapers_dir), name="wallpapers")

    @app.get("/")
    def serve_index():
        return FileResponse(os.path.join(frontend_dir, "index.html"))

    # To serve the logo or vite.svg from public/ which end up in dist/
    @app.get("/{filename}.png")
    @app.get("/{filename}.svg")
    def serve_public_images(filename: str):
        file_path = os.path.join(frontend_dir, f"{filename}.png")
        if not os.path.exists(file_path):
            file_path = os.path.join(frontend_dir, f"{filename}.svg")
        if os.path.exists(file_path):
            return FileResponse(file_path)
        raise HTTPException(status_code=404, detail="File not found")



class ReportEmailRequest(BaseModel):
    job_name: str
    html: str


@app.post("/api/report/email")
async def email_report(req: ReportEmailRequest):
    """Send a copy of a user-generated HTML report via Resend."""
    if not req.html.strip():
        raise HTTPException(status_code=400, detail="Report is empty.")

    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Email is not configured on this server.")

    to_addr = os.environ.get("REPORT_NOTIFY_EMAIL", "rejtarv@sci.muni.cz")
    filename = f"{(req.job_name or 'oligool').strip() or 'oligool'}_report.html"

    import base64
    try:
        resp = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "from": "Oligool <notifications@octoslave.karamazov.website>",
                "to": [to_addr],
                "subject": f"Oligool report: {req.job_name or 'Untitled'}",
                "html": "<p>A report was generated in Oligool. See the attached file.</p>",
                "attachments": [
                    {"filename": filename, "content": base64.b64encode(req.html.encode("utf-8")).decode("ascii")}
                ],
            },
            timeout=15,
        )
        resp.raise_for_status()
    except requests.RequestException as e:
        logging.exception("Failed to send report email")
        raise HTTPException(status_code=502, detail=f"Failed to send email: {e}")

    return {"success": True}


class SearchRequest(BaseModel):
    sequence: str
    max_hits: int = 50
    api_key: str = ""
    organism: Optional[str] = None
    e_value: Optional[float] = None
    perc_identity: Optional[float] = None
    filter_matches: bool = False


class BlastHit(BaseModel):
    accession: str
    description: str
    evalue: float
    identity: float
    query_cover: float
    sstart: Optional[int] = None
    send: Optional[int] = None
    rank: Optional[int] = None


@app.post("/search")
async def search_and_align(request: SearchRequest):
    """
    Full pipeline: BLAST a query sequence, then run MSA on the top hits.
    Uses StreamingResponse to send blank spaces periodically, keeping Cloudflare alive 
    during 100+ second calculations.
    """
    if not request.sequence.strip():
        raise HTTPException(status_code=400, detail="Sequence cannot be empty.")

    def run_heavy_pipeline():
        try:
            # Step 1: Run BLAST
            blast_hits, blast_meta, filtered_hits = run_blast(
                request.sequence,
                max_hits=request.max_hits,
                api_key=request.api_key,
                organism=request.organism,
                e_value=request.e_value,
                perc_identity=request.perc_identity,
                filter_matches=request.filter_matches,
            )

            if not blast_hits and not filtered_hits:
                return {"error": True, "detail": "No BLAST hits found."}

            # Step 2: Prepare sequences for MSA (query + non-filtered hits + filtered hits)
            lines = request.sequence.strip().split("\n")
            if lines[0].startswith(">"):
                query_id = lines[0][1:].strip()
                query_seq = "".join(l.strip() for l in lines[1:] if not l.startswith(">"))
            else:
                query_id = "Query"
                query_seq = request.sequence.strip().replace(" ", "").replace("\n", "")

            msa_input = [{"id": query_id, "seq": query_seq}]
            # 100% matches go immediately after the query so they appear first in the MSA
            for hit in filtered_hits:
                full_id = f"{hit['accession']} {hit['description']}"
                msa_input.append({"id": full_id, "seq": hit["sequence"]})
            for hit in blast_hits:
                full_id = f"{hit['accession']} {hit['description']}"
                msa_input.append({"id": full_id, "seq": hit["sequence"]})

            # Step 3: Run MSA
            alignment = run_msa(msa_input)

            # Build hit summary for the frontend
            hit_summary = [
                {
                    "accession": h["accession"],
                    "description": h["description"],
                    "evalue": h["evalue"],
                    "identity": h["identity"],
                    "query_cover": h["query_cover"],
                    "sstart": h.get("sstart"),
                    "send": h.get("send"),
                    "rank": h.get("rank"),
                }
                for h in blast_hits
            ]

            filtered_summary = [
                {
                    "accession": h["accession"],
                    "description": h["description"],
                    "evalue": h["evalue"],
                    "identity": h["identity"],
                    "query_cover": h["query_cover"],
                    "sstart": h.get("sstart"),
                    "send": h.get("send"),
                    "rank": h.get("rank"),
                }
                for h in filtered_hits
            ]

            return {
                "blast_hits": hit_summary,
                "filtered_hits": filtered_summary,
                "blast_meta": blast_meta,
                "alignment": alignment,
                "num_hits": len(blast_hits),
            }
        except Exception as e:
            return {"error": True, "detail": str(e)}

    async def generate_response():
        # Schedule the heavy blocking work on a background thread
        task = asyncio.create_task(asyncio.to_thread(run_heavy_pipeline))
        
        while not task.done():
            # Yield a space character over the TCP stream to prevent Cloudflare Timeout
            yield b" "
            
            # Wait 15 seconds or until the task finishes, whichever comes first
            done, pending = await asyncio.wait([task], timeout=15.0)
            if done:
                break
                
        # Send the finalized, perfectly formatted JSON string at the very end
        result = task.result()
        yield json.dumps(result).encode("utf-8")

    return StreamingResponse(generate_response(), media_type="application/json")


# Keep the old /align endpoint for direct MSA usage
class Sequence(BaseModel):
    id: str
    seq: str


class AlignmentRequest(BaseModel):
    sequences: List[Sequence]


@app.post("/align")
async def align_sequences(request: AlignmentRequest):
    if len(request.sequences) < 2:
        raise HTTPException(
            status_code=400,
            detail="At least two sequences are required for alignment.",
        )
    try:
        data = [s.model_dump() for s in request.sequences]
        alignment = run_msa(data)
        return {"alignment": alignment}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



from typing import Dict

# Strider duplex Tm alongside primer3 calc_tm; None means "not available" (UI shows —).
# Since the native-tm branch of the strider fork, melting_temperature itself is
# Rust-accelerated (strider._native), so no extra fast path is needed here.
try:
    from strider import melting_temperature as _strider_melting_temperature
except Exception as _exc:
    logging.warning("Strider duplex Tm unavailable (need strider-dna >= 1.2.0 in %s): %s — tm_strider will be null", sys.executable, _exc)
    _strider_melting_temperature = None


class _ResultCache:
    """In-memory per-engine result memoization for ThermoEngine.mfe/pfunc.

    The engine's own ``cache`` parameter (engine.py) is duck-typed: the public
    mfe/pfunc methods call ``self.cache.get(key)`` / ``self.cache.set(key, result)``
    when ``self.cache`` is truthy.  This dict-backed wrapper satisfies that
    interface.  Because ``_thermo_engine_cached`` is itself lru_cached on
    (material, celsius, sodium, magnesium, parameter_set, dangles), the same
    engine instance (and its cache) is reused across requests for the same
    conditions, so repeated analyses of the same primer sequence are instant.
    A different paramset/salt/T yields a different engine and a fresh cache.
    """

    def __init__(self):
        self._store: dict[str, object] = {}

    def __bool__(self) -> bool:
        return True

    def get(self, key: str):
        return self._store.get(key)

    def set(self, key: str, value) -> None:
        self._store[key] = value


@lru_cache(maxsize=32)
def _thermo_engine_cached(material: str, celsius: float, sodium_m: float, magnesium_m: float,
                         parameter_set_name: str = "native", dangles: int = 2):
    """LRU ThermoEngine per salt/temperature/params — building the parameter tables per
    request is pure overhead; engines are stateless across mfe/subopt calls.

    ``parameter_set_name`` selects the thermodynamic parameter set:
      "native"        — SantaLucia 2004 DNA parameters (strider's default)
      "mathews2004-dna" — Mathews 2004 DNA parameters (matches IDT/ViennaRNA)

    The engine carries an in-memory ``_ResultCache`` so repeated mfe/pfunc calls
    on the same sequence under the same conditions are memoized across requests
    (e.g. the Mathews/SantaLucia toggle round-trip).
    """
    from strider import ThermoEngine
    cache = _ResultCache()
    if parameter_set_name == "native":
        return ThermoEngine(material=material, celsius=celsius, sodium=sodium_m,
                            magnesium=magnesium_m, dangles=dangles, cache=cache)
    from strider.thermo.parameters import load_parameters
    ps = load_parameters(parameter_set_name)
    return ThermoEngine(material=material, celsius=celsius, sodium=sodium_m,
                        magnesium=magnesium_m, parameter_set=ps, dangles=dangles, cache=cache)


def strider_duplex_tm(seq, *, mv_conc, dv_conc, dntp_conc, dna_conc):
    """Duplex Tm (°C) from strider. Args use primer3 units: salts/dNTP in mM, DNA in nM.

    Uses strider's NN engine with the von Ahsen (2001) sodium-equivalent recipe
    for Mg2+ (the same conversion primer3/IDT/Biopython use), instead of
    strider.duplex_tm, whose mixed-regime salt correction is broken (6-10 °C low;
    upstream issue EmilioVenegas/strider#10). Revert to plain duplex_tm once a
    fixed strider release ships.
    """
    if _strider_melting_temperature is None or not seq:
        return None
    try:
        free_mg_mM = max(0.0, float(dv_conc) - float(dntp_conc))
        sodium_eq_M = (float(mv_conc) + 120.0 * math.sqrt(free_mg_mM)) / 1000.0
        tm = _strider_melting_temperature(
            seq,
            strand_conc_M=float(dna_conc) * 1e-9,
            sodium_M=sodium_eq_M,
            magnesium_M=0.0,
        )
    except Exception:
        logging.exception("strider duplex_tm failed for %s", seq)
        return None
    return round(tm, 1)


class MoligizeRequest(BaseModel):
    sequence: str
    moligo1_shift: int = 0
    moligo2_shift: int = 0
    moligo1_len: int = 20
    moligo2_len: int = 20
    # Advanced Params
    salt_mono: Optional[float] = 50.0
    salt_div: Optional[float] = 10.0
    dntp_conc: Optional[float] = 0.8
    dna_conc: Optional[float] = 400.0
    # Search behavior
    auto_search: bool = False # If true, finds best spot initially
    local_optimize: bool = False # If true, finds best length for CURRENT shift
    scan_full_region: bool = False # If true, disables center bias so the whole sequence is scanned equally
    # Search params
    search_params: Optional[Dict] = None
    engine: Literal["primer3", "strider"] = "primer3"

@app.post("/moligize")
async def moligize_sequence(request: MoligizeRequest):
    try:
        import primer3
        from Bio.Seq import Seq
    except ImportError:
        raise HTTPException(status_code=500, detail="primer3-py or biopython is not installed.")

    # Primer3 Tm calculation parameters (SantaLucia NN model)
    TM_PARAMS = {
        'mv_conc': float(request.salt_mono if request.salt_mono is not None else 50.0),
        'dv_conc': float(request.salt_div if request.salt_div is not None else 10.0),
        'dntp_conc': float(request.dntp_conc if request.dntp_conc is not None else 0.8),
        'dna_conc': float(request.dna_conc if request.dna_conc is not None else 200.0),
        'tm_method': 'santalucia',
        'salt_corrections_method': 'santalucia',
    }

    if request.engine == "strider" and _strider_melting_temperature is None:
        raise HTTPException(status_code=503, detail="Strider engine requested but strider-dna is unavailable")

    def tm_for_search(s):
        if request.engine == "strider":
            return strider_duplex_tm(s, mv_conc=TM_PARAMS['mv_conc'], dv_conc=TM_PARAMS['dv_conc'],
                                    dntp_conc=TM_PARAMS['dntp_conc'], dna_conc=TM_PARAMS['dna_conc'])
        return primer3.calc_tm(s, **TM_PARAMS)

    seq = request.sequence.upper().replace(" ", "").replace("\n", "").replace("-", "")
    if not seq:
        raise HTTPException(status_code=400, detail="Sequence is empty.")

    # 1. Windowing: Center 600bp (or full if shorter)
    # Give a wide window so that manual shifts don't hit the array boundaries
    full_len = len(seq)
    window_len = 600
    
    start_w = 0
    if full_len > window_len:
        start_w = (full_len - window_len) // 2
        end_w = start_w + window_len
        window_seq = seq[start_w:end_w]
        split_idx_in_window = window_len // 2
    else:
        window_seq = seq
        split_idx_in_window = full_len // 2
    
    absolute_split = start_w + split_idx_in_window

    # Handle sequence lengths < 100 for defaults
    # If the user hasn't manually adjusted lengths (they are at 50), and sequence is < 100
    l1 = request.moligo1_len
    l2 = request.moligo2_len

    # --- Local Length Optimization Logic ---
    if request.local_optimize and request.search_params:
        p = request.search_params
        min_l = int(p.get('min_len', 15))
        max_l = int(p.get('max_len', 35))
        tm_min = float(p.get('tm_min', 60.0))
        tm_max = float(p.get('tm_max', 63.0))

        # Helper to find best local length for a shift
        def find_best_len(is_moligo1):
            shift = request.moligo1_shift if is_moligo1 else request.moligo2_shift
            split_pt = split_idx_in_window
            
            best_l = 20
            best_score = float('inf')
            
            for test_l in range(min_l, max_l + 1):
                # Calculate sequence for this specific length and shift
                if is_moligo1:
                    m1_start_target = split_pt + shift
                    m1_end_target = m1_start_target + test_l
                    m1_end = min(len(window_seq), m1_end_target)
                    m1_start = max(0, m1_end - test_l)
                    test_seq = window_seq[m1_start:m1_end]
                else: # moligo2
                    m2_end_target = split_pt + shift
                    m2_start_target = m2_end_target - test_l
                    m2_start = max(0, m2_start_target)
                    m2_end = min(len(window_seq), m2_start + test_l)
                    test_seq = window_seq[m2_start:m2_end]
                
                if not test_seq: continue
                tm = tm_for_search(test_seq)
                if tm is None: continue
                
                # Scoring: 
                # 0 if in Tm range, otherwise abs distance from range
                tm_score = 0
                if tm < tm_min: tm_score = (tm_min - tm) * 10
                elif tm > tm_max: tm_score = (tm - tm_max) * 10
                
                # Favor length closer to 20
                len_score = abs(test_l - 20) * 0.1
                
                total_score = tm_score + len_score
                if total_score < best_score:
                    best_score = total_score
                    best_l = test_l
            return best_l

        l1 = find_best_len(True)
        l2 = find_best_len(False)

    if l1 == 20 and l2 == 20 and len(window_seq) < 40:
        l1 = l2 = len(window_seq) // 2

    def get_stats(s, start_idx, end_idx):
        if not s: return {"seq": "", "len": 0, "tm": 0, "tm_strider": None, "gc": 0, "start": 0, "end": 0}
        return {
            "seq": s,
            "len": len(s),
            "tm": round(primer3.calc_tm(s, **TM_PARAMS), 1),
            "tm_strider": strider_duplex_tm(s, mv_conc=TM_PARAMS['mv_conc'], dv_conc=TM_PARAMS['dv_conc'],
                                            dntp_conc=TM_PARAMS['dntp_conc'], dna_conc=TM_PARAMS['dna_conc']),
            "gc": round((s.count("G") + s.count("C")) / len(s) * 100, 1),
            "start": start_idx,
            "end": end_idx
        }

    # Deterministic fallback (the current logic)
    def get_deterministic(s1_shift, s2_shift, len1, len2):
        # The true split point in the window
        split_pt = split_idx_in_window
        
        # M2 (Left, 5'): ends at split point + its shift
        m2_end_target = split_pt + s2_shift
        m2_start_target = m2_end_target - len2
        
        # apply bounds bounds
        m2_start = max(0, m2_start_target)
        m2_end = min(len(window_seq), m2_start + len2)
        
        # M1 (Right, 3'): starts at split point + its shift
        m1_start_target = split_pt + s1_shift
        m1_end_target = m1_start_target + len1
        
        # apply bounds 
        m1_end = min(len(window_seq), m1_end_target)
        m1_start = max(0, m1_end - len1)
        
        m2_fwd = window_seq[m2_start:m2_end]
        m1_fwd = window_seq[m1_start:m1_end]
        
        return m1_fwd, m2_fwd, m1_start, m1_end, m2_start, m2_end

    params_not_met = False
    param_warnings = []
    
    # ── Handle Search / Stability ──
    # If auto_search is True, we initially find the best spot based on params.
    # To stop "jumping" during manual tune (+/-, drags), auto_search must be False.
    if request.auto_search and request.search_params is not None:
        p: Dict = request.search_params
        min_l = int(p.get('min_len', 15))
        max_l = int(p.get('max_len', 35))
        tm_min = float(p.get('tm_min', 58.0))
        tm_max = float(p.get('tm_max', 63.0))
        tm_diff = float(p.get('tm_diff', 1.5))
        preferred_len = (l1 + l2) / 2

        split_pt = split_idx_in_window
        search_min, search_max = 10, min(60, len(window_seq))

        left_by_end, right_by_start = {}, {}
        for length in range(search_min, search_max + 1):
            for start in range(0, len(window_seq) - length + 1):
                end = start + length
                s = window_seq[start:end]
                tm = tm_for_search(s)
                if tm is None: continue
                if tm_min <= tm <= tm_max:
                    left_by_end.setdefault(end, []).append((s, start, end, tm, length))
                    right_by_start.setdefault(start, []).append((s, start, end, tm, length))

        best_pair, best_score = None, float('inf')
        for sp in left_by_end:
            if sp in right_by_start:
                for lc in left_by_end[sp]:
                    for rc in right_by_start[sp]:
                        if abs(rc[3] - lc[3]) <= tm_diff:
                            # Center bias is disabled in region-scan mode so every position
                            # in the region is evaluated on Tm/length quality alone.
                            pos_penalty = 0.0 if request.scan_full_region else abs(sp - split_pt) * 0.1
                            score = (abs(rc[4] - preferred_len) + abs(lc[4] - preferred_len)) * 10 + pos_penalty
                            if score < best_score:
                                best_score, best_pair = score, (rc, lc)

        if best_pair:
            rc, lc = best_pair
            moligo1_final, m1_start, m1_end = rc[0], rc[1], rc[2]
            moligo2_final, m2_start, m2_end = lc[0], lc[1], lc[2]
        else:
            moligo1_final, moligo2_final, m1_start, m1_end, m2_start, m2_end = get_deterministic(0, 0, l1, l2)
            params_not_met = True
            param_warnings.append("No optimal pair found; using default positions")
    else:
        # User is editing (non-zero shifts or search_params missing) -> Sticky mode
        moligo1_final, moligo2_final, m1_start, m1_end, m2_start, m2_end = get_deterministic(
            request.moligo1_shift, request.moligo2_shift, l1, l2
        )

    # ── Validation ──
    stats_p1 = get_stats(moligo1_final, start_w + m1_start, start_w + m1_end)
    stats_p2 = get_stats(moligo2_final, start_w + m2_start, start_w + m2_end)
    
    if request.search_params is not None:
        p = request.search_params
        min_l = int(p.get('min_len') if p.get('min_len') is not None else 15)
        max_l = int(p.get('max_len') if p.get('max_len') is not None else 35)
        tm_min = float(p.get('tm_min') if p.get('tm_min') is not None else 58.0)
        tm_max = float(p.get('tm_max') if p.get('tm_max') is not None else 63.0)
        tm_diff = float(p.get('tm_diff') if p.get('tm_diff') is not None else 1.5)
        gc_min = float(p.get('gc_min') if p.get('gc_min') is not None else 0)
        gc_max = float(p.get('gc_max') if p.get('gc_max') is not None else 100)

        # P1
        stats_p1['len_ok'] = min_l <= stats_p1['len'] <= max_l
        stats_p1['tm_ok'] = tm_min <= stats_p1['tm'] <= tm_max
        stats_p1['gc_ok'] = gc_min <= stats_p1['gc'] <= gc_max
        # P2
        stats_p2['len_ok'] = min_l <= stats_p2['len'] <= max_l
        stats_p2['tm_ok'] = tm_min <= stats_p2['tm'] <= tm_max
        stats_p2['gc_ok'] = gc_min <= stats_p2['gc'] <= gc_max
        # Diffs
        tm_diff_actual = abs(stats_p1['tm'] - stats_p2['tm'])
        tm_diff_ok = tm_diff_actual <= tm_diff

        if request.engine == "strider":
            _t1 = stats_p1.get('tm_strider')
            _t2 = stats_p2.get('tm_strider')
            stats_p1['tm_ok'] = _t1 is not None and tm_min <= _t1 <= tm_max
            stats_p2['tm_ok'] = _t2 is not None and tm_min <= _t2 <= tm_max
            if _t1 is not None and _t2 is not None:
                tm_diff_actual = abs(_t1 - _t2)
                tm_diff_ok = tm_diff_actual <= tm_diff
            else:
                tm_diff_actual = None
                tm_diff_ok = False

        _p1_tm = stats_p1['tm_strider'] if request.engine == "strider" else stats_p1['tm']
        _p2_tm = stats_p2['tm_strider'] if request.engine == "strider" else stats_p2['tm']
        
        if not (stats_p1['len_ok'] and stats_p1['tm_ok'] and stats_p1['gc_ok'] and 
                stats_p2['len_ok'] and stats_p2['tm_ok'] and stats_p2['gc_ok'] and tm_diff_ok):
            params_not_met = True
            if not stats_p1['len_ok']: param_warnings.append(f"Oligo 1 length ({stats_p1['len']}) outside range")
            if not stats_p1['tm_ok']: param_warnings.append(f"Oligo 1 Tm ({_p1_tm}°C) outside range")
            if not stats_p1['gc_ok']: param_warnings.append(f"Oligo 1 GC ({stats_p1['gc']}%) outside range")
            if not stats_p2['len_ok']: param_warnings.append(f"Oligo 2 length ({stats_p2['len']}) outside range")
            if not stats_p2['tm_ok']: param_warnings.append(f"Oligo 2 Tm ({_p2_tm}°C) outside range")
            if not stats_p2['gc_ok']: param_warnings.append(f"Oligo 2 GC ({stats_p2['gc']}%) outside range")
            if not tm_diff_ok:
                if tm_diff_actual is not None:
                    param_warnings.append(f"Tm difference ({tm_diff_actual:.1f}°C) exceeds max")
                else:
                    param_warnings.append("Tm difference (unavailable) exceeds max")
    else:
        # Default All OK if no params
        for s in [stats_p1, stats_p2]:
            s['len_ok'] = s['tm_ok'] = s['gc_ok'] = True
        tm_diff_ok = True

    result = {
        "p1": stats_p1,
        "p2": stats_p2,
        "tm_diff_ok": tm_diff_ok,
        "split_idx": absolute_split,
        "params_not_met": params_not_met,
        "param_warnings": param_warnings,
    }
    if request.engine == "strider":
        result["engine"] = "strider"
    return result


class IdtAuthRequest(BaseModel):
    client_id: str
    client_secret: str
    username: Optional[str] = None
    password: Optional[str] = None
    idt_region: str = "eu"


class IdtAnalyzeRequest(BaseModel):
    p1_seq: str
    p2_seq: str
    token: str
    mg_conc: float = 10.0
    mv_conc: float = 50.0
    dntp_conc: float = 0.8
    oligo_conc: float = 0.25
    idt_region: str = "eu"
    parameter_set: str = "mathews2004-dna"  # "mathews2004-dna" (matches IDT) or "native" (SantaLucia 2004)


R_GAS = 1.987e-3  # kcal/(mol*K), matches strider.thermo.engine.R


def _dg_rescale(dh_kcal: float, ds_cal_per_k: float, celsius: float = 25.0) -> float:
    """Two-state ΔG(T) = ΔH − T·ΔS.

    Strider anchors dimer ΔG at 37 °C (``dG37``); IDT's reference ΔG and this
    app's hairpin path report at 25 °C, so dimer values are rescaled to match.
    """
    return round(dh_kcal - (273.15 + celsius) * ds_cal_per_k / 1000.0, 2)


try:
    from strider.thermo.dimer_thermo import (
        DUPLEX_INIT_DG37 as _DUPLEX_INIT_DG37,
        DUPLEX_INIT_DH as _DUPLEX_INIT_DH,
        T_REF as _DIMER_T_REF,
    )
except Exception:  # strider absent — fall back to reporting dH/dS as-is
    _DUPLEX_INIT_DG37 = None


def _dg_rescale_dimer(dh_kcal: float, ds_cal_per_k: float, celsius: float = 25.0) -> float:
    """Dimer ΔG(T) with the bimolecular *initiation* contribution removed.

    Strider folds the duplex-nucleation term (DUPLEX_INIT_DG37/ΔH) into the
    reported dH/dS so its two-state Tm is correct.  IDT OligoAnalyzer reports
    dimer ΔG WITHOUT it (structure-only energy); subtracting the initiation
    contribution ΔG_init(T) = ΔH_init − T·ΔS_init, with
    ΔS_init = (ΔH_init − ΔG37_init)/T_ref, puts strider on IDT's convention
    (e.g. -3.54 vs IDT -3.61 for GCACTACAACCGCTACCGTG instead of -1.64).
    """
    if _DUPLEX_INIT_DG37 is None:
        return _dg_rescale(dh_kcal, ds_cal_per_k, celsius)
    init_ds_cal = (_DUPLEX_INIT_DH - _DUPLEX_INIT_DG37) / _DIMER_T_REF * 1000.0
    return _dg_rescale(dh_kcal - _DUPLEX_INIT_DH, ds_cal_per_k - init_ds_cal, celsius)


def _dimer_init_dg(celsius: float = 25.0) -> float:
    """ΔG(T) of the duplex-initiation term alone, i.e. exactly the constant
    ``_dg_rescale_dimer`` subtracts out of the raw two-state ΔG. Used to rebase
    ``ThermoEngine.pfunc()``'s ensemble ΔG (which keeps the association term,
    same as strider's raw dH/dS) onto the IDT-stripped convention that
    ``Local_DeltaG``/``viz_dg`` already display, so the two numbers are
    directly comparable on screen.
    """
    if _DUPLEX_INIT_DG37 is None:
        return 0.0
    init_ds_cal = (_DUPLEX_INIT_DH - _DUPLEX_INIT_DG37) / _DIMER_T_REF * 1000.0
    return _dg_rescale(_DUPLEX_INIT_DH, init_ds_cal, celsius)


def _idt_host(region: str) -> str:
    return "www.idtdna.com" if region.lower() == "us" else "eu.idtdna.com"


def _extract_idt_delta_g(obj):
    """Extract IDT DeltaG from a dict (ignoring ViennaRNA_DeltaG), dropping
    IDT's placeholder values for unfoldable sequences (e.g. +997.97 kcal/mol)."""
    if not isinstance(obj, dict):
        return None
    for k in ["DeltaG", "deltaG", "deltag", "delta_g", "dG", "Energy", "energy"]:
        if k in obj:
            try:
                val = obj[k]
                if val is not None:
                    fval = float(val)
                    # Real oligo hairpin/dimer ΔG sits well inside (-200, +50);
                    # anything outside is a sentinel, not a measurement.
                    return fval if -200.0 < fval < 50.0 else None
            except (ValueError, TypeError):
                pass
    return None


def _is_single_stem(structure: str) -> bool:
    """Check that a dot-bracket structure is a single unbranched stem (no multiloop).

    All base pairs must be properly nested with strictly increasing left indices
    and strictly decreasing right indices.  Multiloops (multiple sibling stems)
    and pseudoknots are rejected — the frontend's HairpinSVG can only draw
    single-stem hairpins.
    """
    if not structure or '(' not in structure:
        return False
    stack: list[int] = []
    pairs: list[tuple[int, int]] = []
    for i, c in enumerate(structure):
        if c == '(':
            stack.append(i)
        elif c == ')':
            if not stack:
                return False
            pairs.append((stack.pop(), i))
        elif c != '.' and c != '&':
            return False
    if stack:
        return False
    if not pairs:
        return False
    for k in range(1, len(pairs)):
        if not (pairs[k][0] > pairs[k - 1][0] and pairs[k][1] < pairs[k - 1][1]):
            return False
    return True


def _run_strider_analysis(
    p1_seq: str,
    p2_seq: str | None,
    mv_conc: float,
    mg_conc: float,
    dntp_conc: float,
    oligo_conc: float,
    base_temp: float = 25.0,
    parameter_set: str = "mathews2004-dna",
    idt_m1_hairpin=None,
    idt_m1_selfdimer=None,
    idt_m1_analyze=None,
    idt_m2_hairpin=None,
    idt_m2_selfdimer=None,
    idt_m2_analyze=None,
    idt_hetero=None,
):
    """Run strider-dna folding analysis on one or two primer sequences.

    When idt_* kwargs are None, only Strider fields are populated (Local_DeltaG,
    Local_Tm, Local_DotBracket).  When real IDT data is passed, both IDT and
    Strider fields are enriched.  Returns the {m1, m2, pairwise} response shape
    used by both /idt/analyze and /strider/analyze.

    When p2_seq is None, only m1 (hairpin + self-dimer) is computed; m2,
    pairwise, and competition_m2 are returned as null.
    """
    # Use strider-dna for Mg2+-aware dot-bracket structure, local ΔG, and Tm
    try:
        from strider import ThermoEngine
        from strider.thermo.hairpin import hairpin_thermo  # strider >= 0.3.2
        from strider.thermo.dimer_thermo import dimer_thermo  # strider >= 0.3.5
        from strider.thermo.dimer_thermo import dimer_thermo_subopt  # strider >= 0.6.0

        mv_m = mv_conc / 1000.0
        effective_mg = max(0.0, mg_conc - dntp_conc) / 1000.0
        oligo_conc_m = oligo_conc / 1e6

        eng = _thermo_engine_cached('dna', base_temp, mv_m, effective_mg, parameter_set)
        # Dedicated native-SantaLucia engine for ensemble/competition math on the
        # dimer side, mirroring the existing rule that dimer MFE always uses native
        # params regardless of the `parameter_set` toggle (see comment below on
        # `dimer_thermo` dimers-always-native) — mixing paramsets inside one
        # solve_equilibrium() call would be physically incoherent.
        eng_native = _thermo_engine_cached('dna', base_temp, mv_m, effective_mg, "native")

        # Load the ParameterSet object for hairpin_thermo (Tm) if non-default
        _paramset_obj = None
        if parameter_set != "native":
            from strider.thermo.parameters import load_parameters
            _paramset_obj = load_parameters(parameter_set)

        # Hairpin Tm uses strider.thermo.hairpin.hairpin_thermo (>= 0.3.2), the
        # UNImolecular two-state model (Tm = ΔH/ΔS, concentration-independent)
        # with full SantaLucia loop ΔH + salt correction. For strider-dna >= 0.3.3
        # the salt term is the Tan-Chen (2007) TBI whole-helix model for stems
        # >= 6 bp (Mg2+-aware); shorter stems keep the per-base-pair correction.
        # It is bulge-aware and evaluated on the same strider structure we draw.
        # strider's own melting_temperature is BImolecular and only correct for dimers.
        def add_strider_analysis(seq1, hp_data, seq2=None):
            """Strider-dna enrichment for hairpin (seq2=None) or dimer (seq2 provided)."""
            # When IDT returned an error (e.g. 401 with empty token), still run
            # Strider analysis so Local_DeltaG / Local_Tm are available.  Preserve
            # the original IDT error as IDT_Error on each result item.
            idt_error = None
            if isinstance(hp_data, dict) and hp_data.get("error"):
                idt_error = hp_data["error"]
                hp_data = [{}]
            elif not (isinstance(hp_data, list) or isinstance(hp_data, dict)):
                return hp_data

            is_dimer = seq2 is not None
            is_list = isinstance(hp_data, list)
            data_list = hp_data if is_list else [hp_data]

            def _valid_paired(s):
                return '(' in s and s.count('(') == s.count(')')

            if seq2:
                # Use strider's dedicated bimolecular dimer MFE (not the pseudo-
                # hairpin cofold), which finds real inter-strand helices including
                # small interior loops and bulges.
                #
                # Dimers always use the NATIVE (SantaLucia 2004) parameter set,
                # NOT the `parameter_set` toggle that steers hairpins: verified on
                # GCACTACAACCGCTACCGTG the native self-dimer ΔG(25 °C) = -3.54 vs
                # IDT -3.61, whereas mathews2004-dna over-ranks a terminal 2-bp
                # G·C clamp (-4.72) above the same 3-bp helix IDT features.
                # (strider's dimer API now accepts paramset= for callers who
                # deliberately want Mathews dimers.)
                fold_seq = seq1 + seq2
                display_seq = seq1 + '&' + seq2
                def _with_div(s):
                    # Idempotent: skip if '&' already at boundary (eng.mfe includes it; dimer_thermo doesn't).
                    if len(s) > len(seq1) and s[len(seq1)] == '&':
                        return s
                    return s[:len(seq1)] + '&' + s[len(seq1):]
                try:
                    res = dimer_thermo(
                        seq1, seq2,
                        sodium_M=mv_m,
                        magnesium_M=effective_mg,
                        material='dna',
                        structure=None,
                        strand_conc_M=oligo_conc_m,
                        salt_model='auto',
                    )
                    raw_mfe = res.structure
                    if _valid_paired(raw_mfe):
                        viz_struct_raw = raw_mfe
                        viz_dg = _dg_rescale_dimer(res.dH, res.dS)
                        mfe_tm = round(res.tm_celsius, 1) if res.tm_celsius and res.tm_celsius > 1.0 else None
                        try:
                            # Ensemble math always uses native SantaLucia (eng_native), not the
                            # `parameter_set` toggle — same rule as the MFE dimer ΔG above.
                            dimer_pfunc = eng_native.pfunc(seq1, seq2, pair_probs=False)
                            # pfunc's ensemble ΔG keeps the ~1.96 kcal/mol duplex-init/association
                            # term (same convention as res.dH/res.dS) — this is the physically
                            # complete ΔG and is what solve_equilibrium (Part C) must use, since
                            # stripping the association penalty would understate how hard it
                            # actually is to dimerize at real concentrations.
                            ensemble_dg_native = round(float(dimer_pfunc.free_energy), 2)
                            # For DISPLAY, rebase onto the same IDT-stripped convention as
                            # viz_dg/Local_DeltaG so "Ensemble ΔG" is never shown as (confusingly)
                            # weaker than the single MFE structure sitting right next to it —
                            # they're the same physical quantity, just two different reporting
                            # conventions, and the population-fraction math is invariant to the
                            # constant shift either way.
                            ensemble_dg = round(ensemble_dg_native - _dimer_init_dg(base_temp), 2)
                            # dimer_thermo's dedicated MFE search and pfunc's ensemble DP are two
                            # independently-implemented energy models (different internal loop/
                            # coaxial-stacking handling); for very strongly-paired duplexes they can
                            # disagree by a small margin and (rarely) show the ensemble as *weaker*
                            # than the MFE structure it must contain. Clamp display to the physical
                            # invariant ensemble ΔG <= MFE ΔG — matches the population-fraction clamp
                            # below, which already floors this same gap at 0.
                            ensemble_dg = min(ensemble_dg, viz_dg)
                            _diff = max(0.0, viz_dg - ensemble_dg)
                            population_fraction = round(math.exp(-_diff / (R_GAS * (base_temp + 273.15))), 4)
                        except Exception:
                            ensemble_dg_native = None
                            ensemble_dg = None
                            population_fraction = None
                    else:
                        viz_struct_raw = None
                        viz_dg = None
                        mfe_tm = None
                        ensemble_dg_native = None
                        ensemble_dg = None
                        population_fraction = None
                except Exception:
                    viz_struct_raw = None
                    viz_dg = None
                    mfe_tm = None
                    ensemble_dg_native = None
                    ensemble_dg = None
                    population_fraction = None

                subopt_dimers: list[dict] = []
                if dimer_thermo_subopt is not None:
                    try:
                        subopt_res = dimer_thermo_subopt(
                            seq1, seq2,
                            n=5,
                            sodium_M=mv_m,
                            magnesium_M=effective_mg,
                            material='dna',
                            strand_conc_M=oligo_conc_m,
                            salt_model='auto',
                        )
                        for r in subopt_res:
                            subopt_dimers.append({
                                "Sequence": display_seq,
                                "DotBracket": _with_div(r.structure),
                                "DeltaG": _dg_rescale_dimer(r.dH, r.dS),
                                "Tm": round(r.tm_celsius, 1) if r.tm_celsius and r.tm_celsius > 1.0 else None,
                                "BasePairs": r.n_pairs,
                            })
                    except Exception:
                        logging.exception("suboptimal dimer enumeration failed")
            else:
                mfe_result = eng.mfe(seq1)
                raw_mfe = mfe_result.structure
                fold_seq = seq1
                display_seq = seq1
                def _with_div(s): return s

                # Only draw the MFE structure when it actually has base pairs. When the
                # MFE is flat (all dots, ΔG = 0) there is no stable structure — by
                # definition no suboptimal structure can have ΔG < 0, so we must NOT
                # fall back to a positive-ΔG fold that doesn't physically form.
                if _valid_paired(raw_mfe):
                    viz_struct_raw = raw_mfe
                    viz_dg = round(float(mfe_result.energy), 2)
                    try:
                        hairpin_pfunc = eng.pfunc(seq1, pair_probs=False)
                        ensemble_dg = round(float(hairpin_pfunc.free_energy), 2)
                        # eng.mfe() defaults to dangles=2 but pfunc() is always dangle-free, so
                        # the two independently-computed energies can occasionally disagree and
                        # show the ensemble as *weaker* than its own MFE structure — clamp the
                        # displayed value to the physical invariant ensemble ΔG <= MFE ΔG.
                        ensemble_dg = min(ensemble_dg, viz_dg)
                        # No bimolecular association term for a single strand, so no
                        # convention shift is needed here (unlike the dimer branch).
                        ensemble_dg_native = ensemble_dg
                        _diff = max(0.0, viz_dg - ensemble_dg)
                        population_fraction = round(math.exp(-_diff / (R_GAS * (base_temp + 273.15))), 4)
                    except Exception:
                        ensemble_dg_native = None
                        ensemble_dg = None
                        population_fraction = None
                else:
                    viz_struct_raw = None
                    viz_dg = None
                    ensemble_dg_native = None
                    ensemble_dg = None
                    population_fraction = None

                # Tm: unimolecular two-state for hairpins via hairpin_thermo.
                def _struct_tm(structure, energy):
                    try:
                        res = hairpin_thermo(fold_seq, sodium_M=mv_m,
                                             magnesium_M=effective_mg, structure=structure,
                                             paramset=_paramset_obj, dangles=2)
                        t = res.tm_celsius
                    except Exception:
                        t = None
                    return round(t, 1) if t and t > 1.0 else None

                mfe_tm = _struct_tm(viz_struct_raw, viz_dg)

            viz_struct = _with_div(viz_struct_raw) if viz_struct_raw else None

            best_item = None
            best_idt_dg = None
            for item in data_list:
                idt_tm = item.get("thermo") or item.get("MeltingTemperature") or item.get("Tm") or item.get("tm") or item.get("MeltTemp") or item.get("MeltingTemp") or item.get("meltingTemp")
                # Same sentinel class as the ΔG guard: IDT returns absurd Tm
                # placeholders (e.g. 146888.6 °C) when a sequence cannot fold.
                try:
                    if idt_tm is not None and not (-100.0 < float(idt_tm) < 200.0):
                        idt_tm = None
                except (TypeError, ValueError):
                    pass
                item["IDT_Tm"] = idt_tm
                item["Sequence"] = display_seq
                item["Local_DeltaG"] = viz_dg
                item["Local_Tm"] = mfe_tm
                item["Ensemble_DeltaG"] = ensemble_dg
                item["Population_Fraction"] = population_fraction
                # Physically-complete (association-term-kept) ensemble ΔG — not
                # displayed, only fed into the Part C competition solve, which
                # needs the real bimolecular thermodynamics, not the IDT-matching
                # display convention.
                item["Ensemble_DeltaG_Native"] = ensemble_dg_native
                item["SuboptDimers"] = subopt_dimers if is_dimer else []
                if idt_error is not None:
                    item["IDT_Error"] = idt_error
                if viz_struct:
                    item["Local_DotBracket"] = viz_struct
                    # Inject into DotBracket only when IDT gave no structure of
                    # its own — a plain overwrite would keep IDT's ΔG but pair it
                    # with a structure IDT never computed.
                    if not any(item.get(k) for k in (
                        "DotBracket", "AsciiStructure", "VisualPrint",
                        "asciiStructure", "visualPrint", "Bonds",
                    )):
                        item["DotBracket"] = viz_struct
                else:
                    # Strider MFE was flat (no stable structure found locally).
                    # IDT may still have returned a structure under a different
                    # key — normalize it to DotBracket so the frontend can draw it.
                    for k in ("AsciiStructure", "VisualPrint", "asciiStructure", "visualPrint"):
                        val = item.get(k)
                        if val and isinstance(val, str) and '(' in val:
                            item["DotBracket"] = val
                            break
                idt_dg = _extract_idt_delta_g(item)
                # Normalize IDT ΔG to the "DeltaG" key so the frontend can read
                # item.DeltaG regardless of which key IDT used (dG, deltaG, etc.)
                item["DeltaG"] = idt_dg
                if best_item is None or (idt_dg is not None and (best_idt_dg is None or idt_dg < best_idt_dg)):
                    best_item = item
                    best_idt_dg = idt_dg

            final_results = []
            if best_item is not None:
                final_results.append(best_item)

            if not is_dimer:
                seen = {raw_mfe}
                if viz_struct_raw:
                    seen.add(viz_struct_raw)
                # We render at most 4 suboptimal structures (added >= 4 breaks),
                # after dedup/positive-energy filters; enumerating 500 wastes
                # backtrace work — 32 leaves comfortable headroom.
                subs = eng.subopt(fold_seq, gap=5.0, max_structures=32)
                added = 0
                for sub_struct, sub_energy, _ in subs:
                    if added >= 4: break
                    if sub_struct in seen: continue
                    if not _valid_paired(sub_struct): continue
                    if float(sub_energy) >= 0: continue
                    seen.add(sub_struct)
                    sub_dg = round(float(sub_energy), 2)
                    final_results.append({
                        "DotBracket": _with_div(sub_struct),
                        "Sequence": display_seq,
                        "Local_DeltaG": sub_dg,
                        "Local_Tm": _struct_tm(sub_struct, sub_dg),
                        "DeltaG": None,
                        "IDT_Tm": None
                    })
                    added += 1
            else:
                # Expose suboptimal dimer structures (up to 4) in addition to the MFE/best item.
                seen = {viz_struct} if viz_struct else set()
                added = 0
                for sub in subopt_dimers:
                    if added >= 4: break
                    if sub.get("DotBracket") in seen: continue
                    if not _valid_paired(sub.get("DotBracket", "")): continue
                    sub["Local_DeltaG"] = sub.get("DeltaG")
                    sub["Local_Tm"] = sub.get("Tm")
                    sub["DeltaG"] = None
                    sub["IDT_Tm"] = None
                    final_results.append(sub)
                    seen.add(sub["DotBracket"])
                    added += 1

            return final_results if is_list else final_results[0]

        m1_hairpin = add_strider_analysis(p1_seq, idt_m1_hairpin if idt_m1_hairpin is not None else [{}])
        m1_selfdimer = add_strider_analysis(p1_seq, idt_m1_selfdimer if idt_m1_selfdimer is not None else [{}], seq2=p1_seq)
        if p2_seq is not None:
            m2_hairpin = add_strider_analysis(p2_seq, idt_m2_hairpin if idt_m2_hairpin is not None else [{}])
            m2_selfdimer = add_strider_analysis(p2_seq, idt_m2_selfdimer if idt_m2_selfdimer is not None else [{}], seq2=p2_seq)
            hetero = add_strider_analysis(p1_seq, idt_hetero if idt_hetero is not None else [{}], seq2=p2_seq)
        else:
            m2_hairpin, m2_selfdimer, hetero = [{}], [{}], [{}]
    except Exception:
        logging.exception("strider-dna optimization error")
        # Fall back to raw IDT data (or empty) if Strider fails entirely.
        m1_hairpin = idt_m1_hairpin if idt_m1_hairpin is not None else [{}]
        m1_selfdimer = idt_m1_selfdimer if idt_m1_selfdimer is not None else [{}]
        m2_hairpin = idt_m2_hairpin if idt_m2_hairpin is not None else [{}]
        m2_selfdimer = idt_m2_selfdimer if idt_m2_selfdimer is not None else [{}]
        hetero = idt_hetero if idt_hetero is not None else [{}]

    # Each specific endpoint (Hairpin, SelfDimer, HeteroDimer) should return
    # DeltaG directly in its response. We use find_dg to robustly extract it
    # regardless of exact response format variations. We also return the raw data
    # for rendering visualizations on the frontend.
    def find_dg_and_raw(data):
        """Extract DeltaG and return raw data from a single-endpoint response.
        For arrays (multiple hairpins), return TOP 5 items with their individual ΔG values."""
        if not data or isinstance(data, str):
            return {"DeltaG": None, "raw": None}
        if isinstance(data, dict) and "error" in data:
            return data

        # If response is an array (multiple structures found), return TOP 5 with best DeltaG as summary
        if isinstance(data, list):
            if len(data) == 0:
                return {"DeltaG": None, "raw": data}

            # IDT-bearing items first (by IDT ΔG), then strider-only candidates
            # (by Local ΔG). Mixing both engines on one ΔG scale can rank a
            # strider-only fold above IDT's best and leave the summary empty.
            def _sort_key(item):
                idt_dg = _extract_idt_delta_g(item)
                if idt_dg is not None:
                    return (0, idt_dg)
                local_dg = item.get("Local_DeltaG")
                if local_dg is not None:
                    return (1, local_dg)
                return (2, 0.0)

            scored_items = sorted(data, key=_sort_key)
            top_items = scored_items[:5]
            top_idt_dgs = [_extract_idt_delta_g(item) for item in scored_items[:5]]
            top_local_dgs = [item.get("Local_DeltaG") for item in scored_items[:5]]
            top_idt_tms = [item.get("IDT_Tm") for item in scored_items[:5]]
            top_local_tms = [item.get("Local_Tm") for item in scored_items[:5]]
            top_ensemble_dgs = [item.get("Ensemble_DeltaG") for item in scored_items[:5]]
            top_pop_fracs = [item.get("Population_Fraction") for item in scored_items[:5]]

            return {
                "DeltaG": top_idt_dgs[0] if top_idt_dgs else None,
                "all_DeltaG": top_idt_dgs,
                "all_Local_DeltaG": top_local_dgs,
                "all_Ensemble_DeltaG": top_ensemble_dgs,
                "all_Population_Fraction": top_pop_fracs,
                "all_IDT_Tm": top_idt_tms,
                "all_Local_Tm": top_local_tms,
                "raw": top_items
            }

        # If response is a dict, DeltaG and Tm should be at top level
        if isinstance(data, dict):
            dg = _extract_idt_delta_g(data)
            return {
                "DeltaG": dg,
                "Ensemble_DeltaG": data.get("Ensemble_DeltaG"),
                "Population_Fraction": data.get("Population_Fraction"),
                "raw": data,
            }

        return {"DeltaG": None, "raw": None}

    def _first_field(result, key):
        """Pull a field off the MFE item of an add_strider_analysis() result,
        tolerating the non-list/non-dict shapes that function can fall back to
        on error."""
        if isinstance(result, list) and result:
            return result[0].get(key)
        if isinstance(result, dict):
            return result.get(key)
        return None

    def _competition(seq_a, seq_b, selfdimer_dg, hetero_dg, has_hetero, hairpin_pop_frac):
        """Concentration-aware free/hairpin/self-dimer/heterodimer split via
        strider's mass-action solver. Always uses native SantaLucia params
        (eng_native) for every complex fed into one solve_equilibrium() call —
        mixing paramsets across complexes there would be physically incoherent.
        Returns None (rather than raising) if strider is unavailable or the
        Newton solve can't be set up, so this never breaks the rest of the
        response."""
        if selfdimer_dg is None:
            return None
        try:
            from strider.equilibrium import solve_equilibrium
            monomer_a = eng_native.pfunc(seq_a, pair_probs=False).free_energy
            complexes = {
                "A": (["A"], monomer_a),
                "AA": (["A", "A"], selfdimer_dg),
            }
            totals = {"A": oligo_conc_m}
            if has_hetero and hetero_dg is not None:
                monomer_b = eng_native.pfunc(seq_b, pair_probs=False).free_energy
                complexes["B"] = (["B"], monomer_b)
                complexes["AB"] = (["A", "B"], hetero_dg)
                totals["B"] = oligo_conc_m
            else:
                has_hetero = False
            result = solve_equilibrium(complexes, totals, celsius=base_temp)
            total_a = totals["A"]
            p_selfdimer = 2 * result.concentrations.get("AA", 0.0) / total_a
            p_hetero = result.concentrations.get("AB", 0.0) / total_a if has_hetero else 0.0
            p_free = result.strand_free.get("A", 0.0) / total_a
            # Compose with Part B's population fraction: "of the monomer not
            # sequestered in a dimer, X% is in the reported MFE hairpin fold."
            p_hairpin = p_free * hairpin_pop_frac if hairpin_pop_frac is not None else None
            return {
                "P_Free": round(p_free, 4),
                "P_Hairpin": round(p_hairpin, 4) if p_hairpin is not None else None,
                "P_SelfDimer": round(p_selfdimer, 4),
                "P_HeteroDimer": round(p_hetero, 4) if has_hetero else None,
                "Converged": bool(result.converged),
            }
        except Exception:
            logging.exception("hairpin/dimer competition solve failed")
            return None

    # Ensemble_DeltaG_Native (association-term-kept) — not Ensemble_DeltaG
    # (the display-only, IDT-stripped value) — is what the mass-action solve
    # in _competition needs; see the dimer branch of add_strider_analysis.
    _has_hetero = p2_seq is not None and p1_seq != p2_seq
    _hetero_ens_dg = _first_field(hetero, "Ensemble_DeltaG_Native")
    competition_m1 = _competition(
        p1_seq, p2_seq, _first_field(m1_selfdimer, "Ensemble_DeltaG_Native"), _hetero_ens_dg, _has_hetero,
        _first_field(m1_hairpin, "Population_Fraction"),
    )
    if p2_seq is not None:
        competition_m2 = _competition(
            p2_seq, p1_seq, _first_field(m2_selfdimer, "Ensemble_DeltaG_Native"), _hetero_ens_dg, _has_hetero,
            _first_field(m2_hairpin, "Population_Fraction"),
        )
    else:
        competition_m2 = None

    return {
        "m1": {
            "hairpin": find_dg_and_raw(m1_hairpin),
            "self_dimer": find_dg_and_raw(m1_selfdimer),
            "analyze": idt_m1_analyze,
            "competition": competition_m1
        },
        "m2": {
            "hairpin": find_dg_and_raw(m2_hairpin),
            "self_dimer": find_dg_and_raw(m2_selfdimer),
            "analyze": idt_m2_analyze,
            "competition": competition_m2
        },
        "pairwise": find_dg_and_raw(hetero)
    }


@app.post("/idt/token")
async def get_idt_token(request: IdtAuthRequest):
    import requests
    import base64
    import logging

    logger = logging.getLogger(__name__)

    host = _idt_host(request.idt_region)
    url = f"https://{host}/IdentityServer/connect/token"

    try:
        auth_bytes = f"{request.client_id}:{request.client_secret}".encode("utf-8")
        auth_string = base64.b64encode(auth_bytes).decode("ascii")

        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": "Basic " + auth_string,
            "Accept": "application/json"
        }

        payload = {
            "grant_type": "password",
            "scope": "test",
            "username": request.username,
            "password": request.password,
        }

        logger.info("Requesting IDT token for user %s on region %s", request.username, request.idt_region)
        response = requests.post(url, data=payload, headers=headers, timeout=15)

        if not response.ok:
            logger.warning("IDT token request failed for %s on %s: %s %s", request.username, request.idt_region, response.status_code, response.text[:500])
            try:
                err_data = response.json()
                detail = err_data.get("error_description") or err_data.get("error") or response.text
            except Exception:
                detail = response.text
            raise HTTPException(status_code=response.status_code, detail=f"IDT Auth Error: {detail}")

        return response.json()

    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        logger.exception("IDT token request raised exception for %s on %s", request.username, request.idt_region)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/idt/analyze")
async def analyze_idt_oligos(request: IdtAnalyzeRequest):
    import requests
    session = requests.Session()
    session.headers.update({
        "Authorization": f"Bearer {request.token}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    })
    host = _idt_host(request.idt_region)
    base_url = f"https://{host}/restapi/v1/OligoAnalyzer"

    # Limit concurrency to avoid being flagged/throttled by IDT
    semaphore = asyncio.Semaphore(3)

    def hit_idt(endpoint, seq1, seq2=None):
        url = f"{base_url}/{endpoint}"
        params = {}
        # Default payload with salt parameters for all structure types
        payload = {
            "NaConc": request.mv_conc,
            "MgConc": request.mg_conc,
            "dNTPsConc": request.dntp_conc,
            "OligoConc": request.oligo_conc,
            "NucleotideType": "DNA"
        }

        if endpoint == "Hairpin":
            payload["Sequence"] = seq1
            # IDT's web OligoAnalyzer defaults the hairpin folding temperature to
            # 25 °C. Match it so our ΔG/Tm correspond to the website's values.
            payload["FoldingTemp"] = request.temp if hasattr(request, "temp") and request.temp is not None else 25.0
        elif endpoint == "SelfDimer" or endpoint == "HeteroDimer":
            # Pass sequences precisely as 'primary' and 'secondary' query params for proper IDT binding
            params = {"primary": seq1}
            if seq2: params["secondary"] = seq2
            # Note: Dimers often also expect salt params in the body for ΔG calculation
        elif endpoint == "Analyze":
            payload["Sequence"] = seq1

        # Log the exact request for the Hairpin endpoint so users can compare
        # with the IDT website's OligoAnalyzer settings.
        if endpoint == "Hairpin":
            logging.info(
                "IDT Hairpin request — seq=%s NaConc=%s MgConc=%s dNTPsConc=%s OligoConc=%s FoldingTemp=%s",
                seq1, request.mv_conc, request.mg_conc, request.dntp_conc, request.oligo_conc,
                payload.get("FoldingTemp"),
            )

        try:
            # All IDT endpoints typically require POST
            response = session.post(url, json=payload, params=params, timeout=30)

            if not response.ok:
                return {"error": f"IDT {endpoint} Error: {response.status_code} - {response.text}"}
            result = response.json()
            if endpoint == "Hairpin":
                logging.info("IDT Hairpin response — %s", json.dumps(result)[:500])
            return result
        except Exception as e:
            return {"error": str(e)}

    # Use SPECIFIC endpoints for each analysis type in PARALLEL to prevent extreme timeouts.
    async def hit_idt_async(endpoint, seq1, seq2=None):
        async with semaphore:
            return await asyncio.to_thread(hit_idt, endpoint, seq1, seq2)

    try:
        results = await asyncio.gather(
            hit_idt_async("Hairpin", request.p1_seq),
            hit_idt_async("SelfDimer", request.p1_seq),
            hit_idt_async("Analyze", request.p1_seq),
            hit_idt_async("Hairpin", request.p2_seq),
            hit_idt_async("SelfDimer", request.p2_seq),
            hit_idt_async("Analyze", request.p2_seq),
            hit_idt_async("HeteroDimer", request.p1_seq, request.p2_seq)
        )
        m1_hairpin, m1_selfdimer, m1_analyze, m2_hairpin, m2_selfdimer, m2_analyze, hetero = results
    except Exception as e:
        return {"error": f"Parallel execution failed: {str(e)}"}

    # _run_strider_analysis now issues several extra ThermoEngine.pfunc()/
    # solve_equilibrium() calls (ensemble ΔG + competition) on top of the
    # existing mfe/subopt work — run it off the event loop like the IDT calls
    # above, so one slow request can't stall every other concurrent request.
    return await asyncio.to_thread(
        _run_strider_analysis,
        p1_seq=request.p1_seq,
        p2_seq=request.p2_seq,
        mv_conc=request.mv_conc,
        mg_conc=request.mg_conc,
        dntp_conc=request.dntp_conc,
        oligo_conc=getattr(request, "oligo_conc", 0.25),
        base_temp=request.temp if hasattr(request, "temp") and request.temp is not None else 25.0,
        parameter_set=getattr(request, "parameter_set", "mathews2004-dna"),
        idt_m1_hairpin=m1_hairpin,
        idt_m1_selfdimer=m1_selfdimer,
        idt_m1_analyze=m1_analyze,
        idt_m2_hairpin=m2_hairpin,
        idt_m2_selfdimer=m2_selfdimer,
        idt_m2_analyze=m2_analyze,
        idt_hetero=hetero,
    )


class StriderAnalyzeRequest(BaseModel):
    p1_seq: str
    p2_seq: Optional[str] = None
    mg_conc: float = 10.0
    mv_conc: float = 50.0
    dntp_conc: float = 0.8
    oligo_conc: float = 0.25
    parameter_set: str = "mathews2004-dna"  # "mathews2004-dna" (matches IDT) or "native" (SantaLucia 2004)


@app.post("/strider/analyze")
def analyze_strider_oligos(request: StriderAnalyzeRequest):
    """Local-only strider-dna folding analysis (hairpin, self-dimer, hetero-dimer).

    No IDT API call, no credentials needed.  Returns the same {m1, m2, pairwise}
    shape as /idt/analyze, but with IDT-specific fields (DeltaG, IDT_Tm) null
    and only Strider fields (Local_DeltaG, Local_Tm, Local_DotBracket) populated.
    When p2_seq is omitted, only m1 (hairpin + self-dimer) is computed.
    """
    return _run_strider_analysis(
        p1_seq=request.p1_seq,
        p2_seq=request.p2_seq,
        mv_conc=request.mv_conc,
        mg_conc=request.mg_conc,
        dntp_conc=request.dntp_conc,
        oligo_conc=request.oligo_conc,
        parameter_set=getattr(request, "parameter_set", "mathews2004-dna"),
    )


# ────────────────────────────────────────────────────────────────
# Flanking Primers Design  (ported from Primerool)
# ────────────────────────────────────────────────────────────────
class FlankingPrimerParams(BaseModel):
    # The full raw sequence window as used in QueryViewer
    full_seq: str
    # Absolute oligo coordinates in full_seq (0-based, end-exclusive)
    oligo_start: int   # start of leftmost oligo
    oligo_end: int     # end   of rightmost oligo
    # How many bp upstream/downstream of the oligo to include as the design window
    flank_window: int = 200
    # Basic Primer3 constraints
    opt_size: int = 20
    min_size: int = 16
    max_size: int = 27
    opt_tm: float = 58.0
    min_tm: float = 57.0
    max_tm: float = 67.0
    min_gc: float = 20.0
    max_gc: float = 80.0
    num_return: int = 5
    # Thermodynamics (for analyze_primer)
    mv_conc: float = 50.0
    dv_conc: float = 3
    dntp_conc: float = 0.8
    dna_conc: float = 400.0
    
    # Manual Regions (Optional)
    manual_left_start: Optional[int] = None
    manual_left_end: Optional[int] = None
    manual_right_start: Optional[int] = None
    manual_right_end: Optional[int] = None
    engine: Literal["primer3", "strider"] = "primer3"


# Dragging a MOLigo re-fires this endpoint for every intermediate position, so
# identical payloads are served from a small thread-safe cache.  The endpoint
# itself is a sync def: FastAPI runs it in a threadpool, keeping the event loop
# (all other endpoints) responsive while primer3 crunches.
_primer_design_cache: "OrderedDict[str, dict]" = OrderedDict()
_primer_design_cache_lock = _threading.Lock()
_PRIMER_DESIGN_CACHE_MAX = 32


def _design_single_side_strider(flank_seq, *, is_left, min_size, max_size, min_gc, max_gc,
                                opt_size, min_tm, opt_tm, max_tm, therm_kwargs, num_candidates=25):
    from Bio.Seq import Seq
    from strider.thermo.dimer_thermo import dimer_thermo

    mv = therm_kwargs["mv_conc"]
    dv = therm_kwargs["dv_conc"]
    dntp = therm_kwargs["dntp_conc"]
    dna = therm_kwargs["dna_conc"]
    sodium_m = mv / 1000.0
    magnesium_m = max(0.0, dv - dntp) / 1000.0

    considered = 0
    ok_tm = 0
    survivors = []
    n = len(flank_seq)
    for length in range(min_size, max_size + 1):
        for start in range(0, n - length + 1):
            sub = flank_seq[start:start + length]
            considered += 1
            gc = 100.0 * sum(1 for b in sub if b in "GC") / len(sub)
            if not (min_gc <= gc <= max_gc):
                continue
            tm = strider_duplex_tm(sub, mv_conc=mv, dv_conc=dv, dntp_conc=dntp, dna_conc=dna)
            if tm is None:
                continue
            if not (min_tm <= tm <= max_tm):
                continue
            ok_tm += 1
            score = 10 * abs(tm - opt_tm) + abs(length - opt_size)
            survivors.append((score, start, length, sub, tm))

    survivors.sort(key=lambda c: c[0])
    finalists = survivors[:num_candidates]

    eng = _thermo_engine_cached('dna', 25.0, sodium_m, magnesium_m)
    folded = []
    for score, start, length, sub, tm in finalists:
        primer_seq = str(Seq(sub).reverse_complement()) if not is_left else sub
        hairpin_dg = 0.0
        try:
            mfe = eng.mfe(primer_seq)
            hairpin_dg = round(float(mfe.energy), 2)
        except Exception:
            hairpin_dg = 0.0
        homodimer_dg = 0.0
        try:
            res = dimer_thermo(primer_seq, primer_seq, sodium_M=sodium_m, magnesium_M=magnesium_m,
                               material='dna', structure=None, strand_conc_M=dna / 1e9, salt_model='auto')
            homodimer_dg = round(_dg_rescale_dimer(res.dH, res.dS), 2)
        except Exception:
            homodimer_dg = 0.0
        penalty = 2 * max(0, 3 + hairpin_dg) + 1 * max(0, 6 + homodimer_dg)
        folded.append((score + penalty, start, length, primer_seq, tm, hairpin_dg, homodimer_dg))

    folded.sort(key=lambda c: c[0])
    return {
        "candidates": [
            {"start": c[1], "length": c[2], "sequence": c[3], "tm": c[4],
             "hairpin_dg": c[5], "homodimer_dg": c[6]}
            for c in folded
        ],
        "considered": considered,
        "ok_tm": ok_tm,
        "folded": len(folded),
    }


@app.post("/flanking_primers/design")
def design_flanking_primers(req: FlankingPrimerParams):
    try:
        import primer3
    except ImportError:
        raise HTTPException(status_code=500, detail="primer3-py not installed")

    if req.engine == "strider" and _strider_melting_temperature is None:
        raise HTTPException(status_code=503, detail="Strider engine requested but strider-dna is unavailable")

    _cache_key = json.dumps(req.model_dump(), sort_keys=True)
    with _primer_design_cache_lock:
        _hit = _primer_design_cache.get(_cache_key)
        if _hit is not None:
            _primer_design_cache.move_to_end(_cache_key)
            return _hit

    seq = req.full_seq.upper().replace(" ", "").replace("\n", "")
    n   = len(seq)

    if req.oligo_start < 0 or req.oligo_end > n or req.oligo_start >= req.oligo_end:
        raise HTTPException(status_code=400, detail="Invalid oligo coordinates")

    # Upstream = left flank
    if req.manual_left_start is not None and req.manual_left_end is not None:
        up_start = req.manual_left_start
        up_end = req.manual_left_end
    else:
        up_start = max(0, req.oligo_start - req.flank_window)
        up_end = req.oligo_start
    upstream = seq[up_start:up_end]

    # Downstream = right flank
    if req.manual_right_start is not None and req.manual_right_end is not None:
        down_start = req.manual_right_start
        down_end = req.manual_right_end
    else:
        down_start = req.oligo_end
        down_end = min(n, req.oligo_end + req.flank_window)
    downstream = seq[down_start:down_end]

    therm = {
        "mv_conc":   req.mv_conc,
        "dv_conc":   req.dv_conc,
        "dntp_conc": req.dntp_conc,
        "dna_conc":  req.dna_conc,
    }

    overlap_buffer_factor = 5
    primers_request_count = req.num_return * overlap_buffer_factor

    p3_global = {
        "PRIMER_OPT_SIZE":            req.opt_size,
        "PRIMER_MIN_SIZE":            req.min_size,
        "PRIMER_MAX_SIZE":            req.max_size,
        "PRIMER_OPT_TM":              req.opt_tm,
        "PRIMER_MIN_TM":              req.min_tm,
        "PRIMER_MAX_TM":              req.max_tm,
        "PRIMER_MIN_GC":              req.min_gc,
        "PRIMER_MAX_GC":              req.max_gc,
        "PRIMER_NUM_RETURN":          primers_request_count,
        "PRIMER_EXPLAIN_FLAG":        1,
        "PRIMER_PICK_INTERNAL_OLIGO": 0,
        "PRIMER_SALT_MONOVALENT":     req.mv_conc,
        "PRIMER_SALT_DIVALENT":       req.dv_conc,
        "PRIMER_DNTP_CONC":           req.dntp_conc,
        "PRIMER_DNA_CONC":            req.dna_conc,
        "PRIMER_TM_FORMULA":          1,
        "PRIMER_SALT_CORRECTIONS":    1,
    }

    def _round(x, nd=1):
        if x is None: return None
        try: return round(float(x), nd)
        except (ValueError, TypeError): return None

    def _gc(s):
        s = (s or "").upper()
        if not s: return 0.0
        return 100.0 * sum(1 for b in s if b in "GC") / len(s)

    def _analyze(s):
        kwargs = {k: therm[k] for k in ["mv_conc", "dv_conc", "dntp_conc", "dna_conc"]}
        try: tm = primer3.bindings.calc_tm(s, **kwargs)
        except TypeError: tm = primer3.bindings.calc_tm(s)
        try: hp = primer3.bindings.calc_hairpin(s, temp_c=25.0, **kwargs)
        except TypeError: hp = primer3.bindings.calc_hairpin(s)
        try: hd = primer3.bindings.calc_homodimer(s, temp_c=25.0, **kwargs)
        except TypeError: hd = primer3.bindings.calc_homodimer(s)
        return {
            "sequence":   s,
            "length":     len(s),
            "gc_percent": _round(_gc(s), 1),
            "tm":         _round(tm, 1),
            "tm_strider": strider_duplex_tm(s, **kwargs),
            "hairpin":  {"structure_found": bool(getattr(hp, "structure_found", False)), "tm": _round(getattr(hp, "tm", None), 1), "dg": _round((getattr(hp, "dg", None) or 0) / 1000, 2)},
            "homodimer":{"structure_found": bool(getattr(hd, "structure_found", False)), "tm": _round(getattr(hd, "tm", None), 1), "dg": _round((getattr(hd, "dg", None) or 0) / 1000, 2)},
        }

    def _pick_diverse_primers(primers, max_count, min_gap=0):
        picked = []
        picked_set = set()

        for idx, p in enumerate(primers):
            interval = p.get("interval")
            if not interval or len(interval) < 2:
                continue
            s, e = interval[0], interval[1]
            overlaps = False
            for q in picked:
                qs, qe = q["interval"][0], q["interval"][1]
                if e <= qs:
                    if qs - e < min_gap:
                        overlaps = True
                        break
                elif qe <= s:
                    if s - qe < min_gap:
                        overlaps = True
                        break
                else:
                    overlaps = True
                    break
            if not overlaps:
                picked.append(p)
                picked_set.add(idx)
                if len(picked) >= max_count:
                    return picked

        for idx, p in enumerate(primers):
            if idx in picked_set:
                continue
            picked.append(p)
            if len(picked) >= max_count:
                break
        return picked

    results = {"forward": {"num_returned": 0, "primers": [], "explain": ""},
               "reverse": {"num_returned": 0, "primers": [], "explain": ""},
               "pair_metrics": None}

    # ── FORWARD (Left flank → picks LEFT primer from last flank_window bp) ──
    if req.engine == "strider" and upstream and len(upstream) >= req.min_size:
        sres = _design_single_side_strider(upstream, is_left=True, min_size=req.min_size,
                    max_size=req.max_size, min_gc=req.min_gc, max_gc=req.max_gc,
                    opt_size=req.opt_size, min_tm=req.min_tm, opt_tm=req.opt_tm, max_tm=req.max_tm,
                    therm_kwargs=therm, num_candidates=25)
        results["forward"]["explain"] = f"strider: {sres['considered']} considered, {sres['ok_tm']} ok tm, {sres['folded']} folded"
        for cand in sres["candidates"][:primers_request_count]:
            a = _analyze(cand["sequence"])
            abs_start = up_start + cand["start"]
            a["interval"] = [abs_start, abs_start + cand["length"]]
            a["position"] = [cand["start"], cand["length"]]
            a["primer3"] = {
                "tm": a["tm"], "gc_percent": a["gc_percent"],
                "self_any": None, "self_end": None, "hairpin_th": None,
            }
            a["strider"] = {"hairpin_dg": cand["hairpin_dg"], "homodimer_dg": cand["homodimer_dg"]}
            results["forward"]["primers"].append(a)
        results["forward"]["primers"] = _pick_diverse_primers(
            results["forward"]["primers"], req.num_return, min_gap=0)
        results["forward"]["num_returned"] = len(results["forward"]["primers"])
    elif upstream and len(upstream) >= req.min_size:
        up_args = dict(p3_global)
        up_args.update({"PRIMER_PICK_LEFT_PRIMER": 1, "PRIMER_PICK_RIGHT_PRIMER": 0,
                        "PRIMER_PRODUCT_SIZE_RANGE": [[50, 50000]]})
        up_res = primer3.design_primers(
            {"SEQUENCE_ID": "upstream", "SEQUENCE_TEMPLATE": upstream,
             "SEQUENCE_INCLUDED_REGION": [0, len(upstream)]},
            up_args)
        n_l = int(up_res.get("PRIMER_LEFT_NUM_RETURNED", 0) or 0)
        results["forward"]["num_returned"] = n_l
        results["forward"]["explain"] = up_res.get("PRIMER_LEFT_EXPLAIN", "")
        for i in range(min(primers_request_count, n_l)):
            s   = up_res.get(f"PRIMER_LEFT_{i}_SEQUENCE")
            pos = up_res.get(f"PRIMER_LEFT_{i}")
            a   = _analyze(s)
            if pos:
                start, length = int(pos[0]), int(pos[1])
                # Convert local upstream coords → absolute coords in full_seq
                abs_start = up_start + start
                a["interval"] = [abs_start, abs_start + length]
                a["position"] = [start, length]
            a["primer3"] = {
                "tm":         _round(up_res.get(f"PRIMER_LEFT_{i}_TM"), 1),
                "gc_percent": _round(up_res.get(f"PRIMER_LEFT_{i}_GC_PERCENT"), 1),
                "self_any":   _round(up_res.get(f"PRIMER_LEFT_{i}_SELF_ANY"), 1),
                "self_end":   _round(up_res.get(f"PRIMER_LEFT_{i}_SELF_END"), 1),
                "hairpin_th": _round(up_res.get(f"PRIMER_LEFT_{i}_HAIRPIN_TH"), 1),
            }
            results["forward"]["primers"].append(a)
        results["forward"]["primers"] = _pick_diverse_primers(
            results["forward"]["primers"], req.num_return, min_gap=0)
        results["forward"]["num_returned"] = len(results["forward"]["primers"])

    # ── REVERSE (Right flank → picks RIGHT primer from first flank_window bp) ──
    if req.engine == "strider" and downstream and len(downstream) >= req.min_size:
        sres = _design_single_side_strider(downstream, is_left=False, min_size=req.min_size,
                    max_size=req.max_size, min_gc=req.min_gc, max_gc=req.max_gc,
                    opt_size=req.opt_size, min_tm=req.min_tm, opt_tm=req.opt_tm, max_tm=req.max_tm,
                    therm_kwargs=therm, num_candidates=25)
        results["reverse"]["explain"] = f"strider: {sres['considered']} considered, {sres['ok_tm']} ok tm, {sres['folded']} folded"
        for cand in sres["candidates"][:primers_request_count]:
            a = _analyze(cand["sequence"])
            abs_start = down_start + cand["start"]
            a["interval"] = [abs_start, abs_start + cand["length"]]
            a["position"] = [cand["start"], cand["length"]]
            a["primer3"] = {
                "tm": a["tm"], "gc_percent": a["gc_percent"],
                "self_any": None, "self_end": None, "hairpin_th": None,
            }
            a["strider"] = {"hairpin_dg": cand["hairpin_dg"], "homodimer_dg": cand["homodimer_dg"]}
            results["reverse"]["primers"].append(a)
        results["reverse"]["primers"] = _pick_diverse_primers(
            results["reverse"]["primers"], req.num_return, min_gap=0)
        results["reverse"]["num_returned"] = len(results["reverse"]["primers"])
    elif downstream and len(downstream) >= req.min_size:
        down_args = dict(p3_global)
        down_args.update({"PRIMER_PICK_LEFT_PRIMER": 0, "PRIMER_PICK_RIGHT_PRIMER": 1,
                          "PRIMER_PRODUCT_SIZE_RANGE": [[50, 50000]]})
        down_res = primer3.design_primers(
            {"SEQUENCE_ID": "downstream", "SEQUENCE_TEMPLATE": downstream,
             "SEQUENCE_INCLUDED_REGION": [0, len(downstream)]},
            down_args)
        n_r = int(down_res.get("PRIMER_RIGHT_NUM_RETURNED", 0) or 0)
        results["reverse"]["num_returned"] = n_r
        results["reverse"]["explain"] = down_res.get("PRIMER_RIGHT_EXPLAIN", "")
        for i in range(min(primers_request_count, n_r)):
            s   = down_res.get(f"PRIMER_RIGHT_{i}_SEQUENCE")
            pos = down_res.get(f"PRIMER_RIGHT_{i}")
            a   = _analyze(s)
            if pos:
                right_end, length = int(pos[0]), int(pos[1])
                local_start = right_end - length + 1
                abs_start = down_start + local_start
                a["interval"] = [abs_start, abs_start + length]
                a["position"] = [local_start, length]
            a["primer3"] = {
                "tm":         _round(down_res.get(f"PRIMER_RIGHT_{i}_TM"), 1),
                "gc_percent": _round(down_res.get(f"PRIMER_RIGHT_{i}_GC_PERCENT"), 1),
                "self_any":   _round(down_res.get(f"PRIMER_RIGHT_{i}_SELF_ANY"), 1),
                "self_end":   _round(down_res.get(f"PRIMER_RIGHT_{i}_SELF_END"), 1),
                "hairpin_th": _round(down_res.get(f"PRIMER_RIGHT_{i}_HAIRPIN_TH"), 1),
            }
            results["reverse"]["primers"].append(a)
        results["reverse"]["primers"] = _pick_diverse_primers(
            results["reverse"]["primers"], req.num_return, min_gap=0)
        results["reverse"]["num_returned"] = len(results["reverse"]["primers"])

    # ── Pair heterodimer QC ──
    if results["forward"]["primers"] and results["reverse"]["primers"]:
        f0 = results["forward"]["primers"][0]["sequence"]
        r0 = results["reverse"]["primers"][0]["sequence"]
        kwargs = {k: therm[k] for k in ["mv_conc", "dv_conc", "dntp_conc", "dna_conc"]}
        try: het = primer3.bindings.calc_heterodimer(f0, r0, **kwargs)
        except TypeError: het = primer3.bindings.calc_heterodimer(f0, r0)
        results["pair_metrics"] = {
            "heterodimer": {
                "structure_found": bool(getattr(het, "structure_found", False)),
                "tm": _round(getattr(het, "tm", None), 1) if getattr(het, "tm", None) is not None and -50.0 < float(getattr(het, "tm", None)) < 200.0 else None,
                "dg": _round((getattr(het, "dg", None) or 0) / 1000, 2),
            }
        }
        if req.engine == "strider":
            from strider.thermo.dimer_thermo import dimer_thermo as _strider_dimer
            _mv_m = req.mv_conc / 1000.0
            _mg_m = max(0.0, req.dv_conc - req.dntp_conc) / 1000.0
            try:
                _sd = _strider_dimer(f0, r0, sodium_M=_mv_m, magnesium_M=_mg_m,
                                     material='dna', structure=None,
                                     strand_conc_M=req.dna_conc / 1e9, salt_model='auto')
                results["pair_metrics"]["strider_heterodimer"] = {
                    "dg": round(_dg_rescale_dimer(_sd.dH, _sd.dS), 2),
                }
            except Exception:
                results["pair_metrics"]["strider_heterodimer"] = {"dg": None}

    if req.engine == "strider":
        results["engine"] = "strider"

    with _primer_design_cache_lock:
        _primer_design_cache[_cache_key] = results
        _primer_design_cache.move_to_end(_cache_key)
        while len(_primer_design_cache) > _PRIMER_DESIGN_CACHE_MAX:
            _primer_design_cache.popitem(last=False)
    return results


class PrimerAnalyzeRequest(BaseModel):
    sequence: str
    mv_conc: float = 50.0
    dv_conc: float = 3.0
    dntp_conc: float = 0.8
    dna_conc: float = 400.0


@app.post("/primers/analyze")
async def analyze_primer_sequence(req: PrimerAnalyzeRequest):
    """Return Primer3 Tm, GC%, hairpin and homodimer for a single primer sequence.

    This endpoint powers the manual primer-selection path in the frontend so that
    the displayed "P3 Tm" is the real Primer3 thermodynamic Tm instead of a
    simple GC-based approximation.
    """
    try:
        import primer3
    except ImportError:
        raise HTTPException(status_code=500, detail="primer3-py not installed")

    s = req.sequence.upper().replace(" ", "").replace("\n", "")
    if not s:
        raise HTTPException(status_code=400, detail="Sequence is empty")

    kwargs = {
        "mv_conc": req.mv_conc,
        "dv_conc": req.dv_conc,
        "dntp_conc": req.dntp_conc,
        "dna_conc": req.dna_conc,
    }

    try:
        tm = primer3.bindings.calc_tm(s, **kwargs)
    except TypeError:
        tm = primer3.bindings.calc_tm(s)
    try:
        hp = primer3.bindings.calc_hairpin(s, temp_c=25.0, **kwargs)
    except TypeError:
        hp = primer3.bindings.calc_hairpin(s)
    try:
        hd = primer3.bindings.calc_homodimer(s, temp_c=25.0, **kwargs)
    except TypeError:
        hd = primer3.bindings.calc_homodimer(s)

    gc = 100.0 * sum(1 for b in s if b in "GC") / len(s)

    def _round(x, nd=1):
        if x is None:
            return None
        try:
            return round(float(x), nd)
        except (ValueError, TypeError):
            return None

    return {
        "sequence": s,
        "length": len(s),
        "gc_percent": _round(gc, 1),
        "tm": _round(tm, 1),
        "tm_strider": strider_duplex_tm(s, **kwargs),
        "hairpin": {
            "structure_found": bool(getattr(hp, "structure_found", False)),
            "tm": _round(getattr(hp, "tm", None), 1) if getattr(hp, "tm", None) is not None and -50.0 < float(getattr(hp, "tm", None)) < 200.0 else None,
            "dg": _round((getattr(hp, "dg", None) or 0) / 1000, 2),
        },
        "homodimer": {
            "structure_found": bool(getattr(hd, "structure_found", False)),
            "tm": _round(getattr(hd, "tm", None), 1) if getattr(hd, "tm", None) is not None and -50.0 < float(getattr(hd, "tm", None)) < 200.0 else None,
            "dg": _round((getattr(hd, "dg", None) or 0) / 1000, 2),
        },
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
