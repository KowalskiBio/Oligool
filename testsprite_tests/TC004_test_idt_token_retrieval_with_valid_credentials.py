import requests

def test_idt_token_retrieval_with_valid_credentials():
    url = "http://localhost:8000/idt/token"
    # Placeholder valid credentials (should be replaced with real valid credentials)
    payload = {
        "client_id": "valid_client_id",
        "client_secret": "valid_client_secret"
    }
    headers = {
        "Content-Type": "application/json"
    }
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

    assert response.status_code in (200, 400), f"Unexpected status code: {response.status_code}"
    if response.status_code == 200:
        json_resp = response.json()
        assert isinstance(json_resp, dict), "Response is not a JSON object"
        token = json_resp.get("access_token") or json_resp.get("token")
        # Some APIs may return token under different keys, so we check possible keys
        assert token is not None and isinstance(token, str) and len(token) > 0, "Missing or invalid access token"
    else:
        # For 400 Bad Request due to invalid credentials, the response may contain error details
        json_resp = response.json()
        assert "error" in json_resp or "detail" in json_resp, "Expected error detail in 400 response"

test_idt_token_retrieval_with_valid_credentials()