"""Generic rtcmp lane ingestion for the BRL-CAD performance dashboard.

This module owns only data/rtcmp_generic/* derived files.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import as_status, rows_from_lane, run_info_from_upload, to_float, to_nonnegative_float, write_json

LANE_NAME = "rtcmp_generic"

VISIBLE_COLUMNS = [
    "status",
    "tag",
    "compare_status",
    "comp_status_tol",
    "perf_delta_percent",
    "perf_status",
    "perf1_rays_per_sec_wall",
    "perf2_rays_per_sec_wall",
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


def _normalize_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []

    for row in rows:
        item = dict(row)

        for key in NUMERIC_FIELDS:
            if key not in item:
                continue

            item[key] = to_nonnegative_float(item[key]) if key in NONNEGATIVE_FIELDS else to_float(item[key])

        for key in ["status", "compare_status", "perf_status"]:
            if key in item:
                item[key] = as_status(item[key])

        normalized.append(item)

    return normalized


def _row_passes(row: dict[str, Any]) -> bool:
    for key in ["status", "compare_status", "perf_status"]:
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

    rows_with_delta = [row for row in rows if isinstance(row.get("perf_delta_percent"), (int, float))]
    worst = min(rows_with_delta, key=lambda row: row["perf_delta_percent"], default=None)
    best = max(rows_with_delta, key=lambda row: row["perf_delta_percent"], default=None)

    return {
        "row_count": len(rows),
        "passing": passing,
        "failing": failing,
        "average_delta_percent": average_delta,
        "worst_regression": _summary_row(worst),
        "best_improvement": _summary_row(best),
    }


def _summary_row(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None

    return {
        "tag": row.get("tag"),
        "file": row.get("file"),
        "component": row.get("component"),
        "perf_delta_percent": row.get("perf_delta_percent"),
        "status": row.get("status"),
        "compare_status": row.get("compare_status"),
        "perf_status": row.get("perf_status"),
    }


def process(uploads: list[dict[str, Any]], root: Path, generated_at: str) -> None:
    out_dir = root / "data" / LANE_NAME

    latest_snapshot: dict[str, Any] | None = None

    for upload in uploads:
        lanes = upload.get("lanes", {})
        if not isinstance(lanes, dict):
            continue

        lane = lanes.get(LANE_NAME)
        if not isinstance(lane, dict):
            continue

        rows = _normalize_rows(rows_from_lane(lane))
        if not rows:
            continue

        latest_snapshot = {
            "run": run_info_from_upload(upload),
            "status": as_status(lane.get("status")),
            "columns": list(lane.get("columns", [])) if isinstance(lane.get("columns"), list) else [],
            "visible_columns": VISIBLE_COLUMNS,
            "summary": _summarize_rows(rows),
            "rows": rows,
        }

    latest_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "lane": LANE_NAME,
        "source_run": latest_snapshot.get("run") if latest_snapshot else None,
        "status": latest_snapshot.get("status") if latest_snapshot else "UNKNOWN",
        "columns": latest_snapshot.get("columns", []) if latest_snapshot else [],
        "visible_columns": VISIBLE_COLUMNS,
        "summary": latest_snapshot.get("summary") if latest_snapshot else {
            "row_count": 0,
            "passing": 0,
            "failing": 0,
            "average_delta_percent": None,
            "worst_regression": None,
            "best_improvement": None,
        },
        "rows": latest_snapshot.get("rows", []) if latest_snapshot else [],
    }

    write_json(out_dir / "latest.json", latest_payload)
