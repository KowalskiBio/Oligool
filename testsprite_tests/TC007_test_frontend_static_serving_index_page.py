import requests

BASE_URL = "http://localhost:8000"


def test_frontend_static_serving_index_page():
    url = f"{BASE_URL}/"
    headers = {
        "Accept": "text/html"
    }
    try:
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
    except requests.RequestException as e:
        assert False, f"Request to GET / failed: {e}"

    # Assert status code is 200
    assert response.status_code == 200, f"Expected status code 200, got {response.status_code}"

    content_type = response.headers.get("Content-Type", "")
    # Assert content type is HTML
    assert "text/html" in content_type, f"Expected 'text/html' in Content-Type, got '{content_type}'"

    # Assert response text contains basic HTML structure
    html_content = response.text.lower()
    assert "<html" in html_content and "</html>" in html_content, "Response does not contain valid HTML content"


test_frontend_static_serving_index_page()