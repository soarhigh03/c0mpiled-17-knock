"""Explicit doubles and mathematical fixtures, NOT real-model validation."""
import asyncio
import io
import time
import threading
import unittest
from unittest.mock import patch
import numpy as np
from fastapi.testclient import TestClient
from scipy.io import wavfile
from knock_voice.analyzer import Analyzer
from knock_voice.api import create_app, decode_segment
from knock_voice.backend import PellaBackend
from knock_voice.contracts import outcome
from knock_voice.metrics import memory_snapshot, MemorySampler
from knock_voice.quality import inspect_audio

SR = 16000

def signal(seconds=4):
    t = np.arange(round(SR * seconds)) / SR
    return (.1 * (.7 + .3 * np.sin(2*np.pi*3*t)) * np.sin(2*np.pi*220*t)).astype(np.float32)


def wav_bytes(x=None, sr=SR):
    stream = io.BytesIO()
    wavfile.write(stream, sr, (signal()*32767).astype(np.int16) if x is None else x)
    return stream.getvalue()


class BackendDouble:
    model_id, threshold, score_name = "EXPLICIT-TEST-DOUBLE-NOT-PELLA", .5, "p_fake"
    def __init__(self, score=.8, error=False):
        self.score, self.error, self.loads, self.calls, self.startup = score, error, 0, 0, {}
    def start(self):
        self.loads += 1
    def infer(self, wav, sr):
        self.calls += 1
        assert isinstance(wav, np.ndarray) and sr == SR
        if self.error:
            raise RuntimeError("deliberate test failure")
        return self.score, {"device": "TEST-DOUBLE", "inference_ms": 1}


class Gates(unittest.TestCase):
    def test_short_silent_noisy_clipped_sparse_invalid(self):
        noise = np.random.default_rng(28).normal(0, .1, 64000)
        clipped = signal(); clipped[:4000] = 1
        sparse = signal(); sparse[:50000] = 0
        bad = signal(); bad[0] = np.nan
        for x, expected in [(np.array([]), "too_short"), (signal(3.99), "too_short"),
            (np.zeros(64000), "silence_or_very_low_level"), (noise, "stationary_broadband_noise"),
            (clipped, "severe_clipping"), (sparse, "insufficient_active_audio"), (bad, "invalid_audio")]:
            self.assertEqual(inspect_audio(x, SR)[0], expected)
        self.assertIsNone(inspect_audio(signal(), SR)[0])

    def test_threshold_and_invalid_score(self):
        for score in (None, float("nan"), float("inf"), -1, 2):
            self.assertEqual(outcome(score)["decision"], "Unable")
        self.assertEqual(outcome(.5)["decision"], "Review")

    def test_one_load_one_warmup_quality_bypass(self):
        b = BackendDouble(); a = Analyzer(b)
        a.start(); a.start()
        self.assertEqual((b.loads, b.calls), (1, 1))
        self.assertIn("warmup_ms", b.startup)
        self.assertEqual(a.analyze(signal(), SR)["label"], "review")
        self.assertEqual(a.analyze(np.zeros(64000), SR)["label"], "unable")
        self.assertEqual(b.calls, 2)

    def test_startup_and_inference_errors_fail_closed(self):
        a = Analyzer(BackendDouble(error=True))
        with self.assertRaises(RuntimeError): a.start()
        self.assertEqual(a.status, "unavailable")
        self.assertEqual(a.analyze(signal(), SR)["label"], "unable")
        b = BackendDouble(); a = Analyzer(b); a.start(); b.error = True
        self.assertEqual(a.analyze(signal(), SR)["label"], "unable")
        self.assertFalse(a.ready)
        self.assertEqual(a.analyze(signal(), SR)["label"], "unable")

    def test_invalid_warmup_never_ready(self):
        a = Analyzer(BackendDouble(score=float("nan")))
        with self.assertRaises(ValueError): a.start()
        self.assertEqual(a.status, "unavailable")

    def test_model_gate_blocks_unreviewed_pinned_source(self):
        with self.assertRaisesRegex(RuntimeError, "pinned source identity"):
            PellaBackend("unused").start()

    def test_sampling_thread_failure_does_not_break_inference(self):
        with patch("knock_voice.metrics.threading.Thread.start", side_effect=RuntimeError("denied")):
            with MemorySampler() as memory: pass
            self.assertIn("RuntimeError", memory.report()["sampling_thread_unavailable_reason"])

    def test_busy_never_pass(self):
        a = Analyzer(BackendDouble(score=.1)); a.start(); a.lock.acquire()
        try: self.assertEqual(a.analyze(signal(), SR)["label"], "unable")
        finally: a.lock.release()

    def test_optional_metrics_null_and_reason(self):
        with patch("knock_voice.metrics.psutil.swap_memory", side_effect=OSError("blocked")):
            snapshot = memory_snapshot()
            self.assertIsNone(snapshot["swap_used_bytes"])
            self.assertIn("swap", snapshot["unavailable_reasons"])
            with MemorySampler() as memory: pass
            self.assertIn("sampled_peak_rss_bytes", memory.report())
        with patch("knock_voice.metrics.psutil.Process", side_effect=PermissionError("blocked")):
            with MemorySampler() as memory: pass
            self.assertIsNone(memory.report()["sampled_peak_rss_bytes"])
            self.assertIsNotNone(memory.report()["unavailable_reason"])


class HTTP(unittest.TestCase):
    def setUp(self):
        self.backend = BackendDouble()
        self.analyzer = Analyzer(self.backend)
        self.analyzer.start()
        self.client = TestClient(create_app(self.analyzer, token="secret"))
        self.client.__enter__()
        self.headers = {"Authorization": "Bearer secret", "Content-Type": "audio/wav"}
    def tearDown(self): self.client.__exit__(None, None, None)
    def post(self, data=None):
        return self.client.post("/analyze-window", content=wav_bytes() if data is None else data, headers=self.headers)

    def test_memory_only_raw_contract(self):
        # Any attempt to create audio files fails the request/test.
        with patch("builtins.open", side_effect=AssertionError("no disk audio")), patch("tempfile.TemporaryFile", side_effect=AssertionError("no spooling")):
            result = self.post()
        self.assertEqual(result.status_code, 200)
        self.assertEqual(set(result.json()), {"label", "modelScore", "reason", "latencyMs"})
        self.assertEqual(result.json()["modelScore"], .8)
        self.assertEqual(self.client.get("/health", headers=self.headers).json()["status"], "ready")

    def test_invalid_formats_limits_and_no_multipart(self):
        for data in (b"bad", wav_bytes(sr=48000), wav_bytes(np.zeros((64000,2), np.int16)), wav_bytes(np.zeros(64000,np.float32)), wav_bytes(np.zeros(70000,np.int16))):
            self.assertIn(self.post(data).status_code, (413,422))
        self.assertEqual(self.post(b"x"*136001).status_code,413)
        self.assertEqual(self.client.post("/v1/analyze", files={"audio":("x.wav",wav_bytes())}, headers=self.headers).status_code,404)

    def test_chunked_body_limit(self):
        def chunks():
            yield b"x" * 70000
            yield b"x" * 70000
        response = self.client.post("/analyze-window", content=chunks(), headers=self.headers)
        self.assertEqual(response.status_code, 413)
        self.assertFalse(self.client.app.state.accepting)

    def test_silence_and_backpressure(self):
        self.assertEqual(self.post(wav_bytes(np.zeros(64000,np.int16))).json()["label"],"unable")
        self.client.app.state.accepting = True
        self.assertEqual(self.post().status_code,429)

    def test_auth_and_browser_block(self):
        self.assertEqual(self.client.get("/health").status_code,401)
        self.assertEqual(self.client.get("/health",headers=self.headers | {"Origin":"http://localhost"}).status_code,403)

    def test_health_waits_for_load_and_warmup(self):
        entered, release = threading.Event(), threading.Event()
        backend = BackendDouble()
        original_infer = backend.infer
        def slow_warmup(wav, sr):
            entered.set()
            release.wait(2)
            return original_infer(wav, sr)
        backend.infer = slow_warmup
        analyzer = Analyzer(backend)
        with TestClient(create_app(analyzer, token="")) as client:
            try:
                self.assertTrue(entered.wait(1))
                self.assertEqual(client.get("/health").json()["status"], "starting")
                self.assertEqual(client.get("/health").status_code, 503)
            finally:
                release.set()
            deadline = time.monotonic() + 1
            while analyzer.status == "starting" and time.monotonic() < deadline:
                time.sleep(.005)
            self.assertEqual(client.get("/health").json()["status"], "ready")
            self.assertEqual((backend.loads, backend.calls), (1, 1))

    def test_starting_and_unavailable_health(self):
        a = Analyzer(BackendDouble()); c=TestClient(create_app(a,token=""))
        self.assertEqual(c.get("/health").json()["status"],"starting")
        a.status="unavailable"
        self.assertEqual(c.get("/health").status_code,503)
        self.assertEqual(c.post("/analyze-window",content=wav_bytes()).json()["label"],"unable")


class DeviceFallback(unittest.TestCase):
    def test_same_model_cpu_retry_once(self):
        b=PellaBackend("unused"); b.preprocess=lambda wav,sr:wav
        class Model:
            def __init__(self): self.moves=[]
            def to(self,where): self.moves.append(where)
        class MPS:
            def empty_cache(self): pass
        class Torch: mps=MPS()
        b.torch=Torch(); b.model=Model(); original=b.model; b.device="mps"
        calls=[]
        def forward(wav):
            calls.append(b.device)
            if b.device=="mps": raise NotImplementedError("test double unsupported op")
            return .9
        b._forward=forward; b._sync=lambda:None
        score,detail=b.infer(signal(),SR); b.infer(signal(),SR)
        self.assertEqual(calls,["mps","cpu","cpu"])
        self.assertIs(b.model,original); self.assertEqual(b.model.moves,["cpu"])
        self.assertIsNotNone(detail["failed_mps_attempt_ms"])
        self.assertEqual(score,.9)

if __name__=="__main__": unittest.main()
