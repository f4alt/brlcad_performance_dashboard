# BRL-CAD Performance Dashboard

Static GitHub Pages dashboard for BRL-CAD performance runs.

## Initial flow

1. The BRL-CAD performance workflow produces a run package containing `summary.json`.
2. The package is committed into this repo under `data/runs/<run-id>/`.
3. The `Acknowledge performance run` workflow validates the latest summaries and regenerates `data/index.json` and `data/status/latest.json`.
4. The Pages workflow publishes `site/` plus `data/` as a static dashboard.

## Suggested run package layout

```text
perf-package/
  summary.json
  benchmark/
    summary.csv
    benchmark.log
  rtcmp-prims/
    prims_summary.csv
  rtcmp-generic/
    summary.csv
```

Only `summary.json` is required by the dashboard. The raw CSVs and logs are retained for audit/debugging.

## Repository layout

```text
.github/workflows/
  ack-ingest.yml       # validates run summaries and updates derived index/status JSON
  deploy-pages.yml     # publishes the static GitHub Pages site

scripts/
  ingest_summary.py    # simple validator/index generator

site/
  index.html           # placeholder static dashboard

data/
  index.json           # generated run index
  status/latest.json   # generated latest-run acknowledgement
  runs/<run-id>/       # immutable run packages committed by BRL-CAD workflow

examples/
  brlcad-publish-to-dashboard.yml # source-repo publishing sketch
```

## Auth setup for BRL-CAD -> dashboard pushes

Recommended first pass: create a deploy key with write access on this dashboard repo.

1. Generate an SSH key pair for automation.
2. Add the public key to this repo under Settings -> Deploy keys -> Allow write access.
3. Add the private key to the BRL-CAD repo as `PERF_DASHBOARD_DEPLOY_KEY`.
4. Use the example workflow snippet in `examples/brlcad-publish-to-dashboard.yml` as the publishing step.

