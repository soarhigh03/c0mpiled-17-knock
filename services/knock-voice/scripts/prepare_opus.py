"""Codec evaluation using anonymous pipes only: no encoded/decoded files."""
import subprocess
import numpy as np


def opus_roundtrip(wav, sr, bitrate):
    if bitrate not in (16, 24):
        raise ValueError("supported bitrates: 16/24 kbps")
    wav = np.asarray(wav, dtype="<f4")
    channels = 1 if wav.ndim == 1 else wav.shape[1]
    encoded = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "f32le", "-ar", str(sr), "-ac", str(channels),
        "-i", "pipe:0", "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", f"{bitrate}k", "-application", "voip",
        "-f", "opus", "pipe:1"], input=wav.tobytes(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=30).stdout
    decoded = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", "pipe:0", "-ar", "16000", "-ac", "1", "-f", "f32le", "pipe:1"],
        input=encoded, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=30).stdout
    return np.frombuffer(decoded, dtype="<f4").copy(), 16000


if __name__ == "__main__":
    raise SystemExit("Use evaluate.py --opus; audio variants remain in memory, no prepared files are created.")
