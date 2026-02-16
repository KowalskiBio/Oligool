from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from backend.alignment import run_msa
from backend.blast import run_blast
import uvicorn

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    search_params: Optional[Dict] = None # {min_len: 18, max_len: 30, target_tm: 60, tm_dev: 2, tm_diff: 2}

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

    # 1. Windowing: Center 100bp (or full if shorter)
    full_len = len(seq)
    window_len = 100
    
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
    def get_deterministic(s1_shift, s2_shift, l1, l2):
        # M2 (Left): ends at split + shift, length l2
        m2_end = split_idx_in_window + s2_shift
        m2_start = max(0, m2_end - l2)
        m2_end = min(len(window_seq), m2_start + l2) 
        
        # M1 (Right): starts at split + shift, length l1
        m1_start = split_idx_in_window + s1_shift
        m1_end = min(len(window_seq), m1_start + l1)
        m1_start = max(0, m1_end - l1)
        
        m2_fwd = window_seq[m2_start:m2_end]
        m1_fwd = window_seq[m1_start:m1_end]
        
        m2_rc = str(Seq(m2_fwd).reverse_complement())
        m1_rc = str(Seq(m1_fwd).reverse_complement())
        
        return m1_rc, m2_rc, m1_start, m1_end, m2_start, m2_end

    moligo1_final, moligo2_final, m1_start, m1_end, m2_start, m2_end = get_deterministic(request.moligo1_shift, request.moligo2_shift, request.moligo1_len, request.moligo2_len)
    params_not_met = False

    # 3. Parameter-based Search
    if request.search_params is not None:
        p: Dict = request.search_params
        min_l = int(p.get('min_len', 18))
        max_l = int(p.get('max_len', 30))
        tgt_tm = float(p.get('target_tm', 60.0))
        tm_dev = float(p.get('tm_dev', 2.0))
        tm_diff = float(p.get('tm_diff', 2.0))
        
        best_pair = None
        best_score = float('inf') # Lower is better (closest to center)

        # If user has manually adjusted lengths away from 20, should search respect it?
        # User requested + and - "for both search and search by params".
        # If they are in search mode, "Search by params" panel defines min/max for the search itself.
        # But the +/- buttons are "manual prolonging".
        # Let's override min_l/max_l with exact request.moligo1_len/moligo2_len if they were manually touched?
        # Or just search and then allow manual tweeks?
        # User says: "When + clicked, it prolonges the oligo...".
        # Let's make search respect the exact lengths if the user specifically requested them (not 20).
        # Actually, it's probably easier to search first, then apply length adjustments as a post-process.
        # BUT the user wants the tool to "search in the region provided by user for appropriate oligos".
        # Let's keep search flexible but prioritize exact manual lengths if they are specified?
        # No, let's keep it simple: search uses its own min/max. The +/- buttons in the UI will update the 'min_len' and 'max_len' of the search if in search mode? 
        # No, user wants independent buttons.
        
        # We will search based on min/max_l or EXACT lengths if manually set (not 20)
        # However, min_l/max_l already come from the UI.
        # Let's just use the range. If the user clicked +/-, they are effectively 
        # saying "I want a specific length". 
        # To avoid complexity, let's just make the search loop use the manual lengths 
        # as the range if the user has touched them.
        
        m1_search_range = range(min_l, max_l + 1)
        if request.moligo1_len != 20: 
            m1_search_range = [request.moligo1_len]
            
        m2_search_range = range(min_l, max_l + 1)
        if request.moligo2_len != 20:
            m2_search_range = [request.moligo2_len]

        subs_m1 = []
        subs_m2 = []
        
        # Precompute for M2
        for i in range(len(window_seq)):
            for l in m2_search_range:
                if i + l <= len(window_seq):
                    s = window_seq[i:i+l]
                    rc = str(Seq(s).reverse_complement())
                    tm = primer3.calc_tm(rc)
                    if abs(tm - tgt_tm) <= tm_dev:
                        subs_m2.append({'start': i, 'end': i + l, 'tm': tm, 'seq': rc, 'len': l})

        # Precompute for M1
        for i in range(len(window_seq)):
            for l in m1_search_range:
                if i + l <= len(window_seq):
                    s = window_seq[i:i+l]
                    rc = str(Seq(s).reverse_complement())
                    tm = primer3.calc_tm(rc)
                    if abs(tm - tgt_tm) <= tm_dev:
                        subs_m1.append({'start': i, 'end': i + l, 'tm': tm, 'seq': rc, 'len': l})
        
        target_center = split_idx_in_window + p.get('moligoShift', 0)

        for s2 in subs_m2: # Left
            for s1 in subs_m1: # Right
                if s1['start'] == s2['end']:
                     if abs(s1['tm'] - s2['tm']) <= tm_diff:
                         dist = abs(s2['end'] - target_center)
                         score = dist
                         if score < best_score:
                             best_score = score
                             best_pair = (s1, s2)
        
        if best_pair:
            s1, s2 = best_pair
            moligo1_final = s1['seq']
            moligo2_final = s2['seq']
            m1_start, m1_end = s1['start'], s1['end']
            m2_start, m2_end = s2['start'], s2['end']
        else:
            params_not_met = True

    # FINAL STEP: Apply manual length fine-tuning if NOT in search mode (or even if in search mode?)
    # If in search mode, the search already found the best lengths within min/max.
    # If the user clicks + on a result, they want to extend it.
    # Let's ALWAYS respect moligoX_len if they are different from what the logic found?
    # This is tricky because search creates its own lengths.
    # Let's make it so that if showParams is OFF, we use deterministic with the manual lengths.
    # If showParams is ON, we search.
    # How to combine?
    # If the user clicks + in search mode, it should probably increment/decrement the search's min/max?
    # Or just let them refine the static ones.
    # User's request: "prolonges the oligo... Moligo 2... to left, moligo 1... to right".
    # I'll implement it so that the frontend tracks the length and sends it.
    # For search, I will adjust the found result by the requested length.
    
    if request.search_params is None:
        # Re-run deterministic with specific shifts (Connectivity is inherently preserved in deterministic logic)
        # But wait, deterministic logic above already uses request.moligoX_len.
        pass
    else:
        # If search found something, but the user requested a specific length DIFFERENT from what search found...
        # This gets messy. Let's make the search target exactly moligo1_len/moligo2_len if they were manually set?
        # Let's stick to: Search uses min/max. Deterministic uses moligoX_len.
        pass

    # Absolute indices
    abs_m2_start = start_w + m2_start
    abs_m2_end = start_w + m2_end
    abs_m1_start = start_w + m1_start
    abs_m1_end = start_w + m1_end

    return {
        "p1": get_stats(moligo1_final, abs_m1_start, abs_m1_end),
        "p2": get_stats(moligo2_final, abs_m2_start, abs_m2_end),
        "split_idx": absolute_split,
        "params_not_met": params_not_met
    }


if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
