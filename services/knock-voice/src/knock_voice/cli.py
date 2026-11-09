import argparse
import json
from pathlib import Path
import sys

from .analyzer import Analyzer
from .backend import PellaBackend
from .contracts import outcome


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("analyze")
    run.add_argument("files", nargs="+")
    run.add_argument("--artifacts", default="artifacts")
    run.add_argument("--device", choices=["auto", "mps", "cpu"], default="auto")
    serve = sub.add_parser("serve")
    serve.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.command == "serve":
        import uvicorn
        uvicorn.run("knock_voice.api:app", host="127.0.0.1", port=args.port, workers=1, access_log=False)
        return
    import soundfile as sf
    analyzer = Analyzer(PellaBackend(args.artifacts, args.device))
    try:
        analyzer.start()
        print(json.dumps({"startup": analyzer.backend.startup}, ensure_ascii=False), file=sys.stderr)
    except Exception as exc:
        print(json.dumps({"startup_failed": type(exc).__name__, "detail": str(exc)[:500]}), file=sys.stderr)
    failed = not analyzer.ready
    for i, name in enumerate(args.files):
        try:
            wav, sr = sf.read(name, dtype="float32")
            result = analyzer.analyze(Path(name), wav, sr, "cli", "file-test", str(i))
        except Exception as exc:
            result = outcome(reason="invalid_audio") | {"report": {"error_type": type(exc).__name__}}
        failed |= result["decision"] == "Unable"
        print(json.dumps({"file": name, **result}, ensure_ascii=False, allow_nan=False))
    if failed:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
