# Knock local voice sidecar

Candidate audio stays in the local subsystem (AudioWorklet → Electron IPC → authenticated loopback HTTP → NumPy). No multipart parsing, upload spooling, temporary WAVs, audio logs, or external audio service. Raw bodies are decoded with `BytesIO`; original fixture files may be read. Runtime artifacts are local only. Scores and diagnostics stay in bounded private in-memory reports; only `{ label, at }` belongs in the KnockClient result path.

## Current validation status

Implementation tests use explicit model doubles and mathematical signals. **Real Pella inference is unvalidated and currently unavailable.** Package/model DNS downloads were blocked in this session, weights are missing, and the exact pinned upstream Python revision could not be retrieved. The reviewed model implementation from upstream `main` is vendored, but production explicitly refuses startup until its identity against the pinned revision has been reviewed and verified. See [PROVENANCE.md](PROVENANCE.md). Never bypass this gate with a simulated score or a default Pass.

## Installation and offline runtime

Read `scripts/bootstrap_mac.sh` before executing. It uses a Python 3.11–3.13 Apple Silicon virtual environment, pip, a one-time pinned artifact download, and tests. No sudo or destructive actions. Do not rerun successful setup or repeatedly retry blocked downloads. Dependency ranges are recorded alongside actual installed versions when download succeeds; there is no hashed dependency lock yet.

```sh
bash scripts/bootstrap_mac.sh
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 \
  KNOCK_VOICE_TOKEN='<process-secret>' PYTHONPATH=src \
  .venv/bin/python -m knock_voice.cli serve --host 127.0.0.1 --port 18765 --artifacts "$PWD/artifacts"
```

Production Electron sets a random per-process token; `Authorization: Bearer <token>` is required. Browser Origin requests are rejected and no CORS is enabled. The CLI accepts only the host `127.0.0.1`, with a single worker. Renderer HTTP access is not part of the design.

`GET /health` returns `{status: "starting" | "ready" | "unavailable", ready: boolean}`. Starting/unavailable are 503; ready is 200 only after one model load **and one warmup** both succeed. Warmup timing is separate from measured clip inference. Startup exceptions never yield Pass. No diagnostic HTTP endpoint is exposed.

`POST /analyze-window` accepts a raw PCM16, mono, 16kHz WAV body. Body limit 136,000 bytes; decoded limit 65,600 samples (4.1 seconds); input below four seconds fails the quality gate. Responses have exactly `{label: "review" | "pass" | "unable", modelScore, reason, latencyMs}`. Invalid format/oversize/busy return 422/413/429 with unable. Busy requests are rejected before buffering. Decode and preprocessing operate on arrays in memory. Scores are model outputs, **not calibrated probabilities**.

MPS is tried before CPU. RuntimeError/NotImplementedError during MPS transfer/forward/synchronization moves the same model to CPU and retries once; the fallback reason is retained locally. CPU errors mark the analyzer unavailable. Optional psutil metrics return null plus reasons when denied; they cannot break inference.

## Provisional quality gates

All gates inspect raw audio before loudness normalization. Four-second center window; duration ≥4s; DC-removed RMS ≥−55dBFS; at least 2.5s of 30ms frames above −45dBFS; clipping fraction <2%; stationary broadband noise is held if median spectral flatness ≥0.45 and frame-energy p90−p10 <6dB. These are provisional energy/noise heuristics, not validated VAD/SNR. Music, nonstationary noise, reverberation and quiet speech may be misclassified. Pass means no clear synthetic signal in a usable window, not identity verification.

## Tests and local evaluation

```sh
PYTHONPATH=src .venv/bin/python -m unittest discover -s tests -v
node --test tests/test_voice_client.mjs
```

Tests are implementation checks, not accuracy measurements. `scripts/evaluate.py` reads only existing consented original fixtures; `--opus` uses ffmpeg stdin/stdout pipes for encoded/decoded variants. It creates no audio files or report files; operator CLI output must not be connected to telemetry or the app UI. `scripts/prepare_opus.py` no longer creates prepared audio files. The Electron path never calls evaluation scripts.

Real validation still needs three consenting real-voice clips and three local English TTS clips, processed in memory, with Electron running. Download/load/warmup/clip-inference timings, device, sampled peak RSS, false positives and missed detections must be measured before making accuracy claims. Current values are **unmeasured**. The 30s speech and ≥20s TTS-through-speakers demo remains unperformed.

The inherited `checks/` and `VERIFICATION.md` are historical archive evidence, not results from the current implementation.
