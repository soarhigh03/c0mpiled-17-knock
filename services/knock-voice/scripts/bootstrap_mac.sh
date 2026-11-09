#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Reuse an existing complete environment (including a deliberate symlink).
if [[ -x .venv/bin/python ]]; then
  runtime=.venv/bin/python
else
  runtime="${PYTHON:-$(command -v python3.12 || command -v python3)}"
fi
"$runtime" - <<'PY'
import platform, sys
if sys.version_info[:2] not in [(3,11),(3,12),(3,13)]:
    raise SystemExit('Use Python 3.11–3.13 (3.12 recommended). Set PYTHON for a new environment.')
if platform.system() != 'Darwin' or platform.machine() != 'arm64':
    raise SystemExit('This bootstrap targets Apple Silicon macOS.')
PY
if [[ ! -x .venv/bin/python ]]; then
  "$runtime" -m venv .venv
fi
# No pip upgrade/reinstall when the environment already has the requirements.
if ! .venv/bin/python - <<'PY'
import fastapi, uvicorn, torch, torchaudio, transformers, numpy, scipy, soundfile, pyloudnorm, huggingface_hub, psutil
assert torch.__version__.split('+')[0] == torchaudio.__version__.split('+')[0] == '2.8.0'
PY
then
  .venv/bin/python -m pip install -r requirements.txt
fi
export PYTHONPATH="$PWD/src${PYTHONPATH:+:$PYTHONPATH}"
if [[ -f artifacts/manifest.json ]]; then
  .venv/bin/python - <<'PY'
import json
from pathlib import Path
from knock_voice.backend import sha256, PELLA_REV, BACKBONE_REV
root = Path('artifacts').resolve()
manifest = json.loads((root/'manifest.json').read_text())
assert manifest['pella_revision'] == PELLA_REV and manifest['backbone_revision'] == BACKBONE_REV
required = {'pella/pellav2_detector.pt','pella/config.json','backbone/config.json','backbone/model.safetensors'}
assert required.issubset(manifest['sha256'])
for name in required:
    path = (root/name).resolve()
    assert path.is_relative_to(root) and sha256(path) == manifest['sha256'][name], 'Artifact integrity failure; do not overwrite automatically'
print('Reusing verified local artifacts; no download.')
PY
else
  mkdir -p artifacts
  if [[ -e artifacts/.download-attempted ]]; then
    echo 'A model download was already attempted. Resolve the recorded blocker before deliberately removing artifacts/.download-attempted to retry.' >&2
    exit 1
  fi
  touch artifacts/.download-attempted
  HF_HUB_ETAG_TIMEOUT=5 HF_HUB_DOWNLOAD_TIMEOUT=10 .venv/bin/python scripts/download_models.py
fi
.venv/bin/python -m unittest discover -s tests -v
