# Local voice analysis

The voice subsystem is capture → Electron IPC → an owned Python process on
`127.0.0.1`. Audio is bounded and processed in memory. It has no audio upload,
recording export, telemetry, or main UI score path. Production failures produce
`unable`; test doubles exist only in implementation tests.

## Integration boundary

`SdkKnockClient.attachMedia()` starts capture when the active call includes the
voice check; detaching stops it. Capture clones the call's physical microphone
track and owns only that clone. Native device classification must allow the
microphone; unknown or virtual devices fail closed.

Only `{ label, at }` reaches the client's local getter/subscribers. Diagnostics
remain in a bounded private voice report in memory. They are not added to
`KnockState`, the existing room publisher, activity logs, or server requests.

The shared `VoiceEvidence` contract requires `audioBase64` and the server has no
local-result input. Its status vocabulary also lacks `review`. That boundary is
deliberately unchanged: the server-backed voice row remains `not_run`. Eunwoo
must agree on a label-only result contract, trust/token semantics, and separate
local status presentation before connecting these local results to the session
publisher. A local Pass is not a server-signed identity assertion.

## Capture policy

An AudioWorklet processes actual device-rate microphone input into consecutive
16 kHz mono PCM16 windows of four seconds. Insufficient-speech windows are
skipped locally. There is one request in flight and at most two pending windows;
the oldest pending window is dropped when behind. Local subscribers can inspect
pending backlog, dropped windows, and skip reasons.

Aggregation starts `unable`. Three review windows among the latest five yield
`review`; three consecutive pass windows yield `pass`. Other outcomes retain the
previous label only while healthy and fresh. Evidence expires after **20 seconds**
measured from the capture timestamp, not response arrival. Failure, stale
evidence, or prolonged insufficient speech yields `unable`. Session replacement
clears history and queued buffers; old results cannot update the new session.

## Privacy review and consent

The supplied sidecar's temporary WAV and multipart handling were unsafe for the
requested memory-only policy. The new endpoint uses bounded raw WAV bodies and
`BytesIO`, without multipart spooling. Runtime model code must be reviewed local
source, never dynamically imported downloads. Codec tooling must use ffmpeg
pipes and never produce derived audio files.

This review covers the local voice path. The separate existing sonar SDK sends
derived microphone motion/energy measurements to the server; its face tracker
also loads model assets. No sonar or shared contract changes are included.
Browser/OS swap, crash dumps, and hardware-level behavior are outside an
application-level guarantee; the code creates no new audio files.

**The proposed consent claim remains pending** until the complete app audio path
and the eventual session integration have been checked for external transmission.

## Eunwoo handoff — copy changes not applied

- Challenge instruction: “Keep your face in view and keep talking.”
- Pre-join consent: “During the interview, Knock analyzes your voice on this device. Audio is not uploaded. Knock may also briefly change your screen color and play a high-frequency tone.”
- Voice row: “Listening · no clear synthetic signal” / “Synthetic speech suspected — review” / “Not enough speech to judge”.

No UI component, layout, CSS, or copy files are changed. App integration is
limited to `src/knock/sdkClient.ts`, `src/knock-native.d.ts`, dedicated `src/voice/`
modules, and Electron main/preload/lifecycle modules.

## Real-model validation

The initial `git pull --rebase` failed: `.git/FETCH_HEAD: Operation not permitted`.
Existing setup was reused; blocked downloads were not repeatedly retried. Prior
attempts found `pypi.org` and `huggingface.co` DNS unavailable, no cached weights,
and offline startup failed on missing `artifacts/manifest.json`. Real inference
cannot run without artifacts; implementation continued as requested.

The reviewed current upstream computation has been vendored, but its identity at
the pinned Pella revision could not be verified through available source URLs.
Production has an explicit code-review gate and remains unavailable until that
identity is verified. This is a second blocker even after downloading weights.
The complete existing root Python 3.12 environment was reused through an ignored
service `.venv` symlink; the earlier partial environment was preserved as
`.venv-incomplete`. No environment reinstall or repeated download was performed.

An actual offline launch through `services/knock-voice/.venv/bin/python` was
attempted. Uvicorn exited 3 because this session denies binding
`127.0.0.1:18766` with `[Errno 1] operation not permitted`. The child was reaped.
This checks the real command, not model readiness; localhost HTTP and Electron
end-to-end readiness remain blocked by that permission restriction.

| Sample | p_fake | Label | Device | Download | Load | Inference | Sampled peak memory with Electron |
|---|---|---|---|---|---|---|---|
| Real voice 1 | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured |
| Real voice 2 | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured |
| Real voice 3 | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured |
| English local TTS 1 | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured |
| English local TTS 2 | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured |
| English local TTS 3 | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured |

The 30-second normal-speech and at-least-20-second speaker/TTS demos were not
performed because real-model readiness was unavailable. Microphone capture was
not attempted for those evaluations. False-positive and missed-detection rates
remain unmeasured. Local `say` and `ffmpeg` executables are present; that does not
establish microphone access or working inference. Implementation tests do not
validate model accuracy or real-time performance.

## Implementation validation

- Repository `npm run typecheck` and `npm run lint`: passed.
- Repository `npm test`: 53 tests passed, including native lifecycle/security,
  capture resource cleanup, actual candidate-client label-only integration,
  aggregation, freshness, bounded queues, dropped windows, and session reset.
- Sidecar Python unittest: 20 passed. Sidecar Node boundary tests: 3 passed.
  These use explicit backend doubles and mathematical fixtures; none establish
  real model accuracy. The Python test client emits a dependency deprecation
  warning; it does not affect the passing results.
- Vite production build: passed for renderer, worklet, Electron main and preload.
- Actual ffmpeg pipe-only Opus 16/24 kbps roundtrips: passed on a synthetic sine
  fixture; each returned 64,000 finite samples at 16 kHz, with no audio files.
  This is codec plumbing verification, not speech or model validation.
- Bootstrap shell syntax and `git diff --check`: passed.
- `packages/server` and `packages/shared`: unchanged.

Blocked validation remains real-model startup/inference, Electron memory under
load, six real-voice/TTS measurements, microphone demo, and live localhost HTTP.

## Delivery status

Work is on `feature/voice-analysis`. Final staging and commit both failed with
`Unable to create '.git/index.lock': Operation not permitted`. The implementation
is present in the working tree and is not committed. Push was not attempted
after that failure, to avoid presenting an older branch head as delivery of these
changes. The earlier session's push also failed resolving `github.com`. Existing
untracked root `.venv/` and `knock-voice/` were preserved.

## Changed-file manifest

- `apps/login-demo/electron/main.ts`
- `apps/login-demo/electron/preload.ts`
- `apps/login-demo/electron/voice.ts`
- `apps/login-demo/src/knock-native.d.ts`
- `apps/login-demo/src/knock/sdkClient.ts`
- `apps/login-demo/src/voice-capture.test.ts`
- `apps/login-demo/src/voice-native.test.ts`
- `apps/login-demo/src/voice/README.md`
- `apps/login-demo/src/voice/capture-worklet.ts`
- `apps/login-demo/src/voice/capture.ts`
- `apps/login-demo/src/voice/controller.test.ts`
- `apps/login-demo/src/voice/controller.ts`
- `apps/login-demo/src/voice/dsp.test.ts`
- `apps/login-demo/src/voice/dsp.ts`
- `apps/login-demo/src/voice/types.ts`
- `docs/voice-analysis.md`
- `services/knock-voice/.gitignore`
- `services/knock-voice/LOCAL_RUN_REPORT.md`
- `services/knock-voice/PROVENANCE.md`
- `services/knock-voice/README.md`
- `services/knock-voice/REVIEWED_SOURCE_SHA256.json`
- `services/knock-voice/integration/voice-client.proposed.mjs`
- `services/knock-voice/pyproject.toml`
- `services/knock-voice/requirements.txt`
- `services/knock-voice/scripts/bootstrap_mac.sh`
- `services/knock-voice/scripts/download_models.py`
- `services/knock-voice/scripts/evaluate.py`
- `services/knock-voice/scripts/prepare_opus.py`
- `services/knock-voice/src/knock_voice/analyzer.py`
- `services/knock-voice/src/knock_voice/api.py`
- `services/knock-voice/src/knock_voice/backend.py`
- `services/knock-voice/src/knock_voice/cli.py`
- `services/knock-voice/src/knock_voice/contracts.py`
- `services/knock-voice/src/knock_voice/metrics.py`
- `services/knock-voice/src/knock_voice/vendor/__init__.py`
- `services/knock-voice/src/knock_voice/vendor/pella.py`
- `services/knock-voice/tests/test_contract_quality_http.py`
- `services/knock-voice/tests/test_evaluation.py`
- `services/knock-voice/tests/test_voice_client.mjs`
