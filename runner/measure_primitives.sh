#!/usr/bin/env bash
#
# STUB per-primitive performance measurement.
#
# For each primitive object in a hardcoded list, render a fixed view with the
# installed `rt` against the bundled share/db/primitives.g and approximate
# rays/sec as (width*height)/wall_seconds. This is intentionally rough and
# tool-output-agnostic; it is meant to be REPLACED by a comprehensive
# in-BRL-CAD per-primitive runner. Keep the prim list + the measure_one()
# function as the single place to swap in the real implementation.
#
# Writes <WORK_DIR>/primitives.csv: "prim,rays_per_sec" (only measured prims).
#
# Inputs (env):
#   WORK_DIR     required
#   PREFIX       required; install prefix (<PREFIX>/bin/rt, <PREFIX>/share/db/primitives.g)
#   PRIM_WIDTH / PRIM_HEIGHT   default 512
#   PRIM_CPUS    default 1 (single thread for stable numbers)

set -Eeuo pipefail

log() { printf '%s\n' "$*" >&2; }

WORK_DIR="${WORK_DIR:?WORK_DIR must be set}"
PREFIX="${PREFIX:?PREFIX must be set}"
W="${PRIM_WIDTH:-512}"
N="${PRIM_HEIGHT:-512}"
CPUS="${PRIM_CPUS:-1}"

rt="$PREFIX/bin/rt"
db="${PRIM_DB:-$PREFIX/share/db/primitives.g}"
out_csv="$WORK_DIR/primitives.csv"

# Hardcoded primitive object list (mirrors the objects in primitives.g). Edit
# here until the real runner derives this automatically.
PRIMS=(
    grip arb4 arb7 sph arb6 raw 3ptarb rpp arb5 arbn box ellg ell ell1 rpc
    ehy rhc part epa rec trc rcc tec pipe tgc arb8 tor extrude eto metaball
    half vol bot revolve ebm brep ars submodel
)

# Optional CPU pinning, as an array (robust regardless of IFS).
TASKSET=()
command -v taskset >/dev/null 2>&1 && TASKSET=(taskset -c 0)

# High-resolution wall clock in fractional seconds; degrades gracefully.
HAVE_NS=0
if [ -n "${EPOCHREALTIME:-}" ]; then
    HAVE_NS=2
elif date +%N 2>/dev/null | grep -qE '^[0-9]+$'; then
    HAVE_NS=1
fi
now_s() {
    case "$HAVE_NS" in
        2) printf '%s' "${EPOCHREALTIME/,/.}" ;;  # bash 5+
        1) date +%s.%N ;;
        *) date +%s ;;                            # whole seconds fallback
    esac
}

# measure_one <prim> -> echoes rays/sec on success, empty on failure.
# Replace the body with the real per-primitive runner when ready.
measure_one() {
    local prim="$1" rc=0 t0 t1 wall
    local warm_log="$WORK_DIR/prim.${prim}.warmup.log"
    local run_log="$WORK_DIR/prim.${prim}.log"

    # warmup (discarded) to shed cold-start effects
    ( "${TASKSET[@]}" "$rt" -w "$W" -n "$N" -P "$CPUS" -o /dev/null "$db" "$prim" ) >"$warm_log" 2>&1 || return 1

    t0="$(now_s)"
    ( "${TASKSET[@]}" "$rt" -w "$W" -n "$N" -P "$CPUS" -o /dev/null "$db" "$prim" ) >"$run_log" 2>&1 || rc=$?
    t1="$(now_s)"
    if [ "$rc" -ne 0 ]; then
        return 1
    fi

    wall="$(awk -v a="$t0" -v b="$t1" 'BEGIN { d=b-a; if (d<=0) d=0; printf "%.6f", d }')"
    awk -v px="$((W * N))" -v w="$wall" 'BEGIN { if (w>0) printf "%.2f", px/w; else print "" }'
}

# Only successfully-measured primitives are emitted; failures are simply not
# uploaded (no per-row status). An empty result set -> aggregate omits the lane.
{
    echo "prim,rays_per_sec"
    if [ ! -x "$rt" ] || [ ! -f "$db" ]; then
        log "ERROR: missing rt ($rt) or primitives db ($db); primitives lane will be omitted"
    else
        total="${#PRIMS[@]}"; idx=0; ok=0
        for prim in "${PRIMS[@]}"; do
            idx=$((idx + 1))
            log "  [$idx/$total] $prim"
            rps="$(measure_one "$prim" || true)"
            if [ -n "$rps" ]; then
                printf '%s,%s\n' "$prim" "$rps"; ok=$((ok + 1))
            else
                log "    skip $prim (measurement failed)"
            fi
        done
        log "measured $ok/$total primitives"
    fi
} > "$out_csv"

log "Wrote $out_csv"
