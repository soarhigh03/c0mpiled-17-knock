"""Official model math and preprocessing, with a pinned local backbone initializer."""
import gc
import hashlib
import importlib.util
import json
from pathlib import Path
import time

from .metrics import MemorySampler


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


class PellaBackend:
    model_id = "pella-v2"
    threshold = 0.5
    score_name = "p_fake"
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
        startup_started = time.perf_counter()
        import torch
        import torch.nn as nn
        from transformers import Wav2Vec2BertModel
        self.torch = torch
        manifest = json.loads((self.artifacts / "manifest.json").read_text())
        t = time.perf_counter()
        for name, expected in manifest["sha256"].items():
            target = (self.artifacts / name).resolve()
            if not target.is_relative_to(self.artifacts) or sha256(target) != expected:
                raise RuntimeError("Artifact checksum mismatch")
        integrity_ms = (time.perf_counter() - t) * 1000
        spec = importlib.util.spec_from_file_location("knock_pellav2_official", self.artifacts / "pella/pellav2_infer.py")
        official = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(official)
        if (official.SR, official.CROP, official.TARGET_LUFS) != (16000, 64000, -23.0):
            raise RuntimeError("Unexpected official preprocessing constants; review required")
        backbone_path = str(self.artifacts / "backbone")
        class PinnedDetector(official.Detector):
            def __init__(self):
                # Only initialization differs: same pretrained backbone, pinned and local.
                nn.Module.__init__(self)
                self.backbone = Wav2Vec2BertModel.from_pretrained(
                    backbone_path, local_files_only=True)
                self.layer_weights = nn.Parameter(torch.zeros(self.backbone.config.num_hidden_layers + 1))
                self.head = nn.Linear(self.backbone.config.hidden_size, 1)
        t = time.perf_counter()
        with MemorySampler() as mem:
            model = PinnedDetector()
            state = torch.load(self.artifacts / "pella/pellav2_detector.pt", map_location="cpu",
                               weights_only=True, mmap=True)
            model.load_state_dict(state, strict=True)
            del state
            model.eval()
            self.device = "mps" if self.requested_device != "cpu" and torch.backends.mps.is_available() else "cpu"
            if self.requested_device == "mps" and self.device == "cpu":
                self.fallback_reason = "mps_unavailable"
            try:
                model.to(self.device)
                if self.device == "mps":
                    torch.mps.synchronize()
            except (RuntimeError, NotImplementedError) as exc:
                if self.device != "mps":
                    raise
                self.fallback_reason = type(exc).__name__ + ": " + str(exc)[:300]
                self.device = "cpu"
                model.to("cpu")
                gc.collect()
                torch.mps.empty_cache()
            self.model = model
            self.official = official
        self.startup = {
            "integrity_check_ms": integrity_ms,
            "load_ms": (time.perf_counter() - t) * 1000,
            "load_memory": mem.report(),
            "model_revision": manifest["pella_revision"],
            "backbone_revision": manifest["backbone_revision"],
            "sha256": manifest["sha256"],
            "download": manifest["download"],
            "environment": manifest["environment"],
            "device_requested": self.requested_device,
            "startup_wall_ms": (time.perf_counter() - startup_started) * 1000,
        }
        return self.startup

    def _sync(self):
        if self.device == "mps":
            self.torch.mps.synchronize()

    def _forward(self, wav):
        torch = self.torch
        x = torch.from_numpy(wav)[None].to(self.device)
        with torch.inference_mode():
            return torch.sigmoid(self.model(x)).item()

    def infer(self, path):
        t = time.perf_counter()
        wav = self.official.load_clip(str(path))
        preprocess_ms = (time.perf_counter() - t) * 1000
        self._sync()
        t = time.perf_counter()
        failed_attempt_ms = None
        try:
            score = self._forward(wav)
            self._sync()
        except (RuntimeError, NotImplementedError) as exc:
            if self.device != "mps":
                raise
            failed_attempt_ms = (time.perf_counter() - t) * 1000
            self.fallback_reason = type(exc).__name__ + ": " + str(exc)[:300]
            # Reuse exactly the same weights/model; future calls remain on CPU.
            self.model.to("cpu")
            self.device = "cpu"
            gc.collect()
            self.torch.mps.empty_cache()
            t = time.perf_counter()
            score = self._forward(wav)
        inference_ms = (time.perf_counter() - t) * 1000
        report = {"preprocess_ms": preprocess_ms, "inference_ms": inference_ms,
                  "failed_mps_attempt_ms": failed_attempt_ms, "device": self.device,
                  "fallback_reason": self.fallback_reason, "first_inference": self.calls == 0}
        self.calls += 1
        if self.device == "mps":
            report["mps_current_allocated_bytes"] = self.torch.mps.current_allocated_memory()
            report["mps_driver_allocated_bytes"] = self.torch.mps.driver_allocated_memory()
        return float(score), report
