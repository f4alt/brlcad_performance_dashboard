"""Primitive rtcmp lane ingestion for the BRL-CAD performance dashboard.

This module owns only data/rtcmp_prims/* derived files.
"""

from __future__ import annotations

from collections import OrderedDict
from pathlib import Path
from typing import Any

from .common import as_status, point_source, rows_from_lane, run_info_from_upload, to_nonnegative_float, write_json

LANE_NAME = "rtcmp_prims"


def _normalize_rows(rows: list[dict[str, Any]], run_info: dict[str, Any]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []

    for row in rows:
        prim = str(row.get("prim") or "").strip()
        if not prim:
            continue

        rays_per_sec = to_nonnegative_float(row.get("rays_per_sec"))
        row_status = as_status(row.get("status"))

        if rays_per_sec is None:
            row_status = "FAIL" if row_status in {"UNKNOWN", "PASS"} else row_status
        elif row_status == "UNKNOWN":
            row_status = "PASS"

        normalized.append({
            **point_source(run_info),
            "prim": prim,
            "rays_per_sec": rays_per_sec,
            "status": row_status,
        })

    normalized.sort(
        key=lambda item: (
            item["rays_per_sec"] is None,
            -(item["rays_per_sec"] or 0),
            item["prim"],
        )
    )
    return normalized


def _summarize_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    passing = sum(1 for row in rows if row.get("status") == "PASS" and row.get("rays_per_sec") is not None)
    failing = sum(1 for row in rows if row.get("status") != "PASS" or row.get("rays_per_sec") is None)

    return {
        "row_count": len(rows),
        "passing": passing,
        "failing": failing,
    }


def process(uploads: list[dict[str, Any]], root: Path, generated_at: str) -> None:
    out_dir = root / "data" / LANE_NAME

    snapshots: list[dict[str, Any]] = []
    series_by_primitive: "OrderedDict[str, list[dict[str, Any]]]" = OrderedDict()

    for upload in uploads:
        lanes = upload.get("lanes", {})
        if not isinstance(lanes, dict):
            continue

        lane = lanes.get(LANE_NAME)
        if not isinstance(lane, dict):
            continue

        run_info = run_info_from_upload(upload)
        lane_status = as_status(lane.get("status"))
        rows = _normalize_rows(rows_from_lane(lane), run_info)

        if not rows:
            continue

        for row in rows:
            prim = row["prim"]
            series_by_primitive.setdefault(prim, []).append(row)

        snapshots.append({
            "run": run_info,
            "status": lane_status,
            "summary": _summarize_rows(rows),
            "rows": rows,
        })

    latest = snapshots[-1] if snapshots else None

    latest_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "lane": LANE_NAME,
        "source_run": latest.get("run") if latest else None,
        "status": latest.get("status") if latest else "UNKNOWN",
        "summary": latest.get("summary") if latest else {"row_count": 0, "passing": 0, "failing": 0},
        "rows": latest.get("rows", []) if latest else [],
    }

    runs_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "lane": LANE_NAME,
        "snapshots": list(reversed(snapshots)),
    }

    series_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "lane": LANE_NAME,
        "primitives": list(series_by_primitive.keys()),
        "series_by_primitive": series_by_primitive,
    }

    write_json(out_dir / "latest.json", latest_payload)
    write_json(out_dir / "runs.json", runs_payload)
    write_json(out_dir / "series.json", series_payload)
