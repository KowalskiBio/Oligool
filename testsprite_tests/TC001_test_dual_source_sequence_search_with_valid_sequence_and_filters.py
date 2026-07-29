import requests

def test_dual_source_sequence_search_with_valid_sequence_and_filters():
    base_url = "http://localhost:8000"
    url = f"{base_url}/search"
    headers = {
        "Content-Type": "application/json"
    }
    # Example valid nucleotide sequence (partial human beta-actin mRNA)
    payload = {
        "sequence": "ATGGATGATGATATCGCCGCGCTCGTCGTCGTTCCAGG",
        "max_hits": 10,
        "organism": "Homo sapiens",
        "e_value": 1e-5,
        "perc_identity": 90.0,
        "filter_matches": True
    }
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=90)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        result = response.json()
        if isinstance(result, dict):
            # Check for hits in 'filtered_hits' or 'blast_hits'
            if "filtered_hits" in result and isinstance(result["filtered_hits"], list):
                result = result["filtered_hits"]
            elif "blast_hits" in result and isinstance(result["blast_hits"], list):
                result = result["blast_hits"]
            else:
                assert False, f"Response JSON object missing expected list field (filtered_hits/blast_hits): {result}"
        assert isinstance(result, list), "Response should be a list"
        # Check each BlastHit in the list contains required fields with valid types
        required_fields = {"accession", "description", "evalue", "identity", "query_cover", "sstart", "send", "rank"}
        for hit in result:
            assert isinstance(hit, dict), "Each hit should be a dictionary"
            assert required_fields.issubset(hit.keys()), f"Missing fields in hit: {required_fields - hit.keys()}"
            assert isinstance(hit["accession"], str), "accession should be string"
            assert isinstance(hit["description"], str), "description should be string"
            assert isinstance(hit["evalue"], (float, int)), "evalue should be a number"
            assert isinstance(hit["identity"], (float, int)), "identity should be a number"
            assert isinstance(hit["query_cover"], (float, int)), "query_cover should be a number"
            assert isinstance(hit["sstart"], int), "sstart should be int"
            assert isinstance(hit["send"], int), "send should be int"
            assert isinstance(hit["rank"], int), "rank should be int"
    except requests.exceptions.Timeout:
        assert False, "Request timed out"
    except requests.exceptions.RequestException as e:
        assert False, f"Request error: {e}"

test_dual_source_sequence_search_with_valid_sequence_and_filters()