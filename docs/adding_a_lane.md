# Adding a Dashboard Lane

A lane is modular: adding or changing one lane should not require editing another lane's
processor or frontend module. Thanks to backend auto-discovery and a generated lane
manifest, adding a lane needs **three files** and no edits to the ingest script,
`main.js`, or the workflow.

## Model

```text
data/
  master/results.jsonl    # durable source of truth (raw summaries; do not touch directly)
  <lane>/                 # generated, ephemeral derived data (rebuilt every deploy)

scripts/
  ingest_summary.py       # auto-discovers lane_processors/* and calls each process(...)
  summary.schema.json     # the summary.json contract
  lane_processors/
    common.py             # shared helpers
    <lane>.py             # one processor per lane (auto-discovered)

site/
  index.html              # one <section id="<lane>-section"> per lane
  js/
    main.js               # loads data/lanes.json, dynamic-imports lanes/<lane>.js
    utils.js              # shared helpers
    lanes/<lane>.js       # one module per lane, exports init()
```

The ingest script reads the inbox, appends raw summaries to the master, then passes the
full history (newest-last) to each discovered processor as
`records = [{"summary": <raw>, "lanes": <normalized dict>, "index": <run_info>}, ...]`.
Each processor writes **compact** derived data under `<out_dir>/<lane>/`. Derived data is
never committed — it is rebuilt into the Pages artifact on every deploy.

## Lane ownership rule

Each lane owns `scripts/lane_processors/<lane>.py`, `site/js/lanes/<lane>.js`, and its
`<lane>-` prefixed DOM ids. Do not read another lane's data or render into another lane's
section.

## Expected `summary.json` shape

See `scripts/summary.schema.json` for the authoritative contract. A lane is read from
`summary["lanes"]["<lane>"]`:

```json
{
  "schema_version": 1,
  "run": {
    "id": "2026-05-12T204659Z-665328f9c8d1",
    "timestamp": "2026-05-12T20:46:59Z",
    "commit": "665328f9c8d120502c2a9106eca3b9c988f56e71",
    "short_commit": "665328f9c8d1",
    "repository": "f4alt/brlcad",
    "workflow_url": "https://github.com/f4alt/brlcad/actions/runs/123"
  },
  "lane_order": ["benchmark", "primitives"],
  "lanes": {
    "<lane>": {
      "description": "human-readable lane description",
      "columns": ["column_a", "column_b"],
      "rows": [ { "column_a": "value", "column_b": 123 } ]
    }
  }
}
```

There is no lane/row `status` — a lane is present only when it has results. A producer
that fails to measure a lane should omit it (and upload nothing if no lane succeeded). A
missing lane is normal; processors must treat it as non-fatal.

## Step 1: Add a lane processor

Create `scripts/lane_processors/<lane>.py`:

```python
"""<Lane> derived data for the BRL-CAD performance dashboard."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import rows_from_lane, run_info_from_record, write_json

LANE_NAME = "<lane>"
LANE_TITLE = "<Lane Title>"   # shown in the dashboard manifest


def process(records: list[dict[str, Any]], out_dir: Path, generated_at: str) -> None:
    lane_dir = out_dir / LANE_NAME

    latest_rows: list[dict[str, Any]] = []
    latest_run: dict[str, Any] | None = None

    for record in records:                       # newest-last
        lanes = record.get("lanes", {})
        lane = lanes.get(LANE_NAME) if isinstance(lanes, dict) else None
        if not isinstance(lane, dict):
            continue
        rows = rows_from_lane(lane)
        if not rows:
            continue
        latest_rows = rows
        latest_run = run_info_from_record(record)

    write_json(lane_dir / "latest.json", {
        "schema_version": 1,
        "generated_at": generated_at,
        "lane": LANE_NAME,
        "source_run": latest_run,
        "rows": latest_rows,
    })
```

Processor rules:

- Read only from `records`; write only under `out_dir / LANE_NAME`.
- Never mutate the raw summaries; never write to `data/master/`.
- Treat missing/skipped lanes as non-fatal; always write valid (possibly empty) output so
  the frontend can render an empty state.
- Keep output **compact**: a bounded `latest.json`, plus an optional `trend.json` with one
  point per run per metric for charts, plus optional immutable `runs/<id>.json` per-run
  detail files (use `common.safe_run_filename` + `common.thin_run`) for a lazy run picker.
  Do **not** embed full per-run row tables across all history in one file.
- Include enough run metadata via `common.point_source` for tooltips and source links.

That is all the backend wiring — `ingest_summary.py` auto-discovers any module under
`lane_processors/` that defines `LANE_NAME` and `process`.

## Step 2: Add a dashboard section

Add to `site/index.html` (ids must be prefixed with the lane name):

```html
<section class="card lane-card" id="<lane>-section">
  <div class="section-heading">
    <div>
      <p class="eyebrow">Lane</p>
      <h2><Lane Title></h2>
    </div>
  </div>

  <div id="<lane>-message" class="notice muted">Loading lane data…</div>
  <div id="<lane>-content">Loading…</div>
</section>
```

## Step 3: Add a frontend module

Create `site/js/lanes/<lane>.js` (must export `init`):

```javascript
import { checkSchemaVersion, escapeHtml, fetchJson, formatNumber } from "../utils.js";

function renderRows(rows) {
  if (!rows || rows.length === 0) {
    return "<p class='muted'>No data has been ingested for this lane yet.</p>";
  }
  return `
    <table>
      <thead><tr><th>Example</th><th class="numeric">Value</th></tr></thead>
      <tbody>
        ${rows.map((row) => `
          <tr><td>${escapeHtml(row.example)}</td><td class="numeric">${formatNumber(row.value)}</td></tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

export async function init() {
  const latest = await fetchJson("data/<lane>/latest.json");
  checkSchemaVersion(latest, "<lane>/latest.json");

  document.getElementById("<lane>-message").textContent = latest.source_run
    ? `Showing data from ${latest.source_run.id}`
    : "No source run is available yet.";
  document.getElementById("<lane>-content").innerHTML = renderRows(latest.rows || []);
}
```

Frontend module rules:

- Fetch only files under `data/<lane>/`; render only this lane's section.
- Use shared helpers from `site/js/utils.js`; pass `{ cache: 'default' }` to `fetchJson`
  for large lazily-loaded files (trend / per-run detail).
- Export `init` — `main.js` dynamic-imports the module named in `data/lanes.json` and calls
  `init()`, wrapping it so one lane's failure never breaks the others.

That's it — no edits to `ingest_summary.py`, `site/js/main.js`, or the workflow are
required. The lane appears automatically once its processor and section exist.
