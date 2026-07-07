"""Regression test: strider-dna v0.7.0 vs fork baseline.

Reads .omo/evidence/strider-fork-baseline.json, recomputes each entry under
v0.7.0 using the same Strider function calls as capture_baseline.py, and
asserts that drift stays within type-specific tolerances:

Hairpin cases:
  - |delta_g drift| <= 0.3 kcal/mol
  - |Tm drift|      <= 1.0 deg-C

Dimer cases:
  - Upstream v0.6.0+ (including v0.7.0) adds DUPLEX_INIT_DG37 = +1.96 kcal/mol
    (SantaLucia & Hicks 2004 bimolecular duplex initiation/nucleation term) that
    the fork omitted. This is an intentional upstream correction, not a regression.
    We therefore assert that dG drift ≈ +1.96 kcal/mol (within ±0.1) rather than
    requiring near-zero drift.
  - The same initiation term also shifts Tm by several degrees (correcting
    previously inflated dimer Tm).  A wider tolerance of ±15 °C is used.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from strider import ThermoEngine
from strider.thermo.hairpin import hairpin_thermo
from strider.thermo.dimer_thermo import dimer_thermo

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]
BASELINE_PATH = REPO_ROOT / ".omo" / "evidence" / "strider-fork-baseline.json"
LOG_PATH = REPO_ROOT / ".omo" / "evidence" / "task-6-regression.log"

# Hairpin tolerances (no known systematic shift)
HP_MAX_DG_DRIFT = 0.3   # kcal/mol
HP_MAX_TM_DRIFT = 1.0   # deg-C

# Dimer tolerances (expected offset from DUPLEX_INIT_DG37 addition)
DIM_EXPECTED_DG_OFFSET = 1.96   # kcal/mol — the initiation term added in v0.6.0+ (still present in v0.7.0)
DIM_DG_TOLERANCE = 0.1          # allowed deviation from expected offset
DIM_MAX_TM_DRIFT = 15.0         # deg-C — initiation term shifts Tm significantly

# ---------------------------------------------------------------------------
# Baseline loader
# ---------------------------------------------------------------------------

def _load_baseline() -> list[dict[str, Any]]:
    with open(BASELINE_PATH, encoding="utf-8") as fh:
        doc = json.load(fh)
    assert "entries" in doc, "baseline missing 'entries' key"
    return doc["entries"]


BASELINE_ENTRIES = _load_baseline()

# ---------------------------------------------------------------------------
# Recomputation helpers (mirror capture_baseline.py exactly)
# ---------------------------------------------------------------------------

def _recompute_hairpin(seq: str, sodium_m: float, magnesium_m: float) -> dict[str, Any]:
    eng = ThermoEngine(
        material="dna", celsius=25.0, sodium=sodium_m, magnesium=magnesium_m,
    )
    mfe = eng.mfe(seq)
    delta_g = float(mfe.energy)

    tm: float | None = None
    try:
        res = hairpin_thermo(
            seq,
            sodium_M=sodium_m,
            magnesium_M=magnesium_m,
            material="dna",
            salt_model="auto",
        )
        tm = float(res.tm_celsius)
    except Exception:
        tm = None

    return {"delta_g": delta_g, "tm": tm}


def _recompute_dimer(
    seq1: str, seq2: str, sodium_m: float, magnesium_m: float,
) -> dict[str, Any]:
    res = dimer_thermo(
        seq1,
        seq2,
        sodium_M=sodium_m,
        magnesium_M=magnesium_m,
        material="dna",
        structure=None,
        strand_conc_M=2.5e-7,
        salt_model="auto",
    )
    return {"delta_g": float(res.dG37), "tm": float(res.tm_celsius)}


def _recompute_entry(entry: dict[str, Any]) -> dict[str, Any]:
    if entry["type"] == "hairpin":
        return _recompute_hairpin(entry["sequences"][0], entry["sodium_M"], entry["magnesium_M"])
    return _recompute_dimer(
        entry["sequences"][0], entry["sequences"][1],
        entry["sodium_M"], entry["magnesium_M"],
    )

# ---------------------------------------------------------------------------
# Regression log
# ---------------------------------------------------------------------------

def _append_log(line: str) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_PATH, "a", encoding="utf-8") as fh:
        fh.write(line + "\n")

# ---------------------------------------------------------------------------
# Parametrized regression test
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True, scope="module")
def _init_log():
    """Overwrite log at module start."""
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_PATH, "w", encoding="utf-8") as fh:
        fh.write("# Strider v0.7.0 regression log\n")
        fh.write(f"# baseline: {BASELINE_PATH}\n")
        fh.write(f"# hairpin tolerance: dG <= {HP_MAX_DG_DRIFT} kcal/mol, Tm <= {HP_MAX_TM_DRIFT} C\n")
        fh.write(f"# dimer expected dG offset: +{DIM_EXPECTED_DG_OFFSET} kcal/mol (DUPLEX_INIT_DG37), tol +/-{DIM_DG_TOLERANCE}\n")
        fh.write(f"# dimer Tm tolerance: <= {DIM_MAX_TM_DRIFT} C\n\n")


@pytest.mark.parametrize(
    "entry",
    BASELINE_ENTRIES,
    ids=[e["label"] for e in BASELINE_ENTRIES],
)
def test_regression_vs_fork(entry: dict[str, Any]) -> None:
    """Each baseline entry must meet type-specific drift tolerances under v0.7.0."""
    label = entry["label"]
    is_dimer = entry["type"] != "hairpin"
    computed = _recompute_entry(entry)

    dg_fork = entry["delta_g_fork"]
    dg_v070 = computed["delta_g"]
    dg_drift = abs(dg_v070 - dg_fork)

    tm_fork = entry["tm_fork"]
    tm_v070 = computed["tm"]

    # --- delta G assertion ---
    if is_dimer:
        # v0.6.0+ (including v0.7.0) adds DUPLEX_INIT_DG37 = +1.96; drift should match this offset.
        offset_error = abs(dg_drift - DIM_EXPECTED_DG_OFFSET)
        assert offset_error <= DIM_DG_TOLERANCE, (
            f"{label}: dG drift {dg_drift:.4f} != expected offset "
            f"{DIM_EXPECTED_DG_OFFSET} +/- {DIM_DG_TOLERANCE} "
            f"(fork={dg_fork:.4f}, v070={dg_v070:.4f})"
        )
    else:
        assert dg_drift <= HP_MAX_DG_DRIFT, (
            f"{label}: dG drift {dg_drift:.4f} > {HP_MAX_DG_DRIFT} "
            f"(fork={dg_fork:.4f}, v070={dg_v070:.4f})"
        )

    # --- Tm assertion ---
    if tm_fork is None:
        # Fork reported no Tm; v0.7.0 should also yield None.
        if tm_v070 is not None:
            pytest.fail(
                f"{label}: fork Tm=None but v0.7.0 returned Tm={tm_v070:.2f}"
            )
    else:
        assert tm_v070 is not None, (
            f"{label}: fork Tm={tm_fork:.2f} but v0.7.0 returned None"
        )
        tm_drift = abs(tm_v070 - tm_fork)
        max_tm = DIM_MAX_TM_DRIFT if is_dimer else HP_MAX_TM_DRIFT
        assert tm_drift <= max_tm, (
            f"{label}: Tm drift {tm_drift:.2f} > {max_tm} "
            f"(fork={tm_fork:.2f}, v070={tm_v070:.2f})"
        )

    # --- Log per-entry drift ---
    tm_drift_str = (
        f"{abs(tm_v070 - tm_fork):.4f}" if tm_fork is not None and tm_v070 is not None
        else "N/A"
    )
    kind = "dimer" if is_dimer else "hairpin"
    _append_log(
        f"{label} [{kind}]: dG_drift={dg_drift:.4f}, Tm_drift={tm_drift_str} "
        f"(fork_dG={dg_fork:.4f}, v070_dG={dg_v070:.4f}, "
        f"fork_Tm={tm_fork}, v070_Tm={tm_v070})"
    )
