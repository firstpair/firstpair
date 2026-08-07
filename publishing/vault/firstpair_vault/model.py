from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


PRODUCTS = frozenset({"desktop", "mobile", "preview"})
PROFILES = frozenset({"code", "history", "triptych"})


@dataclass(frozen=True)
class ReaderPage:
    page_id: str
    title: str
    source: Path
    preview: bool


@dataclass(frozen=True)
class EvidenceTarget:
    target_id: str
    kind: str
    source: Path
    label: str
    rights: str
    referenced_by: tuple[str, ...]
    metadata: dict[str, Any]


@dataclass(frozen=True)
class EvidenceCollection:
    collection_id: str
    kind: str
    source: Path
    include: tuple[str, ...]
    exclude: tuple[str, ...]
    rights: str
    referenced_by: tuple[str, ...]


@dataclass(frozen=True)
class Product:
    name: str
    output: Path
    edition: str
    max_files: int | None
    max_bytes: int | None


@dataclass(frozen=True)
class VaultConfig:
    config_path: Path
    repo_root: Path
    slug: str
    title: str
    profile: str
    source_commit: str
    pages: tuple[ReaderPage, ...]
    evidence: tuple[EvidenceTarget, ...]
    collections: tuple[EvidenceCollection, ...]
    products: dict[str, Product]
    plugin: bool
    book_guide: Path | None


@dataclass(frozen=True)
class Projection:
    product: Product
    pages: tuple[ReaderPage, ...]
    evidence: tuple[EvidenceTarget, ...]
    collections: tuple[EvidenceCollection, ...]
