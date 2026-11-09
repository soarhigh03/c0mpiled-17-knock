#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import platform, sys
if sys.version_info[:2] not in [(3,11),(3,12),(3,13)]:
    raise SystemExit('Use Python 3.11–3.13 (3.12 recommended for this candidate environment).')
if platform.system() != 'Darwin' or platform.machine() != 'arm64':
    raise SystemExit('This bootstrap targets Apple Silicon macOS. Install requirements manually for another target.')
PY
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pip install -e . --no-deps
.venv/bin/python scripts/download_models.py
.venv/bin/python -m unittest discover -s tests -v
