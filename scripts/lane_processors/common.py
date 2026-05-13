"""Shared helpers for lane processors."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def as_status(value: Any) -> str:
    return str(value or "UNKNOWN").strip().upper() or "UNKNOWN"


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
    """Return lane rows as dictionaries.

    Supports the dashboard object-row shape:
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


def write_json(path: Path, payload: dict[str, Any] | list[Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def run_info_from_upload(upload: dict[str, Any]) -> dict[str, Any]:
    index = upload.get("index", {})
    return index if isinstance(index, dict) else {}


def point_source(run_info: dict[str, Any]) -> dict[str, Any]:
    return {
        "run_id": run_info.get("id"),
        "timestamp": run_info.get("timestamp"),
        "commit": run_info.get("commit"),
        "short_commit": run_info.get("short_commit"),
        "summary_path": run_info.get("path"),
        "package_path": run_info.get("package_path"),
    }
