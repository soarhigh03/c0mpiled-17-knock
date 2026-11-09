import sys
from pathlib import Path
import unittest
from unittest.mock import patch
import subprocess
import numpy as np

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
from prepare_opus import opus_roundtrip
from evaluate import summarize
from manifest_io import read_samples


class Evaluation(unittest.TestCase):
    def test_unable_excluded_from_scored_denominators_and_coverage_retained(self):
        base = {"capture": "direct", "codec": "original"}
        rows = [base | {"kind": kind, "decision": decision} for kind, decision in [
            ("human", "Review"), ("human", "Unable"), ("tts", "Pass"), ("vc", "Unable")]]
        s = summarize(rows)["direct/original"]
        self.assertEqual((s["false_positive"], s["false_negative"], s["unable"]), (1, 1, 2))
        self.assertEqual((s["human_scored"], s["synthetic_scored"]), (1, 1))
        self.assertEqual(s["coverage"], .5)

    def test_example_cannot_be_evaluated_without_real_consent(self):
        with self.assertRaisesRegex(ValueError, "consent=true"):
            read_samples(SCRIPTS.parent / "evaluation/manifest.example.json")

    def test_codec_uses_pipes_and_creates_no_audio_files(self):
        calls = []
        def fake_run(command, **kwargs):
            calls.append((command, kwargs))
            output = b"encoded" if len(calls) == 1 else np.zeros(64000, dtype="<f4").tobytes()
            return subprocess.CompletedProcess(command, 0, stdout=output, stderr=b"")
        with patch("prepare_opus.subprocess.run", side_effect=fake_run), patch("builtins.open", side_effect=AssertionError("no disk")):
            wav, sr = opus_roundtrip(np.zeros(64000, dtype=np.float32), 16000, 16)
        self.assertEqual((len(wav), sr), (64000, 16000))
        self.assertEqual(len(calls), 2)
        for command, kwargs in calls:
            self.assertEqual(command[-1], "pipe:1")
            self.assertIn("pipe:0", command)
            self.assertEqual(kwargs["stdout"], subprocess.PIPE)
