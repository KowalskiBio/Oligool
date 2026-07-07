#!/usr/bin/env python3
"""Capture Strider fork baseline ΔG/Tm for a reference primer panel.

Uses exactly the same Strider functions Oligool's backend/main.py uses so the
output can serve as a regression baseline when upgrading strider.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from strider import ThermoEngine
from strider.thermo.hairpin import hairpin_thermo
from strider.thermo.dimer_thermo import dimer_thermo

BENCHMARK_SEQ = "CAACAAGGTCCGTGAGCTTC"
HAIRPIN_SEQ = "GCGCTTTTGCGC"
HETERODIMER_SEQ2 = "GCTTCGAGTACGTTGTTG"
FLAT_SEQ = "AAAA"

OUTPUT_PATH = ".omo/evidence/strider-fork-baseline.json"


@dataclass
class PanelCase:
    label: str
    sequences: list[str]
    case_type: str
    sodium_m: float
    magnesium_m: float


PANEL: list[PanelCase] = [
    PanelCase(
        label="self_dimer_benchmark",
        sequences=[BENCHMARK_SEQ, BENCHMARK_SEQ],
        case_type="self_dimer",
        sodium_m=0.05,
        magnesium_m=0.0,
    ),
    PanelCase(
        label="hairpin_prone",
        sequences=[HAIRPIN_SEQ],
        case_type="hairpin",
        sodium_m=0.05,
        magnesium_m=0.0,
    ),
    PanelCase(
        label="heterodimer_pair",
        sequences=[BENCHMARK_SEQ, HETERODIMER_SEQ2],
        case_type="heterodimer",
        sodium_m=0.05,
        magnesium_m=0.0,
    ),
    PanelCase(
        label="high_mg_self_dimer",
        sequences=[BENCHMARK_SEQ, BENCHMARK_SEQ],
        case_type="self_dimer",
        sodium_m=0.05,
        magnesium_m=0.005,
    ),
    PanelCase(
        label="low_salt_self_dimer",
        sequences=[BENCHMARK_SEQ, BENCHMARK_SEQ],
        case_type="self_dimer",
        sodium_m=0.01,
        magnesium_m=0.0,
    ),
    PanelCase(
        label="no_structure_flat",
        sequences=[FLAT_SEQ],
        case_type="hairpin",
        sodium_m=0.05,
        magnesium_m=0.0,
    ),
]


def _is_finite(value: Any) -> bool:
    """Return True if value is a finite number."""
    return isinstance(value, (int, float)) and not math.isinf(value) and not math.isnan(value)


def _run_hairpin(seq: str, sodium_m: float, magnesium_m: float) -> dict[str, Any]:
    """Compute hairpin MFE (eng.mfe) and Tm (hairpin_thermo)."""
    eng = ThermoEngine(
        material="dna", celsius=25.0, sodium=sodium_m, magnesium=magnesium_m
    )
    mfe = eng.mfe(seq)

    delta_g = float(mfe.energy)
    structure = mfe.structure

    tm = None
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
        # Flat / no-hairpin sequences legitimately raise here; store None.
        tm = None

    return {
        "delta_g_fork": delta_g,
        "tm_fork": tm,
        "structure_fork": structure,
    }


def _run_dimer(
    seq1: str, seq2: str, sodium_m: float, magnesium_m: float
) -> dict[str, Any]:
    """Compute dimer ΔG, Tm, and structure via dimer_thermo."""
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
    return {
        "delta_g_fork": float(res.dG37),
        "tm_fork": float(res.tm_celsius),
        "structure_fork": res.structure,
    }


def capture() -> dict[str, Any]:
    """Run the full reference panel and return the baseline document."""
    entries = []
    for case in PANEL:
        if case.case_type == "hairpin":
            result = _run_hairpin(case.sequences[0], case.sodium_m, case.magnesium_m)
        else:
            result = _run_dimer(case.sequences[0], case.sequences[1], case.sodium_m, case.magnesium_m)

        entry = {
            "label": case.label,
            "sequences": case.sequences,
            "type": case.case_type,
            "sodium_M": case.sodium_m,
            "magnesium_M": case.magnesium_m,
            "delta_g_fork": result["delta_g_fork"],
            "tm_fork": result["tm_fork"],
            "structure_fork": result["structure_fork"],
        }
        entries.append(entry)

    return {
        "strider_version": getattr(__import__("strider"), "__version__", "unknown"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "entries": entries,
    }


def validate(document: dict[str, Any]) -> list[str]:
    """Validate that the baseline document meets the required schema."""
    errors: list[str] = []
    required_root = {"strider_version", "generated_at", "entries"}
    missing_root = required_root - document.keys()
    if missing_root:
        errors.append(f"missing root keys: {sorted(missing_root)}")

    entries = document.get("entries", [])
    if len(entries) < 6:
        errors.append(f"expected >=6 entries, got {len(entries)}")

    required_entry = {"sequences", "type", "delta_g_fork", "tm_fork", "structure_fork"}
    for i, entry in enumerate(entries):
        missing = required_entry - entry.keys()
        if missing:
            errors.append(f"entry {i} missing keys: {sorted(missing)}")
            continue

        if not isinstance(entry["sequences"], list) or not entry["sequences"]:
            errors.append(f"entry {i} sequences must be a non-empty list")

        if entry["type"] not in {"hairpin", "self_dimer", "heterodimer"}:
            errors.append(f"entry {i} unexpected type: {entry['type']!r}")

        dg = entry["delta_g_fork"]
        if dg is not None and not _is_finite(dg):
            errors.append(f"entry {i} delta_g_fork is not finite: {dg!r}")

        tm = entry["tm_fork"]
        if tm is not None and not _is_finite(tm):
            errors.append(f"entry {i} tm_fork is not finite: {tm!r}")

        struct = entry["structure_fork"]
        if struct is not None and not isinstance(struct, str):
            errors.append(f"entry {i} structure_fork is not a string: {struct!r}")

    return errors


def main() -> None:
    document = capture()
    errors = validate(document)
    if errors:
        print("VALIDATION FAILED:")
        for err in errors:
            print(f"  - {err}")
        raise SystemExit(1)

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(document, fh, indent=2, sort_keys=False)
        fh.write("\n")

    print(f"Baseline written to {OUTPUT_PATH}")
    print(f"Strider version: {document['strider_version']}")
    print(f"Entries: {len(document['entries'])}")
    for entry in document["entries"]:
        tm_str = f"{entry['tm_fork']:.2f}" if entry["tm_fork"] is not None else "None"
        print(
            f"  - {entry['label']}: type={entry['type']}, "
            f"ΔG={entry['delta_g_fork']:.4f}, Tm={tm_str}, "
            f"len(structure)={len(entry['structure_fork']) if entry['structure_fork'] else 0}"
        )


if __name__ == "__main__":
    main()
