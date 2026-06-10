#!/usr/bin/env python3
"""Ingest BRL-CAD performance summaries and build compact dashboard data.

Flow
----
1. Read the durable master log (data/master/results*.jsonl) — one JSON object
   per ingested run, append-only and newest-last. Each line stores the RAW
   validated summary so derived data is fully reproducible.
2. Validate every new summary in the inbox (data/to_process/<run-id>/summary.json).
   Bad summaries are left in place (quarantined) and reported; good ones are
   appended to the master and their inbox directory is deleted.
3. Regenerate COMPACT derived dashboard data from the master into the output
   directory (default _site/data) by calling auto-discovered lane processors.
   Derived data is a build artifact: it is never committed.

The master is the source of truth; the browser never downloads it.
"""

from __future__ import annotations

import argparse
import importlib
import json
import pkgutil
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import lane_processors
from lane_processors.common import write_json

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
TO_PROCESS_DIR = DATA_DIR / "to_process"
MASTER_DIR = DATA_DIR / "master"
SCHEMA_PATH = Path(__file__).resolve().parent / "summary.schema.json"
DEFAULT_OUT = ROOT / "_site" / "data"

# Roll to a new master shard near GitHub's 50 MB single-file warning band, long
# before the 100 MB hard limit. With ~13 KB/run this is roughly a decade away.
MASTER_SHARD_LIMIT_BYTES = 50 * 1024 * 1024

EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------

def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_timestamp(value: Any, fallback: datetime) -> datetime:
    if not value:
        return fallback
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return fallback


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("must contain a JSON object")
    return data


# ---------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------

def _hand_rolled_errors(summary: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    run = summary.get("run")
    if not isinstance(run, dict):
        errors.append("missing 'run' object")
    else:
        if not str(run.get("id") or "").strip():
            errors.append("run.id is required")
        has_ts = str(run.get("timestamp") or "").strip()
        has_generated = str(summary.get("generated_at") or "").strip()
        if not has_ts and not has_generated:
            errors.append("run.timestamp (or generated_at) is required")

    lanes = summary.get("lanes")
    if not isinstance(lanes, dict) or not lanes:
        errors.append("'lanes' must be a non-empty object")
    else:
        for name, lane in lanes.items():
            if not isinstance(lane, dict):
                errors.append(f"lane '{name}' must be an object")
            elif not isinstance(lane.get("rows"), list):
                errors.append(f"lane '{name}' must have a 'rows' array")

    return errors


def _jsonschema_errors(summary: dict[str, Any]) -> list[str]:
    """Stricter validation when jsonschema + the schema file are available."""
    try:
        import jsonschema  # type: ignore
    except Exception:
        return []
    try:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []

    validator = jsonschema.Draft202012Validator(schema)
    return [
        f"{'/'.join(str(p) for p in error.path) or '<root>'}: {error.message}"
        for error in validator.iter_errors(summary)
    ]


def validate_summary(summary: dict[str, Any]) -> list[str]:
    errors = _hand_rolled_errors(summary)
    for extra in _jsonschema_errors(summary):
        if extra not in errors:
            errors.append(extra)
    return errors


# ---------------------------------------------------------------------------
# lane / run normalization
# ---------------------------------------------------------------------------

def normalize_lanes(summary: dict[str, Any]) -> dict[str, dict[str, Any]]:
    lanes = summary.get("lanes", {})
    if isinstance(lanes, dict):
        return {str(name): lane for name, lane in lanes.items() if isinstance(lane, dict)}
    return {}


def build_run_info(summary: dict[str, Any], run_id: str) -> dict[str, Any]:
    run = summary.get("run")
    if not isinstance(run, dict):
        run = {}

    timestamp = parse_timestamp(run.get("timestamp") or summary.get("generated_at"), EPOCH)
    commit = run.get("commit")
    short_commit = str(run.get("short_commit") or commit or "")[:12] or None
    repository = run.get("repository") or run.get("repo")
    system = run.get("system") if isinstance(run.get("system"), dict) else None

    return {
        "id": run_id,
        "timestamp": iso(timestamp),
        "commit": commit,
        "short_commit": short_commit,
        "branch": run.get("branch"),
        "ref": run.get("ref"),
        "repository": repository,
        "workflow": run.get("workflow"),
        "workflow_run_id": run.get("workflow_run_id"),
        "workflow_url": run.get("workflow_url"),
        "system": system,
    }


def to_processor_record(master_record: dict[str, Any]) -> dict[str, Any]:
    source = master_record.get("source") or {}
    if not isinstance(source, dict):
        source = {}
    lanes = normalize_lanes(source)
    run = source.get("run") if isinstance(source.get("run"), dict) else {}
    run_id = str(master_record.get("run_id") or run.get("id") or "")
    return {"summary": source, "lanes": lanes, "index": build_run_info(source, run_id)}


# ---------------------------------------------------------------------------
# master log (sharded JSONL, append-only, newest-last)
# ---------------------------------------------------------------------------

_SHARD_RE = re.compile(r"results-(\d+)\.jsonl$")


def _shard_number(path: Path) -> int:
    if path.name == "results.jsonl":
        return 1
    match = _SHARD_RE.match(path.name)
    return int(match.group(1)) if match else 0


def master_shards() -> list[Path]:
    if not MASTER_DIR.exists():
        return []
    shards = [p for p in MASTER_DIR.glob("results*.jsonl") if _shard_number(p) >= 1]
    return sorted(shards, key=_shard_number)


def read_master() -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for shard in master_shards():
        for lineno, raw in enumerate(shard.read_text(encoding="utf-8").splitlines(), start=1):
            line = raw.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"{shard}:{lineno}: corrupt master record: {exc}")
    return records


def _current_shard() -> Path:
    shards = master_shards()
    if not shards:
        return MASTER_DIR / "results.jsonl"
    last = shards[-1]
    if last.stat().st_size >= MASTER_SHARD_LIMIT_BYTES:
        return MASTER_DIR / f"results-{_shard_number(last) + 1:03d}.jsonl"
    return last


def append_master(record: dict[str, Any]) -> None:
    shard = _current_shard()
    shard.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, separators=(",", ":"), sort_keys=True)
    # newline="\n" keeps the master LF-only regardless of host OS so each append
    # stays a clean trailing-line diff for git delta packing.
    with shard.open("a", encoding="utf-8", newline="\n") as f:
        f.write(line + "\n")


def record_run_id(record: dict[str, Any]) -> str:
    rid = record.get("run_id")
    if not rid:
        source = record.get("source") or {}
        run = source.get("run") if isinstance(source, dict) else {}
        rid = (run or {}).get("id") if isinstance(run, dict) else None
    return str(rid or "")


# ---------------------------------------------------------------------------
# inbox
# ---------------------------------------------------------------------------

def find_inbox_summaries() -> list[Path]:
    if not TO_PROCESS_DIR.exists():
        return []
    return sorted(TO_PROCESS_DIR.glob("*/summary.json"))


def remove_inbox_dir(run_dir: Path) -> None:
    shutil.rmtree(run_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# lane discovery + manifest
# ---------------------------------------------------------------------------

def discover_lane_processors() -> list[Any]:
    modules: list[Any] = []
    for info in pkgutil.iter_modules(lane_processors.__path__):
        if info.name == "common" or info.name.startswith("_"):
            continue
        module = importlib.import_module(f"lane_processors.{info.name}")
        if hasattr(module, "LANE_NAME") and hasattr(module, "process"):
            modules.append(module)
    modules.sort(key=lambda m: m.LANE_NAME)
    return modules


def build_lanes_manifest(modules: list[Any], master_records: list[dict[str, Any]]) -> list[dict[str, str]]:
    order: list[str] = []
    for record in reversed(master_records):
        source = record.get("source") or {}
        lane_order = source.get("lane_order") if isinstance(source, dict) else None
        if isinstance(lane_order, list) and lane_order:
            order = [str(name) for name in lane_order]
            break

    by_name = {module.LANE_NAME: module for module in modules}
    ordered = [name for name in order if name in by_name]
    ordered += [name for name in sorted(by_name) if name not in ordered]

    return [{"name": name, "title": getattr(by_name[name], "LANE_TITLE", name)} for name in ordered]


def write_index(records: list[dict[str, Any]], out_dir: Path, generated_at: str) -> None:
    latest = records[-1]["index"] if records else None
    write_json(out_dir / "index.json", {
        "schema_version": 1,
        "generated_at": generated_at,
        "latest_upload": latest,
        "run_count": len(records),
    })


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ingest BRL-CAD performance summaries and build compact dashboard data."
    )
    parser.add_argument(
        "--out",
        default=str(DEFAULT_OUT),
        help="Directory for generated derived data (default: _site/data).",
    )
    return parser.parse_args(argv)


def ingest_inbox(master_records: list[dict[str, Any]], ingested_at: str) -> tuple[int, list[tuple[Path, str]]]:
    """Validate + append new inbox summaries. Returns (appended_count, failures)."""
    seen_ids = {record_run_id(r) for r in master_records if record_run_id(r)}

    pending: list[dict[str, Any]] = []
    failures: list[tuple[Path, str]] = []

    for summary_path in find_inbox_summaries():
        try:
            summary = load_json(summary_path)
        except Exception as exc:  # noqa: BLE001 - report and quarantine, do not abort batch
            failures.append((summary_path, f"invalid JSON: {exc}"))
            continue

        errors = validate_summary(summary)
        if errors:
            failures.append((summary_path, "; ".join(errors)))
            continue

        # validate_summary guarantees a non-empty run.id by this point; the
        # directory-name fallback is purely defensive.
        run = summary.get("run") if isinstance(summary.get("run"), dict) else {}
        run_id = str(run.get("id") or summary_path.parent.name)

        if run_id in seen_ids:
            # Already ingested (e.g. a retried workflow run) — just clean up.
            remove_inbox_dir(summary_path.parent)
            continue

        timestamp = parse_timestamp(run.get("timestamp") or summary.get("generated_at"), EPOCH)
        pending.append({
            "run_id": run_id,
            "timestamp": iso(timestamp),
            "summary": summary,
            "dir": summary_path.parent,
        })
        seen_ids.add(run_id)

    # Append newest-last so the master stays append-only and git-delta friendly.
    pending.sort(key=lambda item: item["timestamp"])
    for item in pending:
        record = {
            "run_id": item["run_id"],
            "ingested_at": ingested_at,
            "timestamp": item["timestamp"],
            "source": item["summary"],
        }
        append_master(record)
        master_records.append(record)
        remove_inbox_dir(item["dir"])

    return len(pending), failures


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    out_dir = Path(args.out)
    generated_at = utc_now()

    try:
        master_records = read_master()
        appended, failures = ingest_inbox(master_records, generated_at)

        modules = discover_lane_processors()
        processor_records = [to_processor_record(record) for record in master_records]

        write_index(processor_records, out_dir, generated_at)
        write_json(out_dir / "lanes.json", build_lanes_manifest(modules, master_records))
        for module in modules:
            module.process(processor_records, out_dir, generated_at)
    except Exception as exc:  # noqa: BLE001 - concise failure for the workflow log
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(f"master records: {len(master_records)} (+{appended} new)")
    print(f"lanes: {', '.join(module.LANE_NAME for module in modules) or '(none)'}")
    print(f"derived data written to: {out_dir}")

    if failures:
        for path, message in failures:
            rel = path.relative_to(ROOT) if path.is_relative_to(ROOT) else path
            print(f"::error file={rel}::{message}", file=sys.stderr)
            print(f"ERROR: {rel}: {message}", file=sys.stderr)
        print(
            f"{len(failures)} summary(ies) failed validation and remain in data/to_process/.",
            file=sys.stderr,
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
