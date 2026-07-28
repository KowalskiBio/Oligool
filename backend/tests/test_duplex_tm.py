"""Side-by-side Strider duplex_tm coverage for every endpoint that reports a primer3 Tm."""

from __future__ import annotations

import random

import pytest
from fastapi.testclient import TestClient

from backend.main import app, strider_duplex_tm

SEQ = "AGCTGACCTGAAGGTCAACGTA"


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


def _pseudo_random_dna(length: int, seed: int = 42) -> str:
    rng = random.Random(seed)
    return "".join(rng.choice("ACGT") for _ in range(length))


class TestStriderDuplexTmHelper:
    def test_maps_primer3_units_to_von_ahsen_recipe(self) -> None:
        import math

        from strider import melting_temperature

        ours = strider_duplex_tm(SEQ, mv_conc=50.0, dv_conc=3.0, dntp_conc=0.8, dna_conc=250.0)
        # von Ahsen (2001): [Na]_eq = [Na] + 120*sqrt([Mg]_free); dNTP chelates Mg first.
        free_mg_mM = 3.0 - 0.8
        theirs = melting_temperature(SEQ, strand_conc_M=250e-9,
                                     sodium_M=(50.0 + 120.0 * math.sqrt(free_mg_mM)) / 1000.0,
                                     magnesium_M=0.0)
        assert ours == pytest.approx(round(theirs, 1), abs=1e-9)

    def test_tracks_primer3_in_mixed_magnesium_buffer(self) -> None:
        # Acceptance criterion of the vendored workaround for EmilioVenegas/strider#10:
        # with Mg2+ present our strider Tm must stay within a few °C of primer3's,
        # not 6-10 °C below it.
        import primer3

        p3 = primer3.calc_tm(SEQ, mv_conc=50.0, dv_conc=3.0, dntp_conc=0.8, dna_conc=400.0)
        ours = strider_duplex_tm(SEQ, mv_conc=50.0, dv_conc=3.0, dntp_conc=0.8, dna_conc=400.0)
        assert abs(ours - p3) < 3.0

    def test_returns_none_for_empty_sequence(self) -> None:
        assert strider_duplex_tm("", mv_conc=50.0, dv_conc=3.0, dntp_conc=0.8, dna_conc=250.0) is None


class TestPrimersAnalyzeStriderTm:
    def _post(self, client: TestClient, **overrides) -> dict:
        body = {
            "sequence": SEQ,
            "mv_conc": 50.0,
            "dv_conc": 3.0,
            "dntp_conc": 0.8,
            "dna_conc": 400.0,
        }
        body.update(overrides)
        res = client.post("/primers/analyze", json=body)
        assert res.status_code == 200
        return res.json()

    def test_response_carries_tm_strider_next_to_primer3_tm(self, client: TestClient) -> None:
        data = self._post(client)
        # Sequence is 5'→3' as typed; AGCT... revcomp keeps it valid DNA.
        assert data["tm"] == pytest.approx(65.8, abs=0.2)
        assert isinstance(data["tm_strider"], float)
        assert 45.0 < data["tm_strider"] < 75.0

    def test_user_salt_param_flows_into_strider_tm(self, client: TestClient) -> None:
        low_salt = self._post(client)["tm_strider"]
        high_salt = self._post(client, mv_conc=500.0)["tm_strider"]
        assert high_salt > low_salt

    def test_user_oligo_conc_param_flows_into_strider_tm(self, client: TestClient) -> None:
        dilute = self._post(client, dna_conc=50.0)["tm_strider"]
        concentrated = self._post(client, dna_conc=2000.0)["tm_strider"]
        assert concentrated > dilute


class TestMoligizeStriderTm:
    def test_both_moligos_carry_tm_strider(self, client: TestClient) -> None:
        res = client.post(
            "/moligize",
            json={"sequence": _pseudo_random_dna(300), "moligo1_len": 22, "moligo2_len": 22},
        )
        assert res.status_code == 200
        data = res.json()
        for side in ("p1", "p2"):
            assert data[side]["tm"] > 0
            assert isinstance(data[side]["tm_strider"], float), side
            assert 40.0 < data[side]["tm_strider"] < 90.0, side


class TestFlankingPrimersDesignStriderTm:
    def test_primer_candidates_carry_tm_strider(self, client: TestClient) -> None:
        full_seq = _pseudo_random_dna(600, seed=7)
        res = client.post(
            "/flanking_primers/design",
            json={"full_seq": full_seq, "oligo_start": 250, "oligo_end": 350, "num_return": 3},
        )
        assert res.status_code == 200
        data = res.json()
        primers = data["forward"]["primers"] + data["reverse"]["primers"]
        assert primers, "expected primer3 to return at least one candidate"
        for p in primers:
            assert isinstance(p["tm_strider"], float)
            assert 40.0 < p["tm_strider"] < 90.0
