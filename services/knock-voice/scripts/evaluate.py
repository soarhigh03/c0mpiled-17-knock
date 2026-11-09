"""Local fixture evaluation. No audio/score report files are created."""
import argparse
from collections import defaultdict
import json
import soundfile as sf
from manifest_io import read_samples
from prepare_opus import opus_roundtrip
from knock_voice.analyzer import Analyzer
from knock_voice.backend import PellaBackend
from knock_voice.metrics import companions


def summarize(rows):
    groups = defaultdict(lambda: {"human_total": 0, "synthetic_total": 0, "human_scored": 0,
        "synthetic_scored": 0, "false_positive": 0, "false_negative": 0, "unable": 0})
    for row in rows:
        g = groups[row["capture"] + "/" + row["codec"]]
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
    p = argparse.ArgumentParser()
    p.add_argument("manifest")
    p.add_argument("--artifacts", default="artifacts")
    p.add_argument("--device", choices=["auto", "mps", "cpu"], default="auto")
    p.add_argument("--opus", action="store_true")
    p.add_argument("--companion-apps-running", action="store_true")
    args = p.parse_args()
    samples = read_samples(args.manifest)
    analyzer = Analyzer(PellaBackend(args.artifacts, args.device))
    analyzer.start()
    report = {"startup": analyzer.backend.startup, "operator_confirmed_companions": args.companion_apps_running,
              "companions": companions(), "results": []}
    for sample in samples:
        wav, sr = sf.read(sample["path"], dtype="float32")  # Existing consented originals only.
        variants = [("original", wav, sr)]
        if args.opus:
            variants.extend((f"opus{bitrate}k", *opus_roundtrip(wav, sr, bitrate)) for bitrate in (16, 24))
        for codec, audio, rate in variants:
            result = analyzer.analyze(audio, rate)
            report["results"].append({"id": sample["id"], "kind": sample["kind"], "codec": codec, **result,
                                      "private_detail": analyzer.report[-1] if analyzer.report else None})
    # Explicit operator-only CLI; never called by Electron, telemetry, or main UI.
    print(json.dumps(report, allow_nan=False))


if __name__ == "__main__":
    main()
