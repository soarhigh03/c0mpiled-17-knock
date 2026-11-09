"""Reviewed upstream computation, adapted only for local init and array input.

Source: Sadanie/pellav2-audio-deepfake-detector/raw/main/pellav2_infer.py,
reviewed 2026-11-09. Exact pinned-source identity remains pending (see PROVENANCE).
No Hub client, path decoder, CLI, dynamic imports, or network execution.
"""
import numpy as np
import torch
import torch.nn as nn

SR = 16000
CROP = 4 * SR
TARGET_LUFS = -23.0


class Detector(nn.Module):
    def __init__(self, backbone_path):
        super().__init__()
        from transformers import Wav2Vec2BertModel
        self.backbone = Wav2Vec2BertModel.from_pretrained(backbone_path, local_files_only=True)
        self.layer_weights = nn.Parameter(torch.zeros(self.backbone.config.num_hidden_layers + 1))
        self.head = nn.Linear(self.backbone.config.hidden_size, 1)

    @staticmethod
    def features(wav):
        import torchaudio.compliance.kaldi as K
        feats, lens = [], []
        with torch.autocast(device_type=wav.device.type, enabled=False):
            for x in wav.float():
                nz = torch.nonzero(x).flatten()
                n_s = int(nz[-1]) + 1 if len(nz) else len(x)
                f = K.fbank(x[None, :max(n_s, 400)] * 32768.0, num_mel_bins=80,
                            sample_frequency=SR, dither=0.0, window_type="povey")
                f = (f - f.mean(0, keepdim=True)) / torch.sqrt(f.var(0, keepdim=True) + 1e-7)
                n = f.shape[0] // 2 * 2
                feats.append(f[:n].reshape(n // 2, 160))
                lens.append(n // 2)
        F = max(lens)
        out = torch.zeros(len(feats), F, 160, device=wav.device)
        mask = torch.zeros(len(feats), F, dtype=torch.long, device=wav.device)
        for i, (f, n) in enumerate(zip(feats, lens)):
            out[i, :n] = f
            mask[i, :n] = 1
        return out, mask

    def forward(self, wav):
        feats, mask = self.features(wav)
        hs = self.backbone(input_features=feats, attention_mask=mask,
                           output_hidden_states=True).hidden_states
        w = torch.softmax(self.layer_weights, dim=0)
        h = torch.stack(hs).mul(w[:, None, None, None]).sum(0)
        m = mask[:, :, None].float()
        h = (h * m).sum(1) / m.sum(1).clamp(min=1)
        return self.head(h).squeeze(-1)


def loudness(x):
    try:
        import pyloudnorm as pyln
        if len(x) >= int(0.4 * SR):
            v = pyln.Meter(SR).integrated_loudness(x.astype(np.float64))
            if np.isfinite(v):
                return float(v)
    except Exception:
        pass
    return float(20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9) - 0.691)


def preprocess(wav, sr):
    import torchaudio
    from scipy.signal import butter, sosfiltfilt
    wav = np.asarray(wav, dtype=np.float32)
    if wav.ndim > 1:
        wav = wav.mean(axis=1)
    if sr != SR:
        wav = torchaudio.functional.resample(torch.from_numpy(wav), sr, SR).numpy()
    wav = wav - wav.mean()
    if len(wav) > 3 * SR // 100:
        wav = sosfiltfilt(butter(2, 20.0, btype="highpass", fs=SR, output="sos"), wav)
    wav = wav.astype(np.float32)
    if len(wav) > CROP:
        off = (len(wav) - CROP) // 2
        wav = wav[off:off + CROP]
    if len(wav):
        gain = float(np.clip(TARGET_LUFS - loudness(wav), -40.0, 40.0))
        wav = np.clip(wav * 10 ** (gain / 20), -1.0, 1.0).astype(np.float32)
    if len(wav) < CROP:
        wav = np.concatenate([wav, np.zeros(CROP - len(wav), np.float32)])
    return wav
