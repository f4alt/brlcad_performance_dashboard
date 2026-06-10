#!/usr/bin/env bash
#
# Clean-build current BRL-CAD main and install it to a prefix, capturing build +
# system metadata. ALWAYS writes <WORK_DIR>/build_meta.json and never aborts the
# run: on build failure the measure lanes simply find no binaries, produce no
# results, and aggregate.py skips the upload (rather than an opaque CI error).
#
# BRL-CAD's CMake configure auto-builds the bext dependency bundle when
# BRLCAD_EXT_DIR is not provided, so this is a from-scratch build every run.
#
# Inputs (env):
#   WORK_DIR        required; working directory (clone/build/install live here)
#   BRLCAD_REPO     default https://github.com/f4alt/brlcad.git
#   BRLCAD_REF      default main
#   JOBS            default nproc
#   CMAKE_BUILD_TYPE default Release
# Outputs:
#   <WORK_DIR>/install         install prefix (PREFIX) on success
#   <WORK_DIR>/build_meta.json run + system metadata (build_ok true/false)

set -Eeuo pipefail

log() { printf '%s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

WORK_DIR="${WORK_DIR:?WORK_DIR must be set}"
BRLCAD_REPO="${BRLCAD_REPO:-https://github.com/f4alt/brlcad.git}"
BRLCAD_REF="${BRLCAD_REF:-main}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 2)}"
CMAKE_BUILD_TYPE="${CMAKE_BUILD_TYPE:-Release}"

SRC="$WORK_DIR/brlcad"
BUILD="$WORK_DIR/build"
PREFIX="$WORK_DIR/install"

BUILD_FLAGS="-DCMAKE_BUILD_TYPE=$CMAKE_BUILD_TYPE -DBRLCAD_ENABLE_QT=OFF -DBRLCAD_EXT_PARALLEL=1 -DBRLCAD_BEXT_CLEANUP=ON -DCMAKE_INSTALL_PREFIX=$PREFIX"

mkdir -p "$WORK_DIR"

# --- clone (fatal: nothing meaningful to record without source) ---------------
log "Cloning $BRLCAD_REPO@$BRLCAD_REF"
rm -rf "$SRC"
git clone --depth 1 --branch "$BRLCAD_REF" "$BRLCAD_REPO" "$SRC" || die "clone failed"
COMMIT="$(git -C "$SRC" rev-parse HEAD)"
SHORT_COMMIT="$(git -C "$SRC" rev-parse --short=12 HEAD)"

# --- system metadata ----------------------------------------------------------
os_name="$( ( . /etc/os-release 2>/dev/null && printf '%s' "$PRETTY_NAME" ) || true )"
[ -z "$os_name" ] && os_name="$(uname -sr)"
cpu_model="$(awk -F': ' '/model name/ {print $2; exit}' /proc/cpuinfo 2>/dev/null || true)"
[ -z "$cpu_model" ] && cpu_model="$(uname -m)"
cores="$(nproc 2>/dev/null || echo 0)"; cores="$(printf '%s' "$cores" | tr -dc '0-9')"; [ -n "$cores" ] || cores=0
compiler="$({ "${CC:-cc}" --version 2>/dev/null || true; } | head -n1)"
[ -z "$compiler" ] && compiler="unknown"
timestamp="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

json_escape() {
    if command -v python3 >/dev/null 2>&1; then
        python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"
    else
        printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    fi
}

# emit_meta <build_ok true|false> <build_seconds int> <peak_rss_mb int|null>
emit_meta() {
    {
        printf '{\n'
        printf '  "commit": %s,\n'        "$(json_escape "$COMMIT")"
        printf '  "short_commit": %s,\n'  "$(json_escape "$SHORT_COMMIT")"
        printf '  "repository": %s,\n'    "$(json_escape "${BRLCAD_REPO#https://github.com/}")"
        printf '  "branch": %s,\n'        "$(json_escape "$BRLCAD_REF")"
        printf '  "timestamp": %s,\n'     "$(json_escape "$timestamp")"
        printf '  "prefix": %s,\n'        "$(json_escape "$PREFIX")"
        printf '  "build_ok": %s,\n'      "$1"
        printf '  "system": {\n'
        printf '    "os": %s,\n'          "$(json_escape "$os_name")"
        printf '    "cpu": %s,\n'         "$(json_escape "$cpu_model")"
        printf '    "cores": %s,\n'       "$cores"
        printf '    "compiler": %s,\n'    "$(json_escape "$compiler")"
        printf '    "build_flags": %s,\n' "$(json_escape "$BUILD_FLAGS")"
        printf '    "build_seconds": %s,\n' "$2"
        printf '    "peak_rss_mb": %s\n'  "$3"
        printf '  }\n'
        printf '}\n'
    } > "$WORK_DIR/build_meta.json"
}

# --- configure + build + install (timed as one window; bext builds at configure) ---
TIMEV=""
command -v /usr/bin/time >/dev/null 2>&1 && TIMEV="/usr/bin/time -v"
time_log="$WORK_DIR/build_time.log"

log "Configuring + building + installing (Qt off, auto-bext, jobs=$JOBS)"
rm -rf "$BUILD" "$PREFIX"
start="$(date +%s)"
build_rc=0
{
    # shellcheck disable=SC2086
    cmake -S "$SRC" -B "$BUILD" -G Ninja $BUILD_FLAGS &&
    if [ -n "$TIMEV" ]; then
        $TIMEV cmake --build "$BUILD" --config "$CMAKE_BUILD_TYPE" --target install -j "$JOBS" 2> "$time_log"
    else
        cmake --build "$BUILD" --config "$CMAKE_BUILD_TYPE" --target install -j "$JOBS"
    fi
} || build_rc=$?
end="$(date +%s)"
build_seconds=$((end - start))

# peak RSS (kB -> MB), null if unavailable
peak_rss_mb="null"
if [ -f "$time_log" ]; then
    kb="$(awk -F': ' '/Maximum resident set size/ {print $2; exit}' "$time_log" | tr -dc '0-9' || true)"
    [ -n "$kb" ] && peak_rss_mb="$(awk -v k="$kb" 'BEGIN { printf "%.0f", k/1024 }')"
fi

if [ "$build_rc" -ne 0 ]; then
    [ -f "$time_log" ] && tail -n 40 "$time_log" >&2 || true
    log "WARNING: build/install failed (rc=$build_rc); measure lanes will find no binaries"
    emit_meta "false" "$build_seconds" "$peak_rss_mb"
    # Non-fatal: the measure lanes produce no results and aggregate.py skips the upload.
    exit 0
fi

emit_meta "true" "$build_seconds" "$peak_rss_mb"
log "Build complete: prefix=$PREFIX commit=$SHORT_COMMIT build_seconds=${build_seconds}s peak_rss_mb=${peak_rss_mb}"
