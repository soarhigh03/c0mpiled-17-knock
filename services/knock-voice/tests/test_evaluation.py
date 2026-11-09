import importlib.util
import sys
from pathlib import Path
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
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
