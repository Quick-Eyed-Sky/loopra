#!/bin/zsh
set -e

LOOPRA_DIR="${0:A:h}"
cd "$LOOPRA_DIR"
if ! command -v python3 >/dev/null 2>&1; then
  print 'Loopra needs Python 3. Install it, then open this launcher again.'
  exit 1
fi
exec python3 "$LOOPRA_DIR/scripts/serve.py" --open
