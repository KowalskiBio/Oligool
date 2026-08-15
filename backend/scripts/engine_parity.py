#!/usr/bin/env python3
"""Engine-parity harness for /moligize and /flanking_primers/design.

POSTs FIXED endpoint payloads to a running Oligool backend and either captures
a primer3-mode baseline, verifies byte-identical primer3-mode responses, or
records a Strider-vs-Primer3 latency table.

Modeled on the CLI/JSON style of backend/scripts/capture_baseline.py, but hits
the live HTTP endpoints (NOT library calls) so it captures the real
request/response contract. Uses only the standard library so the script has no
third-party dependency.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BASE_URL = "http://localhost:8000"
DEFAULT_BASELINE_PATH = ".omo/evidence/engine-parity-baseline.json"
DEFAULT_PERF_PATH = ".omo/evidence/engine-perf.json"
FIXTURE_PATH = REPO_ROOT / "qa_synthetic.oligool.json"


def _load_fixture() -> dict:
    with open(FIXTURE_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _build_payloads() -> dict:
    """Build the three FIXED payloads from the QA fixture (read at runtime)."""
    fixture = _load_fixture()
    seq = fixture["search"]["input"]
    oligo = fixture.get("oligo") or {}
    cur = oligo.get("currentOligo") or {}
    saved = oligo.get("savedPositions") or []
    # 0-based, end-exclusive MOLigo interval (ungapped) for the flanking payload.
    if cur:
        oligo_start = int(cur.get("p1AbsStart", 51)) - 1
        oligo_end = int(cur.get("p2AbsEnd", 151)) - 1
    elif saved:
        p0 = saved[0]
        oligo_start = int(p0.get("p1AbsStart", 51)) - 1
        oligo_end = int(p0.get("p2AbsEnd", 151)) - 1
    else:
        oligo_start, oligo_end = 50, 150

    search_params = {
        "min_len": 15,
        "max_len": 35,
        "tm_min": 58,
        "tm_max": 63,
        "tm_diff": 1.5,
        "gc_min": 30,
        "gc_max": 80,
    }
    moligize_auto = {
        "sequence": seq,
        "auto_search": True,
        "local_optimize": True,
        "scan_full_region": False,
        "search_params": search_params,
        "salt_mono": 50,
        "salt_div": 10,
        "dntp_conc": 0.8,
        "dna_conc": 400,
    }
    moligize_manual = {
        "sequence": seq,
        "moligo1_shift": int(oligo.get("moligo1Shift", 0)),
        "moligo2_shift": int(oligo.get("moligo2Shift", 0)),
        "moligo1_len": int(oligo.get("moligo1Len", 21)),
        "moligo2_len": int(oligo.get("moligo2Len", 21)),
        "auto_search": False,
        "local_optimize": False,
        "scan_full_region": False,
        "search_params": search_params,
        "salt_mono": 50,
        "salt_div": 10,
        "dntp_conc": 0.8,
        "dna_conc": 400,
    }
    flanking_design = {
        "full_seq": seq,
        "oligo_start": oligo_start,
        "oligo_end": oligo_end,
        "flank_window": 200,
        "opt_size": 20,
        "min_size": 16,
        "max_size": 27,
        "opt_tm": 58.0,
        "min_tm": 57.0,
        "max_tm": 67.0,
        "min_gc": 20.0,
        "max_gc": 80.0,
        "num_return": 5,
        "mv_conc": 50.0,
        "dv_conc": 3,
        "dntp_conc": 0.8,
        "dna_conc": 400.0,
    }
    return {
        "moligize_auto": {"url": "/moligize", "body": moligize_auto},
        "moligize_manual": {"url": "/moligize", "body": moligize_manual},
        "flanking_design": {"url": "/flanking_primers/design", "body": flanking_design},
    }


def _post(base_url: str, path: str, body: dict, timeout: float = 120.0) -> dict:
    url = base_url.rstrip("/") + path
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return {"status": resp.status, "body": json.loads(raw)}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            err_body = json.loads(raw)
        except Exception:
            err_body = raw
        return {"status": exc.code, "body": err_body}
    except urllib.error.URLError as exc:
        raise ConnectionError(f"Could not reach backend at {url}: {exc.reason}")


def _post_or_die(base_url: str, path: str, body: dict, label: str, timeout: float = 120.0) -> dict:
    """POST, or exit with a clean one-line error (no traceback) when unreachable."""
    try:
        return _post(base_url, path, body, timeout=timeout)
    except ConnectionError as exc:
        print(f"ERROR [{label}]: {exc}", file=sys.stderr)
        raise SystemExit(1)


def _canonical_json(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def _first_diff(expected, got, path="$") -> str | None:
    """Return a human-readable path to the first structural/value difference."""
    if type(expected) is not type(got):
        return f"{path}: type {type(expected).__name__} != {type(got).__name__}"
    if isinstance(expected, dict):
        ek, gk = set(expected), set(got)
        if ek != gk:
            missing = sorted(ek - gk)
            extra = sorted(gk - ek)
            if missing:
                return f"{path}: missing keys {missing}"
            return f"{path}: extra keys {extra}"
        for k in sorted(expected):
            d = _first_diff(expected[k], got[k], f"{path}.{k}")
            if d:
                return d
        return None
    if isinstance(expected, list):
        if len(expected) != len(got):
            return f"{path}: list len {len(expected)} != {len(got)}"
        for i, (a, b) in enumerate(zip(expected, got)):
            d = _first_diff(a, b, f"{path}[{i}]")
            if d:
                return d
        return None
    if expected != got:
        return f"{path}: {expected!r} != {got!r}"
    return None


def cmd_capture(base_url: str, output: str) -> None:
    payloads = _build_payloads()
    document = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "base_url": base_url,
        "payloads": {k: v["body"] for k, v in payloads.items()},
        "responses": {},
    }
    for key, spec in payloads.items():
        print(f"  POST {spec['url']} ({key}) ...", flush=True)
        res = _post_or_die(base_url, spec["url"], spec["body"], f"capture/{key}")
        if res["status"] != 200:
            raise SystemExit(
                f"capture failed for {key}: HTTP {res['status']} {res['body']}"
            )
        document["responses"][key] = res["body"]
        print(f"    -> HTTP {res['status']}", flush=True)
    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)
    with open(output, "w", encoding="utf-8") as fh:
        json.dump(document, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print(f"Baseline written to {output}")
    print(f"Sections: {sorted(document['responses'].keys())}")


def cmd_verify(base_url: str, baseline: str) -> None:
    if not os.path.exists(baseline):
        raise SystemExit(f"baseline not found: {baseline} (run `capture` first)")
    with open(baseline, "r", encoding="utf-8") as fh:
        doc = json.load(fh)
    payloads = _build_payloads()
    failures = []
    for key, spec in payloads.items():
        expected = doc["responses"][key]
        res = _post_or_die(base_url, spec["url"], spec["body"], f"verify/{key}")
        if res["status"] != 200:
            failures.append(f"{key}: HTTP {res['status']} {res['body']}")
            continue
        got = res["body"]
        # Pure bytewise diff — zero key deletion. Primer3 mode carries no
        # `engine` echo, so no key stripping is applied.
        exp_canon = _canonical_json(expected)
        got_canon = _canonical_json(got)
        if exp_canon != got_canon:
            diff = _first_diff(expected, got, f"{key}")
            failures.append(f"{key}: byte diff (primer3 mode must be identical) — {diff}")
    if failures:
        print("PARITY VERIFY FAILED:")
        for f in failures:
            print(f"  - {f}")
        raise SystemExit(1)
    print("PARITY VERIFY OK: all primer3-mode responses byte-identical to baseline")
    for key in payloads:
        print(f"  - {key}: identical")


def _strider_sanity(res: dict) -> list[str]:
    """Sanity-check a Strider-mode flanking response."""
    errors = []
    if res.get("engine") != "strider":
        errors.append("missing/wrong top-level engine echo")
    for side in ("forward", "reverse"):
        block = res.get(side, {})
        for p in block.get("primers", []):
            if "strider" not in p:
                errors.append(f"{side} primer missing strider sub-block")
            if "primer3" not in p:
                errors.append(f"{side} primer missing primer3 sub-block")
    pm = res.get("pair_metrics") or {}
    if res.get("forward", {}).get("primers") and res.get("reverse", {}).get("primers"):
        if "strider_heterodimer" not in pm:
            errors.append("pair_metrics missing strider_heterodimer")
    return errors


def cmd_perf(base_url: str, output: str, iterations: int) -> None:
    payloads = _build_payloads()
    flanking = payloads["flanking_design"]
    results = {}
    sanity_errors = []
    for engine in ("primer3", "strider"):
        body = dict(flanking["body"])
        body["engine"] = engine
        # One warmup call (not timed).
        warm = _post_or_die(base_url, flanking["url"], body, f"perf-warmup/{engine}")
        if warm["status"] != 200:
            raise SystemExit(f"perf warmup {engine}: HTTP {warm['status']} {warm['body']}")
        if engine == "strider":
            sanity_errors = _strider_sanity(warm["body"])
        times = []
        for _ in range(iterations):
            t0 = time.perf_counter()
            res = _post_or_die(base_url, flanking["url"], body, f"perf/{engine}")
            t1 = time.perf_counter()
            if res["status"] != 200:
                raise SystemExit(f"perf {engine}: HTTP {res['status']}")
            times.append(t1 - t0)
        results[engine] = {
            "times_ms": [round(t * 1000, 1) for t in times],
            "median_ms": round(statistics.median(times) * 1000, 1),
            "min_ms": round(min(times) * 1000, 1),
            "max_ms": round(max(times) * 1000, 1),
        }
    primer3_med = results["primer3"]["median_ms"]
    strider_med = results["strider"]["median_ms"]
    budget_ok = strider_med < 2 * primer3_med
    document = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "iterations": iterations,
        "results": results,
        "primer3_median_ms": primer3_med,
        "strider_median_ms": strider_med,
        "budget_strider_lt_2x_primer3": budget_ok,
        "strider_sanity_errors": sanity_errors,
    }
    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)
    with open(output, "w", encoding="utf-8") as fh:
        json.dump(document, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print(f"perf: primer3 median={primer3_med}ms, strider median={strider_med}ms, "
          f"budget_ok={budget_ok}")
    if sanity_errors:
        print("STRIDER SANITY ERRORS:")
        for e in sanity_errors:
            print(f"  - {e}")
    if not budget_ok:
        raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Engine-parity harness for /moligize and /flanking_primers/design."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_cap = sub.add_parser("capture", help="Capture primer3-mode baseline responses.")
    p_cap.add_argument("--base-url", default=DEFAULT_BASE_URL)
    p_cap.add_argument("--output", "-o", default=DEFAULT_BASELINE_PATH)

    p_ver = sub.add_parser("verify", help="Verify primer3-mode responses are byte-identical.")
    p_ver.add_argument("--base-url", default=DEFAULT_BASE_URL)
    p_ver.add_argument("--baseline", default=DEFAULT_BASELINE_PATH)

    p_perf = sub.add_parser("perf", help="Record a Strider-vs-Primer3 latency table.")
    p_perf.add_argument("--base-url", default=DEFAULT_BASE_URL)
    p_perf.add_argument("--output", "-o", default=DEFAULT_PERF_PATH)
    p_perf.add_argument("--iterations", "-n", type=int, default=5)

    args = parser.parse_args()

    if args.command == "capture":
        cmd_capture(args.base_url, args.output)
    elif args.command == "verify":
        cmd_verify(args.base_url, args.baseline)
    elif args.command == "perf":
        cmd_perf(args.base_url, args.output, args.iterations)


if __name__ == "__main__":
    main()
