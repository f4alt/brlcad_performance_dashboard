#!/usr/bin/env python3
"""Validate archived BRL-CAD performance summaries and build a small run index.

This is intentionally lightweight for the first wiring pass. Later this script can
also split lanes, precompute benchmark/primitives/generic dashboard data, and
normalize legacy schemas.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
RUNS_DIR = ROOT / "data" / "runs"
INDEX_PATH = ROOT / "data" / "index.json"
STATUS_PATH = ROOT / "data" / "status" / "latest.json"


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return data


def parse_timestamp(value: str | None, fallback: datetime) -> datetime:
    if not value:
        return fallback
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return fallback


def normalize_lanes(summary: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Accept either the proposed object shape or the current list shape."""
    lanes = summary.get("lanes", {})

    if isinstance(lanes, dict):
        return {str(name): lane for name, lane in lanes.items() if isinstance(lane, dict)}

    if isinstance(lanes, list):
        normalized: dict[str, dict[str, Any]] = {}
        for lane in lanes:
            if not isinstance(lane, dict):
                continue
            name = lane.get("lane")
            if name:
                normalized[str(name)] = lane
        return normalized

    return {}


def summarize_run(summary_path: Path) -> dict[str, Any]:
    summary = load_json(summary_path)
    run_dir = summary_path.parent
    default_id = run_dir.name

    run = summary.get("run", {})
    if not isinstance(run, dict):
        run = {}

    lanes = normalize_lanes(summary)
    if not lanes:
        raise ValueError(f"{summary_path} does not define any lanes")

    lane_statuses = {
        name: str(lane.get("status", "UNKNOWN"))
        for name, lane in sorted(lanes.items())
    }

    timestamp = parse_timestamp(run.get("timestamp"), datetime.fromtimestamp(summary_path.stat().st_mtime, tz=timezone.utc))
    run_id = str(run.get("id") or default_id)

    overall_status = "PASS"
    if any(status == "FAIL" for status in lane_statuses.values()):
        overall_status = "FAIL"
    elif any(status == "UNKNOWN" for status in lane_statuses.values()):
        overall_status = "UNKNOWN"
    elif lane_statuses and all(status == "SKIP" for status in lane_statuses.values()):
        overall_status = "SKIP"

    return {
        "id": run_id,
        "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
        "path": str(summary_path.relative_to(ROOT)).replace("\\", "/"),
        "commit": run.get("commit"),
        "branch": run.get("branch"),
        "workflow_run_id": run.get("workflow_run_id"),
        "status": overall_status,
        "lanes": lane_statuses,
    }


def main() -> int:
    summaries = sorted(RUNS_DIR.glob("*/summary.json"))
    runs: list[dict[str, Any]] = []
    errors: list[str] = []

    for summary_path in summaries:
        try:
            runs.append(summarize_run(summary_path))
        except Exception as exc:  # noqa: BLE001 - keep first-pass validator simple
            errors.append(f"{summary_path}: {exc}")

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    runs.sort(key=lambda item: item["timestamp"])
    latest = runs[-1] if runs else None

    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)

    index = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "latest_run": latest["id"] if latest else None,
        "runs": runs,
    }

    status = {
        "schema_version": 1,
        "acknowledged_at": index["generated_at"],
        "latest_run": latest,
        "message": "No run summaries found" if latest is None else f"Acknowledged performance run {latest['id']}",
    }

    INDEX_PATH.write_text(json.dumps(index, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    STATUS_PATH.write_text(json.dumps(status, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(status["message"])
    if latest:
        print(f"timestamp={latest['timestamp']}")
        print(f"status={latest['status']}")
        print(f"summary={latest['path']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
