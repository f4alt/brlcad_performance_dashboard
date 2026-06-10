"""Generic rtcmp lane derived data for the BRL-CAD performance dashboard.

Writes (into <out_dir>/rtcmp_generic/):
  latest.json      - latest comparison table + chip summary + thin run list
  runs/<id>.json   - full table for one run, fetched on demand by the picker
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import (
    as_status,
    rows_from_lane,
    run_info_from_record,
    safe_run_filename,
    thin_run,
    to_float,
    to_nonnegative_float,
    write_json,
)

LANE_NAME = "rtcmp_generic"
LANE_TITLE = "Generic Raytrace Comparison"

VISIBLE_COLUMNS = [
    "status",
    "tag",
    "compare_status",
    "comp_status_tol",
    "perf_status",
    "perf1_rays_per_sec_wall",
    "perf2_rays_per_sec_wall",
    "perf_delta_percent",
]

NUMERIC_FIELDS = {
    "bots",
    "bot_faces",
    "breps",
    "brlcad_prims",
    "num_comp_rays",
    "perf1_rays_per_sec_wall",
    "perf2_rays_per_sec_wall",
    "rays_per_sec_ratio",
    "perf_delta_percent",
}

NONNEGATIVE_FIELDS = {
    "bots",
    "bot_faces",
    "breps",
    "brlcad_prims",
    "num_comp_rays",
    "perf1_rays_per_sec_wall",
    "perf2_rays_per_sec_wall",
}

_EMPTY_SUMMARY = {"row_count": 0, "passing": 0, "failing": 0, "average_delta_percent": None}


def _normalize_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []

    for row in rows:
        item = dict(row)

        for key in NUMERIC_FIELDS:
            if key not in item:
                continue
            item[key] = to_nonnegative_float(item[key]) if key in NONNEGATIVE_FIELDS else to_float(item[key])

        for key in ("status", "compare_status", "perf_status"):
            if key in item:
                item[key] = as_status(item[key])

        normalized.append(item)

    return normalized


def _row_passes(row: dict[str, Any]) -> bool:
    for key in ("status", "compare_status", "perf_status"):
        status = row.get(key)
        if status and as_status(status) != "PASS":
            return False
    return True


def _summarize_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    passing = sum(1 for row in rows if _row_passes(row))
    failing = len(rows) - passing

    deltas = [row.get("perf_delta_percent") for row in rows]
    deltas = [delta for delta in deltas if isinstance(delta, (int, float))]
    average_delta = sum(deltas) / len(deltas) if deltas else None

    return {
        "row_count": len(rows),
        "passing": passing,
        "failing": failing,
        "average_delta_percent": average_delta,
    }


def process(records: list[dict[str, Any]], out_dir: Path, generated_at: str) -> None:
    lane_dir = out_dir / LANE_NAME

    snapshots: list[dict[str, Any]] = []

    for record in records:
        lanes = record.get("lanes", {})
        if not isinstance(lanes, dict):
            continue

        lane = lanes.get(LANE_NAME)
        if not isinstance(lane, dict):
            continue

        rows = _normalize_rows(rows_from_lane(lane))
        if not rows:
            continue

        columns = list(lane.get("columns", [])) if isinstance(lane.get("columns"), list) else []
        snapshots.append({
            "run": run_info_from_record(record),
            "status": as_status(lane.get("status")),
            "columns": columns,
            "visible_columns": VISIBLE_COLUMNS,
            "summary": _summarize_rows(rows),
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
            "status": snapshot["status"],
            "columns": snapshot["columns"],
            "visible_columns": snapshot["visible_columns"],
            "summary": snapshot["summary"],
            "rows": snapshot["rows"],
        })

    latest = snapshots[-1] if snapshots else None

    latest_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "lane": LANE_NAME,
        "source_run": latest.get("run") if latest else None,
        "status": latest.get("status") if latest else "UNKNOWN",
        "columns": latest.get("columns", []) if latest else [],
        "visible_columns": VISIBLE_COLUMNS,
        "summary": latest.get("summary") if latest else dict(_EMPTY_SUMMARY),
        "rows": latest.get("rows", []) if latest else [],
        "runs": [thin_run(s["run"], s["status"]) for s in reversed(snapshots)],
    }

    write_json(lane_dir / "latest.json", latest_payload)
