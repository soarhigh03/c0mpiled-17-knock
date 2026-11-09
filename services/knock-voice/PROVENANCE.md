# Model source review and artifacts

Reviewed 2026-11-09:

- Source: https://huggingface.co/Sadanie/pellav2-audio-deepfake-detector/raw/main/pellav2_infer.py (120 lines).
- Reviewed features/forward: Kaldi 80-bin fbank, Povey, dither 0, per-frequency standardization, pairwise frame concat, hidden-state softmax weighting, masked pooling and linear head.
- Reviewed preprocessing: mono mean, torchaudio 16k resample, DC removal, order-2 20Hz highpass/sosfiltfilt, center 64,000 samples, −23 LUFS with ±40dB gain, clipping and zero padding.
- Vendored `src/knock_voice/vendor/pella.py` preserves this computation. Changes remove path reads/Hub downloads/CLI and accept arrays plus local backbone path. It is imported normally from the repository, never executed from artifacts.

**Unresolved exact-source identity:** attempts to read raw/blob/resolve URLs at `b668eb4dfe4719665692c73c1d70383680afff6b` and the corresponding Hub revision API failed through the web tool. The main API was also inaccessible. We cannot claim the reviewed `main` file equals that commit. `REVIEWED_PINNED_SOURCE=False` in backend.py fails production closed until a reviewer verifies the pinned source and commits the verified identity/hash (no runtime environment bypass).

Pinned intended weight revisions:

- Pella: `Sadanie/pellav2-audio-deepfake-detector@b668eb4dfe4719665692c73c1d70383680afff6b`.
- Backbone: `facebook/w2v-bert-2.0@da985ba0987f70aaeb84a80f2851cfac8c697a7b`.

The downloader fetches weights/config/model-card metadata only; no `.py` files. Manifest records revisions, file SHA-256, byte counts, download timings, Python/platform and installed dependency versions. Runtime enforces required artifact paths/hashes and intended revisions, `local_files_only=True`, and `torch.load(weights_only=True, mmap=True)` with strict state loading. No weights have been downloaded in this session, so actual artifact hashes/timings remain unmeasured. Hashes computed on first download protect subsequent integrity, not independent publisher authenticity.

License evidence inspected 2026-11-09: both upstream raw/main model cards declare `license: mit` in front matter:

- https://huggingface.co/Sadanie/pellav2-audio-deepfake-detector/raw/main/README.md
- https://huggingface.co/facebook/w2v-bert-2.0/raw/main/README.md

These are metadata declarations, not a substituted full license text or proof of pinned-card identity. The downloader preserves pinned README evidence and its hash when network becomes available. Upstream attribution: Sadanie, Pellav2 audio deepfake detector; Meta/Facebook, w2v-BERT 2.0.

`SOURCE_SHA256.json` describes the original archive, not changed local files. `REVIEWED_SOURCE_SHA256.json` records the vendored adaptation and observed local dependency versions separately.
