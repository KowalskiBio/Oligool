from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from .alignment import run_msa
from .blast import run_blast
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



class MoligizeRequest(BaseModel):
    sequence: str
    target_tm: float = 60.0
    tm_tolerance: float = 0.5
    # strict_tm removed, logic is now always strict based on tolerance
    min_len: int = 18
    max_len: int = 30  # Added max_len
    desired_len: Optional[int] = None
    p1_len: Optional[int] = None
    p2_len: Optional[int] = None
    split_idx: Optional[int] = None # 0-based index relative to sequence

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

    # Determine Split Index
    if request.split_idx is not None:
        split_idx = request.split_idx
    else:
        split_idx = len(seq) // 2
    
    # Boundary checks
    if split_idx < 1: split_idx = 1
    if split_idx >= len(seq): split_idx = len(seq) - 1

    # --- Helper to Search Primers ---
    def find_best_primer(chunk, is_p1, min_l, max_l, target_tm, tolerance):
        # Constraints
        eff_max = min(max_l, len(chunk))
        eff_min = min(min_l, eff_max) # Ensure min <= max
        
        if eff_max < 1: return None # No chunk to search

        best_cand = None
        min_diff = float("inf")

        # Iterate length range
        for l in range(eff_min, eff_max + 1):
            if is_p1:
                # P1: Take last `l` bases, Reverse Complement
                sub = chunk[-l:]
                primer_seq = str(Seq(sub).reverse_complement())
            else:
                # P2: Take first `l` bases
                sub = chunk[:l]
                primer_seq = sub
            
            p_tm = primer3.calc_tm(primer_seq)
            diff = abs(p_tm - target_tm)
            
            # If tolerance is not Inf, skip invalid
            if tolerance != float("inf") and diff > tolerance:
                continue

            # Update best match (closest Tm)
            if diff < min_diff:
                min_diff = diff
                best_cand = {
                    "seq": primer_seq,
                    "tm": round(p_tm, 1),
                    "len": l,
                    "gc": round((primer_seq.count("G") + primer_seq.count("C")) / l * 100, 1),
                    "diff": diff
                }
        
        if best_cand:
            # Augment with coordinates
            if is_p1:
                best_cand["start"] = split_idx - best_cand["len"]
                best_cand["end"] = split_idx
            else:
                best_cand["start"] = split_idx
                best_cand["end"] = split_idx + best_cand["len"]
                
        return best_cand

    # --- P1 Selection ---
    left_chunk = seq[:split_idx]
    
    # Determine P1 Range
    if request.p1_len is not None:
        p1_r_min, p1_r_max = request.p1_len, request.p1_len
    else:
        desired = request.desired_len
        p1_r_min = desired if desired else request.min_len
        p1_r_max = desired if desired else min(split_idx, request.max_len)

    # Strategies: Strict -> Relaxed Tm -> Fallback Length
    p1_strategies = [
        (p1_r_min, p1_r_max, request.tm_tolerance),
        (p1_r_min, p1_r_max, float("inf")),
        (10, 40, float("inf"))
    ]

    p1_final = None
    for (mn, mx, tol) in p1_strategies:
        p1_final = find_best_primer(left_chunk, True, mn, mx, request.target_tm, tol)
        if p1_final: break
        
    if not p1_final:
        raise HTTPException(status_code=400, detail="Cannot generate P1 (sequence too short?).")

    # --- P2 Selection ---
    right_chunk = seq[split_idx:]
    
    # Determine P2 Range
    if request.p2_len is not None:
        p2_r_min, p2_r_max = request.p2_len, request.p2_len
    else:
        desired = request.desired_len
        p2_r_min = desired if desired else request.min_len
        p2_r_max = desired if desired else min(len(right_chunk), request.max_len)

    p2_strategies = [
        (p2_r_min, p2_r_max, request.tm_tolerance),
        (p2_r_min, p2_r_max, float("inf")),
        (10, 40, float("inf"))
    ]

    p2_final = None
    for (mn, mx, tol) in p2_strategies:
        p2_final = find_best_primer(right_chunk, False, mn, mx, request.target_tm, tol)
        if p2_final: break

    if not p2_final:
        raise HTTPException(status_code=400, detail="Cannot generate P2 (sequence too short?).")

    return {
        "p1": p1_final,
        "p2": p2_final,
        "split_idx": split_idx
    }


if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
