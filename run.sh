#!/bin/sh
set -eu

if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' 'Loopra needs Python 3 to serve its local files.' >&2
  exit 1
fi

LOOPRA_DIR=$(python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).resolve().parent)' "$0")
cd "$LOOPRA_DIR"
exec python3 "$LOOPRA_DIR/scripts/serve.py" --no-open
