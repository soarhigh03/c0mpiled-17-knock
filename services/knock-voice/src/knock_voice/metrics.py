import platform
import threading
import time
import psutil


def memory_snapshot():
    vm, swap = psutil.virtual_memory(), psutil.swap_memory()
    return {
        "process_rss_bytes": psutil.Process().memory_info().rss,
        "system_total_bytes": vm.total,
        "system_available_bytes": vm.available,
        "system_used_bytes": vm.used,
        "swap_used_bytes": swap.used,
    }


class MemorySampler:
    """Sample RSS during a phase; sampled peak may miss sub-50ms spikes."""
    def __enter__(self):
        self.before = memory_snapshot()
        self.peak = self.before["process_rss_bytes"]
        self.stop = threading.Event()
        def run():
            while not self.stop.wait(0.05):
                self.peak = max(self.peak, memory_snapshot()["process_rss_bytes"])
        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stop.set()
        self.thread.join()
        self.after = memory_snapshot()
        self.peak = max(self.peak, self.after["process_rss_bytes"])

    def report(self):
        return {"before": self.before, "after": self.after,
                "sampled_peak_rss_bytes": self.peak, "sample_interval_ms": 50}


def companions():
    found = []
    for proc in psutil.process_iter(["pid", "name", "memory_info"]):
        try:
            name = proc.info["name"] or ""
            if any(s in name.lower() for s in ("electron", "obs", "node", "knock")):
                found.append({"pid": proc.pid, "name": name,
                              "rss_bytes": proc.info["memory_info"].rss})
        except (psutil.AccessDenied, psutil.NoSuchProcess, AttributeError):
            continue
    return {"observed_processes": found, "os": platform.platform(),
            "note": "Process-name observations do not prove Electron, server and OBS are all running. RSS is not additive unified-memory use."}
