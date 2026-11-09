"""Download only public official artifacts, pinned to observed full commit IDs.

No inference, training or third-party voice samples. Run once on the target Mac.
"""
import argparse
from datetime import datetime, timezone
import importlib.metadata
import json
from pathlib import Path
import platform
import subprocess
import sys
import time

from huggingface_hub import snapshot_download
from knock_voice.backend import sha256

PELLA_REPO = "Sadanie/pellav2-audio-deepfake-detector"
PELLA_REV = "b668eb4dfe4719665692c73c1d70383680afff6b"
BACKBONE_REPO = "facebook/w2v-bert-2.0"
BACKBONE_REV = "da985ba0987f70aaeb84a80f2851cfac8c697a7b"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--output", default="artifacts")
    args = p.parse_args()
    root = Path(args.output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    phases, files = {}, []
    for label, repo, rev, names in [
        ("pella", PELLA_REPO, PELLA_REV, ["pellav2_detector.pt", "config.json", "README.md"]),
        ("backbone", BACKBONE_REPO, BACKBONE_REV, ["config.json", "model.safetensors", "README.md"]),
    ]:
        previously_present = {name: (root / label / name).is_file() for name in names}
        t = time.perf_counter()
        snapshot_download(repo_id=repo, revision=rev, local_dir=root / label, allow_patterns=names)
        phases[label] = {"download_or_cache_ms": (time.perf_counter() - t) * 1000,
                         "files_present_before_run": previously_present}
        for name in names:
            if not (root / label / name).is_file():
                raise RuntimeError(f"Missing expected artifact: {label}/{name}")
            files.append(f"{label}/{name}")
    t = time.perf_counter()
    hashes = {name: sha256(root / name) for name in files}
    phases["hash_ms"] = (time.perf_counter() - t) * 1000
    versions = {}
    for name in ["torch", "torchaudio", "transformers", "numpy", "scipy", "soundfile", "pyloudnorm",
                 "huggingface-hub", "fastapi", "uvicorn", "psutil"]:
        versions[name] = importlib.metadata.version(name)
    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "pella_repo": PELLA_REPO, "pella_revision": PELLA_REV,
        "backbone_repo": BACKBONE_REPO, "backbone_revision": BACKBONE_REV,
        "license_metadata": {"pella": "mit", "backbone": "mit",
            "evidence": "Public model-card metadata checked 2026-11-09. Keep downloaded README files; no standalone LICENSE was listed in the inspected trees."},
        "sha256": hashes, "download": phases,
        "artifact_bytes": {name: (root / name).stat().st_size for name in files},
        "environment": {"python": sys.version, "platform": platform.platform(), "packages": versions},
    }
    tmp = root / "manifest.tmp"
    tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(root / "manifest.json")
    (root / "environment.freeze.txt").write_text(subprocess.check_output([sys.executable, "-m", "pip", "freeze"], text=True))
    print(json.dumps({"manifest": str(root / "manifest.json"), "download": phases}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
