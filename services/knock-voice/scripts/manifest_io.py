import json
from pathlib import Path


def read_samples(filename):
    source = Path(filename).resolve()
    data = json.loads(source.read_text())
    samples = data["samples"]
    if not samples:
        raise ValueError("Manifest has no samples. Supply consenting team members' recordings.")
    ids = set()
    for row in samples:
        if row.get("consent") is not True or row.get("team_member") is not True:
            raise ValueError("Every sample must explicitly record team_member=true and consent=true")
        if row.get("kind") not in ("human", "tts", "vc") or row.get("capture") not in ("direct", "speaker_mic"):
            raise ValueError("Require kind=human/tts/vc and capture=direct/speaker_mic")
        if row.get("codec", "original") not in ("original", "opus16k", "opus24k"):
            raise ValueError("Unknown codec condition")
        if not row.get("speaker_id") or not row.get("id") or row["id"] in ids:
            raise ValueError("Require unique id and speaker_id")
        ids.add(row["id"])
        row["path"] = str((source.parent / row["path"]).resolve())
        if not Path(row["path"]).is_file():
            raise FileNotFoundError(row["path"])
    return samples
