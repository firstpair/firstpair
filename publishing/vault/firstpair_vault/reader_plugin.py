"""Where FirstPair's Obsidian plugins come from.

FirstPair Reader and FirstPair Triptych live in their own repository,
``firstpair-reader`` (github.com/firstpair/firstpair-reader). Its root is
``$FIRSTPAIR_READER_ROOT``, by default ``~/src/firstpair-reader``; a plugin's
release files are ``plugins/<plugin>/{manifest.json,main.js,styles.css}``
(plus its ``README.md``).

Release files are read with ``git show <ref>:<path>``, where ``<ref>`` is
``$FIRSTPAIR_READER_REF`` (default ``HEAD``), so a half-made working tree
is never installed into a vault.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

ROOT_ENV = "FIRSTPAIR_READER_ROOT"
REF_ENV = "FIRSTPAIR_READER_REF"
DEFAULT_ROOT = Path.home() / "src" / "firstpair-reader"

READER = "firstpair-reader"
TRIPTYCH = "firstpair-triptych"
RELEASE_FILES = ("README.md", "main.js", "manifest.json", "styles.css")


def reader_root() -> Path:
    """The firstpair-reader checkout: ``$FIRSTPAIR_READER_ROOT`` or ``~/src/firstpair-reader``."""
    configured = os.environ.get(ROOT_ENV)
    return Path(configured).expanduser() if configured else DEFAULT_ROOT


def reader_ref() -> str:
    """The commit to install from: ``$FIRSTPAIR_READER_REF`` or ``HEAD``."""
    return os.environ.get(REF_ENV) or "HEAD"


def release_path(plugin: str, name: str) -> str:
    """A release file's path inside the firstpair-reader repository."""
    return f"plugins/{plugin}/{name}"


def release_file(plugin: str, name: str, *, root: Path | None = None, ref: str | None = None) -> bytes:
    """A release file of ``plugin`` as committed in firstpair-reader."""
    root = root or reader_root()
    ref = ref or reader_ref()
    if not (root / ".git").exists():
        raise FileNotFoundError(
            f"firstpair-reader is not checked out at {root}; clone "
            f"github.com/firstpair/firstpair-reader there or set {ROOT_ENV}"
        )
    result = subprocess.run(
        ["git", "-C", str(root), "show", f"{ref}:{release_path(plugin, name)}"],
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        raise FileNotFoundError(
            f"{plugin} release file {name} is not committed at {ref} in {root}: "
            + result.stderr.decode("utf-8", "replace").strip()
        )
    return result.stdout


def release_version(plugin: str, *, root: Path | None = None, ref: str | None = None) -> str:
    """The committed ``manifest.json`` version of ``plugin``."""
    return json.loads(release_file(plugin, "manifest.json", root=root, ref=ref))["version"]


def install(plugin: str, destination: Path, *, root: Path | None = None, ref: str | None = None) -> None:
    """Write ``plugin``'s committed release files into ``destination``."""
    files = {name: release_file(plugin, name, root=root, ref=ref) for name in RELEASE_FILES}
    destination.mkdir(parents=True, exist_ok=True)
    for name, payload in files.items():
        (destination / name).write_bytes(payload)
