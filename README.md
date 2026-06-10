# BRL-CAD Performance Dashboard

Static GitHub Pages dashboard for BRL-CAD performance runs. A daily self-hosted runner
(`runner/`, driven by `.github/workflows/run_daily.yml`) builds current BRL-CAD on
consistent hardware and measures **absolute** metrics (benchmark VGR, per-primitive
rays/sec) so the trend over time is the regression signal. Producers drop immutable
`summary.json` packages into an inbox; CI ingests them into a durable, append-only master
log, derives compact lane-specific dashboard data, and deploys a lightweight frontend for
viewing latest results and historical trends. External producers can still push their own
`summary.json` into the same inbox.

## Data model: durable vs ephemeral

The repository tracks only two kinds of data:

```text
data/
  to_process/            # INBOX — transient. Producers commit summaries here.
    <run-id>/summary.json
    .gitkeep
  master/                # DURABLE — the source of truth (committed, grows slowly).
    results.jsonl        # append-only, newest-last, one JSON object per run:
                         #   {"run_id","ingested_at","timestamp","source":<raw summary>}
                         # rolls to results-002.jsonl etc. near ~50 MB.
```

Everything the browser fetches (`data/index.json`, `data/lanes.json`,
`data/<lane>/*.json`) is **derived** — regenerated from `data/master/` into the Pages
deploy artifact on every run and **never committed** (it is `.gitignore`d). This keeps
git history near-linear instead of ballooning quadratically, and the browser never
downloads the full master.

## Repository layout

```text
.github/workflows/
  ingest_and_deploy.yml     # ingests the inbox, builds + deploys GitHub Pages
  run_daily.yml             # daily: SSH to the server, build+measure, push to the inbox

data/
  to_process/               # inbox of incoming run packages (transient)
  master/results.jsonl      # durable append-only master log (source of truth)

runner/                     # server-side build + measure scripts; emit summary.json
  run_all.sh                # orchestrates build -> measure -> aggregate
  build.sh                  # clean build of current BRL-CAD main (+ bext)
  measure_benchmark.sh      # absolute VGR
  measure_primitives.sh     # per-primitive rays/sec (stub: rt vs primitives.g)
  aggregate.py              # writes the contract summary.json

scripts/
  ingest_summary.py         # validates inbox, appends to master, builds derived data
  summary.schema.json       # the summary.json contract (validation + documentation)
  lane_processors/          # one processor per dashboard lane (auto-discovered)

site/
  index.html                # static dashboard shell (one <section> per lane)
  css/                      # dashboard styling
  js/
    main.js                 # loads index + lane manifest, dynamic-imports each lane
    utils.js                # shared formatting/loading helpers
    lanes/<lane>.js         # one frontend module per lane (exports init())

examples/                   # integration patterns (pushing data, adding a lane)
```

## Data flow

```text
producer (BRL-CAD perf workflow / daily runner)
  -> data/to_process/<run-id>/summary.json        (committed to the inbox)
  -> ingest_summary.py
       validate -> append raw record to data/master/results.jsonl (newest-last)
                -> delete the processed inbox entry
                -> regenerate compact derived data into _site/data/
  -> commit master + pruned inbox  ([skip ci])
  -> GitHub Pages deploys site/ + freshly built _site/data/
```

`summary.json` is the only required input. See `scripts/summary.schema.json` for the
exact contract; bad summaries are quarantined (left in `data/to_process/`) and turn the
run red without blocking the rest.

## Lane pattern

Each lane owns one backend processor, one frontend module, and one dashboard section:

```text
scripts/lane_processors/<lane>.py     # exposes LANE_NAME, LANE_TITLE, process(records, out_dir, generated_at)
site/js/lanes/<lane>.js               # exports init()
site/index.html                       # <section id="<lane>-section"> ... ids prefixed with <lane>-
```

Backends are auto-discovered (no central registry), and the frontend is driven by the
generated `data/lanes.json` manifest, so adding a lane needs no edits to
`ingest_summary.py`, `main.js`, or the workflow. See `examples/adding_a_lane.md`.

## Important notes / future work

- **Keep inbox uploads small.** `summary.json` is the durable record (it is copied
  verbatim into the master). Large logs, raw dumps, build artifacts, and images do not
  belong in the inbox — keep those as short-retention GitHub Actions artifacts.

- **Treat `summary.json` as a schema contract.** Ingestion and lane processors depend on
  stable `run.*` metadata and per-lane row fields (benchmark: `build`, `vgr`; primitives:
  `prim`, `rays_per_sec`). If the producer changes the shape, bump `schema_version`, update
  `scripts/summary.schema.json`, and adjust the relevant lane processor.

- **No lane/row status.** There is no pass/fail field. A lane (or a primitive row) is
  present only when it was successfully measured; a failed lane is simply omitted from
  `summary.json`, and a run with no lanes is not uploaded at all.

- **Per-primitive is a stub.** `runner/measure_primitives.sh` currently approximates
  rays/sec via `rt` against the bundled `share/db/primitives.g`; it is designed to be
  replaced by a comprehensive in-BRL-CAD per-primitive runner at the isolated measurement
  function.

- **Master sharding.** `data/master/results.jsonl` is append-only and rolls to
  `results-002.jsonl` near ~50 MB (≈ a decade of daily runs), well before GitHub's
  100 MB single-file limit. Old shards are immutable and pack once.

- **Retention.** The master grows linearly (~13 KB/run). If long-term size becomes a
  concern, cold-archive the oldest shards (e.g. to release assets) — derived data is
  always reproducible from whatever shards remain.
