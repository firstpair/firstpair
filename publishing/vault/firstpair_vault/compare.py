from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .inventory import Inventory, inventory


def _metric(value: Inventory) -> dict[str, int]:
    return {
        "files": len(value.files),
        "bytes": value.bytes,
        "markdown": value.markdown,
        "images": value.images,
        "brokenLinks": len(value.broken_links),
        "criticalBrokenLinks": len(value.critical_broken_links),
        "unsafePaths": len(value.unsafe_paths),
    }


def _manifest(root: Path) -> dict[str, Any]:
    path = root / "VAULT-MANIFEST.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def _semantic(root: Path) -> dict[str, int]:
    files = [path for path in root.rglob("*") if path.is_file() and not path.is_symlink()]
    relative = [path.relative_to(root).as_posix() for path in files]
    return {
        "readerPages": sum(
            any(part in {"Reader", "Chapters"} for part in Path(path).parts) and path.endswith(".md")
            for path in relative
        ),
        "codeFiles": sum("/Code/" in f"/{path}" or path.startswith("Code/") for path in relative),
        "sourceDocuments": sum(
            any(part in {"Sources", "Source Files", "Anthology", "Bilingual Sources"} for part in Path(path).parts)
            and path.endswith((".md", ".json", ".jsonl"))
            for path in relative
        ),
        "triptychDocuments": sum(
            "Triptych" in Path(path).parts and path.endswith((".md", ".json")) for path in relative
        ),
        "pluginFiles": sum(".obsidian/plugins/" in f"/{path}" for path in relative),
        "evidenceFiles": sum(path.startswith("Evidence/") for path in relative),
    }


def baseline_contract(root: Path) -> dict[str, Any]:
    scanned = inventory(root)
    required = [path for path in ("Home.md", "README.md") if (root / path).exists()]
    return {
        "schema": "firstpair-vault-qa-v1",
        "baselineMetrics": _metric(scanned),
        "semanticMinimums": _semantic(root.resolve()),
        "requiredPaths": required,
        "manifestNotLessThan": ["readerPages", "evidenceTargets"],
        "forbiddenGlobs": ["**/.git/**", "**/.DS_Store", "**/workspace.json", "**/workspace-mobile.json"],
        "reviewPaths": [],
    }


def compare_vaults(baseline_root: Path, candidate_root: Path, contract_path: Path | None = None) -> dict[str, Any]:
    baseline = inventory(baseline_root)
    candidate = inventory(candidate_root)
    contract = json.loads(contract_path.read_text(encoding="utf-8")) if contract_path else {}
    minimums = contract.get("minimums", {})
    semantic_minimums = contract.get("semanticMinimums", {})
    hard: list[str] = []
    warnings: list[str] = []

    if not (candidate.root / "Home.md").is_file():
        hard.append("candidate is missing root Home.md")
    if candidate.critical_broken_links:
        hard.append(f"candidate has {len(candidate.critical_broken_links)} broken Reader or Home links")
    if candidate.unsafe_paths:
        hard.append(f"candidate has {len(candidate.unsafe_paths)} unsafe or private paths")
    if len(candidate.broken_links) > len(baseline.broken_links):
        hard.append("candidate has more broken links than baseline")
    for metric in ("files", "bytes", "markdown", "images"):
        floor = minimums.get(metric)
        actual = _metric(candidate)[metric]
        if floor is not None and actual < floor:
            hard.append(f"candidate {metric} {actual} is below contract minimum {floor}")
    candidate_semantic = _semantic(candidate.root)
    for metric, floor in semantic_minimums.items():
        actual = candidate_semantic.get(metric, 0)
        if actual < floor:
            hard.append(f"candidate semantic metric {metric} {actual} is below baseline {floor}")

    baseline_manifest = _manifest(baseline.root)
    candidate_manifest = _manifest(candidate.root)
    for field in contract.get("manifestNotLessThan", ["readerPages", "evidenceTargets"]):
        old = baseline_manifest.get(field)
        new = candidate_manifest.get(field)
        if old is not None and (new is None or new < old):
            hard.append(f"candidate manifest {field} regressed from {old} to {new}")
    for path in contract.get("requiredPaths", []):
        if not (candidate.root / path).exists():
            hard.append(f"candidate is missing required path: {path}")
    for pattern in contract.get("requiredGlobs", []):
        if not any(candidate.root.glob(pattern)):
            hard.append(f"candidate does not match required glob: {pattern}")
    for pattern in contract.get("forbiddenGlobs", []):
        if any(candidate.root.glob(pattern)):
            hard.append(f"candidate matches forbidden glob: {pattern}")
    for path in contract.get("reviewPaths", []):
        if baseline.files.get(path) != candidate.files.get(path):
            warnings.append(f"review required for changed path: {path}")

    return {
        "schema": "firstpair-vault-comparison-v1",
        "baseline": _metric(baseline),
        "candidate": _metric(candidate),
        "baselineSemantic": _semantic(baseline.root),
        "candidateSemantic": candidate_semantic,
        "hardRegressions": sorted(set(hard)),
        "reviewWarnings": sorted(set(warnings)),
        "passed": not hard,
    }
