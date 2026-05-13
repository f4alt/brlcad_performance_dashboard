# Adding a Dashboard Lane

This document describes the expected pattern for adding or modifying a dashboard lane.

A lane should be modular. Adding or changing one lane should not require editing another lane's processor or frontend module.

## Current model

The dashboard has three major areas:

```text
data/
  uploads/                 # immutable incoming run packages
  index.json               # generated global upload/run index
  <lane>/                  # generated lane-specific dashboard data

scripts/
  ingest_summary.py        # high-level ingestion orchestration
  lane_processors/
    <lane>.py              # one processor per lane

site/
  index.html               # dashboard shell / section placeholders
  css/
  js/
    main.js                # global startup / run index rendering
    utils.js               # shared formatting/loading helpers
    lanes/
      <lane>.js            # one frontend module per lane
```

`data/uploads/<run-id>/summary.json` is the immutable input from the performance workflow.

Everything under `data/<lane>/` is derived from uploaded summaries and may be regenerated.

## Lane ownership rule

Each lane owns:

```text
scripts/lane_processors/<lane>.py
site/js/lanes/<lane>.js
data/<lane>/*.json
```

The high-level ingest script should only:

1. Find and validate uploaded summaries.
2. Build `data/index.json`.
3. Call registered lane processors.
4. Let each processor write its own derived files.

The high-level site startup should only:

1. Load `data/index.json`.
2. Render global/latest run information.
3. Initialize each lane module.

Do not put lane-specific parsing or rendering logic in unrelated lanes.

## Expected uploaded summary shape

A lane is read from:

```json
{
  "schema_version": 1,
  "run": {
    "id": "2026-05-12T204659Z-665328f9c8d1",
    "timestamp": "2026-05-12T20:46:59Z",
    "commit": "665328f9c8d120502c2a9106eca3b9c988f56e71",
    "short_commit": "665328f9c8d1"
  },
  "lanes": {
    "<lane>": {
      "description": "human-readable lane description",
      "status": "PASS | FAIL | SKIP",
      "columns": ["column_a", "column_b"],
      "rows": [
        {
          "column_a": "value",
          "column_b": 123,
            ...
        }
      ],
      "summary_csv": "<lane>/summary.csv"
    }
  }
}
```

Lane processors should treat missing lanes as normal. A missing lane should not break ingestion unless that lane is explicitly required.

## Step 1: Add a lane processor

Create:

```text
scripts/lane_processors/<lane>.py
```

Minimum shape:

```python
"""<Lane> ingestion for the BRL-CAD performance dashboard."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

LANE_NAME = "<lane>"


def _as_status(value: Any) -> str:
    return str(value or "UNKNOWN").strip().upper() or "UNKNOWN"


def _write_json(path: Path, payload: dict[str, Any] | list[Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _rows_from_lane(lane: dict[str, Any]) -> list[dict[str, Any]]:
    rows = lane.get("rows")
    if isinstance(rows, list):
        return [row for row in rows if isinstance(row, dict)]

    # Optional compatibility with older CSV-table summaries:
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


def process(runs: list[dict[str, Any]], root: Path, generated_at: str) -> None:
    out_dir = root / "data" / LANE_NAME

    latest_rows: list[dict[str, Any]] = []
    latest_run: dict[str, Any] | None = None

    for run in runs:
        lanes = run.get("lanes", {})
        if not isinstance(lanes, dict):
            continue

        lane = lanes.get(LANE_NAME)
        if not isinstance(lane, dict):
            continue

        if _as_status(lane.get("status")) != "PASS":
            continue

        rows = _rows_from_lane(lane)
        if not rows:
            continue

        latest_rows = rows
        latest_run = run.get("index", {})

    latest_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "lane": LANE_NAME,
        "source_run": latest_run,
        "rows": latest_rows,
    }

    _write_json(out_dir / "latest.json", latest_payload)
```

Processor rules:

- Read only from the `runs` argument.
- Write only under `data/<lane>/`.
- Do not mutate uploaded summaries.
- Treat missing or skipped lanes as non-fatal.
- Convert sentinel values, such as `-1`, into explicit JSON values like `null` plus a row status when appropriate.
- Prefer object rows over positional arrays.
- Include enough run metadata in derived data for hover text, links, debugging, and later filtering.

## Step 2: Register the lane processor

Edit:

```text
scripts/ingest_summary.py
```

Import the processor:

```python
from lane_processors import <lane>
```

Register it:

```python
LANE_PROCESSORS = [
    ...
    <lane>,
]
```

The processor must expose:

```python
process(runs, root, generated_at)
```

## Step 3: Add generated lane data paths to the workflow

If generated files are committed back to the repo, update the ingest/deploy workflow to include the new lane directory.

Example:

```bash
git add data/<lane>
```

NOTE: right now, each ingest/deploy build re-index ALL data/upload/, so this is 'technically' not needed.
However, this registration step protects the expectation of an eventual latest-only ingestion.

## Step 4: Add placeholders to `site/index.html`

Add a section for the lane.

Example:

```html
<section class="card lane-card" id="<lane>-section">
  <div class="section-heading">
    <div>
      <p class="eyebrow">Lane</p>
      <h2><Lane title></h2>
    </div>
    <span class="status-pill" id="<lane>-status">Loading…</span>
  </div>

  <div id="<lane>-message" class="muted">Loading lane data…</div>
  <div id="<lane>-content">Loading…</div>
</section>
```

Keep the HTML section lightweight. Most lane-specific table/chart rendering should live in `site/js/lanes/<lane>.js`.

## Step 5: Add a frontend lane module

Create:

```text
site/js/lanes/<lane>.js
```

Minimum shape:

```javascript
import { escapeHtml, fetchJson, formatNumber, formatTimestamp } from "../utils.js";

function renderRows(rows) {
  if (!rows || rows.length === 0) {
    return "<p>No data has been ingested for this lane yet.</p>";
  }

  return `
    <table>
      <thead>
        <tr>
          <th>Example</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.example)}</td>
            <td>${formatNumber(row.value)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

export async function initLaneSection() {
  const latest = await fetchJson("data/<lane>/latest.json");

  const statusEl = document.getElementById("<lane>-status");
  const messageEl = document.getElementById("<lane>-message");
  const contentEl = document.getElementById("<lane>-content");

  const status = latest.rows?.length ? "PASS" : "UNKNOWN";

  statusEl.textContent = status;
  statusEl.className = `status-pill status-${status}`;

  messageEl.textContent = latest.source_run
    ? `Showing data from ${latest.source_run.id}`
    : "No source run is available yet.";

  contentEl.innerHTML = renderRows(latest.rows || []);
}
```

Frontend module rules:

- Fetch only files under `data/<lane>/`.
- Render only the lane's own section.
- Use shared helpers from `site/js/utils.js`.
- Keep chart/table controls local to the lane module.
- Do not rely on another lane's generated data.

## Step 6: Register the frontend module

Edit:

```text
site/js/main.js
```

Import the initializer:

```javascript
import { initLaneSection } from "./lanes/<lane>.js";
```

Call it during startup:

```javascript
await initLaneSection();
```

A lane should fail gracefully. If a lane is optional or under development, consider wrapping that lane initializer so one lane failure does not prevent the rest of the dashboard from loading.

Example:

```javascript
async function initLane(name, initFn) {
  try {
    await initFn();
  } catch (error) {
    console.error(`Failed to initialize ${name}`, error);
  }
}
```

Then:

```javascript
await initLane("<lane>", initLaneSection);
```
