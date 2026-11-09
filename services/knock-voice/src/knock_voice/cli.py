import argparse
import json
import os
from .analyzer import Analyzer
from .backend import PellaBackend


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("analyze")
    run.add_argument("files", nargs="+")
    run.add_argument("--artifacts", default="artifacts")
    run.add_argument("--device", choices=["auto", "mps", "cpu"], default="auto")
    serve = sub.add_parser("serve")
    serve.add_argument("--host", choices=["127.0.0.1"], default="127.0.0.1")
    serve.add_argument("--port", type=int, default=18765)
    serve.add_argument("--artifacts", default="artifacts")
    args = parser.parse_args()
    if args.command == "serve":
        os.environ["KNOCK_ARTIFACTS"] = os.path.abspath(args.artifacts)
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
        import uvicorn
        uvicorn.run("knock_voice.api:app", host="127.0.0.1", port=args.port, workers=1, access_log=False)
        return
    import soundfile as sf
    analyzer = Analyzer(PellaBackend(args.artifacts, args.device))
    try:
        analyzer.start()
    except Exception:
        pass
    failed = not analyzer.ready
    for name in args.files:
        wav, sr = sf.read(name, dtype="float32")  # Existing fixtures only; no output audio.
        result = analyzer.analyze(wav, sr)
        failed |= result["label"] == "unable"
        print(json.dumps({"file": name, **result}, allow_nan=False))
    if failed:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
