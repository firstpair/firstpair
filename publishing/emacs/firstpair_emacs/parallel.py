"""Aligned chapters in the shared ``firstpair-aligned-chapter-v1`` schema.

The Obsidian Reader and the Emacs reader read the same chapter files: a
title and a list of units, each with the source lines and the lines of every
translation. Here a chapter becomes one Verse block per language per unit,
source first, so both readers show the same text and the same alignment.
"""

from __future__ import annotations

import json
from pathlib import Path

from .document import Block, Verse


SCHEMA = "firstpair-aligned-chapter-v1"
INDEX_SCHEMA = "firstpair-parallel-reader-v1"


def is_chapter(path: Path) -> bool:
    return path.suffix.lower() == ".json"


def load_index(path: Path) -> dict:
    """The edition's reader index: languages, translations (several per language), pages, dictionaries.

    An index that predates languages and translation metadata is normalised:
    each translation's id doubles as its language, and every translation is
    its language's default.
    """

    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema") != INDEX_SCHEMA:
        raise ValueError(f"unsupported reader index schema: {path}")
    translations = []
    for row in payload.get("translations", []):
        item = dict(row)
        item.setdefault("lang", item["id"])
        item.setdefault("title", item.get("translator") or item.get("label") or item["id"])
        item.setdefault("alignment", "line")
        item.setdefault("default", True)
        translations.append(item)
    languages = payload.get("languages") or [
        {"id": lang, "label": next(t.get("label", lang) for t in translations if t["lang"] == lang)}
        for lang in dict.fromkeys(t["lang"] for t in translations)
    ]
    return {"languages": languages, "translations": translations, "pages": payload.get("pages", []), "sourceLanguage": payload.get("sourceLanguage", {})}


def load(path: Path, source_language: str, translations: tuple[str, ...]) -> tuple[tuple[Block, ...], str, list[str]]:
    """Return the blocks, the title, and every source-language word of a chapter."""

    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema") != SCHEMA:
        raise ValueError(f"unsupported aligned chapter schema: {path}")
    blocks: list[Block] = []
    vocabulary: list[str] = []
    for unit in payload.get("units", []):
        identifier = str(unit.get("id", ""))
        lines = tuple(str(line) for line in unit.get("source", []))
        blocks.append(Verse(lines=lines, language=source_language, unit=identifier, source=True))
        vocabulary.extend(lines)
        for language in translations:
            translated = tuple(str(line) for line in unit.get("translations", {}).get(language, []))
            if any(line.strip() for line in translated):
                blocks.append(Verse(lines=translated, language=language, unit=identifier))
    return tuple(blocks), str(payload.get("title", path.stem)), vocabulary
