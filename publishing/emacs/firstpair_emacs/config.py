"""Configuration for the Emacs delivery.

An adopting title keeps one canonical description of its reader order and its
evidence. The Obsidian vault builder reads the shared core of that file; this
module reads the same core through ``firstpair_vault`` and adds the Emacs
block: Info directory identity, part grouping, record sets, and the lexicon
the dictionary window uses. A title that ships only an Emacs bundle can use the
same file with no vault products declared.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any

from firstpair_vault.config import ConfigError, load_config as load_core
from firstpair_vault.model import VaultConfig


PRODUCTS = ("desktop", "preview")
LEXICON_MODES = ("projected", "complete", "none")


@dataclass(frozen=True)
class Product:
    name: str
    output: Path
    edition: str
    max_files: int | None
    max_bytes: int | None


@dataclass(frozen=True)
class LexiconSpec:
    language: str
    mode: str
    exclude: tuple[str, ...]
    include: tuple[str, ...]
    minimum_length: int


@dataclass(frozen=True)
class RecordBlock:
    label: str
    field: str
    style: str
    language: str


@dataclass(frozen=True)
class RecordSet:
    set_id: str
    source: Path
    kind: str
    identifier: str
    label: str
    rights: str
    blocks: tuple[RecordBlock, ...]
    anchors: tuple[str, ...]
    referenced_by: str
    reference_match: str
    section: str


@dataclass(frozen=True)
class EmacsConfig:
    core: VaultConfig
    config_path: Path
    repo_root: Path
    products: dict[str, Product]
    direntry: tuple[str, str, str]
    lexicon: LexiconSpec | None
    records: tuple[RecordSet, ...]
    parts: tuple[tuple[str, str], ...]
    page_parts: dict[str, str]
    reader_stem: str
    reference_stem: str
    subtitle: str
    author: str


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ConfigError(f"{label} must be an object")
    return value


def _text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{label} must be a non-empty string")
    return value.strip()


def _relative(root: Path, value: Any, label: str, *, directory: bool = False) -> Path:
    candidate = Path(_text(value, label))
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ConfigError(f"{label} must be a repository-relative path")
    resolved = (root / candidate).resolve()
    if not resolved.is_relative_to(root) or resolved.is_symlink():
        raise ConfigError(f"{label} escapes the repository or is a symlink: {candidate}")
    if directory:
        return resolved
    if not resolved.is_file():
        raise ConfigError(f"{label} is not a regular file: {candidate}")
    return resolved


def load(path: Path) -> EmacsConfig:
    config_path = path.resolve()
    core = load_core(config_path)
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    block = _object(raw.get("emacs"), "emacs")
    root = core.repo_root

    products: dict[str, Product] = {}
    for name, item in _object(block.get("products"), "emacs.products").items():
        if name not in PRODUCTS:
            raise ConfigError(f"unsupported Emacs product: {name}")
        row = _object(item, f"emacs.products.{name}")
        output = Path(_text(row.get("output"), f"emacs.products.{name}.output"))
        if output.is_absolute() or ".." in output.parts:
            raise ConfigError(f"emacs.products.{name}.output must be repository-relative")
        products[name] = Product(
            name=name,
            output=(root / output).resolve(),
            edition=_text(
                row.get("edition", "preview" if name == "preview" else "full"),
                f"emacs.products.{name}.edition",
            ),
            max_files=row.get("maxFiles"),
            max_bytes=row.get("maxBytes"),
        )
    if not products:
        raise ConfigError("emacs.products must not be empty")

    direntry_raw = _object(block.get("direntry", {}), "emacs.direntry")
    stem = _text(direntry_raw.get("name", core.slug), "emacs.direntry.name")
    direntry = (
        _text(direntry_raw.get("category", "Books"), "emacs.direntry.category"),
        stem,
        _text(direntry_raw.get("description", core.title), "emacs.direntry.description"),
    )

    lexicon_raw = block.get("lexicon")
    lexicon = None
    if lexicon_raw is not None:
        row = _object(lexicon_raw, "emacs.lexicon")
        mode = _text(row.get("mode", "projected"), "emacs.lexicon.mode")
        if mode not in LEXICON_MODES:
            raise ConfigError(f"unsupported lexicon mode: {mode}")
        lexicon = LexiconSpec(
            language=_text(row.get("language", "latin"), "emacs.lexicon.language"),
            mode=mode,
            exclude=tuple(row.get("exclude", [])),
            include=tuple(row.get("include", [])),
            minimum_length=int(row.get("minimumLength", 3)),
        )

    page_ids = {page.page_id for page in core.pages}
    records: list[RecordSet] = []
    for index, item in enumerate(block.get("records", [])):
        row = _object(item, f"emacs.records[{index}]")
        blocks = tuple(
            RecordBlock(
                label=_text(entry.get("label", entry.get("field", "")), f"emacs.records[{index}].blocks[{position}].label"),
                field=_text(entry.get("field"), f"emacs.records[{index}].blocks[{position}].field"),
                style=_text(entry.get("style", "paragraph"), f"emacs.records[{index}].blocks[{position}].style"),
                language=str(entry.get("language", "")),
            )
            for position, entry in enumerate(_list(row.get("blocks"), f"emacs.records[{index}].blocks"))
        )
        records.append(
            RecordSet(
                set_id=_text(row.get("id"), f"emacs.records[{index}].id"),
                source=_relative(root, row.get("source"), f"emacs.records[{index}].source"),
                kind=_text(row.get("kind", "source-passage"), f"emacs.records[{index}].kind"),
                identifier=_text(row.get("identifier", "id"), f"emacs.records[{index}].identifier"),
                label=_text(row.get("label", "{id}"), f"emacs.records[{index}].label"),
                rights=_text(row.get("rights", "redistributable"), f"emacs.records[{index}].rights"),
                blocks=blocks,
                anchors=tuple(row.get("anchors", [])),
                referenced_by=str(row.get("referencedBy", "")),
                reference_match=_text(row.get("referenceMatch", "source"), f"emacs.records[{index}].referenceMatch"),
                section=_text(row.get("section", "References"), f"emacs.records[{index}].section"),
            )
        )

    parts: list[tuple[str, str]] = []
    for index, item in enumerate(block.get("parts", [])):
        row = _object(item, f"emacs.parts[{index}]")
        parts.append(
            (
                _text(row.get("title"), f"emacs.parts[{index}].title"),
                str(row.get("description", "")),
            )
        )

    page_parts: dict[str, str] = {}
    for index, item in enumerate(raw.get("reader", [])):
        row = _object(item, f"reader[{index}]")
        if row.get("part"):
            page_parts[_text(row.get("id"), f"reader[{index}].id")] = _text(
                row.get("part"), f"reader[{index}].part"
            )
    unknown = sorted(set(page_parts) - page_ids)
    if unknown:
        raise ConfigError(f"reader parts name unknown pages: {', '.join(unknown)}")

    return EmacsConfig(
        core=core,
        config_path=config_path,
        repo_root=root,
        products=products,
        direntry=direntry,
        lexicon=lexicon,
        records=tuple(records),
        parts=tuple(parts),
        page_parts=page_parts,
        reader_stem=stem,
        reference_stem=f"{stem}-refs",
        subtitle=str(block.get("subtitle", "")),
        author=str(block.get("author", "")),
    )


def _list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list) or not value:
        raise ConfigError(f"{label} must be a non-empty array")
    return value
