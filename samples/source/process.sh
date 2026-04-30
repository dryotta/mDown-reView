#!/usr/bin/env bash
# Sample shell script — exercises Shiki shellscript.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${ROOT}/logs"
SAMPLES="${ROOT}/samples"

usage() {
    cat <<USAGE
Usage: $(basename "$0") [--verbose] [--out DIR] FILE...

Process FILE(s) and write results to DIR (default: $LOG_DIR).

Options:
  -v, --verbose        Verbose output
  -o, --out DIR        Output directory
  -h, --help           Show this help and exit
USAGE
}

VERBOSE=0
OUT="$LOG_DIR"
declare -a FILES=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        -v|--verbose) VERBOSE=1; shift ;;
        -o|--out)     OUT="$2"; shift 2 ;;
        -h|--help)    usage; exit 0 ;;
        --)           shift; FILES+=("$@"); break ;;
        -*)           echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
        *)            FILES+=("$1"); shift ;;
    esac
done

[[ ${#FILES[@]} -gt 0 ]] || { echo "no files" >&2; exit 2; }
mkdir -p "$OUT"

for f in "${FILES[@]}"; do
    if [[ ! -f "$f" ]]; then
        echo "skip (not a file): $f" >&2
        continue
    fi
    base=$(basename "$f" | sed 's/\.[^.]*$//')
    out_path="$OUT/${base}.processed"
    [[ $VERBOSE -eq 1 ]] && echo "process: $f -> $out_path"
    cp -- "$f" "$out_path"
done

echo "done — processed ${#FILES[@]} file(s) into $OUT"
