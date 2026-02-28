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
from fastapi.responses import FileResponse


app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    """
    if not request.sequence.strip():
        raise HTTPException(status_code=400, detail="Sequence cannot be empty.")

    try:
        # Step 1: Run BLAST
        blast_hits, blast_meta = run_blast(
            request.sequence,
            max_hits=request.max_hits,
            api_key=request.api_key,
            organism=request.organism,
            e_value=request.e_value,
            perc_identity=request.perc_identity,
        )

        if not blast_hits:
            raise HTTPException(status_code=404, detail="No BLAST hits found.")

        # Step 2: Prepare sequences for MSA (query + hits)
        # Parse query: if it starts with '>', extract the header, otherwise use "Query"
        lines = request.sequence.strip().split("\n")
        if lines[0].startswith(">"):
            query_id = lines[0][1:].strip()
            query_seq = "".join(l.strip() for l in lines[1:] if not l.startswith(">"))
        else:
            query_id = "Query"
            query_seq = request.sequence.strip().replace(" ", "").replace("\n", "")

        msa_input = [{"id": query_id, "seq": query_seq}]
        for hit in blast_hits:
            msa_input.append({"id": hit["accession"], "seq": hit["sequence"]})

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

        return {
            "blast_hits": hit_summary,
            "blast_meta": blast_meta,
            "alignment": alignment,
            "num_hits": len(blast_hits),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    # Search params
    search_params: Optional[Dict] = None # {min_len: 18, max_len: 30, tm_min: 47, tm_max: 58, tm_diff: 1.5}

@app.post("/moligize")
async def moligize_sequence(request: MoligizeRequest):
    try:
        import primer3
        from Bio.Seq import Seq
    except ImportError:
        raise HTTPException(status_code=500, detail="primer3-py or biopython is not installed.")

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
    if l1 == 20 and l2 == 20 and len(window_seq) < 40:
        l1 = l2 = len(window_seq) // 2

    def get_stats(s, start_idx, end_idx):
        if not s: return {"seq": "", "len": 0, "tm": 0, "gc": 0, "start": 0, "end": 0}
        return {
            "seq": s,
            "len": len(s),
            "tm": round(primer3.calc_tm(s), 1),
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

    moligo1_final, moligo2_final, m1_start, m1_end, m2_start, m2_end = get_deterministic(request.moligo1_shift, request.moligo2_shift, l1, l2)
    params_not_met = False
    param_warnings = []  # Per-oligo violation messages

    # 3. Parameter Validation (always use deterministic result, just check compliance)
    if request.search_params is not None and moligo1_final and moligo2_final:
        p: Dict = request.search_params
        min_l = int(p.get('min_len', 18))
        max_l = int(p.get('max_len', 60))
        tm_min = float(p.get('tm_min', 47.0))
        tm_max = float(p.get('tm_max', 58.0))
        tm_diff = float(p.get('tm_diff', 1.5))

        tm1 = primer3.calc_tm(moligo1_final)
        tm2 = primer3.calc_tm(moligo2_final)
        len1_actual = len(moligo1_final)
        len2_actual = len(moligo2_final)

        # Check Oligo 1
        if len1_actual < min_l or len1_actual > max_l:
            param_warnings.append(f"Oligo 1 length ({len1_actual}nt) outside range [{min_l}–{max_l}]")
        if tm1 < tm_min or tm1 > tm_max:
            param_warnings.append(f"Oligo 1 Tm ({tm1:.1f}°C) outside range [{tm_min:.1f}–{tm_max:.1f}]")

        # Check Oligo 2
        if len2_actual < min_l or len2_actual > max_l:
            param_warnings.append(f"Oligo 2 length ({len2_actual}nt) outside range [{min_l}–{max_l}]")
        if tm2 < tm_min or tm2 > tm_max:
            param_warnings.append(f"Oligo 2 Tm ({tm2:.1f}°C) outside range [{tm_min:.1f}–{tm_max:.1f}]")

        # Check Tm difference
        if abs(tm1 - tm2) > tm_diff:
            param_warnings.append(f"Tm difference ({abs(tm1 - tm2):.1f}°C) exceeds max ({tm_diff:.1f}°C)")

        if param_warnings:
            params_not_met = True

    # Absolute indices
    abs_m2_start = start_w + m2_start
    abs_m2_end = start_w + m2_end
    abs_m1_start = start_w + m1_start
    abs_m1_end = start_w + m1_end

    return {
        "p1": get_stats(moligo1_final, abs_m1_start, abs_m1_end),
        "p2": get_stats(moligo2_final, abs_m2_start, abs_m2_end),
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
    mg_conc: float = 0


@app.post("/idt/token")
async def get_idt_token(request: IdtAuthRequest):
    import json
    import base64
    from urllib import request as url_request, parse, error as url_error
    
    # Verified working endpoint from user's script
    url = "https://eu.idtdna.com/IdentityServer/connect/token"
    
    try:
        # Construct Authorization header exactly as in working script
        auth_bytes = f"{request.client_id}:{request.client_secret}".encode("utf-8")
        auth_string = base64.b64encode(auth_bytes).decode("ascii")

        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": "Basic " + auth_string,
        }

        # Data exactly as in working script
        data_dict = {
            "grant_type": "password",
            "scope": "test",
            "username": request.username,
            "password": request.password,
        }
        
        request_data = parse.urlencode(data_dict).encode("utf-8")

        post_request = url_request.Request(
            url,
            data=request_data,
            headers=headers,
            method="POST",
        )

        with url_request.urlopen(post_request, timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return json.loads(body)

    except url_error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=e.code, detail=f"IDT Auth Error: {body}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/idt/analyze")
async def analyze_idt_oligos(request: IdtAnalyzeRequest):
    import requests
    headers = {
        "Authorization": f"Bearer {request.token}",
        "Content-Type": "application/json"
    }
    # User confirmed: use EU API host for actual calls
    base_url = "https://eu.idtdna.com/restapi/v1/OligoAnalyzer"

    def hit_idt(endpoint, seq1, seq2=None):
        url = f"{base_url}/{endpoint}"
        params = {}
        payload = None

        if endpoint == "Hairpin":
            # Hairpin: sequence in JSON body with specific concentration params
            payload = {
                "Sequence": seq1,
                "NaConc": 50.0,
                "FoldingTemp": 25.0,
                "MgConc": request.mg_conc,
                "NucleotideType": "DNA"
            }
        elif endpoint == "SelfDimer":
            # SelfDimer: sequence as query parameter only
            params = {"primary": seq1}
        elif endpoint == "HeteroDimer":
            # HeteroDimer: both sequences as query parameters
            params = {"primary": seq1, "secondary": seq2}
        elif endpoint == "Analyze":
            # Analyze: requires full payload for valid response
            payload = {
                "Sequence": seq1,
                "NaConc": 50.0,
                "MgConc": request.mg_conc,
                "dNTPsConc": 0.0,
                "OligoConc": 0.25,
                "NucleotideType": "DNA"
            }
            
        try:
            # IDT endpoints generally require POST, even if payload is empty or None
            response = requests.post(url, json=payload, params=params, headers=headers, timeout=15)
            
            if not response.ok:
                return {"error": f"IDT {endpoint} Error: {response.status_code} - {response.text}"}
            return response.json()
        except Exception as e:
            return {"error": str(e)}

    # Use SPECIFIC endpoints for each analysis type.
    # The IDT API has /Hairpin, /SelfDimer, /HeteroDimer as separate endpoints
    # that return DeltaG directly, instead of the general /Analyze endpoint.
    m1_hairpin = hit_idt("Hairpin", request.p1_seq)
    m1_selfdimer = hit_idt("SelfDimer", request.p1_seq)
    m1_analyze = hit_idt("Analyze", request.p1_seq)
    m2_hairpin = hit_idt("Hairpin", request.p2_seq)
    m2_selfdimer = hit_idt("SelfDimer", request.p2_seq)
    m2_analyze = hit_idt("Analyze", request.p2_seq)
    hetero = hit_idt("HeteroDimer", request.p1_seq, request.p2_seq)

    # Use ViennaRNA to add dot-bracket structure to hairpins since IDT does not provide visual coordinates
    try:
        import RNA
        def add_dot_bracket(seq, hp_data):
            if isinstance(hp_data, list) and len(hp_data) > 0:
                # Configure for DNA at 25°C (matching IDT hairpin analysis conditions)
                md = RNA.md()
                md.temperature = 25.0   # IDT uses 25°C for hairpin folding
                md.noGU = 1             # Disable GU wobble pairs (DNA, not RNA)
                fc = RNA.fold_compound(seq, md)
                structure, mfe = fc.mfe()
                hp_data[0]["DotBracket"] = structure
            return hp_data
            
        m1_hairpin = add_dot_bracket(request.p1_seq, m1_hairpin)
        m2_hairpin = add_dot_bracket(request.p2_seq, m2_hairpin)
    except Exception as e:
        print(f"ViennaRNA integration error: {e}")

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
        """Extract DeltaG and return raw data from a single-endpoint response."""
        if not data or isinstance(data, str):
            return {"DeltaG": None, "raw": None}
        if isinstance(data, dict) and "error" in data:
            return data
        
        # If response is an array (multiple structures found), pick lowest DeltaG
        if isinstance(data, list):
            if len(data) == 0:
                return {"DeltaG": None, "raw": data}
            best_dg = None
            best_item = None
            for item in data:
                dg = _extract_delta_g(item)
                if dg is not None and (best_dg is None or dg < best_dg):
                    best_dg = dg
                    best_item = item
            return {"DeltaG": best_dg, "raw": best_item if best_item else data}
        
        # If response is a dict, DeltaG should be at top level
        if isinstance(data, dict):
            dg = _extract_delta_g(data)
            return {"DeltaG": dg, "raw": data}
        
        return {"DeltaG": None, "raw": None}
    
    def _extract_delta_g(obj):
        """Extract DeltaG from a dict, trying common key names."""
        if not isinstance(obj, dict):
            return None
        for k in ["DeltaG", "deltaG", "deltag", "delta_g", "dG", "Energy", "energy"]:
            if k in obj:
                try:
                    return float(obj[k])
                except (ValueError, TypeError):
                    pass
        return None

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
