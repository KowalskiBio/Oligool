"""Tests for the /moligize engine toggle (primer3 default vs strider)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.main as main_module

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = REPO_ROOT / "qa_synthetic.oligool.json"


@pytest.fixture(scope="module")
def fixture_seq() -> str:
    with open(FIXTURE_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)["search"]["input"]


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(main_module.app)


SEARCH_PARAMS = {
    "min_len": 15,
    "max_len": 35,
    "tm_min": 58,
    "tm_max": 63,
    "tm_diff": 1.5,
    "gc_min": 30,
    "gc_max": 80,
}


def _moligize_body(seq: str, *, engine: str | None = None, auto_search: bool = True) -> dict:
    body = {
        "sequence": seq,
        "auto_search": auto_search,
        "local_optimize": True,
        "scan_full_region": False,
        "search_params": SEARCH_PARAMS,
        "salt_mono": 50,
        "salt_div": 10,
        "dntp_conc": 0.8,
        "dna_conc": 400,
    }
    if engine is not None:
        body["engine"] = engine
    return body


def test_primer3_default_has_no_engine_echo(client: TestClient, fixture_seq: str) -> None:
    """Primer3 mode (default, no engine field) must not carry an `engine` key."""
    res = client.post("/moligize", json=_moligize_body(fixture_seq))
    assert res.status_code == 200
    data = res.json()
    assert "engine" not in data, "primer3 mode must not echo engine"
    for key in ("p1", "p2", "tm_diff_ok", "split_idx", "params_not_met", "param_warnings"):
        assert key in data


def test_primer3_explicit_matches_default(client: TestClient, fixture_seq: str) -> None:
    """Explicit engine=primer3 produces the same response as omitting the field."""
    implicit = client.post("/moligize", json=_moligize_body(fixture_seq)).json()
    explicit = client.post(
        "/moligize", json=_moligize_body(fixture_seq, engine="primer3")
    ).json()
    assert implicit == explicit


def test_strider_echoes_engine_and_in_range_tm(client: TestClient, fixture_seq: str) -> None:
    """Strider mode echoes engine and validates tm against the strider model."""
    res = client.post("/moligize", json=_moligize_body(fixture_seq, engine="strider"))
    assert res.status_code == 200
    data = res.json()
    assert data.get("engine") == "strider"
    for side in ("p1", "p2"):
        stats = data[side]
        assert "tm" in stats and "tm_strider" in stats
        ts = stats["tm_strider"]
        assert ts is not None, "strider Tm must be present after the 503 guard"
        assert SEARCH_PARAMS["tm_min"] <= ts <= SEARCH_PARAMS["tm_max"], (
            f"{side} strider Tm {ts} outside search range"
        )
        assert stats["tm_ok"] is True
    assert data["tm_diff_ok"] is True


def test_strider_validation_uses_strider_tm(client: TestClient, fixture_seq: str) -> None:
    """A tight strider-incompatible Tm range must flag tm_ok False via strider values."""
    body = _moligize_body(fixture_seq, engine="strider")
    body["search_params"] = {
        "min_len": 15,
        "max_len": 35,
        "tm_min": 0.0,
        "tm_max": 1.0,
        "tm_diff": 0.1,
        "gc_min": 0,
        "gc_max": 100,
    }
    res = client.post("/moligize", json=body)
    assert res.status_code == 200
    data = res.json()
    assert data["p1"]["tm_ok"] is False
    assert data["p2"]["tm_ok"] is False
    assert data["params_not_met"] is True


def test_bogus_engine_rejected(client: TestClient, fixture_seq: str) -> None:
    res = client.post("/moligize", json=_moligize_body(fixture_seq, engine="bogus"))
    assert res.status_code == 422


def test_strider_unavailable_returns_503(
    client: TestClient, fixture_seq: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When the strider kernel is unavailable, strider mode returns 503."""
    monkeypatch.setattr(main_module, "_strider_melting_temperature", None)
    res = client.post("/moligize", json=_moligize_body(fixture_seq, engine="strider"))
    assert res.status_code == 503


def test_manual_mode_strider(client: TestClient, fixture_seq: str) -> None:
    """Strider manual mode (auto_search off) still echoes engine."""
    res = client.post(
        "/moligize",
        json=_moligize_body(fixture_seq, engine="strider", auto_search=False),
    )
    assert res.status_code == 200
    assert res.json().get("engine") == "strider"
