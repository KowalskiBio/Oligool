"""Regression test: strider-dna baseline self-consistency.

Reads .omo/evidence/strider-v1.1.0-baseline.json, recomputes each entry with the
same Strider function calls as capture_baseline.py, and asserts that drift stays
near zero. This guards against accidental behavior changes when upgrading strider
or modifying the analysis code.

Tolerances (same-version recomputation, floating point only):
  - |delta_g drift| <= 1e-6 kcal/mol
  - |Tm drift|      <= 1e-6 deg-C
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
BASELINE_PATH = REPO_ROOT / ".omo" / "evidence" / "strider-v1.1.0-baseline.json"
LOG_PATH = REPO_ROOT / ".omo" / "evidence" / "task-6-regression.log"

# Same-version tolerances (floating-point noise only)
MAX_DG_DRIFT = 1e-6   # kcal/mol
MAX_TM_DRIFT = 1e-6   # deg-C

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
        fh.write("# Strider v1.1.0 regression log\n")
        fh.write(f"# baseline: {BASELINE_PATH}\n")
        fh.write(f"# tolerance: dG <= {MAX_DG_DRIFT} kcal/mol, Tm <= {MAX_TM_DRIFT} C\n\n")


@pytest.mark.parametrize(
    "entry",
    BASELINE_ENTRIES,
    ids=[e["label"] for e in BASELINE_ENTRIES],
)
def test_regression_vs_baseline(entry: dict[str, Any]) -> None:
    """Each baseline entry must reproduce within floating-point tolerance."""
    label = entry["label"]
    computed = _recompute_entry(entry)

    dg_baseline = entry["delta_g_fork"]
    dg_current = computed["delta_g"]
    dg_drift = abs(dg_current - dg_baseline)

    tm_baseline = entry["tm_fork"]
    tm_current = computed["tm"]

    # --- delta G assertion ---
    assert dg_drift <= MAX_DG_DRIFT, (
        f"{label}: dG drift {dg_drift:.4f} > {MAX_DG_DRIFT} "
        f"(baseline={dg_baseline:.4f}, current={dg_current:.4f})"
    )

    # --- Tm assertion ---
    if tm_baseline is None:
        if tm_current is not None:
            pytest.fail(
                f"{label}: baseline Tm=None but current returned Tm={tm_current:.2f}"
            )
    else:
        assert tm_current is not None, (
            f"{label}: baseline Tm={tm_baseline:.2f} but current returned None"
        )
        tm_drift = abs(tm_current - tm_baseline)
        assert tm_drift <= MAX_TM_DRIFT, (
            f"{label}: Tm drift {tm_drift:.2f} > {MAX_TM_DRIFT} "
            f"(baseline={tm_baseline:.2f}, current={tm_current:.2f})"
        )

    # --- Log per-entry drift ---
    tm_drift_str = (
        f"{abs(tm_current - tm_baseline):.4f}"
        if tm_baseline is not None and tm_current is not None
        else "N/A"
    )
    kind = "dimer" if entry["type"] != "hairpin" else "hairpin"
    _append_log(
        f"{label} [{kind}]: dG_drift={dg_drift:.4f}, Tm_drift={tm_drift_str} "
        f"(baseline_dG={dg_baseline:.4f}, current_dG={dg_current:.4f}, "
        f"baseline_Tm={tm_baseline}, current_Tm={tm_current})"
    )
