#!/usr/bin/env bash
#
# Server-side orchestration: clean-build current BRL-CAD main, then measure the
# benchmark + per-primitive lanes. Produces, under WORK_DIR:
#   build_meta.json, benchmark.csv, primitives.csv
#
# It deliberately does NOT aggregate into summary.json or require python3 on the
# server — the scheduling workflow scp's these artifacts back and runs
# .github/runner/aggregate.py on the GitHub runner.
#
# Inputs (env): WORK_DIR (required) + any knobs honored by the sub-scripts.

set -Eeuo pipefail

log() { printf '%s\n' "$*" >&2; }

WORK_DIR="${WORK_DIR:?WORK_DIR must be set}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export WORK_DIR

mkdir -p "$WORK_DIR"

log "== build =="
bash "$HERE/build.sh"

PREFIX="$WORK_DIR/install"
SHORT_COMMIT="$(sed -n 's/.*"short_commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$WORK_DIR/build_meta.json" | head -n1)"
export PREFIX SHORT_COMMIT

log "== measure: benchmark =="
bash "$HERE/measure_benchmark.sh"

log "== measure: primitives =="
bash "$HERE/measure_primitives.sh"

log "Done. Artifacts in $WORK_DIR: build_meta.json benchmark.csv primitives.csv"
printf '%s\n' "$WORK_DIR"
