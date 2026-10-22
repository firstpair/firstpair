"""Precomputed word diffs between editions of one text (``firstpair.edition-diffs.v1``).

Readers show a diff instantly, offline, and identically on every device, so
the comparison is made once at build time and shipped as data.  For a page
whose panes hold editions ``A, B, C`` (in reading order, oldest first) the
entry holds every pair and the whole set:

    "A|B", "A|C", "B|C"   pairwise: the earlier pane marks what it lost
                          ("del"), the later one what it gained ("ins")
    "A|B|C"               three-way: each pane marks words found in no
                          other pane ("uniq") and words shared with exactly
                          one other pane ("share:<edition>")

so a reader showing two panes picks that pair, and one showing all three
picks the set.  Ranges are ``[start, end, kind]`` in Unicode code points of
the pane text exactly as the page payload carries it; Python string indices
are code points, as the shared ledger requires.  Tokens are words and single
punctuation marks; whitespace is never marked.

    from edition_diffs import page_diffs, diffs_file
    entry = page_diffs({"ru-4.1": a, "ru-4.2.3": b, "ru-4.3.0": c},
                       ["ru-4.1", "ru-4.2.3", "ru-4.3.0"])
    data = diffs_file({"page-key": entry}, ["ru-4.1", "ru-4.2.3", "ru-4.3.0"])

The JavaScript side is ``plugin/shared/diff-view.js``.
"""

from __future__ import annotations

import difflib
import re
from itertools import combinations

SCHEMA = "firstpair.edition-diffs.v1"
TOKEN_RE = re.compile(r"[^\W_]+(?:[-'’][^\W_]+)*|[^\w\s]", re.UNICODE)


def tokens(text: str) -> list[tuple[int, int, str]]:
    """Word and punctuation tokens as (start, end, folded text)."""

    return [(m.start(), m.end(), m.group().casefold()) for m in TOKEN_RE.finditer(text)]


def _matched(left: list, right: list) -> tuple[set[int], set[int]]:
    """Indices of tokens on each side that survive into the other."""

    matcher = difflib.SequenceMatcher(
        None, [t[2] for t in left], [t[2] for t in right], autojunk=False,
    )
    keep_left: set[int] = set()
    keep_right: set[int] = set()
    for block in matcher.get_matching_blocks():
        keep_left.update(range(block.a, block.a + block.size))
        keep_right.update(range(block.b, block.b + block.size))
    return keep_left, keep_right


def _ranges(text: str, toks: list, kinds: list[str | None]) -> list[list]:
    """Merge consecutive tokens of one kind into ranges over the text.

    Whitespace between two marked tokens of the same kind joins the range,
    so a changed phrase reads as one mark rather than a row of words.
    """

    out: list[list] = []
    for (start, end, _), kind in zip(toks, kinds):
        if kind is None:
            continue
        if out and out[-1][2] == kind and not text[out[-1][1]:start].strip():
            out[-1][1] = end
        else:
            out.append([start, end, kind])
    return out


def page_diffs(texts: dict[str, str], order: list[str]) -> dict:
    """Every pairwise diff and the all-editions diff for one page."""

    present = [edition for edition in order if edition in texts]
    toks = {edition: tokens(texts[edition]) for edition in present}
    kept: dict[tuple[str, str], tuple[set[int], set[int]]] = {}
    entry: dict[str, dict[str, list]] = {}
    for left, right in combinations(present, 2):
        keep_left, keep_right = _matched(toks[left], toks[right])
        kept[(left, right)] = (keep_left, keep_right)
        entry[f"{left}|{right}"] = {
            left: _ranges(texts[left], toks[left],
                          [None if i in keep_left else "del" for i in range(len(toks[left]))]),
            right: _ranges(texts[right], toks[right],
                           [None if i in keep_right else "ins" for i in range(len(toks[right]))]),
        }
    if len(present) >= 3:
        group: dict[str, list] = {}
        for edition in present:
            others = [other for other in present if other != edition]
            survives: dict[str, set[int]] = {}
            for other in others:
                if (edition, other) in kept:
                    survives[other] = kept[(edition, other)][0]
                else:
                    survives[other] = kept[(other, edition)][1]
            kinds: list[str | None] = []
            for index in range(len(toks[edition])):
                found = [other for other in others if index in survives[other]]
                if len(found) == len(others):
                    kinds.append(None)
                elif not found:
                    kinds.append("uniq")
                elif len(found) == 1:
                    kinds.append(f"share:{found[0]}")
                else:
                    kinds.append("part")
            group[edition] = _ranges(texts[edition], toks[edition], kinds)
        entry["|".join(present)] = group
    # Pages where nothing differs carry no entry at all.
    if all(not ranges for diff in entry.values() for ranges in diff.values()):
        return {}
    return entry


def diffs_file(pages: dict[str, dict], editions: list[str]) -> dict:
    """The vault data file: schema, edition order, and per-page entries."""

    return {
        "schema": SCHEMA,
        "editions": list(editions),
        "pages": {key: entry for key, entry in pages.items() if entry},
    }
