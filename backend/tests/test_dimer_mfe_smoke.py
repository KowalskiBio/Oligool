"""Smoke tests for dimer MFE behavior with strand-separator '&'."""

import pytest
from strider import ThermoEngine
from strider.thermo.dimer_thermo import dimer_thermo

BENCHMARK_SEQ = "CAACAAGGTCCGTGAGCTTC"


class TestEngMfeDimer:
    """ThermoEngine.mfe(seq, seq) returns &-separated structure and negative energy."""

    def test_structure_contains_ampersand(self):
        r = ThermoEngine().mfe(BENCHMARK_SEQ, BENCHMARK_SEQ)
        assert "&" in r.structure

    def test_energy_negative(self):
        r = ThermoEngine().mfe(BENCHMARK_SEQ, BENCHMARK_SEQ)
        assert r.energy < 0

    def test_sequence_contains_ampersand(self):
        r = ThermoEngine().mfe(BENCHMARK_SEQ, BENCHMARK_SEQ)
        assert "&" in r.sequence
        parts = r.sequence.split("&")
        assert parts[0] == BENCHMARK_SEQ
        assert parts[1] == BENCHMARK_SEQ

    def test_structure_lengths_match_per_strand(self):
        r = ThermoEngine().mfe(BENCHMARK_SEQ, BENCHMARK_SEQ)
        struct_parts = r.structure.split("&")
        assert len(struct_parts) == 2
        assert len(struct_parts[0]) == len(BENCHMARK_SEQ)
        assert len(struct_parts[1]) == len(BENCHMARK_SEQ)

    def test_self_complementary_short(self):
        r = ThermoEngine().mfe("AAAA", "TTTT")
        assert "&" in r.structure
        assert r.energy < 0


class TestDimerThermoFlat:
    """dimer_thermo returns flat structure (no &); backend _with_div handles both."""

    def test_structure_no_ampersand(self):
        res = dimer_thermo(
            BENCHMARK_SEQ,
            BENCHMARK_SEQ,
            sodium_M=0.05,
            magnesium_M=0.0,
            material="dna",
            structure=None,
            strand_conc_M=2.5e-7,
            salt_model="auto",
        )
        assert "&" not in res.structure

    def test_structure_length_is_concatenated(self):
        res = dimer_thermo(
            BENCHMARK_SEQ,
            BENCHMARK_SEQ,
            sodium_M=0.05,
            magnesium_M=0.0,
            material="dna",
            structure=None,
            strand_conc_M=2.5e-7,
            salt_model="auto",
        )
        assert len(res.structure) == 2 * len(BENCHMARK_SEQ)

    def test_negative_dG37(self):
        res = dimer_thermo(
            BENCHMARK_SEQ,
            BENCHMARK_SEQ,
            sodium_M=0.05,
            magnesium_M=0.0,
            material="dna",
            structure=None,
            strand_conc_M=2.5e-7,
            salt_model="auto",
        )
        assert res.dG37 < 0


class TestWithDivIdempotent:
    """Backend _with_div logic: inserting & at strand boundary is idempotent."""

    @staticmethod
    def _with_div(s, seq1_len):
        if len(s) > seq1_len and s[seq1_len] == "&":
            return s
        return s[:seq1_len] + "&" + s[seq1_len:]

    def test_flat_structure_gets_separator(self):
        flat = "....(((.((((.((.(((.....))).)))).')).)))."
        result = self._with_div(flat, 20)
        assert result[20] == "&"
        assert "&" not in result[:20]
        assert "&" not in result[21:]

    def test_already_separated_structure_unchanged(self):
        separated = "....(((.((((.((.(((.&....))).)))).')).)))."
        result = self._with_div(separated, 20)
        assert result == separated

    def test_double_call_idempotent(self):
        flat = "....(((.((((.((.(((.....))).)))).')).)))."
        once = self._with_div(flat, 20)
        twice = self._with_div(once, 20)
        assert once == twice
