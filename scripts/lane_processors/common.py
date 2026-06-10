"""Shared helpers for lane processors.

Lane processors receive the in-memory list of master records (one per ingested
run, newest-last) and write COMPACT derived dashboard data into an output
directory. They never read or write the durable master themselves.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_FILENAME_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None

    try:
        number = float(value)
    except (TypeError, ValueError):
        return None

    if not (number == number):  # NaN guard without importing math
        return None

    return number


def to_nonnegative_float(value: Any) -> float | None:
    number = to_float(value)
    if number is None or number < 0:
        return None
    return number


def rows_from_lane(lane: dict[str, Any]) -> list[dict[str, Any]]:
    """Return a lane's object-rows.

    The current producer contract is object rows:
        {"rows": [{"build": "...", "vgr": 123}]}
    """
    rows = lane.get("rows")
    if isinstance(rows, list):
        return [row for row in rows if isinstance(row, dict)]
    return []


def write_json(path: Path, payload: dict[str, Any] | list[Any]) -> None:
    """Write derived data compactly (it is rebuilt every deploy, never committed)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n",
        encoding="utf-8",
    )


def run_info_from_record(record: dict[str, Any]) -> dict[str, Any]:
    index = record.get("index", {})
    return index if isinstance(index, dict) else {}


def point_source(run_info: dict[str, Any]) -> dict[str, Any]:
    """Minimal per-point provenance for charts (links + tooltips)."""
    return {
        "run_id": run_info.get("id"),
        "timestamp": run_info.get("timestamp"),
        "commit": run_info.get("commit"),
        "short_commit": run_info.get("short_commit"),
        "repository": run_info.get("repository"),
        "workflow_url": run_info.get("workflow_url"),
    }


def safe_run_filename(run_id: str) -> str:
    """Filesystem/URL-safe filename for a per-run detail file."""
    cleaned = _FILENAME_SAFE.sub("_", str(run_id or "run")).strip("_") or "run"
    return f"{cleaned}.json"


def thin_run(run_info: dict[str, Any]) -> dict[str, Any]:
    """A small descriptor used to populate run-picker dropdowns (no rows)."""
    run_id = run_info.get("id")
    return {
        "id": run_id,
        "timestamp": run_info.get("timestamp"),
        "short_commit": run_info.get("short_commit"),
        "detail": safe_run_filename(run_id),
    }
