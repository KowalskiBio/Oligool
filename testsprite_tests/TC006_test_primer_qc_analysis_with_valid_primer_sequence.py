import requests

BASE_URL = "http://localhost:8000"


def test_primer_qc_analysis_with_valid_primer_sequence():
    url = f"{BASE_URL}/primers/analyze"
    headers = {
        "Content-Type": "application/json",
    }
    payload = {
        "sequence": "ATCGTACGATCGATCGATCG",  # valid primer sequence
        "mv_conc": 50.0,
        "dv_conc": 3.0,
        "dntp_conc": 0.8,
        "dna_conc": 400.0
    }
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"
    assert response.status_code == 200, f"Unexpected status code: {response.status_code}"
    try:
        data = response.json()
    except ValueError:
        assert False, "Response is not valid JSON"
    # Basic assertions on returned analysis results keys
    assert isinstance(data, dict), "Response JSON should be an object"
    # Expect some typical keys in thermodynamic analysis
    expected_keys = ["tm", "hairpin", "dimer"]
    for key in expected_keys:
        assert key in data, f"Key '{key}' not found in response data"

    # Optional: Validate that Tm and dimer values are numbers
    assert isinstance(data.get("tm"), (int, float)), "Tm should be numeric"
    # dimer may be complex structure, so just ensure key exists
    
test_primer_qc_analysis_with_valid_primer_sequence()