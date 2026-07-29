import requests

BASE_URL = "http://localhost:8000"


def test_moligo_design_with_valid_parameters():
    url = f"{BASE_URL}/moligize"
    headers = {
        "Content-Type": "application/json"
    }
    payload = {
        "sequence": "ATGCGTACGTAGCTAGCTAGCTGACTGATCGTAGCTAGCTGATCGATCGTACTG",
        "moligo1_shift": 2,
        "moligo2_shift": 3,
        "moligo1_len": 20,
        "moligo2_len": 20,
        "salt_mono": 50.0,
        "salt_div": 10.0,
        "dntp_conc": 0.8,
        "dna_conc": 400.0,
        "auto_search": False,
        "local_optimize": False,
        "scan_full_region": False
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
    except requests.RequestException as e:
        assert False, f"Request to /moligize failed: {e}"

    json_resp = response.json()
    
    assert isinstance(json_resp, dict), "Response JSON is not a dictionary"

    # Check required split position keys
    assert "moligo1_start" in json_resp, "Response missing 'moligo1_start' key"
    assert "moligo2_start" in json_resp, "Response missing 'moligo2_start' key"
    assert isinstance(json_resp["moligo1_start"], int), "moligo1_start is not an integer"
    assert isinstance(json_resp["moligo2_start"], int), "moligo2_start is not an integer"

    # Check oligo sequences keys
    assert "moligo1_seq" in json_resp, "Response missing 'moligo1_seq' key"
    assert "moligo2_seq" in json_resp, "Response missing 'moligo2_seq' key"
    assert isinstance(json_resp["moligo1_seq"], str), "moligo1_seq is not a string"
    assert isinstance(json_resp["moligo2_seq"], str), "moligo2_seq is not a string"

    # Thermodynamic checks
    thermodynamics_keys = [
        "tm_moligo1", "tm_moligo2", "delta_g", "delta_h", "delta_s"
    ]
    found_thermo_key = False
    for key in thermodynamics_keys:
        if key in json_resp:
            val = json_resp[key]
            assert isinstance(val, (int, float)), f"Thermodynamic value '{key}' is not numeric"
            found_thermo_key = True
    assert found_thermo_key, "Response missing thermodynamic values"


test_moligo_design_with_valid_parameters()
