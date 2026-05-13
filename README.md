# BRL-CAD Performance Dashboard

Static GitHub Pages dashboard for BRL-CAD performance runs. The BRL-CAD performance workflow uploads immutable `summary.json` packages, this repo ingests them, derives lane-specific dashboard data, and deploys a lightweight frontend for viewing latest results and historical trends.

## Repository layout

```text
.github/workflows/
  ack-ingest.yml            # ingests uploaded summaries and deploys GitHub Pages

data/
  uploads/<run-id>/         # immutable uploaded run packages from BRL-CAD
    summary.json            # canonical per-run summary
  index.json                # generated global upload index
  benchmark/                # generated benchmark lane data
  rtcmp_prims/              # generated primitive-performance lane data
  rtcmp_generic/            # generated generic-comparison lane data

scripts/
  ingest_summary.py         # validates uploads, builds the index, runs lane processors
  lane_processors/          # one processor per dashboard lane

site/
  index.html                # static dashboard shell
  css/                      # dashboard styling
  js/                       # shared frontend code and lane modules
    lanes/                  # one frontend module per dashboard lane

examples/		    # potentially useful patterns for using the dashboard
```

## Data flow

```text
BRL-CAD performance workflow
  -> data/uploads/<run-id>/summary.json
  -> scripts/ingest_summary.py
  -> data/index.json + data/<lane>/*.json
  -> GitHub Pages deploys site/ plus generated data/
```

Only `summary.json` is required from each upload package. Extra CSVs and logs may be kept alongside it for audit/debugging, but generated dashboard data should be reproducible from the uploaded summaries.

## Lane pattern

Each lane owns its backend processor, frontend module, and generated data directory:

```text
scripts/lane_processors/<lane>.py
site/js/lanes/<lane>.js
data/<lane>/
```

The ingest script should stay lane-agnostic: it loads uploaded summaries, builds the global index, and calls registered lane processors. See `examples/adding_a_lane.md` for the expected pattern.
