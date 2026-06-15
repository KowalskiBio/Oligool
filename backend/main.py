import sys
import os
# Robustly add project root to sys.path
root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from backend.alignment import run_msa
from backend.blast import run_blast
import json
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
import asyncio


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



from typing import Optional, Dict

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
                tm = primer3.calc_tm(test_seq, **TM_PARAMS)
                
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
        if not s: return {"seq": "", "len": 0, "tm": 0, "gc": 0, "start": 0, "end": 0}
        return {
            "seq": s,
            "len": len(s),
            "tm": round(primer3.calc_tm(s, **TM_PARAMS), 1),
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
                tm = primer3.calc_tm(s, **TM_PARAMS)
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
        
        if not (stats_p1['len_ok'] and stats_p1['tm_ok'] and stats_p1['gc_ok'] and 
                stats_p2['len_ok'] and stats_p2['tm_ok'] and stats_p2['gc_ok'] and tm_diff_ok):
            params_not_met = True
            if not stats_p1['len_ok']: param_warnings.append(f"Oligo 1 length ({stats_p1['len']}) outside range")
            if not stats_p1['tm_ok']: param_warnings.append(f"Oligo 1 Tm ({stats_p1['tm']}°C) outside range")
            if not stats_p1['gc_ok']: param_warnings.append(f"Oligo 1 GC ({stats_p1['gc']}%) outside range")
            if not stats_p2['len_ok']: param_warnings.append(f"Oligo 2 length ({stats_p2['len']}) outside range")
            if not stats_p2['tm_ok']: param_warnings.append(f"Oligo 2 Tm ({stats_p2['tm']}°C) outside range")
            if not stats_p2['gc_ok']: param_warnings.append(f"Oligo 2 GC ({stats_p2['gc']}%) outside range")
            if not tm_diff_ok: param_warnings.append(f"Tm difference ({tm_diff_actual:.1f}°C) exceeds max")
    else:
        # Default All OK if no params
        for s in [stats_p1, stats_p2]:
            s['len_ok'] = s['tm_ok'] = s['gc_ok'] = True
        tm_diff_ok = True

    return {
        "p1": stats_p1,
        "p2": stats_p2,
        "tm_diff_ok": tm_diff_ok,
        "split_idx": absolute_split,
        "params_not_met": params_not_met,
        "param_warnings": param_warnings
    }


class IdtAuthRequest(BaseModel):
    client_id: str
    client_secret: str
    username: Optional[str] = None
    password: Optional[str] = None


class IdtAnalyzeRequest(BaseModel):
    p1_seq: str
    p2_seq: str
    token: str
    mg_conc: float = 10.0
    mv_conc: float = 50.0
    dntp_conc: float = 0.8
    oligo_conc: float = 0.2


@app.post("/idt/token")
async def get_idt_token(request: IdtAuthRequest):
    import requests
    import base64
    
    # Verified working endpoint from user's script
    url = "https://eu.idtdna.com/IdentityServer/connect/token"
    
    try:
        # Construct Authorization header exactly as in working script
        auth_bytes = f"{request.client_id}:{request.client_secret}".encode("utf-8")
        auth_string = base64.b64encode(auth_bytes).decode("ascii")

        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": "Basic " + auth_string,
            "Accept": "application/json"
        }

        # Data exactly as in working script
        payload = {
            "grant_type": "password",
            "scope": "test",
            "username": request.username,
            "password": request.password,
        }
        
        response = requests.post(url, data=payload, headers=headers, timeout=15)
        
        if not response.ok:
            # Try to extract detail from IDT response
            try:
                err_data = response.json()
                detail = err_data.get("error_description") or err_data.get("error") or response.text
            except:
                detail = response.text
            raise HTTPException(status_code=response.status_code, detail=f"IDT Auth Error: {detail}")

        return response.json()

    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
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
    # User confirmed: use EU API host for actual calls
    base_url = "https://eu.idtdna.com/restapi/v1/OligoAnalyzer"

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
            
        try:
            # All IDT endpoints typically require POST
            response = session.post(url, json=payload, params=params, timeout=30)
            
            if not response.ok:
                return {"error": f"IDT {endpoint} Error: {response.status_code} - {response.text}"}
            return response.json()
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

    def _extract_idt_delta_g(obj):
        """Extract IDT DeltaG from a dict (ignoring ViennaRNA_DeltaG)."""
        if not isinstance(obj, dict):
            return None
        for k in ["DeltaG", "deltaG", "deltag", "delta_g", "dG", "Energy", "energy"]:
            if k in obj:
                try:
                    val = obj[k]
                    if val is not None:
                        return float(val)
                except (ValueError, TypeError):
                    pass
        return None

    # Use strider-dna for Mg2+-aware dot-bracket structure, local ΔG, and Tm
    try:
        from strider import ThermoEngine
        from strider.thermo.hairpin import hairpin_thermo  # strider >= 0.3.2

        base_temp = request.temp if hasattr(request, "temp") and request.temp is not None else 25.0
        mv_m = request.mv_conc / 1000.0
        effective_mg = max(0.0, request.mg_conc - request.dntp_conc) / 1000.0
        oligo_conc_m = getattr(request, "oligo_conc", 0.25) / 1e6

        eng = ThermoEngine(material='dna', celsius=base_temp, sodium=mv_m, magnesium=effective_mg)

        # Hairpin Tm uses strider.thermo.hairpin.hairpin_thermo (>= 0.3.2), the
        # UNImolecular two-state model (Tm = ΔH/ΔS, concentration-independent)
        # with full SantaLucia loop ΔH + salt correction. For strider-dna >= 0.3.3
        # the salt term is the Tan-Chen (2007) TBI whole-helix model for stems
        # >= 6 bp (Mg2+-aware); shorter stems keep the per-base-pair correction.
        # It is bulge-aware and evaluated on the same strider structure we draw.
        # strider's own melting_temperature is BImolecular and only correct for dimers.
        def add_strider_analysis(seq1, hp_data, seq2=None):
            """Strider-dna enrichment for hairpin (seq2=None) or dimer (seq2 provided)."""
            if not (isinstance(hp_data, list) or (isinstance(hp_data, dict) and not hp_data.get("error"))):
                return hp_data

            is_dimer = seq2 is not None
            is_list = isinstance(hp_data, list)
            data_list = hp_data if is_list else [hp_data]

            if seq2:
                mfe_result = eng.mfe(seq1, seq2)
                raw_mfe = mfe_result.structure
                fold_seq = seq1 + seq2
                display_seq = seq1 + '&' + seq2
                def _with_div(s): return s[:len(seq1)] + '&' + s[len(seq1):]
            else:
                mfe_result = eng.mfe(seq1)
                raw_mfe = mfe_result.structure
                fold_seq = seq1
                display_seq = seq1
                def _with_div(s): return s

            def _valid_paired(s):
                return '(' in s and s.count('(') == s.count(')')

            # Only draw the MFE structure when it actually has base pairs. When the
            # MFE is flat (all dots, ΔG = 0) there is no stable structure — by
            # definition no suboptimal structure can have ΔG < 0, so we must NOT
            # fall back to a positive-ΔG fold that doesn't physically form.
            if _valid_paired(raw_mfe):
                viz_struct_raw = raw_mfe
                viz_dg = round(float(mfe_result.energy), 2)
            else:
                viz_struct_raw = None
                viz_dg = None

            viz_struct = _with_div(viz_struct_raw) if viz_struct_raw else None

            # Tm: unimolecular two-state for hairpins (seq2 is None).
            # For dimers we deliberately return None: a heterodimer melts
            # BImolecularly (two strands associating), and strider has no proper
            # two-strand Tm yet — eng.melting_temperature(seq1+seq2) just melts the
            # concatenation as one strand, which is physically meaningless. A
            # correct bimolecular dimer Tm is coming as strider PR3
            # (structure_thermo dimer support); until then dimers show ΔG only,
            # with IDT/primer3 providing the dimer Tm.
            def _struct_tm(structure, energy):
                if seq2:
                    return None
                try:
                    # strider >= 0.3.2: returns a HairpinThermo object; raises
                    # ValueError for multiloops / no base pairs.
                    res = hairpin_thermo(fold_seq, sodium_M=mv_m,
                                         magnesium_M=effective_mg, structure=structure)
                    t = res.tm_celsius
                except Exception:
                    t = None
                return round(t, 1) if t and t > 1.0 else None

            mfe_tm = _struct_tm(viz_struct_raw, viz_dg)

            best_item = None
            best_idt_dg = None
            for item in data_list:
                idt_tm = item.get("thermo") or item.get("MeltingTemperature") or item.get("Tm") or item.get("tm") or item.get("MeltTemp")
                item["IDT_Tm"] = idt_tm
                item["Sequence"] = display_seq
                item["Local_DeltaG"] = viz_dg
                item["Local_Tm"] = mfe_tm
                if viz_struct and not is_dimer:
                    item["DotBracket"] = viz_struct
                    for k in ["AsciiStructure", "VisualPrint", "asciiStructure", "visualPrint"]:
                        item.pop(k, None)
                idt_dg = _extract_idt_delta_g(item)
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
                subs = eng.subopt(fold_seq, gap=5.0, max_structures=500)
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

            return final_results if is_list else final_results[0]

        m1_hairpin = add_strider_analysis(request.p1_seq, m1_hairpin)
        m1_selfdimer = add_strider_analysis(request.p1_seq, m1_selfdimer, seq2=request.p1_seq)
        m2_hairpin = add_strider_analysis(request.p2_seq, m2_hairpin)
        m2_selfdimer = add_strider_analysis(request.p2_seq, m2_selfdimer, seq2=request.p2_seq)
        hetero = add_strider_analysis(request.p1_seq, hetero, seq2=request.p2_seq)
    except Exception as e:
        print(f"strider-dna optimization error: {e}")

    # DEBUG: Log raw responses to understand structure
    import json as _json
    print("=== IDT RAW RESPONSES ===")
    print(f"M1 Hairpin: {_json.dumps(m1_hairpin, indent=2, default=str)}")
    print(f"M1 SelfDimer: {_json.dumps(m1_selfdimer, indent=2, default=str)}")
    print(f"M1 Analyze: {_json.dumps(m1_analyze, indent=2, default=str)}")
    print(f"M2 Hairpin: {_json.dumps(m2_hairpin, indent=2, default=str)}")
    print(f"M2 SelfDimer: {_json.dumps(m2_selfdimer, indent=2, default=str)}")
    print(f"M2 Analyze: {_json.dumps(m2_analyze, indent=2, default=str)}")
    print(f"HeteroDimer: {_json.dumps(hetero, indent=2, default=str)}")
    print("=== END IDT RAW RESPONSES ===")

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
            
            # Sort items by IDT DeltaG (most stable first)
            scored_items = []
            for item in data:
                idt_dg = _extract_idt_delta_g(item)
                scored_items.append((idt_dg if idt_dg is not None else 999.0, item))
            
            scored_items.sort(key=lambda x: x[0])
            top_items = [x[1] for x in scored_items[:5]]
            top_idt_dgs = [x[0] if x[0] != 999.0 else None for x in scored_items[:5]]
            top_local_dgs = [x[1].get("Local_DeltaG") for x in scored_items[:5]]
            top_idt_tms = [x[1].get("IDT_Tm") for x in scored_items[:5]]
            top_local_tms = [x[1].get("Local_Tm") for x in scored_items[:5]]

            return {
                "DeltaG": top_idt_dgs[0] if top_idt_dgs else None,
                "all_DeltaG": top_idt_dgs,
                "all_Local_DeltaG": top_local_dgs,
                "all_IDT_Tm": top_idt_tms,
                "all_Local_Tm": top_local_tms,
                "raw": top_items
            }
        
        # If response is a dict, DeltaG and Tm should be at top level
        if isinstance(data, dict):
            dg = _extract_idt_delta_g(data)
            return {"DeltaG": dg, "raw": data}
        
        return {"DeltaG": None, "raw": None}

    return {
        "m1": {
            "hairpin": find_dg_and_raw(m1_hairpin),
            "self_dimer": find_dg_and_raw(m1_selfdimer),
            "analyze": m1_analyze
        },
        "m2": {
            "hairpin": find_dg_and_raw(m2_hairpin),
            "self_dimer": find_dg_and_raw(m2_selfdimer),
            "analyze": m2_analyze
        },
        "pairwise": find_dg_and_raw(hetero)
    }


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
    opt_tm: float = 62.0
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


@app.post("/flanking_primers/design")
async def design_flanking_primers(req: FlankingPrimerParams):
    try:
        import primer3
    except ImportError:
        raise HTTPException(status_code=500, detail="primer3-py not installed")

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

    p3_global = {
        "PRIMER_OPT_SIZE":            req.opt_size,
        "PRIMER_MIN_SIZE":            req.min_size,
        "PRIMER_MAX_SIZE":            req.max_size,
        "PRIMER_OPT_TM":              req.opt_tm,
        "PRIMER_MIN_TM":              req.min_tm,
        "PRIMER_MAX_TM":              req.max_tm,
        "PRIMER_MIN_GC":              req.min_gc,
        "PRIMER_MAX_GC":              req.max_gc,
        "PRIMER_NUM_RETURN":          req.num_return,
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
        except: return None

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
            "hairpin":  {"structure_found": bool(getattr(hp, "structure_found", False)), "tm": _round(getattr(hp, "tm", None), 1), "dg": _round((getattr(hp, "dg", None) or 0) / 1000, 2)},
            "homodimer":{"structure_found": bool(getattr(hd, "structure_found", False)), "tm": _round(getattr(hd, "tm", None), 1), "dg": _round((getattr(hd, "dg", None) or 0) / 1000, 2)},
        }

    results = {"forward": {"num_returned": 0, "primers": [], "explain": ""},
               "reverse": {"num_returned": 0, "primers": [], "explain": ""},
               "pair_metrics": None}

    # ── FORWARD (Left flank → picks LEFT primer from last flank_window bp) ──
    if upstream and len(upstream) >= req.min_size:
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
        for i in range(min(req.num_return, n_l)):
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

    # ── REVERSE (Right flank → picks RIGHT primer from first flank_window bp) ──
    if downstream and len(downstream) >= req.min_size:
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
        for i in range(min(req.num_return, n_r)):
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
                "tm": _round(getattr(het, "tm", None), 1),
                "dg": _round(getattr(het, "dg", None), 1),
            }
        }

    return results


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
