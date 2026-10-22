from __future__ import annotations

import sys
import unittest
from pathlib import Path

PUBLISHING = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PUBLISHING / "vault"))

from edition_diffs import SCHEMA, build_diffs, page_diffs  # noqa: E402

FUNCTION = ("и", "в", "на", "что")


class EditionDiffsTest(unittest.TestCase):
    def test_pairs_and_set(self) -> None:
        entry = page_diffs(
            {"a": "один два три", "b": "один четыре три", "c": "один два три"},
            ["a", "b", "c"],
        )
        self.assertEqual(entry["a|b"], {"a": [[5, 8, "del", "lexical"]], "b": [[5, 11, "ins", "lexical"]]})
        self.assertEqual(entry["a|c"], {"a": [], "c": []})
        # "два" is in a and c only; "четыре" is b's alone.  Set ranges carry
        # no category: the history lens, not the kind, narrows them.
        self.assertEqual(entry["a|b|c"], {
            "a": [[5, 8, "share:c"]], "b": [[5, 11, "uniq"]], "c": [[5, 8, "share:a"]],
        })

    def test_categories(self) -> None:
        lemma = {"старой": "старый", "старая": "старый"}.get

        def cat(a: str, b: str) -> str:
            entry = page_diffs({"a": a, "b": b}, ["a", "b"],
                               lemmatize=lambda w: lemma(w, w), function_words=FUNCTION)
            return entry["a|b"]["b"][0][3] if entry["a|b"]["b"] else entry["a|b"]["a"][0][3]

        self.assertEqual(cat("Дом стоял, и всё.", "Дом стоял — и всё."), "punct")
        self.assertEqual(cat("Дом старой постройки.", "Дом старая постройки."), "inflect")
        self.assertEqual(cat("Дом в городе.", "Дом на городе."), "function")
        self.assertEqual(cat("Дом стоял.", "Дом высился."), "lexical")
        self.assertEqual(cat("Он пришёл домой поздно вечером.",
                             "Он пришёл, когда стемнело, к своему крыльцу у реки."), "rewrite")
        self.assertEqual(cat("Он пришёл.", "Он пришёл вместе с братом, сестрой и отцом."), "content")

    def test_offsets_are_code_points(self) -> None:
        entry = page_diffs({"a": "𝔄 старый дом стоял", "b": "𝔄 новый белый дом стоял"}, ["a", "b"])
        text = "𝔄 новый белый дом стоял"
        [(start, end, kind, _category)] = entry["a|b"]["b"]
        self.assertEqual((text[start:end], kind), ("новый белый", "ins"))

    def test_rules_moves_and_summary(self) -> None:
        pages = {
            f"p{i}": {"a": f"Он сказал нежели {i} раз и ушёл.", "b": f"Он сказал чем {i} раз и ушёл."}
            for i in range(4)
        }
        long = "старый мельник продал мельницу соседу весной перед большим половодьем"
        pages["p4"] = {"a": f"Начало. {long}.", "b": "Начало."}
        pages["p5"] = {"a": "Конец.", "b": f"Конец. {long.replace('продал', 'отдал')}."}
        data = build_diffs(pages, ["a", "b"], part_of={key: "P001" for key in pages},
                           function_words=FUNCTION)
        self.assertEqual(data["schema"], SCHEMA)
        [rule] = data["rules"]["a|b"]
        self.assertEqual((rule["from"], rule["to"], rule["count"], rule["pages"], rule["reverse"]),
                         ("нежели", "чем", 4, 4, None))
        dropped = data["pages"]["p4"]["a|b"]["a"][-1]
        added = data["pages"]["p5"]["a|b"]["b"][-1]
        self.assertEqual((dropped[3], dropped[4]), ("moved", "p5"))
        self.assertEqual((added[3], added[4]), ("moved", "p4"))
        self.assertEqual(data["summary"]["a|b"]["P001"]["lexical"], 4)

    def test_identical_pages_are_omitted(self) -> None:
        self.assertEqual(page_diffs({"a": "x y", "b": "x y"}, ["a", "b"]), {})
        data = build_diffs({"p": {"a": "x", "b": "y"}, "q": {"a": "z", "b": "z"}}, ["a", "b"])
        self.assertEqual(list(data["pages"]), ["p"])


if __name__ == "__main__":
    unittest.main()
