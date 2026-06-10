#!/usr/bin/env bash
#
# Measure the ABSOLUTE BRL-CAD benchmark VGR of the freshly built install.
# Writes <WORK_DIR>/benchmark.csv: "build,vgr" (empty vgr -> lane omitted).
#
# Inputs (env):
#   WORK_DIR    required
#   PREFIX      required; install prefix (<PREFIX>/bin/benchmark)
#   SHORT_COMMIT optional; used for a fallback build label
#   BENCHMARK_TIMEFRAME / BENCHMARK_MAXTIME / BENCHMARK_AVERAGE  optional knobs

set -Eeuo pipefail

log() { printf '%s\n' "$*" >&2; }

WORK_DIR="${WORK_DIR:?WORK_DIR must be set}"
PREFIX="${PREFIX:?PREFIX must be set}"
SHORT_COMMIT="${SHORT_COMMIT:-}"

out_csv="$WORK_DIR/benchmark.csv"
bench="$PREFIX/bin/benchmark"
log_file="$WORK_DIR/benchmark.log"

# A lane is uploaded only when it has a result; a missing VGR -> empty vgr cell,
# which aggregate.py treats as "no benchmark result" and omits the lane.

# Reuse the proven VGR parser (locale-independent, scientific-notation tolerant).
parse_vgr() {
    awk '
      /Benchmark results indicate an approximate VGR performance metric of/ {
        for (i = NF; i >= 1; i--) {
          token = $i; gsub(/[,;]/, "", token)
          if (token ~ /^[-+]?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?$/) { print token; exit }
        }
      }' "$1"
}
parse_build_name() {
    awk '
      /^BRL-CAD Release[[:space:]]/ {
        if (match($0, /BRL-CAD Release[[:space:]]+[^[:space:]]+/)) { print substr($0, RSTART, RLENGTH); exit }
      }' "$1"
}

write_csv() {  # build, vgr
    {
        echo "build,vgr"
        printf '%s,%s\n' "$1" "$2"
    } > "$out_csv"
}

if [ ! -x "$bench" ]; then
    log "ERROR: benchmark not found at $bench"
    write_csv "unknown" ""
    exit 0
fi

args=(run)
[ -n "${BENCHMARK_TIMEFRAME:-}" ] && args+=("TIMEFRAME=$BENCHMARK_TIMEFRAME")
[ -n "${BENCHMARK_MAXTIME:-}" ]   && args+=("MAXTIME=$BENCHMARK_MAXTIME")
[ -n "${BENCHMARK_AVERAGE:-}" ]   && args+=("AVERAGE=$BENCHMARK_AVERAGE")

log "Running benchmark: $bench ${args[*]}"
( cd "$WORK_DIR" && "$bench" "${args[@]}" ) > "$log_file" 2>&1 || log "benchmark exited non-zero (see $log_file)"

vgr="$(parse_vgr "$log_file" || true)"
build="$(parse_build_name "$log_file" || true)"
[ -z "$build" ] && build="BRL-CAD main${SHORT_COMMIT:+ @ $SHORT_COMMIT}"

if [ -z "$vgr" ]; then
    log "ERROR: could not parse VGR (see $log_file); benchmark lane will be omitted"
    write_csv "$build" ""
    exit 0
fi

write_csv "$build" "$vgr"
log "VGR=$vgr build='$build'"
