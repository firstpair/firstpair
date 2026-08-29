"""Product projection: what a given Emacs product is allowed to contain."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any

from firstpair_vault.model import EvidenceCollection, EvidenceTarget, ReaderPage

from .config import EmacsConfig, Product, RecordSet


@dataclass(frozen=True)
class Record:
    record_id: str
    label: str
    kind: str
    section: str
    rights: str
    fields: dict[str, Any]
    referenced_by: tuple[str, ...]
    anchors: tuple[str, ...]
    origin: str


@dataclass(frozen=True)
class Projection:
    product: Product
    pages: tuple[ReaderPage, ...]
    evidence: tuple[EvidenceTarget, ...]
    collections: tuple[EvidenceCollection, ...]
    records: tuple[Record, ...]


def _rows(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    if path.suffix == ".jsonl":
        return [json.loads(line) for line in text.splitlines() if line.strip()]
    payload = json.loads(text)
    if isinstance(payload, dict):
        payload = payload.get("records", [])
    if not isinstance(payload, list):
        raise ValueError(f"record source is not an array: {path}")
    return payload


def _format(template: str, row: dict[str, Any]) -> str:
    result = template
    for key, value in row.items():
        if isinstance(value, (str, int, float)):
            result = result.replace("{" + key + "}", str(value))
    return " ".join(result.split())


def read_records(config: EmacsConfig, record_set: RecordSet, pages: tuple[ReaderPage, ...]) -> list[Record]:
    by_source = {
        str(page.source.relative_to(config.repo_root)): page.page_id for page in pages
    }
    by_id = {page.page_id: page.page_id for page in pages}
    lookup = by_source if record_set.reference_match == "source" else by_id
    merged: dict[str, dict[str, Any]] = {}
    for source, key in record_set.merges:
        for extra in _rows(source):
            extra_id = str(extra.get(key, "")).strip()
            if extra_id:
                merged.setdefault(extra_id, {}).update({name: value for name, value in extra.items() if name != key})
    records: list[Record] = []
    for row in _rows(record_set.source):
        identifier = str(row.get(record_set.identifier, "")).strip()
        if identifier in merged:
            row = {**row, **merged[identifier]}
        if not identifier:
            raise ValueError(f"record without {record_set.identifier}: {record_set.set_id}")
        referenced: list[str] = []
        if record_set.referenced_by:
            values = row.get(record_set.referenced_by, [])
            if isinstance(values, str):
                values = [values]
            referenced = [lookup[value] for value in values if value in lookup]
        anchors: list[str] = []
        for field in record_set.anchors:
            value = row.get(field)
            if isinstance(value, str) and value.strip():
                anchors.append(value.strip())
            elif isinstance(value, list):
                anchors.extend(item.strip() for item in value if isinstance(item, str) and item.strip())
        records.append(
            Record(
                record_id=identifier,
                label=_format(record_set.label, row),
                kind=record_set.kind,
                section=record_set.section,
                rights=record_set.rights,
                fields=row,
                referenced_by=tuple(dict.fromkeys(referenced)),
                anchors=tuple(dict.fromkeys(anchors)),
                origin=record_set.set_id,
            )
        )
    return records


def project(config: EmacsConfig, product_name: str) -> Projection:
    product = config.products[product_name]
    preview = product.edition == "preview"
    pages = tuple(page for page in config.core.pages if not preview or page.preview)
    if not pages:
        raise ValueError("preview product has no selected reader pages")
    page_ids = {page.page_id for page in pages}
    evidence = tuple(
        target
        for target in config.core.evidence
        if not preview or set(target.referenced_by) & page_ids
    )
    collections = tuple(
        collection
        for collection in config.core.collections
        if not preview or set(collection.referenced_by) & page_ids
    )
    records: list[Record] = []
    for record_set in config.records:
        for record in read_records(config, record_set, config.core.pages):
            kept = tuple(item for item in record.referenced_by if item in page_ids)
            if preview and not kept:
                continue
            records.append(Record(**{**record.__dict__, "referenced_by": kept}))
    return Projection(
        product=product,
        pages=pages,
        evidence=evidence,
        collections=collections,
        records=tuple(records),
    )
