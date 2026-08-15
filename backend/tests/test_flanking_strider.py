"""Tests for the /flanking_primers/design engine toggle (primer3 vs strider)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.main as main_module

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = REPO_ROOT / "qa_synthetic.oligool.json"


@pytest.fixture(scope="module")
def fixture_data() -> dict:
    with open(FIXTURE_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


@pytest.fixture(scope="module")
def fixture_seq(fixture_data: dict) -> str:
    return fixture_data["search"]["input"]


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(main_module.app)


def _flanking_body(seq: str, *, engine: str | None = None, **overrides) -> dict:
    body = {
        "full_seq": seq,
        "oligo_start": 50,
        "oligo_end": 150,
    }
    body.update(overrides)
    if engine is not None:
        body["engine"] = engine
    return body


def test_primer3_default_has_no_strider_fields(client: TestClient, fixture_seq: str) -> None:
    res = client.post("/flanking_primers/design", json=_flanking_body(fixture_seq))
    assert res.status_code == 200
    data = res.json()
    assert "engine" not in data
    assert "strider_heterodimer" not in (data.get("pair_metrics") or {})
    for side in ("forward", "reverse"):
        for p in data[side]["primers"]:
            assert "strider" not in p


def test_strider_echo_and_sub_blocks(client: TestClient, fixture_seq: str) -> None:
    res = client.post(
        "/flanking_primers/design", json=_flanking_body(fixture_seq, engine="strider")
    )
    assert res.status_code == 200
    data = res.json()
    assert data.get("engine") == "strider"
    pm = data.get("pair_metrics") or {}
    assert "heterodimer" in pm
    assert "strider_heterodimer" in pm
    for side in ("forward", "reverse"):
        assert data[side]["explain"].startswith("strider:")
        for p in data[side]["primers"]:
            assert "strider" in p
            assert "hairpin_dg" in p["strider"]
            assert "homodimer_dg" in p["strider"]
            assert "tm" not in p["strider"]
            assert "primer3" in p
            assert p["primer3"]["self_any"] is None
            assert p["primer3"]["self_end"] is None
            assert p["primer3"]["hairpin_th"] is None


def test_strider_candidates_in_range(client: TestClient, fixture_seq: str) -> None:
    res = client.post(
        "/flanking_primers/design",
        json=_flanking_body(fixture_seq, engine="strider", min_tm=57.0, max_tm=67.0,
                            min_gc=20.0, max_gc=80.0, min_size=16, max_size=27),
    )
    assert res.status_code == 200
    data = res.json()
    for side in ("forward", "reverse"):
        for p in data[side]["primers"]:
            ts = p["tm_strider"]
            assert ts is not None
            assert 57.0 <= ts <= 67.0
            assert 16 <= p["length"] <= 27
            assert 20.0 <= p["gc_percent"] <= 80.0


def test_bogus_engine_rejected(client: TestClient, fixture_seq: str) -> None:
    res = client.post(
        "/flanking_primers/design", json=_flanking_body(fixture_seq, engine="bogus")
    )
    assert res.status_code == 422


def test_strider_unavailable_returns_503(
    client: TestClient, fixture_seq: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(main_module, "_strider_melting_temperature", None)
    res = client.post(
        "/flanking_primers/design", json=_flanking_body(fixture_seq, engine="strider")
    )
    assert res.status_code == 503


def test_contradictory_params_empty_not_500(client: TestClient, fixture_seq: str) -> None:
    res = client.post(
        "/flanking_primers/design",
        json=_flanking_body(fixture_seq, engine="strider", min_tm=70.0, max_tm=60.0),
    )
    assert res.status_code == 200
    data = res.json()
    assert len(data["forward"]["primers"]) == 0
    assert len(data["reverse"]["primers"]) == 0


def test_cache_separation_by_engine(client: TestClient, fixture_seq: str) -> None:
    """Identical payloads differing only in engine must not share a cache entry."""
    strider_res = client.post(
        "/flanking_primers/design", json=_flanking_body(fixture_seq, engine="strider")
    ).json()
    primer3_res = client.post(
        "/flanking_primers/design", json=_flanking_body(fixture_seq, engine="primer3")
    ).json()
    assert "engine" not in primer3_res, "primer3 response must not carry strider cache data"
    assert primer3_res.get("engine") != "strider"
    for side in ("forward", "reverse"):
        for p in primer3_res[side]["primers"]:
            assert "strider" not in p, "primer3 primer must not carry strider sub-block"
    assert strider_res.get("engine") == "strider"
