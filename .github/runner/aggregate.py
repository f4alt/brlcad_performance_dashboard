#!/usr/bin/env python3
"""Aggregate runner artifacts into the dashboard summary.json contract.

Runs on the scheduling workflow's host (not the measurement server). Reads:
  --meta        build_meta.json   (commit/system/build metadata)
  --benchmark   benchmark.csv     (build,vgr)
  --primitives  primitives.csv    (prim,rays_per_sec)
Writes the contract summary.json to --out and prints the run id on stdout.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def read_csv_rows(path: str) -> list[dict[str, str]]:
    p = Path(path)
    if not p.is_file():
        return []
    with p.open("r", encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None  # NaN guard


def now_z() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    ap = argparse.ArgumentParser(description="Build summary.json from runner artifacts.")
    ap.add_argument("--meta", required=True)
    ap.add_argument("--benchmark", required=True)
    ap.add_argument("--primitives", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    meta = json.loads(Path(args.meta).read_text(encoding="utf-8"))
    system = meta.get("system") if isinstance(meta.get("system"), dict) else {}
    commit = meta.get("commit")
    short_commit = meta.get("short_commit") or (str(commit)[:12] if commit else None)
    timestamp = meta.get("timestamp") or now_z()
    compact_ts = timestamp.replace("-", "").replace(":", "").replace("T", "").replace("Z", "")
    run_id = f"{compact_ts}-{short_commit or 'unknown'}"

    # A lane is uploaded only when it actually has results. There is no per-lane
    # or per-row "status": presence of data is success; a failed lane is omitted.
    lanes: dict[str, Any] = {}

    # benchmark lane — only when a VGR was measured
    brows = read_csv_rows(args.benchmark)
    if brows:
        vgr = to_float(brows[0].get("vgr"))
        if vgr is not None:
            lanes["benchmark"] = {
                "description": "absolute BRL-CAD benchmark VGR (higher is better)",
                "rows": [{"build": brows[0].get("build") or "BRL-CAD main", "vgr": vgr}],
            }

    # primitives lane — only the primitives that were successfully measured
    prim_rows: list[dict[str, Any]] = []
    for r in read_csv_rows(args.primitives):
        rps = to_float(r.get("rays_per_sec"))
        if rps is None:
            continue
        prim_rows.append({"prim": r.get("prim"), "rays_per_sec": rps})
    if prim_rows:
        lanes["primitives"] = {
            "description": "per-primitive rays/sec (stub: rt vs primitives.g)",
            "rows": prim_rows,
        }

    if not lanes:
        print("No lane results to upload (build or all measurements failed).", file=sys.stderr)
        return 1

    run = {
        "id": run_id,
        "timestamp": timestamp,
        "repository": meta.get("repository") or "f4alt/brlcad",
        "branch": meta.get("branch") or "main",
        "system": system,
    }
    # commit/short_commit are string-typed (not nullable) in the schema — only
    # include them when present.
    if commit:
        run["commit"] = commit
    if short_commit:
        run["short_commit"] = short_commit

    summary = {
        "schema_version": 1,
        "generated_at": now_z(),
        "lane_order": [name for name in ("benchmark", "primitives") if name in lanes],
        "run": run,
        "lanes": lanes,
    }

    Path(args.out).write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(run_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
