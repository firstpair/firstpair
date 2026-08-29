"""Translations of lexicon entries into the reader's target languages.

The lexicon itself analyses forms and carries the glosses of its own corpus
(Whitaker's senses are English). A title may declare further target
languages, each drawn from up to three places: a FirstPair-pinned glossary
corpus (a Wiktextract/Kaikki extraction), a title-owned dictionary in the
shared ``firstpair-reader-dictionary-v1`` schema that the Obsidian Reader also
uses, and a reviewed supplement. Every gloss is keyed either by the exact form
or by a lexicon entry (its lemma), so the reader can explain a form it has
analysed even when the glossary lists only the headword.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
from typing import Iterable

from .languages.base import Entry, Projection
from .lexicon import normalise


MAXIMUM_PER_KEY = 8
PIVOT_HINT = 48  # characters of the English sense kept in a pivoted gloss


@dataclass(frozen=True)
class Gloss:
    language: str
    key: str
    kind: str  # "form" or "entry"
    headword: str
    part: str
    definitions: tuple[str, ...]
    source: str


@dataclass(frozen=True)
class GlossaryIndex:
    by_headword: dict[str, tuple[dict[str, object], ...]]
    by_form: dict[str, tuple[dict[str, object], ...]]


def index_kaikki(path: Path, fold=normalise) -> GlossaryIndex:
    """Index a Kaikki JSON Lines extraction by headword and by inflected form.

    FOLD is the lexicon language's normalisation, so keys match its forms.
    """

    by_headword: dict[str, list[dict[str, object]]] = {}
    by_form: dict[str, list[dict[str, object]]] = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            headword = str(row.get("word", ""))
            key = fold(headword)
            definitions: list[str] = []
            for sense in row.get("senses", []):
                definitions.extend(str(value) for value in sense.get("glosses", []) if value)
            if not key or not definitions:
                continue
            entry = {
                "headword": headword,
                "partOfSpeech": str(row.get("pos", "")),
                "definitions": list(dict.fromkeys(definitions)),
            }
            by_headword.setdefault(key, []).append(entry)
            by_form.setdefault(key, []).append(entry)
            for form in row.get("forms", []):
                form_key = fold(str(form.get("form", "")))
                if form_key and form_key != key:
                    by_form.setdefault(form_key, []).append(entry)
    return GlossaryIndex(
        by_headword={key: tuple(items) for key, items in by_headword.items()},
        by_form={key: tuple(items) for key, items in by_form.items()},
    )


def index_translations(path: Path, source_code: str, fold=normalise) -> GlossaryIndex:
    """Invert a Kaikki extraction of the target language into a glossary.

    Each row is a target-language entry; its translation tables name the
    words of other languages that render it. Every SOURCE_CODE word named
    there becomes a headword glossed by the target-language entry, so a
    dictionary of the target language doubles as a dictionary into it.
    """

    by_headword: dict[str, list[dict[str, object]]] = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            translations = [
                item for item in row.get("translations", [])
                if item.get("lang_code") == source_code and item.get("word")
            ]
            if not translations:
                continue
            word = str(row.get("word", ""))
            if not word:
                continue
            glosses = [str(value) for sense in row.get("senses", []) for value in sense.get("glosses", []) if value]
            part = str(row.get("pos", ""))
            for item in translations:
                key = fold(str(item["word"]))
                if not key:
                    continue
                sense = str(item.get("sense", "")).strip()
                definition = word if not sense else f"{word} ({sense})"
                entry = {"headword": str(item["word"]), "partOfSpeech": part, "definitions": [definition], "hint": glosses[:1]}
                bucket = by_headword.setdefault(key, [])
                if not any(existing["definitions"] == entry["definitions"] for existing in bucket):
                    bucket.append(entry)
    merged: dict[str, tuple[dict[str, object], ...]] = {}
    for key, bucket in by_headword.items():
        # One entry per headword listing every target word, most common part first.
        definitions = list(dict.fromkeys(definition for entry in bucket for definition in entry["definitions"]))
        merged[key] = ({"headword": bucket[0]["headword"], "partOfSpeech": bucket[0]["partOfSpeech"], "definitions": definitions[:12]},)
    return GlossaryIndex(by_headword=merged, by_form=merged)


def _cells(value: str) -> list[str]:
    """Split a translation cell into its words: 'seguente, consecutivo' lists two."""

    return [part.strip() for part in re.split(r"[,;/]", value) if part.strip()]


def index_entry_translations(path: Path, target_code: str, fold=normalise) -> GlossaryIndex:
    """Index lexicon-language entries by their translation tables into TARGET_CODE."""

    by_headword: dict[str, list[dict[str, object]]] = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if '"translations"' not in line:
                continue
            row = json.loads(line)
            words = list(dict.fromkeys(
                str(item["word"]).strip() for item in row.get("translations", [])
                if item.get("lang_code") == target_code and item.get("word")
            ))
            key = fold(str(row.get("word", "")))
            if not words or not key:
                continue
            entry = {"headword": str(row.get("word", "")), "partOfSpeech": str(row.get("pos", "")), "definitions": words[:12]}
            bucket = by_headword.setdefault(key, [])
            if not any(existing["definitions"] == entry["definitions"] for existing in bucket):
                bucket.append(entry)
    merged = {key: tuple(value) for key, value in by_headword.items()}
    return GlossaryIndex(by_headword=merged, by_form=merged)


def index_pivot(path: Path, source_code: str, target_code: str, fold=normalise) -> GlossaryIndex:
    """Gloss SOURCE_CODE words through a third language's translation tables.

    Each row is an entry of the dump's language (English, say) whose tables
    translate one sense into many languages. A source-language word named
    for a sense is glossed by the target-language words named for the same
    sense, and the gloss says which sense carried it, so a reader can see the
    pivot rather than mistake it for a direct dictionary.
    """

    by_headword: dict[str, list[dict[str, object]]] = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if '"translations"' not in line or f'"lang_code": "{source_code}"' not in line or f'"lang_code": "{target_code}"' not in line:
                continue
            row = json.loads(line)
            senses: dict[str, dict[str, list[str]]] = {}

            def collect(items, label: str) -> None:
                for item in items:
                    code = item.get("lang_code")
                    if code not in (source_code, target_code) or not item.get("word"):
                        continue
                    bucket = senses.setdefault(str(item.get("sense", "")) or label, {source_code: [], target_code: []})
                    bucket[code].append(str(item["word"]).strip())

            # Tables sit on the entry or, more often, on the sense they translate.
            collect(row.get("translations", []), "")
            for sense in row.get("senses", []):
                glosses = [str(value) for value in sense.get("glosses", []) if value]
                collect(sense.get("translations", []), glosses[0] if glosses else "")
            word = str(row.get("word", ""))
            for sense, sides in senses.items():
                targets = list(dict.fromkeys(sides[target_code]))
                if not targets:
                    continue
                short = sense if len(sense) <= PIVOT_HINT else sense[: PIVOT_HINT - 1].rstrip() + "…"
                hint = f"{word}: {short}" if short and short != word else word
                definition = ", ".join(targets[:6]) + f" ({hint})"
                for cell in sides[source_code]:
                    for piece in _cells(cell):
                        if " " in piece:
                            continue
                        key = fold(piece)
                        if not key:
                            continue
                        bucket = by_headword.setdefault(key, [])
                        if len(bucket) < 8 and not any(existing["definitions"][0] == definition for existing in bucket):
                            bucket.append({"headword": piece, "partOfSpeech": str(row.get("pos", "")), "definitions": [definition]})
    merged = {key: tuple(value) for key, value in by_headword.items()}
    return GlossaryIndex(by_headword=merged, by_form=merged)


def load_glossary(path: Path, item, fold=normalise, cache: Path | None = None) -> GlossaryIndex:
    """Index a pinned glossary according to its kind, reusing a derived file when present.

    Scanning a multi-gigabyte extraction takes minutes; the derived index is
    small and keyed by the dump's digest, so later builds load it in seconds.
    """

    kind = getattr(item, "kind", "entries")
    derived = (cache or path.parent) / f"{path.name}.{kind}.{getattr(item, 'source_code', '')}-{getattr(item, 'target_code', '')}.{getattr(item, 'sha256', '')[:12]}.json"
    if derived.is_file():
        payload = json.loads(derived.read_text(encoding="utf-8"))
        return GlossaryIndex(
            by_headword={key: tuple(value) for key, value in payload["byHeadword"].items()},
            by_form={key: tuple(value) for key, value in payload["byForm"].items()},
        )
    if kind == "translations":
        index = index_translations(path, item.source_code, fold=fold)
    elif kind == "entry-translations":
        index = index_entry_translations(path, item.target_code, fold=fold)
    elif kind == "pivot":
        index = index_pivot(path, item.source_code, item.target_code, fold=fold)
    else:
        index = index_kaikki(path, fold=fold)
    derived.write_text(
        json.dumps({"schema": "firstpair-derived-glossary-v1", "kind": kind, "byHeadword": {k: list(v) for k, v in index.by_headword.items()}, "byForm": {k: list(v) for k, v in index.by_form.items()}}, ensure_ascii=False),
        encoding="utf-8",
    )
    return index


def merge(first: GlossaryIndex, second: GlossaryIndex) -> GlossaryIndex:
    """Combine two glossaries; the first's readings come first."""

    by_headword = {key: tuple(value) for key, value in first.by_headword.items()}
    for key, value in second.by_headword.items():
        by_headword[key] = by_headword.get(key, ()) + tuple(value)
    by_form = {key: tuple(value) for key, value in first.by_form.items()}
    for key, value in second.by_form.items():
        by_form[key] = by_form.get(key, ()) + tuple(value)
    return GlossaryIndex(by_headword=by_headword, by_form=by_form)


def load_dictionary(path: Path, fold=normalise) -> dict[str, tuple[dict[str, object], ...]]:
    """Load a ``firstpair-reader-dictionary-v1`` file keyed by normalised form."""

    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema") != "firstpair-reader-dictionary-v1":
        raise ValueError(f"unsupported dictionary schema: {path}")
    entries = payload.get("entries", {})
    if not isinstance(entries, dict):
        raise ValueError(f"dictionary entries are not an object: {path}")
    return {fold(key): tuple(value) for key, value in entries.items() if isinstance(value, list)}


def load_supplement(path: Path, fold=normalise) -> dict[str, tuple[str, ...]]:
    """Load a reviewed supplement: ``{form: [definition, ...]}``."""

    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and isinstance(payload.get("entries"), dict) and "schema" in payload:
        payload = payload["entries"]
    if not isinstance(payload, dict):
        raise ValueError(f"supplement is not an object: {path}")
    result: dict[str, tuple[str, ...]] = {}
    for key, value in payload.items():
        if isinstance(value, list):
            result[fold(key)] = tuple(str(item) for item in value if item)
        elif isinstance(value, dict) and isinstance(value.get("definitions"), list):
            result[fold(key)] = tuple(str(item) for item in value["definitions"] if item)
    return result


def _lemmas(entry: Entry, fold=normalise) -> tuple[str, ...]:
    """Return every principal part of ENTRY's headword as a lookup key.

    Whitaker lists some paradigms neuter- or stem-first (``omne, omnis``), so
    a glossary keyed on the conventional headword answers for a later part.
    """

    parts = [fold(part) for part in entry.headword.split(",")]
    return tuple(dict.fromkeys(part for part in parts if part))


def _glosses_from(language: str, key: str, kind: str, items: Iterable[dict[str, object]], source: str) -> list[Gloss]:
    found: list[Gloss] = []
    for item in items:
        definitions = tuple(str(value) for value in item.get("definitions", []) if value)
        if not definitions:
            continue
        found.append(
            Gloss(
                language=language,
                key=key,
                kind=kind,
                headword=str(item.get("headword", "")),
                part=str(item.get("partOfSpeech", "")),
                definitions=definitions,
                source=str(item.get("source", "")) or source,
            )
        )
    return found


def project(
    language: str,
    projection: Projection,
    *,
    fold=normalise,
    glossary: GlossaryIndex | None = None,
    glossary_name: str = "",
    dictionary: dict[str, tuple[dict[str, object], ...]] | None = None,
    dictionary_name: str = "",
    supplement: dict[str, tuple[str, ...]] | None = None,
    supplement_name: str = "",
) -> tuple[list[Gloss], dict[str, object]]:
    """Return the glosses a bundle needs for LANGUAGE and a coverage report."""

    glosses: dict[str, list[Gloss]] = {}

    def add(key: str, kind: str, candidates: list[Gloss]) -> None:
        bucket = glosses.setdefault(f"{kind}\0{key}", [])
        seen = {(item.headword, item.definitions) for item in bucket}
        for gloss in candidates:
            marker = (gloss.headword, gloss.definitions)
            if marker in seen or len(bucket) >= MAXIMUM_PER_KEY:
                continue
            seen.add(marker)
            bucket.append(gloss)

    forms = [form for form, _ in projection.forms]
    for form in forms:
        if glossary is not None:
            add(form, "form", _glosses_from(language, form, "form", glossary.by_form.get(form, ()), glossary_name))
        if dictionary is not None:
            add(form, "form", _glosses_from(language, form, "form", dictionary.get(form, ()), dictionary_name))
        if supplement is not None and form in supplement:
            add(form, "form", [Gloss(language, form, "form", form, "", supplement[form], supplement_name)])
    for entry in projection.entries:
        for lemma in _lemmas(entry, fold):
            if glossary is not None:
                add(entry.entry_id, "entry", _glosses_from(language, entry.entry_id, "entry", glossary.by_headword.get(lemma, ()), glossary_name))
            if dictionary is not None:
                add(entry.entry_id, "entry", _glosses_from(language, entry.entry_id, "entry", dictionary.get(lemma, ()), dictionary_name))
            if supplement is not None and lemma in supplement:
                add(entry.entry_id, "entry", [Gloss(language, entry.entry_id, "entry", entry.headword, "", supplement[lemma], supplement_name)])

    covered = 0
    missing: list[str] = []
    for form, analyses in projection.forms:
        if glosses.get(f"form\0{form}") or any(glosses.get(f"entry\0{analysis.entry_id}") for analysis in analyses):
            covered += 1
        else:
            missing.append(form)
    report = {
        "forms": len(forms),
        "covered": covered,
        "missing": missing,
        "entries": sum(1 for key in glosses if key.startswith("entry\0") and glosses[key]),
    }
    return [gloss for bucket in glosses.values() for gloss in bucket], report


def write(directory: Path, glosses: Iterable[Gloss]) -> dict[str, object]:
    """Append the delivered ``lexicon/glosses.tsv`` and return its metadata."""

    rows = sorted(
        "\t".join(
            (
                gloss.language,
                gloss.key,
                gloss.kind,
                gloss.headword.replace("\t", " "),
                gloss.part.replace("\t", " "),
                " | ".join(definition.replace("\t", " ").replace("|", "/").replace("\n", " ") for definition in gloss.definitions),
                gloss.source.replace("\t", " "),
            )
        )
        for gloss in glosses
    )
    text = "language\tkey\tkind\theadword\tpart\tdefinitions\tsource\n" + "".join(f"{row}\n" for row in rows)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "glosses.tsv").write_text(text, encoding="utf-8")
    return {"rows": len(rows), "bytes": len(text.encode("utf-8")), "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()}
