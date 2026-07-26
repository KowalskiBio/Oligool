from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


class TestPrimersAnalyze:
    """Verify the standalone Primer3 single-primer analysis endpoint."""

    def test_returns_primer3_tm_gc_and_structures(self, client: TestClient) -> None:
        res = client.post(
            "/primers/analyze",
            json={
                "sequence": "TAATTGTTACATTATGTAAT",
                "mv_conc": 50.0,
                "dv_conc": 3.0,
                "dntp_conc": 0.8,
                "dna_conc": 400.0,
            },
        )
        assert res.status_code == 200
        data = res.json()
        assert data["sequence"] == "TAATTGTTACATTATGTAAT"
        assert data["length"] == 20
        assert data["gc_percent"] == 15.0
        assert data["tm"] == 47.0
        assert "hairpin" in data
        assert "homodimer" in data

    def test_ignores_whitespace_and_lowercase(self, client: TestClient) -> None:
        res = client.post(
            "/primers/analyze",
            json={"sequence": "  taattgttacattatgtaat\n"},
        )
        assert res.status_code == 200
        assert res.json()["sequence"] == "TAATTGTTACATTATGTAAT"

    def test_rejects_empty_sequence(self, client: TestClient) -> None:
        res = client.post("/primers/analyze", json={"sequence": "   "})
        assert res.status_code == 400
