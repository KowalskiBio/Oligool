import requests

BASE_URL = "http://localhost:8000"


def test_multiple_sequence_alignment_with_valid_sequences():
    url = f"{BASE_URL}/align"
    headers = {"Content-Type": "application/json"}
    payload = {
        "sequences": [
            {"id": "seq1", "seq": "ATGCGTACGTTAG"},
            {"id": "seq2", "seq": "ATGCGTTCGTTAG"},
            {"id": "seq3", "seq": "ATGCGTACGCTAG"}
        ]
    }
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        assert response.status_code == 200, f"Expected 200 OK but got {response.status_code}"
        aligned_sequences = response.json()
        assert isinstance(aligned_sequences, list), "Response should be a list of aligned sequences"
        assert len(aligned_sequences) == len(payload["sequences"]), "Aligned sequences count mismatch"
        for item in aligned_sequences:
            assert "id" in item, "Aligned sequence missing 'id' field"
            assert "seq" in item, "Aligned sequence missing 'seq' field"
            assert isinstance(item["seq"], str) and len(item["seq"]) >= len(payload["sequences"][0]["seq"]), "Aligned sequence length invalid"
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"


test_multiple_sequence_alignment_with_valid_sequences()
