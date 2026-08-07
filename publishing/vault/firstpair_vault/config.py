from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .model import EvidenceCollection, EvidenceTarget, PRODUCTS, PROFILES, Product, ReaderPage, VaultConfig


class ConfigError(ValueError):
    pass


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ConfigError(f"{label} must be an object")
    return value


def _text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{label} must be a non-empty string")
    return value.strip()


def _source(root: Path, value: Any, label: str) -> Path:
    relative = Path(_text(value, label))
    if relative.is_absolute() or ".." in relative.parts:
        raise ConfigError(f"{label} must be a repository-relative path")
    resolved = (root / relative).resolve()
    if not resolved.is_relative_to(root):
        raise ConfigError(f"{label} escapes the repository")
    if not resolved.is_file() or resolved.is_symlink():
        raise ConfigError(f"{label} is not a regular source file: {relative}")
    return resolved


def _directory(root: Path, value: Any, label: str) -> Path:
    relative = Path(_text(value, label))
    if relative.is_absolute() or ".." in relative.parts:
        raise ConfigError(f"{label} must be a repository-relative path")
    resolved = (root / relative).resolve()
    if not resolved.is_relative_to(root) or not resolved.is_dir() or resolved.is_symlink():
        raise ConfigError(f"{label} is not a regular source directory: {relative}")
    return resolved


def load_config(path: Path) -> VaultConfig:
    config_path = path.resolve()
    raw = _object(json.loads(config_path.read_text(encoding="utf-8")), "config")
    if raw.get("schemaVersion") != 1:
        raise ConfigError("schemaVersion must be 1")
    repo_root = (config_path.parent / raw.get("repoRoot", ".")).resolve()
    profile = _text(raw.get("profile"), "profile")
    if profile not in PROFILES:
        raise ConfigError(f"unsupported profile: {profile}")

    pages: list[ReaderPage] = []
    page_ids: set[str] = set()
    for index, item in enumerate(raw.get("reader", [])):
        row = _object(item, f"reader[{index}]")
        page_id = _text(row.get("id"), f"reader[{index}].id")
        if page_id in page_ids:
            raise ConfigError(f"duplicate reader id: {page_id}")
        page_ids.add(page_id)
        pages.append(
            ReaderPage(
                page_id=page_id,
                title=_text(row.get("title"), f"reader[{index}].title"),
                source=_source(repo_root, row.get("source"), f"reader[{index}].source"),
                preview=bool(row.get("preview", False)),
            )
        )
    if not pages:
        raise ConfigError("reader must contain at least one page")

    evidence: list[EvidenceTarget] = []
    target_ids: set[str] = set()
    for index, item in enumerate(raw.get("evidence", [])):
        row = _object(item, f"evidence[{index}]")
        target_id = _text(row.get("id"), f"evidence[{index}].id")
        if target_id in target_ids:
            raise ConfigError(f"duplicate evidence id: {target_id}")
        target_ids.add(target_id)
        references = tuple(row.get("referencedBy", []))
        unknown = sorted(set(references) - page_ids)
        if unknown:
            raise ConfigError(f"{target_id} references unknown pages: {', '.join(unknown)}")
        evidence.append(
            EvidenceTarget(
                target_id=target_id,
                kind=_text(row.get("kind"), f"evidence[{index}].kind"),
                source=_source(repo_root, row.get("source"), f"evidence[{index}].source"),
                label=_text(row.get("label", target_id), f"evidence[{index}].label"),
                rights=_text(row.get("rights", "redistributable"), f"evidence[{index}].rights"),
                referenced_by=references,
                metadata=_object(row.get("metadata", {}), f"evidence[{index}].metadata"),
            )
        )

    collections: list[EvidenceCollection] = []
    collection_ids: set[str] = set()
    for index, item in enumerate(raw.get("collections", [])):
        row = _object(item, f"collections[{index}]")
        collection_id = _text(row.get("id"), f"collections[{index}].id")
        if collection_id in collection_ids or collection_id in target_ids:
            raise ConfigError(f"duplicate evidence or collection id: {collection_id}")
        collection_ids.add(collection_id)
        references = tuple(row.get("referencedBy", []))
        unknown = sorted(set(references) - page_ids)
        if unknown:
            raise ConfigError(f"{collection_id} references unknown pages: {', '.join(unknown)}")
        collections.append(
            EvidenceCollection(
                collection_id=collection_id,
                kind=_text(row.get("kind"), f"collections[{index}].kind"),
                source=_directory(repo_root, row.get("source"), f"collections[{index}].source"),
                include=tuple(row.get("include", ["*", "**/*"])),
                exclude=tuple(row.get("exclude", [])),
                rights=_text(row.get("rights", "redistributable"), f"collections[{index}].rights"),
                referenced_by=references,
            )
        )

    products: dict[str, Product] = {}
    for name, item in _object(raw.get("products"), "products").items():
        if name not in PRODUCTS:
            raise ConfigError(f"unsupported product: {name}")
        row = _object(item, f"products.{name}")
        output = Path(_text(row.get("output"), f"products.{name}.output"))
        if output.is_absolute() or ".." in output.parts:
            raise ConfigError(f"products.{name}.output must be repository-relative")
        products[name] = Product(
            name=name,
            output=(repo_root / output).resolve(),
            edition=_text(row.get("edition", "preview" if name == "preview" else "full"), f"products.{name}.edition"),
            max_files=row.get("maxFiles"),
            max_bytes=row.get("maxBytes"),
        )
    if not products:
        raise ConfigError("products must not be empty")

    return VaultConfig(
        config_path=config_path,
        repo_root=repo_root,
        slug=_text(raw.get("slug"), "slug"),
        title=_text(raw.get("title"), "title"),
        profile=profile,
        source_commit=_text(raw.get("sourceCommit"), "sourceCommit"),
        pages=tuple(pages),
        evidence=tuple(evidence),
        collections=tuple(collections),
        products=products,
        plugin=bool(raw.get("plugin", True)),
    )
