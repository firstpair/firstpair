"""Dictionaries in the shared ``firstpair-reader-dictionary-v1`` schema.

The Obsidian Reader and the Emacs reader look words up the same way: an
exact normalised surface form keyed into a projected dictionary. This module
projects one language's analyser and translation sources onto a text's
vocabulary and returns that payload, so a vault and an Emacs bundle built
from the same text agree word for word on what the reader is told.
"""

from __future__ import annotations

from typing import Iterable
import unicodedata

from . import glosses as glosses_module
from .languages.base import Language


SCHEMA = "firstpair-reader-dictionary-v1"


def reader_key(surface: str) -> str:
    """Fold a surface form the way the Obsidian Reader does before lookup."""

    text = unicodedata.normalize("NFC", surface).casefold()
    return text.strip("".join(character for character in text if not character.isalpha()) or " ")


def project(
    language: Language,
    vocabulary: Iterable[str],
    *,
    target: str,
    label: str,
    license: str,
    attribution: str,
    glossary: glosses_module.GlossaryIndex | None = None,
    glossary_name: str = "",
    dictionary: dict[str, tuple[dict[str, object], ...]] | None = None,
    dictionary_name: str = "",
    supplement: dict[str, tuple[str, ...]] | None = None,
    supplement_name: str = "",
    examples: dict[str, list[str]] | None = None,
    gloss_pivot: glosses_module.GlossaryIndex | None = None,
    gloss_pivot_name: str = "",
) -> tuple[dict[str, object], dict[str, object]]:
    """Return a dictionary payload for TARGET and its coverage report.

    Every surface form in VOCABULARY is analysed; its entries are the
    analyser's own senses when TARGET is the analyser's gloss language, and
    otherwise the glosses found by exact form first and by lemma second. The
    payload is keyed by both the analyser's fold and the Reader's, so either
    reader finds it.
    """

    surfaces: dict[str, list[str]] = {}
    for surface in vocabulary:
        key = language.normalise(surface)
        if key:
            surfaces.setdefault(key, [])
            if surface not in surfaces[key]:
                surfaces[key].append(surface)
    projection = language.project(surfaces.keys())
    own = target == language.gloss_language
    found: list[glosses_module.Gloss] = []
    gloss_report: dict[str, object] = {}
    if not own or glossary or dictionary or supplement or gloss_pivot:
        found, gloss_report = glosses_module.project(
            target,
            projection,
            fold=language.normalise,
            glossary=glossary,
            glossary_name=glossary_name,
            dictionary=dictionary,
            dictionary_name=dictionary_name,
            supplement=supplement,
            supplement_name=supplement_name,
            related=getattr(language, "related", None),
            senses=language.senses,
            gloss_pivot=gloss_pivot,
            gloss_pivot_name=gloss_pivot_name,
        )
    by_form: dict[str, list[glosses_module.Gloss]] = {}
    by_entry: dict[str, list[glosses_module.Gloss]] = {}
    for gloss in found:
        (by_form if gloss.kind == "form" else by_entry).setdefault(gloss.key, []).append(gloss)

    entries: dict[str, list[dict[str, object]]] = {}
    missing: list[str] = []
    for form, analyses in projection.forms:
        rows: list[dict[str, object]] = []
        seen: set[tuple[str, tuple[str, ...]]] = set()

        def add(headword: str, part: str, definitions: tuple[str, ...], grammar: str, source: str) -> None:
            marker = (headword, definitions)
            if marker in seen or not definitions:
                return
            seen.add(marker)
            row: dict[str, object] = {"headword": headword, "partOfSpeech": part, "definitions": list(definitions)}
            if grammar:
                row["grammar"] = grammar
            if source:
                row["source"] = source
            if examples and examples.get(form):
                row["examples"] = examples[form][:2]
            rows.append(row)

        for analysis in analyses:
            entry = language.entry(analysis.entry_id)
            grammar = analysis.features if analysis.features != "lemma" else ""
            if analysis.note:
                grammar = f"{grammar} ({analysis.note})".strip()
            if analysis.enclitic:
                grammar = f"{grammar} + {analysis.enclitic}".strip()
            if own:
                add(entry.headword, language.part_name(entry.part), tuple(part.strip() for part in language.senses(entry).split(";") if part.strip()), grammar, "")
            for gloss in by_entry.get(analysis.entry_id, ()):
                add(gloss.headword or entry.headword, gloss.part or language.part_name(entry.part), gloss.definitions, grammar, gloss.source)
        for gloss in by_form.get(form, ()):
            add(gloss.headword or form, gloss.part, gloss.definitions, "", gloss.source)
        if rows:
            entries[form] = rows
            for surface in surfaces.get(form, ()):
                alias = reader_key(surface)
                if alias and alias != form and alias not in entries:
                    entries[alias] = rows
        else:
            missing.append(form)
    unknown = list(projection.unknown)
    payload = {
        "schema": SCHEMA,
        "sourceLanguage": language.code,
        "targetLanguage": target,
        "label": label,
        "license": license,
        "attribution": attribution,
        "entries": dict(sorted(entries.items())),
    }
    report = {
        "target": target,
        "forms": len(projection.forms) + len(unknown),
        "analysed": len(projection.forms),
        "covered": len(projection.forms) - len(missing),
        "unanalysed": unknown,
        "missing": missing,
        "derivedEntries": gloss_report.get("derivedEntries", 0),
    }
    return payload, report
