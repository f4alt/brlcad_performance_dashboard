"""Benchmark lane ingestion for the BRL-CAD performance dashboard.

This module owns only benchmark-derived dashboard files. Other lanes should add
sibling modules rather than editing this file.
"""

from __future__ import annotations

import json
from collections import OrderedDict
from pathlib import Path
from typing import Any


BENCHMARK_LANE = "benchmark"


def _as_status(value: Any) -> str:
    return str(value or "UNKNOWN").strip().upper() or "UNKNOWN"


def _rows_from_lane(lane: dict[str, Any]) -> list[dict[str, Any]]:
    """Return lane rows as dictionaries.

    Supports the dashboard-facing object-row shape:
      {"rows": [{"build": "...", "vgr": 123}]}

    Also supports the earlier CSV-table shape:
      {"summary": [["build", "vgr"], ["...", "123"]]}
    """
    rows = lane.get("rows")
    if isinstance(rows, list):
        return [row for row in rows if isinstance(row, dict)]

    summary = lane.get("summary")
    if not isinstance(summary, list) or not summary:
        return []

    header = summary[0]
    if not isinstance(header, list):
        return []

    columns = [str(column) for column in header]
    normalized_rows: list[dict[str, Any]] = []
    for raw_row in summary[1:]:
        if not isinstance(raw_row, list):
            continue
        row: dict[str, Any] = {}
        for index, column in enumerate(columns):
            row[column] = raw_row[index] if index < len(raw_row) else ""
        normalized_rows.append(row)

    return normalized_rows


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0:
        return None
    return parsed


def _commit_label(commit: Any) -> str | None:
    if not commit:
        return None
    return str(commit)[:12]


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def process(runs: list[dict[str, Any]], root: Path, generated_at: str) -> None:
    """Build benchmark dashboard data from immutable run summaries."""
    out_dir = root / "data" / "benchmark"
    latest_path = out_dir / "latest.json"
    series_path = out_dir / "series.json"

    points_by_label: "OrderedDict[str, list[dict[str, Any]]]" = OrderedDict()
    passing_snapshots: list[dict[str, Any]] = []

    latest_run = runs[-1] if runs else None
    latest_benchmark_status = "UNKNOWN"

    for run in runs:
        lanes = run.get("lanes", {})
        if not isinstance(lanes, dict):
            continue

        lane = lanes.get(BENCHMARK_LANE)
        if not isinstance(lane, dict):
            continue

        lane_status = _as_status(lane.get("status"))
        if latest_run is run:
            latest_benchmark_status = lane_status

        run_info = run.get("index", {})
        rows = _rows_from_lane(lane)
        run_points: list[dict[str, Any]] = []

        for row in rows:
            build = str(row.get("build") or "").strip()
            vgr = _to_float(row.get("vgr"))
            if not build or vgr is None:
                continue

            point = {
                "build": build,
                "vgr": vgr,
                "timestamp": run_info.get("timestamp"),
                "run_id": run_info.get("id"),
                "commit": run_info.get("commit"),
                "short_commit": _commit_label(run_info.get("commit")),
                "summary_path": run_info.get("path"),
            }
            run_points.append(point)
            points_by_label.setdefault(build, []).append(point)

        if lane_status == "PASS" and run_points:
            passing_snapshots.append({
                "run": run_info,
                "rows": run_points,
            })

    latest_passing = passing_snapshots[-1] if passing_snapshots else None
    latest_run_id = latest_run.get("index", {}).get("id") if latest_run else None
    source_run_id = latest_passing.get("run", {}).get("id") if latest_passing else None
    stale = bool(latest_passing and latest_run_id and source_run_id != latest_run_id)

    latest_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "lane": BENCHMARK_LANE,
        "latest_run_id": latest_run_id,
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
    }

    series_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "lane": BENCHMARK_LANE,
        "labels": list(points_by_label.keys()),
        "series_by_label": points_by_label,
    }

    _write_json(latest_path, latest_payload)
    _write_json(series_path, series_payload)
