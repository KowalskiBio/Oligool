"""
Fetches a GenBank flat-file record from NCBI for a single accession and
returns its FEATURES table as structured JSON, so the frontend can preview
gene/CDS locations without leaving the app.

When seq_start/seq_stop are given (1-based, inclusive), NCBI returns only
that slice of the record - much faster for large genomes and matches exactly
what the "Coding region" NCBI deep link (already offered alongside this)
would show if opened.
"""
import io
from typing import Dict, List, Optional

import requests
from Bio import SeqIO
from Bio.SeqFeature import AfterPosition, BeforePosition, CompoundLocation, SimpleLocation

EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"

# Feature-table qualifiers worth surfacing in the popup; anything else (e.g.
# /translation, /db_xref) stays out to keep the response small and readable.
_QUALIFIER_KEYS = ("gene", "product", "protein_id", "note")

# Large records (bacterial/human chromosomes) can carry thousands of features;
# cap the response so the popup stays fast and readable.
_MAX_FEATURES = 300


def _format_location(loc: SimpleLocation) -> str:
    """Render a Biopython location back into classic GenBank flat-file style
    (e.g. "102..566", "<3..470", "2744..>3003", "complement(569..886)") instead
    of Biopython's own 0-based "[101:566](+)" repr."""
    if isinstance(loc, CompoundLocation):
        inner = ",".join(_format_location(part).replace("complement(", "").rstrip(")") for part in loc.parts)
        core = f"join({inner})"
    else:
        start_str = ("<" if isinstance(loc.start, BeforePosition) else "") + str(int(loc.start) + 1)
        end_str = (">" if isinstance(loc.end, AfterPosition) else "") + str(int(loc.end))
        core = f"{start_str}..{end_str}"
    return f"complement({core})" if loc.strand == -1 else core


def fetch_genbank_features(accession: str, seq_start: Optional[int] = None, seq_stop: Optional[int] = None) -> Dict:
    accession = (accession or "").strip()
    if not accession:
        raise ValueError("accession is required")

    params = {"db": "nuccore", "id": accession, "rettype": "gb", "retmode": "text"}
    if seq_start is not None and seq_stop is not None:
        params["seq_start"] = str(seq_start)
        params["seq_stop"] = str(seq_stop)

    resp = requests.get(EFETCH_URL, params=params, timeout=20)
    resp.raise_for_status()
    text = resp.text
    if not text.lstrip().startswith("LOCUS"):
        raise RuntimeError(f"No GenBank record returned for {accession}")

    record = SeqIO.read(io.StringIO(text), "genbank")

    source: Dict[str, Optional[str]] = {}
    features: List[Dict] = []
    total_non_source = 0
    for feat in record.features:
        if feat.type == "source":
            source = {
                "organism": feat.qualifiers.get("organism", [None])[0],
                "isolate": feat.qualifiers.get("isolate", [None])[0] or feat.qualifiers.get("strain", [None])[0],
                "mol_type": feat.qualifiers.get("mol_type", [None])[0],
                "note": feat.qualifiers.get("note", [None])[0],
            }
            continue

        total_non_source += 1
        if len(features) >= _MAX_FEATURES:
            continue

        entry: Dict = {
            "type": feat.type,
            "location": _format_location(feat.location),
            "start": int(feat.location.start) + 1,
            "end": int(feat.location.end),
            "strand": feat.location.strand,
        }
        for key in _QUALIFIER_KEYS:
            if key in feat.qualifiers:
                entry[key] = feat.qualifiers[key][0]
        features.append(entry)

    return {
        "accession": record.id,
        "definition": record.description,
        "length": len(record.seq),
        "source": source,
        "features": features,
        "truncated": total_non_source > len(features),
    }
