"""Optional platform metrics must never control inference success."""
import platform
import threading
import psutil


def memory_snapshot():
    result = {k: None for k in ("process_rss_bytes", "system_total_bytes", "system_available_bytes", "system_used_bytes", "swap_used_bytes")}
    errors = {}
    for name, read in (
        ("process", lambda: {"process_rss_bytes": psutil.Process().memory_info().rss}),
        ("virtual", lambda: dict(zip(("system_total_bytes", "system_available_bytes", "system_used_bytes"), (lambda v: (v.total, v.available, v.used))(psutil.virtual_memory())))),
        ("swap", lambda: {"swap_used_bytes": psutil.swap_memory().used}),
    ):
        try:
            result.update(read())
        except Exception as exc:
            errors[name] = type(exc).__name__ + ": " + str(exc)[:160]
    return result | {"unavailable_reasons": errors}


class MemorySampler:
    """RSS sampled every 50ms; null means unavailable, never zero."""
    def _sample(self):
        snapshot = memory_snapshot()
        rss = snapshot["process_rss_bytes"]
        if rss is not None:
            self.peak = rss if self.peak is None else max(self.peak, rss)
        return snapshot

    def __enter__(self):
        self.peak = None
        self.before = self._sample()
        self.stop = threading.Event()
        def run():
            while not self.stop.wait(.05):
                self._sample()
        self.thread = threading.Thread(target=run, daemon=True)
        self.thread_error = None
        try:
            self.thread.start()
        except (RuntimeError, OSError) as exc:
            self.thread_error = type(exc).__name__ + ": " + str(exc)[:160]
        return self

    def __exit__(self, *_):
        self.stop.set()
        if self.thread.is_alive():
            try:
                self.thread.join(timeout=1)
            except (RuntimeError, OSError) as exc:
                self.thread_error = type(exc).__name__ + ": " + str(exc)[:160]
        self.after = self._sample()

    def report(self):
        return {"before": self.before, "after": self.after, "sampled_peak_rss_bytes": self.peak,
                "sample_interval_ms": 50, "sampling_thread_unavailable_reason": self.thread_error, "unavailable_reason": None if self.peak is not None else "process RSS unavailable"}


def companions():
    found, error = [], None
    try:
        for proc in psutil.process_iter(["pid", "name", "memory_info"]):
            try:
                name = proc.info["name"] or ""
                if any(s in name.lower() for s in ("electron", "obs", "node", "knock")):
                    info = proc.info["memory_info"]
                    found.append({"pid": proc.pid, "name": name, "rss_bytes": info.rss if info else None})
            except (psutil.Error, OSError, AttributeError):
                continue
    except (psutil.Error, OSError) as exc:
        error = type(exc).__name__
    return {"observed_processes": found, "unavailable_reason": error, "os": platform.platform(),
            "note": "Process names do not prove companion apps are running; RSS is not additive unified memory."}
