#!/usr/bin/env python3
"""Validate uploaded BRL-CAD performance summaries and build dashboard data.

Immutable source packages live under:

    data/uploads/<run-id>/summary.json

This script owns only high-level ingestion:

1. Find and validate uploaded summaries.
2. Build data/index.json.
3. Delegate lane-specific derived data to scripts/lane_processors/*.

Lane-specific parsing and output belongs in each lane processor.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from lane_processors import benchmark, rtcmp_generic, rtcmp_prims

ROOT = Path(__file__).resolve().parents[1]
UPLOADS_DIR = ROOT / "data" / "uploads"
INDEX_PATH = ROOT / "data" / "index.json"

LANE_PROCESSORS = [
    benchmark,
    rtcmp_prims,
    rtcmp_generic,
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")

    return data


def parse_timestamp(value: Any, fallback: datetime) -> datetime:
    if not value:
        return fallback

    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return fallback


def normalize_lanes(summary: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Accept current object-shaped lanes and the older list-shaped lane format."""
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


def overall_status_from_lanes(lane_statuses: dict[str, str]) -> str:
    if not lane_statuses:
        return "UNKNOWN"

    if any(status == "FAIL" for status in lane_statuses.values()):
        return "FAIL"

    if any(status == "UNKNOWN" for status in lane_statuses.values()):
        return "UNKNOWN"

    if all(status == "SKIP" for status in lane_statuses.values()):
        return "SKIP"

    return "PASS"


def summarize_upload(summary_path: Path, summary: dict[str, Any], lanes: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if not lanes:
        raise ValueError(f"{summary_path} does not define any lanes")

    run_dir = summary_path.parent
    run = summary.get("run", {})
    if not isinstance(run, dict):
        run = {}

    lane_statuses = {
        name: str(lane.get("status", "UNKNOWN")).strip().upper() or "UNKNOWN"
        for name, lane in sorted(lanes.items())
    }

    timestamp = parse_timestamp(
        run.get("timestamp") or summary.get("generated_at"),
        datetime.fromtimestamp(summary_path.stat().st_mtime, tz=timezone.utc),
    )

    run_id = str(run.get("id") or run_dir.name)
    commit = run.get("commit")
    short_commit = str(run.get("short_commit") or commit or "")[:12] or None
    repository = run.get("repository") or run.get("repo")

    return {
        "id": run_id,
        "timestamp": timestamp.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "path": str(summary_path.relative_to(ROOT)).replace("\\", "/"),
        "package_path": str(run_dir.relative_to(ROOT)).replace("\\", "/"),
        "commit": commit,
        "short_commit": short_commit,
        "branch": run.get("branch"),
        "ref": run.get("ref"),
        "repository": repository,
        "workflow": run.get("workflow"),
        "workflow_run_id": run.get("workflow_run_id"),
        "workflow_url": run.get("workflow_url"),
        "status": overall_status_from_lanes(lane_statuses),
        "lanes": lane_statuses,
    }


def find_summary_paths() -> list[Path]:
    if not UPLOADS_DIR.exists():
        return []

    return sorted(UPLOADS_DIR.glob("*/summary.json"))


def load_uploads() -> list[dict[str, Any]]:
    uploads: list[dict[str, Any]] = []
    errors: list[str] = []

    for summary_path in find_summary_paths():
        try:
            summary = load_json(summary_path)
            lanes = normalize_lanes(summary)
            index = summarize_upload(summary_path, summary, lanes)
            uploads.append({
                "summary_path": summary_path,
                "summary": summary,
                "lanes": lanes,
                "index": index,
            })
        except Exception as exc:  # noqa: BLE001 - report all invalid uploads together
            errors.append(f"{summary_path}: {exc}")

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        raise RuntimeError("One or more uploaded summaries failed validation")

    uploads.sort(key=lambda item: item["index"]["timestamp"])
    return uploads


def write_index(uploads: list[dict[str, Any]], generated_at: str) -> None:
    index_uploads = [upload["index"] for upload in uploads]
    latest = index_uploads[-1] if index_uploads else None

    payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "latest_upload": latest,
        "uploads": index_uploads,
    }

    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    if latest is None:
        print("No uploaded summaries found")
        return

    print(f"Acknowledged performance upload {latest['id']}")
    print(f"timestamp={latest['timestamp']}")
    print(f"status={latest['status']}")
    print(f"summary={latest['path']}")


def main() -> int:
    generated_at = utc_now()

    try:
        uploads = load_uploads()
        write_index(uploads, generated_at)

        for processor in LANE_PROCESSORS:
            processor.process(uploads, ROOT, generated_at)
    except Exception as exc:  # noqa: BLE001 - workflow should get concise failure
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
