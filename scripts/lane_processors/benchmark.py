"""Benchmark lane ingestion for the BRL-CAD performance dashboard.

This module owns only benchmark-derived dashboard files.
"""

from __future__ import annotations

from collections import OrderedDict, defaultdict
from pathlib import Path
from typing import Any

from .common import as_status, point_source, rows_from_lane, run_info_from_upload, to_nonnegative_float, write_json

LANE_NAME = "benchmark"


def _row_key(build: str, index: int, total_for_build: int) -> str:
    if total_for_build <= 1:
        return build
    return f"{build} #{index}"


def _normalize_snapshot_rows(rows: list[dict[str, Any]], run_info: dict[str, Any]) -> list[dict[str, Any]]:
    build_totals: dict[str, int] = defaultdict(int)
    for row in rows:
        build = str(row.get("build") or "").strip()
        if build:
            build_totals[build] += 1

    build_seen: dict[str, int] = defaultdict(int)
    normalized: list[dict[str, Any]] = []

    for row in rows:
        build = str(row.get("build") or "").strip()
        vgr = to_nonnegative_float(row.get("vgr"))

        if not build or vgr is None:
            continue

        build_seen[build] += 1
        source = point_source(run_info)

        normalized.append({
            **source,
            "row_key": _row_key(build, build_seen[build], build_totals[build]),
            "build": build,
            "vgr": vgr,
        })

    return normalized


def process(uploads: list[dict[str, Any]], root: Path, generated_at: str) -> None:
    out_dir = root / "data" / LANE_NAME

    points_by_label: "OrderedDict[str, list[dict[str, Any]]]" = OrderedDict()
    snapshots: list[dict[str, Any]] = []
    latest_upload = uploads[-1] if uploads else None
    latest_benchmark_status = "UNKNOWN"

    for upload in uploads:
        lanes = upload.get("lanes", {})
        if not isinstance(lanes, dict):
            continue

        lane = lanes.get(LANE_NAME)
        if not isinstance(lane, dict):
            continue

        lane_status = as_status(lane.get("status"))
        run_info = run_info_from_upload(upload)

        if latest_upload is upload:
            latest_benchmark_status = lane_status

        snapshot_rows = _normalize_snapshot_rows(rows_from_lane(lane), run_info)
        if not snapshot_rows:
            continue

        for row in snapshot_rows:
            build = row["build"]
            points_by_label.setdefault(build, []).append(row)

        if lane_status == "PASS":
            snapshots.append({
                "run": run_info,
                "status": lane_status,
                "rows": snapshot_rows,
            })

    latest_passing = snapshots[-1] if snapshots else None
    latest_upload_id = latest_upload.get("index", {}).get("id") if latest_upload else None
    source_run_id = latest_passing.get("run", {}).get("id") if latest_passing else None
    stale = bool(latest_passing and latest_upload_id and source_run_id != latest_upload_id)

    latest_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "lane": LANE_NAME,
        "latest_upload_id": latest_upload_id,
        "latest_benchmark_status": latest_benchmark_status,
        "source_run": latest_passing.get("run") if latest_passing else None,
        "stale": stale,
        "message": (
            "No passing benchmark data has been ingested yet."
            if latest_passing is None
            else "Showing latest passing benchmark data."
            if not stale
            else "Latest benchmark run did not pass; showing the most recent passing benchmark data."
        ),
        "rows": latest_passing.get("rows", []) if latest_passing else [],
        "comparison_runs": list(reversed(snapshots)),
    }

    series_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "lane": LANE_NAME,
        "labels": list(points_by_label.keys()),
        "series_by_label": points_by_label,
    }

    write_json(out_dir / "latest.json", latest_payload)
    write_json(out_dir / "series.json", series_payload)
