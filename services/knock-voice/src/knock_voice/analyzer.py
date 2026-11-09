import threading
import time
from .contracts import outcome
from .metrics import MemorySampler
from .quality import inspect_audio


class Analyzer:
    def __init__(self, backend):
        self.backend = backend
        self.lock = threading.Lock()
        self.ready = False
        self.startup_error = None

    def start(self):
        with self.lock:
            try:
                self.backend.start()
                self.ready = True
                self.startup_error = None
            except Exception as exc:
                self.ready = False
                self.startup_error = type(exc).__name__
                raise

    def analyze(self, path, wav, sr, room_code, session_id, segment_id):
        t = time.perf_counter()
        base = {"schema_version": "1.0", "room_code": room_code, "session_id": session_id,
                "segment_id": segment_id}
        reason, quality = inspect_audio(wav, sr)
        report = {"model": self.backend.model_id, "score_semantics": "model score; not a calibrated probability",
                  "threshold": self.backend.threshold, "quality": quality, "model_score": None}
        if reason:
            return base | outcome(reason=reason) | {"report": report | {"total_ms": (time.perf_counter() - t) * 1000}}
        if not self.lock.acquire(blocking=False):
            return base | outcome(reason="analyzer_busy") | {"report": report}
        try:
            if not self.ready:
                return base | outcome(reason="model_unavailable") | {"report": report}
            with MemorySampler() as mem:
                try:
                    score, detail = self.backend.infer(path)
                    decision = outcome(score, threshold=self.backend.threshold)
                    if decision["decision"] != "Unable":
                        report["model_score"] = {"name": self.backend.score_name, "value": score, "calibrated_probability": False}
                    report.update(detail)
                except Exception as exc:
                    decision = outcome(reason="model_error")
                    report["error_type"] = type(exc).__name__
            report.update({"memory": mem.report(), "total_ms": (time.perf_counter() - t) * 1000})
            return base | decision | {"report": report}
        finally:
            self.lock.release()
