"""Primitive performance lane derived data for the BRL-CAD performance dashboard.

Only successfully-measured primitives are present (the producer omits failures),
so there is no per-row status.

Writes (into <out_dir>/primitives/):
  latest.json      - latest leaderboard (bounded) + thin run list for the picker
  trend.json       - rays/sec per primitive, one point per run (compact)
  runs/<id>.json   - full leaderboard for one run, fetched on demand by the picker
"""

from __future__ import annotations

from collections import OrderedDict
from pathlib import Path
from typing import Any

from .common import (
    point_source,
    rows_from_lane,
    run_info_from_record,
    safe_run_filename,
    thin_run,
    to_nonnegative_float,
    write_json,
)

LANE_NAME = "primitives"
LANE_TITLE = "Primitive Performance"


def _normalize_rows(rows: list[dict[str, Any]], run_info: dict[str, Any]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []

    for row in rows:
        prim = str(row.get("prim") or "").strip()
        if not prim:
            continue
        rays_per_sec = to_nonnegative_float(row.get("rays_per_sec"))
        if rays_per_sec is None:
            continue  # only successfully-measured primitives are kept

        normalized.append({
            **point_source(run_info),
            "prim": prim,
            "rays_per_sec": rays_per_sec,
        })

    normalized.sort(key=lambda item: (-item["rays_per_sec"], item["prim"]))
    return normalized


def process(records: list[dict[str, Any]], out_dir: Path, generated_at: str) -> None:
    lane_dir = out_dir / LANE_NAME

    snapshots: list[dict[str, Any]] = []
    series_by_primitive: "OrderedDict[str, list[dict[str, Any]]]" = OrderedDict()

    for record in records:
        lanes = record.get("lanes", {})
        if not isinstance(lanes, dict):
            continue

        lane = lanes.get(LANE_NAME)
        if not isinstance(lane, dict):
            continue

        run_info = run_info_from_record(record)
        rows = _normalize_rows(rows_from_lane(lane), run_info)
        if not rows:
            continue

        for row in rows:
            series_by_primitive.setdefault(row["prim"], []).append(row)

        snapshots.append({
            "run": run_info,
            "summary": {"row_count": len(rows)},
            "rows": rows,
        })

    # Per-run detail files (fetched on demand by the run picker).
    for snapshot in snapshots:
        run_id = snapshot["run"].get("id")
        write_json(lane_dir / "runs" / safe_run_filename(run_id), {
            "schema_version": 1,
            "generated_at": generated_at,
            "lane": LANE_NAME,
            "run": snapshot["run"],
            "summary": snapshot["summary"],
            "rows": snapshot["rows"],
        })

    latest = snapshots[-1] if snapshots else None

    latest_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "lane": LANE_NAME,
        "source_run": latest.get("run") if latest else None,
        "summary": latest.get("summary") if latest else {"row_count": 0},
        "rows": latest.get("rows", []) if latest else [],
        "runs": [thin_run(s["run"]) for s in reversed(snapshots)],
    }

    trend_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "lane": LANE_NAME,
        "primitives": list(series_by_primitive.keys()),
        "series_by_primitive": series_by_primitive,
    }

    write_json(lane_dir / "latest.json", latest_payload)
    write_json(lane_dir / "trend.json", trend_payload)
