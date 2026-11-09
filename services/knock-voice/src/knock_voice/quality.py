"""Provisional quality gates on raw audio, BEFORE official loudness normalization.

These are signal heuristics, not a speech detector or a validated SNR estimator.
"""
from dataclasses import asdict, dataclass
import numpy as np


@dataclass(frozen=True)
class QualityPolicy:
    min_duration_s: float = 4.0
    silence_dbfs: float = -55.0
    active_frame_dbfs: float = -45.0
    min_active_s: float = 2.5
    max_clip_fraction: float = 0.02
    noise_flatness: float = 0.45
    noise_dynamic_range_db: float = 6.0


def inspect_audio(wav, sr: int, policy=QualityPolicy()):
    x = np.asarray(wav, dtype=np.float64)
    if x.ndim == 2:
        x = x.mean(axis=1)
    metrics = {"policy_version": "provisional-1", "policy": asdict(policy)}
    if x.ndim != 1 or sr <= 0 or not np.isfinite(x).all():
        return "invalid_audio", metrics
    metrics["duration_s"] = len(x) / sr
    if len(x) < round(policy.min_duration_s * sr):
        return "too_short", metrics
    # Same central window as official load_clip; do not select a better sounding crop.
    crop = 4 * sr
    offset = max(0, (len(x) - crop) // 2)
    x = x[offset:offset + crop]
    metrics["window_start_s"] = offset / sr
    metrics["clip_fraction"] = float(np.mean(np.abs(x) >= 0.999))
    x = x - x.mean()
    rms = float(np.sqrt(np.mean(x * x)))
    metrics["rms_dbfs"] = float(20 * np.log10(max(rms, 1e-12)))
    if metrics["rms_dbfs"] < policy.silence_dbfs:
        return "silence_or_very_low_level", metrics
    if metrics["clip_fraction"] >= policy.max_clip_fraction:
        return "severe_clipping", metrics
    frame = round(0.03 * sr)
    frames = x[:len(x) // frame * frame].reshape(-1, frame)
    powers = np.mean(frames * frames, axis=1)
    db = 10 * np.log10(np.maximum(powers, 1e-24))
    metrics["energy_active_s"] = float(np.sum(db >= policy.active_frame_dbfs) * frame / sr)
    if metrics["energy_active_s"] < policy.min_active_s:
        return "insufficient_active_audio", metrics
    spectrum = np.abs(np.fft.rfft(frames * np.hanning(frame), axis=1)) ** 2
    freq = np.fft.rfftfreq(frame, 1 / sr)
    spectrum = np.maximum(spectrum[:, (freq >= 80) & (freq <= min(7600, sr / 2))], 1e-24)
    flatness = np.exp(np.mean(np.log(spectrum), axis=1)) / np.mean(spectrum, axis=1)
    metrics["median_spectral_flatness"] = float(np.median(flatness))
    metrics["energy_dynamic_range_db"] = float(np.percentile(db, 90) - np.percentile(db, 10))
    if (metrics["median_spectral_flatness"] >= policy.noise_flatness
            and metrics["energy_dynamic_range_db"] < policy.noise_dynamic_range_db):
        return "stationary_broadband_noise", metrics
    return None, metrics
