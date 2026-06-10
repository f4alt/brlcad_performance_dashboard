"""Benchmark lane derived data for the BRL-CAD performance dashboard.

Absolute-trend model: each run measures the current build's VGR. The trend is a
single continuous VGR-over-time line (one point per run). A run only appears here
if it actually produced a VGR (the producer omits the lane otherwise), so there
is no pass/fail state — the latest run with data is the latest.

Writes (into <out_dir>/benchmark/):
  latest.json  - latest VGR + source run
  trend.json   - one VGR point per run (single series), compact
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import (
    point_source,
    rows_from_lane,
    run_info_from_record,
    to_nonnegative_float,
    write_json,
)

LANE_NAME = "benchmark"
LANE_TITLE = "Benchmark"


def _run_points(rows: list[dict[str, Any]], run_info: dict[str, Any]) -> list[dict[str, Any]]:
    """Rows with a usable build + VGR, as chart points."""
    points: list[dict[str, Any]] = []
    for row in rows:
        build = str(row.get("build") or "").strip()
        vgr = to_nonnegative_float(row.get("vgr"))
        if not build or vgr is None:
            continue
        points.append({**point_source(run_info), "build": build, "vgr": vgr, "value": vgr})
    return points


def process(records: list[dict[str, Any]], out_dir: Path, generated_at: str) -> None:
    lane_dir = out_dir / LANE_NAME

    trend_points: list[dict[str, Any]] = []  # one representative point per run
    latest: dict[str, Any] | None = None

    for record in records:
        lanes = record.get("lanes", {})
        if not isinstance(lanes, dict):
            continue

        lane = lanes.get(LANE_NAME)
        if not isinstance(lane, dict):
            continue

        run_info = run_info_from_record(record)
        points = _run_points(rows_from_lane(lane), run_info)
        if not points:
            continue

        # Absolute trend: one point per run. Legacy runs carried both a baseline
        # and a candidate row; the last row is the candidate/current build.
        representative = points[-1]
        trend_points.append(representative)
        latest = {"run": run_info, "point": representative}

    latest_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "lane": LANE_NAME,
        "source_run": latest["run"] if latest else None,
        "vgr": latest["point"]["vgr"] if latest else None,
        "build": latest["point"]["build"] if latest else None,
    }

    trend_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "lane": LANE_NAME,
        "series": [{"label": "VGR", "points": trend_points}],
    }

    write_json(lane_dir / "latest.json", latest_payload)
    write_json(lane_dir / "trend.json", trend_payload)
