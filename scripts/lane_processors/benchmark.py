"""Benchmark lane derived data for the BRL-CAD performance dashboard.

Writes (into <out_dir>/benchmark/):
  latest.json  - latest passing snapshot (bounded), with stale/source metadata
  trend.json   - VGR per build label, one point per run (compact)
"""

from __future__ import annotations

from collections import OrderedDict, defaultdict
from pathlib import Path
from typing import Any

from .common import (
    as_status,
    point_source,
    rows_from_lane,
    run_info_from_record,
    to_nonnegative_float,
    write_json,
)

LANE_NAME = "benchmark"
LANE_TITLE = "Benchmark"


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
        normalized.append({
            **point_source(run_info),
            "row_key": _row_key(build, build_seen[build], build_totals[build]),
            "build": build,
            "vgr": vgr,
        })

    return normalized


def process(records: list[dict[str, Any]], out_dir: Path, generated_at: str) -> None:
    lane_dir = out_dir / LANE_NAME

    points_by_label: "OrderedDict[str, list[dict[str, Any]]]" = OrderedDict()
    snapshots: list[dict[str, Any]] = []
    latest_record = records[-1] if records else None
    latest_status = "UNKNOWN"

    for record in records:
        lanes = record.get("lanes", {})
        if not isinstance(lanes, dict):
            continue

        lane = lanes.get(LANE_NAME)
        if not isinstance(lane, dict):
            continue

        lane_status = as_status(lane.get("status"))
        run_info = run_info_from_record(record)

        if latest_record is record:
            latest_status = lane_status

        snapshot_rows = _normalize_snapshot_rows(rows_from_lane(lane), run_info)
        if not snapshot_rows:
            continue

        for row in snapshot_rows:
            points_by_label.setdefault(row["build"], []).append(row)

        if lane_status == "PASS":
            snapshots.append({"run": run_info, "status": lane_status, "rows": snapshot_rows})

    latest_passing = snapshots[-1] if snapshots else None
    latest_record_id = run_info_from_record(latest_record).get("id") if latest_record else None
    source_run_id = latest_passing.get("run", {}).get("id") if latest_passing else None
    stale = bool(latest_passing and latest_record_id and source_run_id != latest_record_id)

    latest_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "lane": LANE_NAME,
        "latest_upload_id": latest_record_id,
        "latest_benchmark_status": latest_status,
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
    }

    trend_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "lane": LANE_NAME,
        "labels": list(points_by_label.keys()),
        "series_by_label": points_by_label,
    }

    write_json(lane_dir / "latest.json", latest_payload)
    write_json(lane_dir / "trend.json", trend_payload)
