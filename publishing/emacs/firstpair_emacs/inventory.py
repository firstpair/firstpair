"""File inventory and the safety gates every bundle must pass."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path


FORBIDDEN_NAMES = {".DS_Store", ".git", ".gitignore", "Thumbs.db"}
FORBIDDEN_SUFFIXES = {".elc", ".pyc", ".orig", ".rej"}


@dataclass(frozen=True)
class Inventory:
    files: dict[str, str]
    bytes: int
    unsafe: tuple[str, ...]


def scan(root: Path) -> Inventory:
    files: dict[str, str] = {}
    total = 0
    unsafe: list[str] = []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            unsafe.append(f"symlink: {relative}")
            continue
        if path.is_dir():
            if path.name in FORBIDDEN_NAMES:
                unsafe.append(f"forbidden directory: {relative}")
            continue
        if not path.is_file():
            unsafe.append(f"not a regular file: {relative}")
            continue
        if path.name in FORBIDDEN_NAMES or path.suffix in FORBIDDEN_SUFFIXES:
            unsafe.append(f"forbidden file: {relative}")
            continue
        if ".." in Path(relative).parts:
            unsafe.append(f"path traversal: {relative}")
            continue
        payload = path.read_bytes()
        files[relative] = hashlib.sha256(payload).hexdigest()
        total += len(payload)
    return Inventory(files=files, bytes=total, unsafe=tuple(unsafe))
