"""Tests for the equilibrium strip: cliff fix and the two-state mode.

The competition payload must stay populated past the hairpin Tm (previously
P_Hairpin collapsed to null one degree above Tm, because the flat-MFE path
skipped the partition), and P_Hairpin_TwoState must reproduce the classic
two-state sigmoid of the structure behind Local Tm: ~100% well below Tm,
50% at Tm, monotonically decaying above it.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import backend.main as main_module

try:
    import strider  # noqa: F401
    _HAVE_STRIDER = True
except ImportError:  # pragma: no cover
    _HAVE_STRIDER = False

pytestmark = pytest.mark.skipif(not _HAVE_STRIDER, reason="strider-dna not installed")

SEQ = "AACCAAGCCCTGTTGAAACACAGGGAAGAAAT"
SEQ2 = "TGGTAATCGATACATCGAG"


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(main_module.app)


def _competition(client: TestClient, temp: float, p2: str | None = None):
    payload = {"p1_seq": SEQ, "temp": temp}
    if p2 is not None:
        payload["p2_seq"] = p2
    response = client.post("/strider/competition", json=payload)
    assert response.status_code == 200
    return response.json()["m1"]["competition"]


@pytest.fixture(scope="module")
def local_tm() -> float:
    """Local Tm of the card's anchor structure (the 25 C MFE)."""
    res = main_module.strider_hairpin_analysis(
        SEQ, mv_conc=50.0, dv_conc=10.0, dntp_conc=0.8,
        parameter_set="mathews2004-dna")
    assert res["tm"] is not None
    return res["tm"]


def test_population_survives_past_tm(client, local_tm):
    """The cliff regression: P_Hairpin must stay populated above the Tm."""
    for temp in [25.0, 45.0, local_tm, local_tm + 1.0, local_tm + 5.0,
                 local_tm + 15.0, 80.0]:
        comp = _competition(client, temp)
        assert comp is not None, f"competition payload vanished at {temp} C"
        assert comp["P_Hairpin"] is not None and comp["P_Hairpin"] > 0, \
            f"P_Hairpin dropped to null/zero at {temp} C (the cliff)"
        assert comp["P_Unfolded"] is not None
        assert comp["P_Hairpin_TwoState"] is not None


def test_two_state_reads_half_at_local_tm(client, local_tm):
    comp = _competition(client, local_tm)
    assert 0.45 <= comp["P_Hairpin_TwoState"] <= 0.55
    below = _competition(client, local_tm - 2.0)
    above = _competition(client, local_tm + 2.0)
    assert below["P_Hairpin_TwoState"] > 0.55
    assert above["P_Hairpin_TwoState"] < 0.45
    room_temp = _competition(client, 25.0)
    assert room_temp["P_Hairpin_TwoState"] > 0.99


def test_two_state_decays_monotonically(client):
    prev = None
    for temp in range(25, 86, 5):
        comp = _competition(client, float(temp))
        ts = comp["P_Hairpin_TwoState"]
        assert 0.0 <= ts <= 1.0
        if prev is not None:
            assert ts <= prev + 1e-9, \
                f"two-state fraction rose from {prev} to {ts} at {temp} C"
        prev = ts


def test_ensemble_segments_sum_to_free(client, local_tm):
    for temp in [25.0, local_tm, local_tm + 10.0]:
        comp = _competition(client, temp)
        monomer_split = (comp["P_Hairpin"] or 0.0) + (comp["P_Unfolded"] or 0.0)
        assert monomer_split <= comp["P_Free"] + 1e-3
        assert comp["P_Free"] + comp["P_SelfDimer"] <= 1.0 + 1e-3


def test_two_oligo_payload_carries_two_state(client):
    response = client.post(
        "/strider/competition",
        json={"p1_seq": SEQ, "p2_seq": SEQ2, "temp": 60.0})
    assert response.status_code == 200
    for side in ["m1", "m2"]:
        comp = response.json()[side]["competition"]
        assert comp is not None
        assert comp["P_Hairpin_TwoState"] is not None
        assert 0.0 <= comp["P_Hairpin_TwoState"] <= 1.0


# Two-stem MFE fold (the single-hairpin two-state model refuses it).
MULTILOOP_SEQ = "AAGAACCAGAAATGGCCAACCAAGCCCTGTTGAAACACAGGGAA"
HAIRPIN_SEQ = "GAAATTGGTAATCGATACATCGAGATAT"


def test_multiloop_folds_are_flagged_not_silent(client):
    response = client.post("/strider/analyze", json={"p1_seq": MULTILOOP_SEQ})
    items = response.json()["m1"]["hairpin"]["raw"]
    assert items, "hairpin cards missing for the multiloop sequence"
    for item in items:
        # Branched folds keep strider's split-out best-stem Tm, flagged so the
        # UI can annotate it as a per-stem number rather than the whole fold's.
        assert item["Local_Tm_Multiloop"] is True
        assert item["Local_Tm"] is not None
        assert item["Local_DeltaG"] is not None

    response = client.post("/strider/analyze", json={"p1_seq": HAIRPIN_SEQ})
    items = response.json()["m1"]["hairpin"]["raw"]
    assert items[0]["Local_Tm"] is not None
    for item in items:
        assert item["Local_Tm_Multiloop"] is False
