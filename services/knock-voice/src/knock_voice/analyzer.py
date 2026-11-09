"""Single model, startup warmup, bounded private in-memory diagnostics."""
from collections import deque
import math
import threading
import time
import numpy as np
from .metrics import MemorySampler
from .quality import inspect_audio


def unable(reason, latency=0):
    return {"label": "unable", "modelScore": None, "reason": reason, "latencyMs": latency}


class Analyzer:
    def __init__(self, backend):
        self.backend = backend
        self.lock = threading.Lock()
        self.ready = False
        self.status = "starting"
        self.startup_error = None
        self.report = deque(maxlen=150)

    def start(self):
        with self.lock:
            if self.ready:
                return
            self.status = "starting"
            try:
                self.backend.start()
                t = time.perf_counter()
                # Warm-up is synthetic input, never a classification or measured clip.
                wave = (.01 * np.sin(np.arange(64000) * (2 * np.pi * 220 / 16000))).astype(np.float32)
                score, _ = self.backend.infer(wave, 16000)
                if not isinstance(score, (int, float)) or not math.isfinite(score) or not 0 <= score <= 1:
                    raise ValueError("warmup produced invalid model score")
                self.backend.startup["warmup_ms"] = (time.perf_counter() - t) * 1000
                self.ready, self.status, self.startup_error = True, "ready", None
            except Exception as exc:
                self.ready, self.status = False, "unavailable"
                self.startup_error = type(exc).__name__ + ": " + str(exc)[:300]
                raise

    def analyze(self, wav, sr):
        t = time.perf_counter()
        elapsed = lambda: (time.perf_counter() - t) * 1000
        if not self.lock.acquire(blocking=False):
            return unable("analyzer_busy", elapsed())
        try:
            if not self.ready:
                return unable("voice analyzer not running", elapsed())
            reason, quality = inspect_audio(wav, sr)
            if reason:
                result = unable(reason, elapsed())
                self.report.append({"at": time.time(), "result": result.copy(), "quality": quality})
                return result
            with MemorySampler() as memory:
                try:
                    score, detail = self.backend.infer(wav, sr)
                    if not isinstance(score, (int, float)) or not math.isfinite(score) or not 0 <= score <= 1:
                        raise ValueError("invalid model score")
                    result = {"label": "review" if score >= self.backend.threshold else "pass", "modelScore": score,
                              "reason": None, "latencyMs": elapsed()}
                except Exception as exc:
                    self.ready, self.status = False, "unavailable"
                    result = unable("model_error", elapsed())
                    detail = {"error_type": type(exc).__name__}
            self.report.append({"at": time.time(), "result": result.copy(), "quality": quality, "detail": detail, "memory": memory.report()})
            return result
        finally:
            self.lock.release()
