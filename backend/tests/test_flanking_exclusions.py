"""Tests for excluded_regions filtering in /flanking_primers/design."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.main as main_module

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = REPO_ROOT / "qa_synthetic.oligool.json"

try:
    import strider  # noqa: F401
    _HAVE_STRIDER = True
except ImportError:  # pragma: no cover
    _HAVE_STRIDER = False


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


MANUAL_LEFT = [10, 60]
EXCLUDED = [30, 33]


def _overlaps(interval, excluded):
    return interval[0] < excluded[1] and excluded[0] < interval[1]


def _design(client, seq, **overrides):
    body = {
        "full_seq": seq,
        "oligo_start": 50,
        "oligo_end": 150,
        "manual_left_start": MANUAL_LEFT[0],
        "manual_left_end": MANUAL_LEFT[1],
        "excluded_regions": [EXCLUDED],
    }
    body.update(overrides)
    res = client.post("/flanking_primers/design", json=body)
    assert res.status_code == 200
    return res.json()


def test_primer3_excluded_region_respected(client: TestClient, fixture_seq: str) -> None:
    data = _design(client, fixture_seq)
    primers = data["forward"]["primers"]
    assert primers, "manual region must still yield candidates"
    for p in primers:
        iv = p["interval"]
        assert iv[0] >= MANUAL_LEFT[0] and iv[1] <= MANUAL_LEFT[1]
        assert not _overlaps(iv, EXCLUDED), f"primer {iv} overlaps exclusion {EXCLUDED}"
    assert data["forward"]["num_returned"] == len(primers)


def test_primer3_without_exclusions_unfiltered(client: TestClient, fixture_seq: str) -> None:
    data = _design(client, fixture_seq, excluded_regions=[])
    assert data["forward"]["primers"]
    for p in data["forward"]["primers"]:
        iv = p["interval"]
        assert iv[0] >= MANUAL_LEFT[0] and iv[1] <= MANUAL_LEFT[1]


def test_exclusion_outside_window_keeps_candidates(client: TestClient, fixture_seq: str) -> None:
    data = _design(client, fixture_seq, excluded_regions=[[200, 210]])
    assert data["forward"]["primers"]


@pytest.mark.skipif(not _HAVE_STRIDER, reason="strider-dna not installed")
def test_strider_excluded_region_respected(client: TestClient, fixture_seq: str) -> None:
    data = _design(client, fixture_seq, engine="strider")
    primers = data["forward"]["primers"]
    assert primers, "manual region must still yield candidates"
    for p in primers:
        iv = p["interval"]
        assert iv[0] >= MANUAL_LEFT[0] and iv[1] <= MANUAL_LEFT[1]
        assert not _overlaps(iv, EXCLUDED), f"primer {iv} overlaps exclusion {EXCLUDED}"
    assert data["forward"]["num_returned"] == len(primers)


def test_malformed_excluded_entries_ignored(client: TestClient, fixture_seq: str) -> None:
    data = _design(client, fixture_seq, excluded_regions=[[40, 40], [999999]])
    assert data["forward"]["primers"]
