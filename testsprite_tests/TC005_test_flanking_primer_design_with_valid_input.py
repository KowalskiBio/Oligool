import requests

BASE_URL = "http://localhost:8000"
TIMEOUT = 30

def test_flanking_primer_design_with_valid_input():
    url = f"{BASE_URL}/flanking_primers/design"
    # Example valid payload based on the API schema and typical Primer3 constraints
    payload = {
        "full_seq": "ATGCGTACGTAGCTAGCTAGCTACGATCGATGCTAGCTAGCTGACTGATCGTAGCTAGCTAGCTGATCGATCGATCGTAGCTAGCTAGCTAG",
        "oligo_start": 10,
        "oligo_end": 30,
        "flank_window": 200,
        "opt_size": 20,
        "min_size": 16,
        "max_size": 27,
        "opt_tm": 62.0,
        "min_tm": 57.0,
        "max_tm": 67.0,
        "min_gc": 20.0,
        "max_gc": 80.0,
        "num_return": 5,
        "mv_conc": 50.0,
        "dv_conc": 3.0,
        "dntp_conc": 0.8,
        "dna_conc": 400.0
        # no manual region override here; testing default behavior
    }
    headers = {"Content-Type": "application/json"}

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

    assert response.status_code == 200, f"Expected 200 OK, got {response.status_code}"

    try:
        data = response.json()
    except ValueError:
        assert False, "Response is not valid JSON"

    # The response should contain Primer3-designed primer pairs and metrics
    assert isinstance(data, dict) or isinstance(data, list), "Response JSON should be a dict or list"

    # If list, check at least one item for expected keys
    primer_pairs = data if isinstance(data, list) else data.get("primer_pairs", data)

    assert primer_pairs, "No primer pairs found in response"

    sample = primer_pairs[0] if isinstance(primer_pairs, list) else primer_pairs

    # Check for presence of possible primer coordinate keys
    possible_start_keys = {"start", "left_primer_start", "right_primer_start", "oligo_start", "left_start", "right_start"}
    possible_end_keys = {"end", "left_primer_end", "right_primer_end", "oligo_end", "left_end", "right_end"}

    found_start_key = any(k in sample for k in possible_start_keys)
    found_end_key = any(k in sample for k in possible_end_keys)

    assert found_start_key, "Primer pair missing expected start position key"
    assert found_end_key, "Primer pair missing expected end position key"

    # Check melting temperature or GC content presence
    assert any(k in sample for k in ("melting_temp", "tm", "gc_content")), "Primer pair missing thermodynamic keys"

test_flanking_primer_design_with_valid_input()
