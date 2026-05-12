#!/usr/bin/env python3
"""Validate archived BRL-CAD performance summaries and build dashboard data.

The immutable source of truth is data/uploads/<run-id>/summary.json. This script
validates those summaries, builds the global run index, and delegates lane-specific
precomputation to scripts/lane_processors/* modules.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from lane_processors import benchmark

ROOT = Path(__file__).resolve().parents[1]
RUNS_DIR = ROOT / "data" / "uploads"
INDEX_PATH = ROOT / "data" / "index.json"
STATUS_PATH = ROOT / "data" / "status" / "latest.json"

LANE_PROCESSORS = [
    benchmark,
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


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
    """Accept either the dashboard object shape or the earlier list shape."""
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


def summarize_run(summary_path: Path, summary: dict[str, Any], lanes: dict[str, dict[str, Any]]) -> dict[str, Any]:
    run_dir = summary_path.parent
    default_id = run_dir.name

    run = summary.get("run", {})
    if not isinstance(run, dict):
        run = {}

    if not lanes:
        raise ValueError(f"{summary_path} does not define any lanes")

    lane_statuses = {
        name: str(lane.get("status", "UNKNOWN")).strip().upper() or "UNKNOWN"
        for name, lane in sorted(lanes.items())
    }

    timestamp = parse_timestamp(
        run.get("timestamp"),
        datetime.fromtimestamp(summary_path.stat().st_mtime, tz=timezone.utc),
    )
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
        "short_commit": str(run.get("short_commit") or run.get("commit") or "")[:12] or None,
        "branch": run.get("branch"),
        "repository": run.get("repository") or run.get("repo"),
        "workflow_run_id": run.get("workflow_run_id"),
        "workflow_url": run.get("workflow_url"),
        "status": overall_status,
        "lanes": lane_statuses,
    }


def load_runs() -> list[dict[str, Any]]:
    summaries = sorted(RUNS_DIR.glob("*/summary.json"))
    runs: list[dict[str, Any]] = []
    errors: list[str] = []

    for summary_path in summaries:
        try:
            summary = load_json(summary_path)
            lanes = normalize_lanes(summary)
            index = summarize_run(summary_path, summary, lanes)
            runs.append({
                "summary_path": summary_path,
                "summary": summary,
                "lanes": lanes,
                "index": index,
            })
        except Exception as exc:  # noqa: BLE001 - validator should report all bad summaries
            errors.append(f"{summary_path}: {exc}")

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        raise RuntimeError("One or more run summaries failed validation")

    runs.sort(key=lambda item: item["index"]["timestamp"])
    return runs


def write_index_and_status(runs: list[dict[str, Any]], generated_at: str) -> None:
    index_runs = [run["index"] for run in runs]
    latest = index_runs[-1] if index_runs else None

    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)

    index = {
        "schema_version": 1,
        "generated_at": generated_at,
        "latest_run": latest["id"] if latest else None,
        "runs": index_runs,
    }

    status = {
        "schema_version": 1,
        "acknowledged_at": generated_at,
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


def main() -> int:
    generated_at = utc_now()

    try:
        runs = load_runs()
        write_index_and_status(runs, generated_at)

        for processor in LANE_PROCESSORS:
            processor.process(runs, ROOT, generated_at)
    except Exception as exc:  # noqa: BLE001 - surface concise workflow failure
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
