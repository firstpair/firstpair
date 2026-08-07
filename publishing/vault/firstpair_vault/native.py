from __future__ import annotations

import json
from pathlib import Path
import subprocess

from .guides import compose_guide
from .inventory import inventory
from .workspace import first_open_bytes


def _command(
    arguments: tuple[str, ...], *, output: Path, guide: Path, product: str
) -> list[str]:
    replacements = {
        "{output}": str(output),
        "{guide}": str(guide),
        "{product}": product,
    }
    return [
        argument.replace("{output}", replacements["{output}"]).replace(
            "{guide}", replacements["{guide}"]
        ).replace("{product}", replacements["{product}"])
        for argument in arguments
    ]


def build_native_candidate(root: Path, config, projection, source_revision: str) -> dict[str, object]:
    driver = config.native_driver
    if driver is None:
        raise RuntimeError("native driver is not configured")
    guide = root.parent / f".{root.name}-guide.md"
    guide.write_text(
        compose_guide(config, projection, source_revision=source_revision),
        encoding="utf-8",
    )
    try:
        subprocess.run(
            _command(
                driver.build,
                output=root,
                guide=guide,
                product=projection.product.name,
            ),
            cwd=config.repo_root,
            check=True,
        )
        if not root.is_dir() or root.is_symlink():
            raise RuntimeError("native builder did not create its candidate directory")
        subprocess.run(
            _command(
                driver.validate,
                output=root,
                guide=guide,
                product=projection.product.name,
            ),
            cwd=config.repo_root,
            check=True,
        )
        complete_guide = guide.read_text(encoding="utf-8")
        (root / "Guide.md").write_text(complete_guide, encoding="utf-8")
        (root / "README.md").write_text(complete_guide, encoding="utf-8")
        obsidian = root / ".obsidian"
        obsidian.mkdir(exist_ok=True)
        for private_name in ("workspace.json", "workspace-mobile.json", "workspaces.json"):
            (obsidian / private_name).unlink(missing_ok=True)
        (obsidian / "workspace-first-open.json").write_bytes(first_open_bytes())
        scanned = inventory(root)
        if scanned.critical_broken_links or scanned.unsafe_paths:
            raise RuntimeError(
                f"native candidate validation failed: "
                f"{scanned.critical_broken_links + scanned.unsafe_paths}"
            )
        payload = {
            "schema": "firstpair-native-vault-manifest-v1",
            "slug": config.slug,
            "profile": config.profile,
            "product": projection.product.name,
            "edition": projection.product.edition,
            "sourceCommit": source_revision,
            "readerPages": len(projection.pages),
            "files": scanned.files,
            "totalBytes": scanned.bytes,
            "nativeValidator": list(driver.validate),
        }
        (root / "FIRSTPAIR-VAULT-MANIFEST.json").write_text(
            json.dumps(payload, indent=2) + "\n", encoding="utf-8"
        )
        return payload
    finally:
        guide.unlink(missing_ok=True)
