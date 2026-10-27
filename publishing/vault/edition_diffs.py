"""Precomputed word diffs between editions of one text (``firstpair.edition-diffs.v2``).

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

Version 2 adds what an editor needs beyond marks:

* each pairwise range carries the **category** of its change as a fourth
  element, ordered by risk: ``punct`` (punctuation only), ``inflect`` (same
  words, other endings), ``function`` (prepositions, particles,
  connectives), ``lexical`` (a word or two swapped), ``restructure`` (the
  clause reworked around kept words), ``rewrite`` (a phrase replaced),
  ``content`` (more than three words added or dropped), and ``moved``
  (text that left this place but appears elsewhere on the page or on a
  neighbouring page; the fifth element then names that page);
* ``rules``: per pair, one-word substitutions that recur on several pages
  (``нежели -> чем``), with every occurrence and the opposite rule when the
  edit also runs the other way, so one decision can cover a whole book;
* ``summary``: per pair and Part, the words changed in each category.

Categories need a lemmatizer to tell an inflection from a new word; without
one (``lemmatize=None``) words are compared case-folded.  The language's
function words are the caller's to supply.

    from edition_diffs import build_diffs
    data = build_diffs(pages, ["ru-4.1", "ru-4.2.3", "ru-4.3.0"],
                       part_of=part_by_page, lemmatize=lemma, function_words=FUNC)

The JavaScript side is ``plugins/shared/diff-view.js`` in the
firstpair-reader repository.
"""

from __future__ import annotations

import difflib
import hashlib
import re
from collections import Counter, defaultdict
from itertools import combinations
from typing import Callable, Iterable

SCHEMA = "firstpair.edition-diffs.v2"
SCHEMA_V1 = "firstpair.edition-diffs.v1"
TOKEN_RE = re.compile(r"[^\W_]+(?:[-'’][^\W_]+)*|[^\w\s]", re.UNICODE)
WORD_RE = re.compile(r"\w", re.UNICODE)
CATEGORIES = ("punct", "inflect", "function", "lexical", "restructure", "rewrite", "content", "moved")
RULE_MIN_PAGES = 3
MOVE_MIN_WORDS = 6
MOVE_NEIGHBOURS = 2
MOVE_OVERLAP = 0.5


def tokens(text: str) -> list[tuple[int, int, str]]:
    """Word and punctuation tokens as (start, end, folded text)."""

    return [(m.start(), m.end(), m.group().casefold()) for m in TOKEN_RE.finditer(text)]


def _matcher(left: list, right: list) -> difflib.SequenceMatcher:
    return difflib.SequenceMatcher(None, [t[2] for t in left], [t[2] for t in right], autojunk=False)


def _matched(left: list, right: list) -> tuple[set[int], set[int]]:
    """Indices of tokens on each side that survive into the other."""

    keep_left: set[int] = set()
    keep_right: set[int] = set()
    for block in _matcher(left, right).get_matching_blocks():
        keep_left.update(range(block.a, block.a + block.size))
        keep_right.update(range(block.b, block.b + block.size))
    return keep_left, keep_right


def _ranges(text: str, toks: list, kinds: list) -> list[list]:
    """Merge consecutive tokens of one kind into ranges over the text.

    Whitespace between two marked tokens of the same kind joins the range,
    so a changed phrase reads as one mark rather than a row of words.
    """

    out: list[list] = []
    for (start, end, _), kind in zip(toks, kinds):
        if kind is None:
            continue
        if out and out[-1][2:] == list(kind if isinstance(kind, tuple) else (kind,)) \
                and not text[out[-1][1]:start].strip():
            out[-1][1] = end
        else:
            out.append([start, end, *(kind if isinstance(kind, tuple) else (kind,))])
    return out


class _Classifier:
    def __init__(self, lemmatize: Callable[[str], str] | None, function_words: Iterable[str]):
        self.cache: dict[str, str] = {}
        self.lemmatize = lemmatize
        self.function = frozenset(word.casefold() for word in function_words)

    def lemma(self, token: str) -> str:
        if token not in self.cache:
            self.cache[token] = (self.lemmatize(token) if self.lemmatize and WORD_RE.search(token) else token)
        return self.cache[token]

    def words(self, toks: list) -> list[str]:
        return [self.lemma(t[2]) for t in toks if WORD_RE.search(t[2])]

    def content(self, toks: list) -> list[str]:
        return [word for word in self.words(toks) if word not in self.function]

    def category(self, tag: str, left: list, right: list) -> str:
        wl, wr = self.words(left), self.words(right)
        if not wl and not wr:
            return "punct"
        if tag == "replace" and wl == wr:
            return "inflect"
        if set(wl + wr) <= self.function:
            return "function"
        if tag == "replace":
            if len(wl) <= 2 and len(wr) <= 2 and not set(wl) & set(wr):
                return "lexical"
            return "restructure" if set(wl) & set(wr) else "rewrite"
        return "content" if max(len(wl), len(wr)) > 3 else "lexical"


def _pair_diff(texts, toks, left, right, cls: _Classifier, hunks: list | None):
    """Pairwise ranges with categories, and the hunks rules are mined from."""

    matcher = _matcher(toks[left], toks[right])
    kinds_left: list = [None] * len(toks[left])
    kinds_right: list = [None] * len(toks[right])
    keep_left: set[int] = set()
    keep_right: set[int] = set()
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            keep_left.update(range(i1, i2))
            keep_right.update(range(j1, j2))
            continue
        a, b = toks[left][i1:i2], toks[right][j1:j2]
        category = cls.category(tag, a, b)
        for index in range(i1, i2):
            kinds_left[index] = ("del", category)
        for index in range(j1, j2):
            kinds_right[index] = ("ins", category)
        if hunks is not None and tag == "replace" and category == "lexical":
            wl, wr = cls.words(a), cls.words(b)
            if len(wl) == 1 and len(wr) == 1 and not (wl[0] in cls.function and wr[0] in cls.function):
                hunks.append((wl[0], wr[0], a[0][0], a[-1][1], b[0][0], b[-1][1]))
    # A dropped run whose words reappear elsewhere on the page was moved.
    _mark_moves_within(toks[left], kinds_left, toks[right], kinds_right, cls)
    return (
        {
            left: _ranges(texts[left], toks[left], kinds_left),
            right: _ranges(texts[right], toks[right], kinds_right),
        },
        (keep_left, keep_right),
    )


def _runs(kinds: list, wanted: str) -> list[tuple[int, int]]:
    runs, start = [], None
    for index, kind in enumerate(kinds + [None]):
        hit = kind is not None and kind[0] == wanted and kind[1] in ("content", "rewrite")
        if hit and start is None:
            start = index
        elif not hit and start is not None:
            runs.append((start, index))
            start = None
    return runs


def _overlap(words: list[str], other: list[str]) -> float:
    """Share of `words` (content-word lemmas) found again in `other`.

    A bag, not a sequence: moved text is often rewritten on the way.
    """

    if not words or not other:
        return 0.0
    return sum((Counter(words) & Counter(other)).values()) / len(words)


def _mark_moves_within(lt, lk, rt, rk, cls: _Classifier) -> None:
    for gone_start, gone_end in _runs(lk, "del"):
        gone = cls.content(lt[gone_start:gone_end])
        if len(gone) < MOVE_MIN_WORDS:
            continue
        for new_start, new_end in _runs(rk, "ins"):
            if _overlap(gone, cls.content(rt[new_start:new_end])) >= MOVE_OVERLAP:
                for index in range(gone_start, gone_end):
                    lk[index] = ("del", "moved")
                for index in range(new_start, new_end):
                    rk[index] = ("ins", "moved")
                break


def page_diffs(texts: dict[str, str], order: list[str], *, lemmatize=None,
               function_words: Iterable[str] = (), _hunks: dict | None = None) -> dict:
    """Every pairwise diff and the all-editions diff for one page."""

    cls = _Classifier(lemmatize, function_words)
    present = [edition for edition in order if edition in texts]
    toks = {edition: tokens(texts[edition]) for edition in present}
    kept: dict[tuple[str, str], tuple[set[int], set[int]]] = {}
    entry: dict[str, dict[str, list]] = {}
    for left, right in combinations(present, 2):
        hunks = _hunks.setdefault(f"{left}|{right}", []) if _hunks is not None else None
        entry[f"{left}|{right}"], kept[(left, right)] = _pair_diff(texts, toks, left, right, cls, hunks)
    if len(present) >= 3:
        group: dict[str, list] = {}
        for edition in present:
            others = [other for other in present if other != edition]
            survives = {
                other: kept[(edition, other)][0] if (edition, other) in kept else kept[(other, edition)][1]
                for other in others
            }
            kinds: list = []
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


def _rule_id(pair: str, source: str, target: str) -> str:
    digest = hashlib.sha256(f"{pair}\x1f{source}\x1f{target}".encode()).hexdigest()[:12]
    return f"R{digest}"


def build_diffs(pages: dict[str, dict[str, str]], order: list[str], *,
                part_of: dict[str, str] | None = None, lemmatize=None,
                function_words: Iterable[str] = ()) -> dict:
    """The vault data file: per-page diffs, recurring rules, Part summary.

    ``pages`` maps page key -> {edition: pane text}, in book order.
    """

    function_words = tuple(function_words)
    cls = _Classifier(lemmatize, function_words)
    entries: dict[str, dict] = {}
    hunks_by_page: dict[str, dict[str, list]] = {}
    keys = list(pages)
    for key in keys:
        hunks: dict[str, list] = {}
        entries[key] = page_diffs(pages[key], order, lemmatize=cls.lemma if lemmatize else None,
                                  function_words=function_words, _hunks=hunks)
        hunks_by_page[key] = hunks

    # Moves across pages: a dropped run whose words appear among the other
    # edition's additions on a neighbouring page.
    position = {key: index for index, key in enumerate(keys)}
    for key, entry in entries.items():
        for pair, diff in entry.items():
            if pair.count("|") != 1:
                continue
            left, right = pair.split("|")
            for side, other_side, mark in ((left, right, "del"), (right, left, "ins")):
                for rng in diff.get(side, []):
                    if rng[2] != mark or rng[3] not in ("content", "rewrite"):
                        continue
                    words = cls.content(tokens(pages[key][side][rng[0]:rng[1]]))
                    if len(words) < MOVE_MIN_WORDS:
                        continue
                    lo, hi = position[key] - MOVE_NEIGHBOURS, position[key] + MOVE_NEIGHBOURS
                    for near in keys[max(0, lo):hi + 1]:
                        if near == key:
                            continue
                        near_diff = entries.get(near, {}).get(pair, {})
                        opposite = "ins" if mark == "del" else "del"
                        for other in near_diff.get(other_side, []):
                            if other[2] != opposite or other[3] not in ("content", "rewrite"):
                                continue
                            text = pages[near][other_side][other[0]:other[1]]
                            if _overlap(words, cls.content(tokens(text))) >= MOVE_OVERLAP:
                                rng[3] = "moved"
                                rng[4:] = [near]
                                other[3] = "moved"
                                other[4:] = [key]
                                break
                        if rng[3] == "moved":
                            break

    # Rules: one-word substitutions recurring on several pages.
    rules: dict[str, list] = {}
    for left, right in combinations(order, 2):
        pair = f"{left}|{right}"
        found: dict[tuple[str, str], list] = defaultdict(list)
        for key in keys:
            for source, target, a0, a1, b0, b1 in hunks_by_page[key].get(pair, []):
                found[(source, target)].append([key, a0, a1, b0, b1])
        recurring = {
            sub: hits for sub, hits in found.items()
            if len({hit[0] for hit in hits}) >= RULE_MIN_PAGES
        }
        listed = []
        for (source, target), hits in sorted(recurring.items(), key=lambda item: (-len(item[1]), item[0])):
            reverse = (target, source)
            listed.append({
                "id": _rule_id(pair, source, target),
                "from": source,
                "to": target,
                "count": len(hits),
                "pages": len({hit[0] for hit in hits}),
                "reverse": _rule_id(pair, target, source) if reverse in recurring else None,
                "reverse_count": len(found.get(reverse, [])),
                "occurrences": hits,
            })
        if listed:
            rules[pair] = listed

    # Part summary: words changed per category, counted on the later side
    # (the earlier side for pure deletions).
    summary: dict[str, dict[str, dict[str, int]]] = {}
    if part_of:
        for key, entry in entries.items():
            part = part_of.get(key)
            if part is None:
                continue
            for pair, diff in entry.items():
                if pair.count("|") != 1:
                    continue
                left, right = pair.split("|")
                bucket = summary.setdefault(pair, {}).setdefault(part, {})
                for side in (right, left):
                    for rng in diff.get(side, []):
                        # The earlier side adds only what has no later counterpart.
                        if side == left and rng[3] != "content":
                            continue
                        words = len(re.findall(r"[^\W_]+", pages[key][side][rng[0]:rng[1]])) or (1 if rng[3] == "punct" else 0)
                        bucket[rng[3]] = bucket.get(rng[3], 0) + words
    return {
        "schema": SCHEMA,
        "editions": list(order),
        "categories": list(CATEGORIES),
        "pages": {key: entry for key, entry in entries.items() if entry},
        "rules": rules,
        "summary": summary,
    }


def diffs_file(pages: dict[str, dict], editions: list[str]) -> dict:
    """A version-1 file from precomputed page entries (kept for old callers)."""

    return {
        "schema": SCHEMA_V1,
        "editions": list(editions),
        "pages": {key: entry for key, entry in pages.items() if entry},
    }
