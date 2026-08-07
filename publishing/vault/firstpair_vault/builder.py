from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
from fnmatch import fnmatch
from pathlib import Path

from .config import load_config
from .guides import compose_guide
from .inventory import inventory
from .model import Projection
from .profiles import validate_collection_kinds, validate_evidence
from .projection import project
from .revisions import require_clean_worktree, resolve_source_commit


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = PACKAGE_ROOT / "plugin" / "firstpair-reader"
ARCHIVER = PACKAGE_ROOT.parents[1] / "scripts" / "archive-vault.py"


def _safe_name(value: str) -> str:
    return "".join(character if character.isalnum() or character in " -_." else "-" for character in value).strip()


def _first_open_bytes() -> bytes:
    specification = importlib.util.spec_from_file_location("firstpair_archive_vault", ARCHIVER)
    if specification is None or specification.loader is None:
        raise RuntimeError(f"could not load canonical workspace contract: {ARCHIVER}")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module.FIRST_OPEN_BYTES


def _process_gate() -> None:
    if os.uname().sysname != "Darwin":
        return
    result = subprocess.run(["pgrep", "-x", "Obsidian"], check=False, capture_output=True)
    if result.returncode == 0:
        raise RuntimeError("Obsidian is running; quit it fully before building a vault")
    if result.returncode not in {1}:
        raise RuntimeError("could not determine whether Obsidian is running")


def _verify_source_revision(config) -> str:
    revision = resolve_source_commit(config.repo_root, config.source_commit)
    require_clean_worktree(config.repo_root)
    return revision


def plan_vault(config_path: Path, product_name: str) -> dict[str, object]:
    config = load_config(config_path)
    validate_evidence(config.profile, config.evidence)
    validate_collection_kinds(config.profile, config.collections)
    projection = project(config, product_name)
    return {
        "slug": config.slug,
        "title": config.title,
        "profile": config.profile,
        "product": product_name,
        "edition": projection.product.edition,
        "output": str(projection.product.output),
        "readerPages": len(projection.pages),
        "evidenceTargets": len(projection.evidence),
        "evidenceCollections": len(projection.collections),
        "sourceCommit": resolve_source_commit(config.repo_root, config.source_commit),
    }


def _write_projection(root: Path, projection: Projection, config, source_revision: str) -> None:
    reader_root = root / "Reader"
    evidence_root = root / "Evidence"
    data_root = root / "_data"
    reader_root.mkdir(parents=True)
    evidence_root.mkdir()
    data_root.mkdir()

    page_rows = []
    for position, page in enumerate(projection.pages, start=1):
        filename = f"{position:03d} - {_safe_name(page.title)}.md"
        destination = reader_root / filename
        destination.write_text(page.source.read_text(encoding="utf-8"), encoding="utf-8")
        page_rows.append({"id": page.page_id, "title": page.title, "path": f"Reader/{filename}"})

    target_rows = []
    for target in projection.evidence:
        suffix = target.source.suffix or ".txt"
        filename = f"{_safe_name(target.target_id)}{suffix}"
        destination = evidence_root / filename
        shutil.copyfile(target.source, destination)
        target_rows.append(
            {
                "id": target.target_id,
                "kind": target.kind,
                "label": target.label,
                "path": f"Evidence/{filename}",
                "rights": target.rights,
                "referencedBy": list(target.referenced_by),
                "metadata": target.metadata,
            }
        )

    for collection in projection.collections:
        collection_root = evidence_root / _safe_name(collection.collection_id)
        copied = 0
        for source in sorted(collection.source.rglob("*")):
            relative = source.relative_to(collection.source)
            if source.is_symlink():
                raise RuntimeError(f"collection contains a symlink: {collection.collection_id}/{relative}")
            if not source.is_file():
                continue
            path_text = relative.as_posix()
            if not any(fnmatch(path_text, pattern) for pattern in collection.include):
                continue
            if any(fnmatch(path_text, pattern) for pattern in collection.exclude):
                continue
            destination = collection_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
            copied += 1
        target_rows.append(
            {
                "id": collection.collection_id,
                "kind": collection.kind,
                "path": f"Evidence/{_safe_name(collection.collection_id)}",
                "rights": collection.rights,
                "referencedBy": list(collection.referenced_by),
                "fileCount": copied,
            }
        )

    (data_root / "reader.json").write_text(json.dumps(page_rows, indent=2) + "\n", encoding="utf-8")
    (data_root / "targets.json").write_text(json.dumps(target_rows, indent=2) + "\n", encoding="utf-8")
    home = (
        f"# {config.title}\n\n"
        f"[[Reader/001 - {_safe_name(projection.pages[0].title)}|Open the Reader]]\n\n"
        "[[Guide|First time using Obsidian? Read the complete Vault Guide.]]\n"
    )
    (root / "Home.md").write_text(home, encoding="utf-8")
    guide = compose_guide(config, projection, source_revision=source_revision)
    (root / "Guide.md").write_text(guide, encoding="utf-8")
    (root / "README.md").write_text(guide, encoding="utf-8")
    obsidian = root / ".obsidian"
    obsidian.mkdir()
    (obsidian / "community-plugins.json").write_text("[]\n", encoding="utf-8")
    (obsidian / "core-plugins.json").write_text(
        json.dumps(["file-explorer", "search", "bookmarks", "outline"], indent=2) + "\n",
        encoding="utf-8",
    )
    (obsidian / "workspace-first-open.json").write_bytes(_first_open_bytes())
    if config.plugin:
        shutil.copytree(PLUGIN_ROOT, obsidian / "plugins" / "firstpair-reader")


def _manifest(root: Path, config, projection: Projection, source_revision: str) -> dict[str, object]:
    scanned = inventory(root)
    payload = {
        "schema": "firstpair-vault-manifest-v2",
        "slug": config.slug,
        "title": config.title,
        "profile": config.profile,
        "product": projection.product.name,
        "edition": projection.product.edition,
        "sourceCommit": source_revision,
        "readerPages": len(projection.pages),
        "evidenceTargets": len(projection.evidence),
        "evidenceCollections": len(projection.collections),
        "capabilities": ["reader", f"profile:{config.profile}"],
        "files": scanned.files,
        "totalBytes": scanned.bytes,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    payload["manifestDigest"] = hashlib.sha256(encoded).hexdigest()
    return payload


def build_vault(config_path: Path, product_name: str) -> dict[str, object]:
    _process_gate()
    config = load_config(config_path)
    validate_evidence(config.profile, config.evidence)
    validate_collection_kinds(config.profile, config.collections)
    source_revision = _verify_source_revision(config)
    projection = project(config, product_name)
    destination = projection.product.output
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{destination.name}-", dir=destination.parent) as temporary:
        candidate = Path(temporary) / destination.name
        candidate.mkdir()
        _write_projection(candidate, projection, config, source_revision)
        manifest = _manifest(candidate, config, projection, source_revision)
        (candidate / "VAULT-MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        scanned = inventory(candidate)
        if scanned.critical_broken_links or scanned.unsafe_paths:
            raise RuntimeError(
                f"candidate validation failed: {scanned.critical_broken_links + scanned.unsafe_paths}"
            )
        if projection.product.max_files is not None and len(scanned.files) > projection.product.max_files:
            raise RuntimeError("candidate exceeds maxFiles")
        if projection.product.max_bytes is not None and scanned.bytes > projection.product.max_bytes:
            raise RuntimeError("candidate exceeds maxBytes")
        if destination.exists():
            raise RuntimeError(f"refusing to replace existing vault: {destination}")
        candidate.rename(destination)
    return manifest
