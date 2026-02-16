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



class MoligizeRequest(BaseModel):
    sequence: str
    moligo1_shift: int = 0 # Shift for Right/3' oligo (MOLigo 1)
    moligo2_shift: int = 0 # Shift for Left/5' oligo (MOLigo 2)

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
    
    if full_len > window_len:
        start_w = (full_len - window_len) // 2
        end_w = start_w + window_len
        window_seq = seq[start_w:end_w]
        # split relative to window is 50
        split_idx_in_window = window_len // 2
        # absolute split index (for reference)
        absolute_split = start_w + split_idx_in_window
    else:
        window_seq = seq
        split_idx_in_window = full_len // 2
        absolute_split = split_idx_in_window

    # 2. MOLigo Generation (20bp, RevComp)
    # We work relative to the *window* center (split_idx_in_window)
    # MOLigo 2 (Left/5' side): ends at split + shift.
    # MOLigo 1 (Right/3' side): starts at split + shift.

    # --- MOLigo 2 (Left) ---
    # Target 20bp ENDING at (split_idx_in_window + request.moligo2_shift)
    m2_end = split_idx_in_window + request.moligo2_shift
    m2_start = m2_end - 20
    
    # Check bounds relative to window
    if m2_start < 0 or m2_end > len(window_seq):
         # If out of window bounds, try clamping or error? 
         # User requested "if user provided less, then work with what he provided".
         # Let's clamp to window limits, even if < 20bp?
         # "write them out in a box... 20 bp long oligos" -> strict 20bp implies we shouldn't return mismatch length.
         # But shifts might push it out. Let's return error if out of bounds of the *window*?
         # Or maybe just clamp shift? user wants to move them.
         # If I strictly follow: "select +- 100bp... split into two 20 bp long oligos".
         # Let's safeguard index.
         m2_start = max(0, m2_start)
         m2_end = min(len(window_seq), m2_end)
    
    moligo2_seq_fwd = window_seq[m2_start:m2_end]
    moligo2_final = str(Seq(moligo2_seq_fwd).reverse_complement())

    # --- MOLigo 1 (Right) ---
    # Target 20bp STARTING at (split_idx_in_window + request.moligo1_shift)
    m1_start = split_idx_in_window + request.moligo1_shift
    m1_end = m1_start + 20

    if m1_start < 0 or m1_end > len(window_seq):
        m1_start = max(0, m1_start)
        m1_end = min(len(window_seq), m1_end)

    moligo1_seq_fwd = window_seq[m1_start:m1_end]
    moligo1_final = str(Seq(moligo1_seq_fwd).reverse_complement())

    # Calc Stats
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

    # Absolute indices relative to original `seq`
    # (Handling cases where window_seq might be shorter than window_len)
    abs_m2_start = (start_w if full_len > window_len else 0) + m2_start
    abs_m2_end = (start_w if full_len > window_len else 0) + m2_end
    
    abs_m1_start = (start_w if full_len > window_len else 0) + m1_start
    abs_m1_end = (start_w if full_len > window_len else 0) + m1_end

    return {
        "p1": get_stats(moligo1_final, abs_m1_start, abs_m1_end), # Right side (MOLigo 1)
        "p2": get_stats(moligo2_final, abs_m2_start, abs_m2_end), # Left side (MOLigo 2)
        "split_idx": absolute_split
    }


if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
