"""Pinned local weights and repository-reviewed model; no downloaded executable code."""
import gc
import hashlib
import json
from pathlib import Path
import time
from .metrics import MemorySampler

PELLA_REV = "b668eb4dfe4719665692c73c1d70383680afff6b"
BACKBONE_REV = "da985ba0987f70aaeb84a80f2851cfac8c697a7b"
# Fail closed until the reviewed upstream/main source is verified against PELLA_REV.
# This is a code-review gate, not an environment variable or runtime bypass.
REVIEWED_PINNED_SOURCE = False


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


class PellaBackend:
    model_id, threshold, score_name = "pella-v2", 0.5, "p_fake"

    def __init__(self, artifacts, device="auto"):
        if device not in ("auto", "mps", "cpu"):
            raise ValueError("device must be auto, mps or cpu")
        self.artifacts = Path(artifacts).resolve()
        self.requested_device = device
        self.model = None
        self.fallback_reason = None
        self.calls = 0
        self.startup = {}

    def start(self):
        if self.model is not None:
            return self.startup
        if not REVIEWED_PINNED_SOURCE:
            raise RuntimeError("upstream pinned source identity not verified; see PROVENANCE.md")
        startup_started = time.perf_counter()
        import torch
        from .vendor.pella import Detector, preprocess
        self.torch, self.preprocess = torch, preprocess
        manifest = json.loads((self.artifacts / "manifest.json").read_text())
        if manifest["pella_revision"] != PELLA_REV or manifest["backbone_revision"] != BACKBONE_REV:
            raise RuntimeError("Unexpected artifact revisions")
        required = {"pella/pellav2_detector.pt", "pella/config.json", "backbone/config.json", "backbone/model.safetensors"}
        if not required.issubset(manifest["sha256"]):
            raise RuntimeError("Incomplete artifact manifest")
        t = time.perf_counter()
        for name in required:
            target = (self.artifacts / name).resolve()
            if not target.is_relative_to(self.artifacts) or sha256(target) != manifest["sha256"][name]:
                raise RuntimeError("Artifact checksum mismatch")
        integrity_ms = (time.perf_counter() - t) * 1000
        t = time.perf_counter()
        with MemorySampler() as memory:
            model = Detector(str(self.artifacts / "backbone"))
            state = torch.load(self.artifacts / "pella/pellav2_detector.pt", map_location="cpu", weights_only=True, mmap=True)
            model.load_state_dict(state, strict=True)
            del state
            model.eval()
            self.device = "mps" if self.requested_device != "cpu" and torch.backends.mps.is_available() else "cpu"
            if self.device == "cpu" and self.requested_device != "cpu":
                self.fallback_reason = "mps_unavailable"
            try:
                model.to(self.device)
                self._sync()
            except (RuntimeError, NotImplementedError) as exc:
                if self.device != "mps":
                    raise
                self._fallback(model, exc)
            self.model = model
        self.startup = {"integrity_check_ms": integrity_ms, "load_ms": (time.perf_counter() - t) * 1000,
                        "load_memory": memory.report(), "model_revision": PELLA_REV, "backbone_revision": BACKBONE_REV,
                        "download": manifest.get("download"), "environment": manifest.get("environment"),
                        "startup_wall_ms": (time.perf_counter() - startup_started) * 1000}
        return self.startup

    def _sync(self):
        if self.device == "mps":
            self.torch.mps.synchronize()

    def _fallback(self, model, exc):
        self.fallback_reason = type(exc).__name__ + ": " + str(exc)[:300]
        model.to("cpu")
        self.device = "cpu"
        gc.collect()
        try:
            self.torch.mps.empty_cache()
        except (RuntimeError, AttributeError):
            pass

    def _forward(self, wav):
        x = self.torch.from_numpy(wav)[None].to(self.device)
        with self.torch.inference_mode():
            return self.torch.sigmoid(self.model(x)).item()

    def infer(self, wav, sr):
        t = time.perf_counter()
        wav = self.preprocess(wav, sr)
        preprocess_ms = (time.perf_counter() - t) * 1000
        t = time.perf_counter()
        failed_attempt_ms = None
        try:
            self._sync()
            score = self._forward(wav)
            self._sync()
        except (RuntimeError, NotImplementedError) as exc:
            if self.device != "mps":
                raise
            failed_attempt_ms = (time.perf_counter() - t) * 1000
            self._fallback(self.model, exc)
            t = time.perf_counter()
            score = self._forward(wav)
        report = {"preprocess_ms": preprocess_ms, "inference_ms": (time.perf_counter() - t) * 1000,
                  "failed_mps_attempt_ms": failed_attempt_ms, "device": self.device,
                  "fallback_reason": self.fallback_reason, "first_inference": self.calls == 0}
        self.calls += 1
        return float(score), report
