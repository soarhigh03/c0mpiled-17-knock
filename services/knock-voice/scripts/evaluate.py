"""Consented labeled evaluation; rows with Unable never count as successful detection."""
import argparse
from collections import defaultdict
import csv
import json
from pathlib import Path
import platform
import time

from manifest_io import read_samples
from knock_voice.analyzer import Analyzer
from knock_voice.backend import PellaBackend
from knock_voice.contracts import outcome
from knock_voice.metrics import companions, memory_snapshot


def summarize(rows):
    groups = defaultdict(lambda: {"human_total": 0, "synthetic_total": 0, "human_scored": 0,
        "synthetic_scored": 0, "false_positive": 0, "false_negative": 0, "unable": 0})
    for row in rows:
        key = row["capture"] + "/" + row["codec"]
        g = groups[key]
        human = row["kind"] == "human"
        g["human_total" if human else "synthetic_total"] += 1
        if row["decision"] == "Unable":
            g["unable"] += 1
            continue
        g["human_scored" if human else "synthetic_scored"] += 1
        g["false_positive"] += int(human and row["decision"] == "Review")
        g["false_negative"] += int(not human and row["decision"] == "Pass")
    for g in groups.values():
        g["false_positive_rate_among_scored"] = g["false_positive"] / g["human_scored"] if g["human_scored"] else None
        g["false_negative_rate_among_scored"] = g["false_negative"] / g["synthetic_scored"] if g["synthetic_scored"] else None
        total = g["human_total"] + g["synthetic_total"]
        g["coverage"] = (total - g["unable"]) / total
    return dict(groups)


def main():
    import soundfile as sf
    p = argparse.ArgumentParser()
    p.add_argument("manifest")
    p.add_argument("--artifacts", default="artifacts")
    p.add_argument("--device", choices=["auto", "mps", "cpu"], default="auto")
    p.add_argument("--output", default="evaluation/run")
    p.add_argument("--repeats", type=int, default=3)
    p.add_argument("--companion-apps-running", action="store_true",
                   help="Operator confirms Electron app, server and OBS are concurrently running")
    args = p.parse_args()
    if args.repeats < 1:
        p.error("repeats must be positive")
    samples = read_samples(args.manifest)
    dest = Path(args.output)
    dest.mkdir(parents=True, exist_ok=True)
    analyzer = Analyzer(PellaBackend(args.artifacts, args.device))
    context = {"operator_confirmed_companion_apps_running": args.companion_apps_running,
               "observations": companions(), "before_loading": memory_snapshot(),
               "target_context_declared": args.companion_apps_running and platform.system() == "Darwin"
                   and 14 * 1024**3 <= memory_snapshot()["system_total_bytes"] <= 18 * 1024**3}
    t = time.perf_counter()
    try:
        analyzer.start()
    except Exception as exc:
        (dest / "startup-failure.json").write_text(json.dumps({"error_type": type(exc).__name__,
            "startup_wall_ms": (time.perf_counter() - t) * 1000, "context": context}, indent=2))
        raise
    results, flat = [], []
    # Alternate repeated samples to separate first inference from steady-state reuse.
    for repeat in range(args.repeats):
        for sample in samples:
            try:
                wav, sr = sf.read(sample["path"], dtype="float32")
                result = analyzer.analyze(Path(sample["path"]), wav, sr, "evaluation", "local", sample["id"])
            except Exception as exc:
                result = outcome(reason="invalid_audio") | {"report": {"error_type": type(exc).__name__}}
            results.append({"sample": sample, "repeat": repeat, "result": result})
            report = result["report"]
            score = report.get("model_score")
            flat.append({"id": sample["id"], "speaker_id": sample["speaker_id"], "kind": sample["kind"],
                "capture": sample["capture"], "codec": sample.get("codec", "original"), "repeat": repeat,
                "decision": result["decision"], "reason": result["reason"],
                "model_score": score["value"] if score else None,
                **{k: report.get(k) for k in ("device", "first_inference", "preprocess_ms", "inference_ms", "total_ms")}})
    first_repeat = [r for r in flat if r["repeat"] == 0]
    (dest / "results.json").write_text(json.dumps({"context": context, "startup": analyzer.backend.startup,
        "summary_first_repeat_only": summarize(first_repeat), "results": results,
        "limitations": "Codec variants and repeats are correlated. No confidence or population accuracy claim. Opus is not a real call."},
        ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    with (dest / "results.csv").open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(flat[0]))
        writer.writeheader()
        writer.writerows(flat)
    print(json.dumps(summarize(first_repeat), ensure_ascii=False, indent=2))
    print(dest / "results.json")


if __name__ == "__main__":
    main()
