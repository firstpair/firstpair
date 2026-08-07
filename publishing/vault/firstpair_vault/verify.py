from __future__ import annotations

import json
from pathlib import Path

from .inventory import inventory


MANIFEST = "FIRSTPAIR-VAULT-MANIFEST.json"


def verify_composed_vault(root: Path) -> dict[str, object]:
    """Verify a final native composition against its sealed file inventory."""

    root = root.resolve(strict=True)
    manifest_path = root / MANIFEST
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if payload.get("schema") != "firstpair-native-vault-manifest-v1":
        raise ValueError("unsupported composed vault manifest")
    scanned = inventory(root)
    current_files = dict(scanned.files)
    current_files.pop(MANIFEST, None)
    if current_files != payload.get("files"):
        raise ValueError("composed vault files differ from the sealed manifest")
    bytes_without_manifest = scanned.bytes - manifest_path.stat().st_size
    if bytes_without_manifest != payload.get("totalBytes"):
        raise ValueError("composed vault byte total differs from the sealed manifest")
    if scanned.critical_broken_links or scanned.unsafe_paths:
        raise ValueError(
            "composed vault violates shared safety gates: "
            f"{scanned.critical_broken_links + scanned.unsafe_paths}"
        )
    return {
        "passed": True,
        "vault": str(root),
        "sourceCommit": payload.get("sourceCommit"),
        "product": payload.get("product"),
        "files": len(current_files),
        "totalBytes": bytes_without_manifest,
        "nativeValidator": payload.get("nativeValidator"),
    }
