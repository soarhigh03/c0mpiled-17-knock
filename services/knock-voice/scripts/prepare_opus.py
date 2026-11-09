"""Original -> Opus 16/24 kbps -> 16k mono PCM16 WAV. Not a real-call test."""
import argparse
import json
from pathlib import Path
import subprocess
from manifest_io import read_samples


def main():
    p = argparse.ArgumentParser()
    p.add_argument("manifest")
    p.add_argument("--output", default="evaluation/opus")
    args = p.parse_args()
    samples = read_samples(args.manifest)
    dest = Path(args.output).resolve()
    dest.mkdir(parents=True, exist_ok=True)
    output = []
    for i, row in enumerate(samples):
        row.setdefault("codec", "original")
        if row["codec"] != "original":
            raise ValueError("Input manifest must contain only originals")
        output.append(row)
        for bitrate in (16, 24):
            # Numeric filenames prevent sample identifiers from becoming paths.
            encoded = dest / f"{i:03d}-{bitrate}k.opus"
            decoded = dest / f"{i:03d}-{bitrate}k.wav"
            subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", row["path"],
                            "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", f"{bitrate}k",
                            "-application", "voip", str(encoded)], check=True)
            subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(encoded),
                            "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(decoded)], check=True)
            output.append(row | {"id": f"{row['id']}-opus{bitrate}k", "source_id": row["id"],
                                 "codec": f"opus{bitrate}k", "path": str(decoded)})
    versions = subprocess.check_output(["ffmpeg", "-version"], text=True).splitlines()[0]
    (dest / "manifest.json").write_text(json.dumps({"ffmpeg": versions, "samples": output}, ensure_ascii=False, indent=2) + "\n")
    print(dest / "manifest.json")


if __name__ == "__main__":
    main()
