"""
BLAST search module using NCBI's BLAST REST API directly.
Uses requests for more control over the submission/polling process.
"""
import os
import re
import time
import requests
import xml.etree.ElementTree as ET
from typing import Callable, List, Dict, Tuple, Optional


BLAST_PUT_URL = "https://blast.ncbi.nlm.nih.gov/blast/Blast.cgi"
RID_PATTERN = re.compile(r"^[A-Z0-9]{8,14}$")


def ncbi_identity() -> Dict[str, str]:
    """`tool` and `email` parameters NCBI asks every BLAST API client to send.

    Read at call time so values from the .env file (loaded by main.py) apply.
    """
    email = os.environ.get("NCBI_EMAIL") or os.environ.get("REPORT_NOTIFY_EMAIL", "rejtarv@sci.muni.cz")
    return {"tool": "oligool", "email": email}


def run_blast(
    sequence: str,
    max_hits: int = 50,
    api_key: str = "",
    organism: Optional[str] = None,
    e_value: Optional[float] = None,
    perc_identity: Optional[float] = None,
    filter_matches: bool = False,
    on_submit: Optional[Callable[[str], None]] = None,
) -> Tuple[List[Dict], Dict]:
    """
    Run NCBI BLAST search using the REST API and return top hits.
    Uses the aligned subject sequences directly from BLAST results.

    Args:
        sequence: The query nucleotide sequence (FASTA or raw).
        max_hits: Maximum number of hits to return.
        api_key: NCBI API key.
        organism: Organism name or taxid to filter by (e.g. "human", "txid9606").
        e_value: E-value threshold.
        perc_identity: Percent identity threshold (0-100).
        on_submit: Called with the RID as soon as NCBI accepts the job, so callers
            can show it before the search finishes (or times out).

    Returns:
        Tuple[List[Dict], Dict]:
            - List of hits (accession, description, evalue, identity, query_cover, sequence)
            - Metadata dict (rid, rtoe, query_len)
    """
    clean_seq = clean_query(sequence)

    print(f"[BLAST] Submitting {len(clean_seq)} bp query to NCBI...")

    # Step 1: Submit the BLAST job
    params = {
        "CMD": "Put",
        "PROGRAM": "blastn",
        "DATABASE": "nt",
        "QUERY": clean_seq,
        "HITLIST_SIZE": str(max_hits),
        "FORMAT_TYPE": "XML",
        "MEGABLAST": "on",  # Optimization: Use MEGABLAST for faster, high-identity matches
        **ncbi_identity(),
    }
    if api_key:
        params["API_KEY"] = api_key
        print(f"[BLAST] Using NCBI API key")

    if organism:
        # Construct Entrez Query for organism
        # If it looks like a taxid (e.g. txid9606), use it directly, else assume name
        org_query = f"{organism}[ORGN]"
        params["ENTREZ_QUERY"] = org_query
        print(f"[BLAST] Filtering by organism: {org_query}")

    if e_value is not None:
        params["EXPECT"] = str(e_value)
        print(f"[BLAST] Filtering by E-value: {e_value}")

    response = requests.post(BLAST_PUT_URL, data=params)
    response.raise_for_status()

    # Parse RID from response
    rid = None
    rtoe = 10  # estimated time
    for line in response.text.split("\n"):
        if line.strip().startswith("RID ="):
            rid = line.split("=")[1].strip()
        if line.strip().startswith("RTOE ="):
            try:
                rtoe = int(line.split("=")[1].strip())
            except ValueError:
                rtoe = 10

    if not rid:
        raise RuntimeError("Failed to submit BLAST job: no RID returned")

    print(f"[BLAST] Job submitted. RID={rid}, estimated wait={rtoe}s")
    if on_submit:
        on_submit(rid)

    # Step 2: Poll for results
    # Wait the estimated time first
    wait_time = min(rtoe, 15)  # Don't wait more than 15s initially
    print(f"[BLAST] Waiting {wait_time}s before first poll...")
    time.sleep(wait_time)

    max_polls = 20  # Max ~3-4 minutes of polling (20 * 10s = 200s)
    for poll in range(max_polls):
        check_params = {
            "CMD": "Get",
            "FORMAT_OBJECT": "SearchInfo",
            "RID": rid,
            **ncbi_identity(),
        }
        check_resp = requests.get(BLAST_PUT_URL, params=check_params)
        check_resp.raise_for_status()

        if "Status=WAITING" in check_resp.text:
            print(f"[BLAST] Still waiting... (poll {poll + 1}/{max_polls})")
            time.sleep(10) # Optimization: Wait 10s between polls to avoid throttling
            continue
        elif "Status=FAILED" in check_resp.text:
            raise RuntimeError("BLAST search failed on NCBI servers.")
        elif "Status=READY" in check_resp.text:
            print("[BLAST] Results ready!")
            break
    else:
        raise RuntimeError(f"BLAST search timed out after {max_polls * 10} seconds.")

    # Step 3: Fetch results in XML format
    xml_text = fetch_blast_xml(rid)

    # Step 4: Parse the XML
    hits, query_len = _parse_blast_xml(xml_text)
    hits, filtered_hits = filter_hits(hits, perc_identity, filter_matches)

    print(f"[BLAST] Returning {len(hits)} hits ({len(filtered_hits)} filtered)")
    metadata = {
        "rid": rid,
        "rtoe": rtoe,
        "query_len": query_len
    }
    return hits, metadata, filtered_hits


def clean_query(sequence: str) -> str:
    """Strip a FASTA header, whitespace and line breaks from a query sequence."""
    lines = sequence.strip().split("\n")
    if lines[0].startswith(">"):
        seq_lines = [l.strip() for l in lines[1:] if not l.startswith(">")]
    else:
        seq_lines = [l.strip() for l in lines]
    clean_seq = "".join(seq_lines).replace(" ", "").upper()

    if not clean_seq:
        raise RuntimeError("No sequence data found in input.")
    return clean_seq


def filter_hits(
    hits: List[Dict],
    perc_identity: Optional[float] = None,
    filter_matches: bool = False,
) -> Tuple[List[Dict], List[Dict]]:
    """Apply the % identity floor and split off 100% matches. Returns (hits, filtered_hits)."""
    if perc_identity is not None:
        print(f"[BLAST] Filtering by % identity >= {perc_identity}")
        hits = [h for h in hits if h["identity"] >= perc_identity]

    filtered_hits = []
    if filter_matches:
        print(f"[BLAST] Filtering out 100% exact matches")
        filtered_hits = [h for h in hits if h["identity"] >= 100.0]
        hits = [h for h in hits if h["identity"] < 100.0]
    return hits, filtered_hits


def fetch_blast_xml(rid: str, api_key: str = "") -> str:
    """Fetch finished results for an existing RID as BLAST XML."""
    params = {
        "CMD": "Get",
        "FORMAT_TYPE": "XML",
        "RID": rid,
        **ncbi_identity(),
    }
    if api_key:
        params["API_KEY"] = api_key
    resp = requests.get(BLAST_PUT_URL, params=params, timeout=120)
    resp.raise_for_status()
    return resp.text


def check_rid_status(rid: str, api_key: str = "") -> str:
    """Return the NCBI status of a RID: READY, WAITING, FAILED or UNKNOWN (expired or invalid)."""
    params = {
        "CMD": "Get",
        "FORMAT_OBJECT": "SearchInfo",
        "RID": rid,
        **ncbi_identity(),
    }
    if api_key:
        params["API_KEY"] = api_key
    resp = requests.get(BLAST_PUT_URL, params=params, timeout=30)
    resp.raise_for_status()
    for status in ("READY", "WAITING", "FAILED", "UNKNOWN"):
        if f"Status={status}" in resp.text:
            return status
    return "UNKNOWN"


def import_blast_results(
    rid: Optional[str] = None,
    xml_text: Optional[str] = None,
    max_hits: int = 50,
    api_key: str = "",
    perc_identity: Optional[float] = None,
    filter_matches: bool = False,
) -> Tuple[List[Dict], Dict, List[Dict]]:
    """
    Load results of a BLAST search run elsewhere (e.g. on the NCBI website),
    either by fetching its RID or from a downloaded XML file.
    Returns the same (hits, metadata, filtered_hits) shape as run_blast.
    """
    if rid:
        rid = rid.strip().upper()
        if not RID_PATTERN.match(rid):
            raise RuntimeError(f"'{rid}' does not look like a BLAST RID (e.g. 6H1AB2CD016).")
        print(f"[BLAST] Importing results for RID={rid}")
        status = check_rid_status(rid, api_key)
        if status == "WAITING":
            raise RuntimeError(f"BLAST search {rid} is still running on NCBI. Wait until the results page shows hits, then import again.")
        if status == "FAILED":
            raise RuntimeError(f"BLAST search {rid} failed on NCBI servers.")
        if status == "UNKNOWN":
            raise RuntimeError(f"NCBI does not know RID {rid}. Results expire about 36 hours after the search; download the XML file from the results page instead.")
        xml_text = fetch_blast_xml(rid, api_key)
    elif not xml_text or not xml_text.strip():
        raise RuntimeError("Provide a BLAST RID or an XML results file.")

    if "<BlastXML2" in xml_text[:2000]:
        raise RuntimeError("This is a BLAST XML2 file. On the NCBI results page choose Download All > XML (not XML2).")

    hits, query_len = _parse_blast_xml(xml_text)
    info = _parse_blast_header(xml_text)

    hits = hits[:max_hits]
    hits, filtered_hits = filter_hits(hits, perc_identity, filter_matches)

    print(f"[BLAST] Imported {len(hits)} hits ({len(filtered_hits)} filtered)")
    metadata = {
        "rid": rid or "",
        "rtoe": 0,
        "query_len": query_len,
        "program": info.get("program", ""),
        "database": info.get("database", ""),
        "imported": True,
    }
    return hits, metadata, filtered_hits


def _parse_blast_header(xml_text: str) -> Dict[str, str]:
    """Read program and database from a BLAST XML header."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return {}
    return {
        "program": _get_text(root, "BlastOutput_program"),
        "database": _get_text(root, "BlastOutput_db"),
    }


def _parse_blast_xml(xml_text: str) -> Tuple[List[Dict], int]:
    """Parse BLAST XML output and extract hit information."""
    hits = []

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        raise RuntimeError("Failed to parse BLAST XML response.")
    if root.tag != "BlastOutput":
        raise RuntimeError("Not a BLAST XML result (expected a <BlastOutput> document).")

    # Find query length
    query_len_el = root.find(".//BlastOutput_query-len")
    query_len = int(query_len_el.text) if query_len_el is not None and query_len_el.text else 0

    # Iterate through hits
    rank = 0
    # Only the first query is used; a multi-query search would otherwise mix hits
    iteration = root.find(".//Iteration")
    hit_parent = iteration if iteration is not None else root
    for hit in hit_parent.findall(".//Hit"):
        rank += 1
        hit_accession = _get_text(hit, "Hit_accession")
        hit_def = _get_text(hit, "Hit_def")

        # Get best HSP
        hsp = hit.find(".//Hsp")
        if hsp is None:
            continue

        identity = int(_get_text(hsp, "Hsp_identity", "0"))
        align_len = int(_get_text(hsp, "Hsp_align-len", "1"))
        evalue = float(_get_text(hsp, "Hsp_evalue", "999"))
        hsp_sbjct = _get_text(hsp, "Hsp_hseq", "")
        hsp_hit_from = int(_get_text(hsp, "Hsp_hit-from", "1"))
        hsp_hit_to = int(_get_text(hsp, "Hsp_hit-to", "1"))

        identity_pct = round((identity / align_len) * 100, 1) if align_len > 0 else 0
        query_cover_pct = round((align_len / query_len) * 100, 1) if query_len > 0 else 0

        # Use the subject sequence from the HSP (remove gaps)
        subject_seq = hsp_sbjct.replace("-", "")

        if subject_seq:
            hits.append({
                "accession": hit_accession,
                "description": hit_def[:100] if hit_def else "",
                "evalue": evalue,
                "identity": identity_pct,
                "query_cover": query_cover_pct,
                "sequence": subject_seq,
                "sstart": hsp_hit_from,
                "send": hsp_hit_to,
                "rank": rank,
            })

    return hits, query_len


def _get_text(element, tag: str, default: str = "") -> str:
    """Safely get text from an XML element."""
    child = element.find(tag)
    if child is not None and child.text:
        return child.text
    return default
