"""Contract/gate tests with mathematical signals and an explicit test double.

No tests in this file measure Pella accuracy or use a person's voice.
"""
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
import numpy as np
from scipy.io import wavfile

from knock_voice.analyzer import Analyzer
from knock_voice.api import create_app
from knock_voice.backend import PellaBackend
from knock_voice.contracts import outcome, ui_view
from knock_voice.quality import inspect_audio


SR = 16000


def signal(seconds=4):
    t = np.arange(round(SR * seconds)) / SR
    # Modulated harmonic signal, strictly an engineering fixture, not human speech.
    return (0.1 * (0.7 + 0.3 * np.sin(2 * np.pi * 3 * t)) * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def wav_bytes(x=None, sr=SR):
    f = io.BytesIO()
    wavfile.write(f, sr, (signal() * 32767).astype(np.int16) if x is None else x)
    return f.getvalue()


class BackendDouble:
    model_id = "test-double-NOT-PELLA"
    threshold = 0.5
    score_name = "p_fake"
    def __init__(self, score=.8, error=False):
        self.score, self.error = score, error
        self.loads = self.calls = 0
        self.startup = {}
    def start(self):
        self.loads += 1
        return {}
    def infer(self, path):
        self.calls += 1
        if self.error:
            raise RuntimeError("deliberate test failure")
        return self.score, {"inference_ms": 1, "device": "test-double"}


class Gates(unittest.TestCase):
    def test_empty_short_and_silence_are_unable(self):
        for x, expected in [(np.array([]), "too_short"), (signal(3.99), "too_short"),
                            (np.zeros(64000), "silence_or_very_low_level")]:
            self.assertEqual(inspect_audio(x, SR)[0], expected)

    def test_noise_clipping_sparse_and_nonfinite_are_unable(self):
        rng = np.random.default_rng(28)
        self.assertEqual(inspect_audio(rng.normal(0, .1, 64000), SR)[0], "stationary_broadband_noise")
        clipped = signal()
        clipped[:4000] = 1
        self.assertEqual(inspect_audio(clipped, SR)[0], "severe_clipping")
        sparse = signal()
        sparse[:50000] = 0
        self.assertEqual(inspect_audio(sparse, SR)[0], "insufficient_active_audio")
        bad = signal()
        bad[0] = np.nan
        self.assertEqual(inspect_audio(bad, SR)[0], "invalid_audio")

    def test_quality_inspects_official_center_not_speech_at_edges(self):
        x = np.concatenate([signal(), np.zeros(64000), signal()])
        self.assertEqual(inspect_audio(x, SR)[0], "silence_or_very_low_level")
        self.assertIsNone(inspect_audio(signal(), SR)[0])

    def test_threshold_boundary_and_invalid_scores(self):
        self.assertEqual(outcome(.5)["decision"], "Review")
        self.assertEqual(outcome(.49999)["decision"], "Pass")
        for score in [None, float("nan"), float("inf"), -1, 2]:
            self.assertEqual(outcome(score)["decision"], "Unable")

    def test_model_reuse_and_quality_bypass(self):
        backend = BackendDouble()
        a = Analyzer(backend)
        a.start()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "fixture.wav"
            path.write_bytes(wav_bytes())
            for i in range(2):
                self.assertEqual(a.analyze(path, signal(), SR, "abc123", "s", str(i))["decision"], "Review")
            r = a.analyze(path, np.zeros(64000), SR, "abc123", "s", "silent")
        self.assertEqual(r["decision"], "Unable")
        self.assertIsNone(r["report"]["model_score"])
        self.assertEqual((backend.loads, backend.calls), (1, 2))

    def test_unavailable_exception_and_busy_never_pass(self):
        for backend, start, busy in [(BackendDouble(), False, False),
                                      (BackendDouble(error=True), True, False),
                                      (BackendDouble(), True, True)]:
            a = Analyzer(backend)
            if start: a.start()
            if busy: a.lock.acquire()
            r = a.analyze(Path("unused"), signal(), SR, "r", "s", "a")
            if busy: a.lock.release()
            self.assertEqual(r["decision"], "Unable")


class HTTP(unittest.TestCase):
    def setUp(self):
        self.backend = BackendDouble()
        self.client = TestClient(create_app(Analyzer(self.backend)))
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def post(self, data=None, **ids):
        return self.client.post("/v1/analyze", files={"audio": ("fixture.wav", wav_bytes() if data is None else data, "audio/wav")},
            data={"room_code": "abc123", "session_id": "s1", "segment_id": "seg1", **ids})

    def test_room_binding_and_main_ui_score_allowlist(self):
        r = self.post()
        self.assertEqual(r.status_code, 200)
        result = r.json()
        self.assertEqual(result["room_code"], "abc123")
        self.assertEqual(result["session_id"], "s1")
        self.assertEqual(result["report"]["model_score"]["value"], .8)
        self.assertEqual(set(ui_view(result)), {"room_code", "session_id", "segment_id", "decision", "label", "reason"})
        self.assertEqual(self.client.get("/health").status_code, 200)

    def test_invalid_format_and_limits(self):
        for data in [b"not audio", wav_bytes(sr=48000), wav_bytes(np.zeros((64000, 2), np.int16)),
                     wav_bytes(np.zeros(64000, np.float32)), wav_bytes(np.zeros(13 * SR, np.int16))]:
            self.assertEqual(self.post(data).status_code, 422)
        self.assertEqual(self.post(b"x" * 1_000_001).status_code, 413)
        self.assertEqual(self.post(room_code="../../secret").status_code, 422)

    def test_short_or_silent_valid_wav_is_unable(self):
        r = self.post(wav_bytes(np.zeros(64000, np.int16)))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["decision"], "Unable")
        self.assertEqual(self.backend.calls, 0)

    def test_inflight_request_backpressure(self):
        self.client.app.state.accepting = True
        self.assertEqual(self.post().status_code, 429)

    def test_missing_model_health_unable(self):
        a = Analyzer(BackendDouble())
        a.backend.start = lambda: (_ for _ in ()).throw(FileNotFoundError())
        with TestClient(create_app(a)) as client:
            self.assertEqual(client.get("/health").status_code, 503)
            r = client.post("/v1/analyze", files={"audio": ("fixture.wav", wav_bytes(), "audio/wav")},
                data={"room_code": "abc123", "session_id": "s1", "segment_id": "seg1"})
            self.assertEqual(r.json()["reason"], "model_unavailable")


class DeviceFallback(unittest.TestCase):
    def test_runtime_mps_error_moves_same_model_and_stays_on_cpu(self):
        b = PellaBackend("unused")
        class Model:
            def __init__(self): self.moves = []
            def to(self, where): self.moves.append(where)
        class MPS:
            def empty_cache(self): pass
        class Torch:
            mps = MPS()
        class Official:
            def load_clip(self, path): return signal()
        b.torch, b.official = Torch(), Official()
        b.model = Model()
        original_model = b.model
        b.device = "mps"
        calls = []
        def forward(wav):
            calls.append(b.device)
            if b.device == "mps":
                raise NotImplementedError("simulated unsupported op")
            return .9
        b._forward = forward
        b._sync = lambda: None
        with patch("knock_voice.backend.gc.collect"):
            score, report = b.infer("unused")
            b.infer("unused")
        self.assertEqual(score, .9)
        self.assertEqual(calls, ["mps", "cpu", "cpu"])
        self.assertIs(b.model, original_model)
        self.assertEqual(b.model.moves, ["cpu"])
        self.assertIsNotNone(report["failed_mps_attempt_ms"])


if __name__ == "__main__":
    unittest.main()
