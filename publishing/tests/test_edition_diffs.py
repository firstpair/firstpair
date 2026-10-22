from __future__ import annotations

import sys
import unittest
from pathlib import Path

PUBLISHING = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PUBLISHING / "vault"))

from edition_diffs import SCHEMA, diffs_file, page_diffs  # noqa: E402


class EditionDiffsTest(unittest.TestCase):
    def test_pairs_and_set(self) -> None:
        entry = page_diffs(
            {"a": "один два три", "b": "один четыре три", "c": "один два три"},
            ["a", "b", "c"],
        )
        self.assertEqual(entry["a|b"], {"a": [[5, 8, "del"]], "b": [[5, 11, "ins"]]})
        self.assertEqual(entry["a|c"], {"a": [], "c": []})
        # "два" is in a and c only; "четыре" is b's alone.
        self.assertEqual(entry["a|b|c"], {
            "a": [[5, 8, "share:c"]], "b": [[5, 11, "uniq"]], "c": [[5, 8, "share:a"]],
        })

    def test_phrases_merge_and_offsets_are_code_points(self) -> None:
        entry = page_diffs({"a": "𝔄 старый дом стоял", "b": "𝔄 новый белый дом стоял"}, ["a", "b"])
        text = "𝔄 новый белый дом стоял"
        [(start, end, kind)] = entry["a|b"]["b"]
        self.assertEqual((text[start:end], kind), ("новый белый", "ins"))

    def test_identical_pages_are_omitted(self) -> None:
        self.assertEqual(page_diffs({"a": "x y", "b": "x y"}, ["a", "b"]), {})
        data = diffs_file({"p": page_diffs({"a": "x", "b": "y"}, ["a", "b"]), "q": {}}, ["a", "b"])
        self.assertEqual((data["schema"], list(data["pages"])), (SCHEMA, ["p"]))


if __name__ == "__main__":
    unittest.main()
