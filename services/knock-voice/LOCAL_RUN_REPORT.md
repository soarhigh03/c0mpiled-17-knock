> Historical Step 0 import attempt. Superseded by README.md and PROVENANCE.md for current implementation and validation.

# Local Step 0 attempt — 2026-11-09

Historical first attempt. The continued implementation and current validation
status are documented in [the integration report](../../docs/voice-analysis.md)
and the current service README.

Stopped during Step 0 within the five-minute timebox. Steps 1–3 have not been implemented.

## Checkout and installation

- Current branch: `feature/voice-analysis`.
- Initial `git pull --rebase` failed: `cannot open '.git/FETCH_HEAD': Operation not permitted`. Staging succeeded; commit and push are attempted separately.
- Extracted the supplied archive into `services/knock-voice`. Existing root `.venv/` and `knock-voice/` were preserved.
- Read bootstrap and README before execution. Used Python 3.12 via `/opt/homebrew/opt/python@3.12/libexec/bin` on PATH, because default Python 3.14 is unsupported.
- Bootstrap created the service virtual environment but exited 1 installing dependencies: DNS resolution for `pypi.org` failed, leaving torch unavailable in that new environment.
- Tried the download script separately using the existing root Python 3.12 environment, which already has dependencies. It exited 1: DNS resolution for `huggingface.co` failed; no cached snapshot was found.
- Model weights were not downloaded. Offline startup with `HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1` using the existing root environment exited 1: `FileNotFoundError` for `artifacts/manifest.json`. Offline inference is not verified.

## Safety review

- Bootstrap uses a virtual environment, pip, model download, and tests; no sudo or destructive commands were found.
- The supplied HTTP endpoint writes audio into a temporary `segment.wav`; deleting it afterward does not satisfy memory-only handling. Multipart uploads can also spool to disk. Do not use this API for candidate audio until replaced with a bounded in-memory path.
- Backend preprocessing currently accepts a filesystem path. It must be adapted and verified before recording or evaluating candidate speech.
- Model startup executes downloaded `pellav2_infer.py`. Its revision is pinned, but the downloaded code could not be reviewed in this session. Hashes generated after download provide subsequent integrity checking.

## Actual checks

Ran from the service directory using existing root dependencies:

```sh
PYTHONPATH=src ../../.venv/bin/python -m unittest discover -s tests -v
node --test tests/test_voice_client.mjs
```

- Python: 14 tests, 11 passed, 3 errors. `psutil.swap_memory()` raises `OSError` in this restricted macOS session. Affected tests: `test_model_reuse_and_quality_bypass`, `test_unavailable_exception_and_busy_never_pass`, `test_room_binding_and_main_ui_score_allowlist`.
- Node adapter: 3 tests passed.
- These tests use model doubles; they do not establish real Pella accuracy or performance.
- No candidate audio was captured or processed. The three real-voice clips, three English TTS clips, Electron memory measurement, and normal-speech/TTS speaker demo were not performed. Scores, device, download/load/inference times, and peak memory are unavailable.
- App typecheck, lint, and tests were not run because work stopped at the Step 0 gate.
- UI files touched: none.

## Eunwoo handoff — do not apply as part of this change

- Challenge: remove the read-aloud phrase; use “Keep your face in view and keep talking.”
- Pre-join consent: “During the interview, Knock analyzes your voice on this device. Audio is not uploaded. Knock may also briefly change your screen color and play a high-frequency tone.”
- Voice row: “Listening · no clear synthetic signal” / “Synthetic speech suspected — review” / “Not enough speech to judge”.
