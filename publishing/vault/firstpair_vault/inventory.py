from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path


WIKI_LINK = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]")
MARKDOWN_LINK = re.compile(r"\[[^\]]*\]\((?!https?://|mailto:|obsidian:)([^)#]+)(?:#[^)]+)?\)")


@dataclass(frozen=True)
class Inventory:
    root: Path
    files: dict[str, str]
    bytes: int
    markdown: int
    images: int
    broken_links: tuple[str, ...]
    critical_broken_links: tuple[str, ...]
    unsafe_paths: tuple[str, ...]


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def inventory(root: Path) -> Inventory:
    root = root.resolve()
    files: dict[str, str] = {}
    total = 0
    markdown = 0
    images = 0
    broken: list[str] = []
    critical_broken: list[str] = []
    unsafe: list[str] = []
    paths = [path for path in sorted(root.rglob("*")) if path.is_file() or path.is_symlink()]
    note_paths = {
        path.relative_to(root).with_suffix("").as_posix()
        for path in paths
        if path.is_file() and path.suffix.lower() == ".md"
    }
    note_names = {Path(path).name for path in note_paths}
    for path in paths:
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            unsafe.append(f"symlink:{relative}")
            continue
        if not path.is_file():
            continue
        if ".git" in path.parts or path.name in {"workspace.json", "workspace-mobile.json", ".DS_Store"}:
            unsafe.append(f"private:{relative}")
        files[relative] = digest(path)
        total += path.stat().st_size
        if path.suffix.lower() == ".md":
            markdown += 1
            text = path.read_text(encoding="utf-8", errors="replace")
            for target in WIKI_LINK.findall(text):
                target_path = Path(target)
                relative_target = (path.parent / target_path).resolve()
                root_target = (root / target_path).resolve()
                resolved = any(
                    choice.is_file() and choice.is_relative_to(root)
                    for base in (relative_target, root_target)
                    for choice in (base, base.with_suffix(".md"))
                ) or target_path.with_suffix("").name in note_names
                if not resolved:
                    finding = f"{relative}->{target}"
                    broken.append(finding)
                    if relative == "Home.md" or "Reader" in Path(relative).parts:
                        critical_broken.append(finding)
            for target in MARKDOWN_LINK.findall(text):
                candidate = (path.parent / target).resolve()
                if not candidate.is_file() or not candidate.is_relative_to(root):
                    finding = f"{relative}->{target}"
                    broken.append(finding)
                    if relative == "Home.md" or "Reader" in Path(relative).parts:
                        critical_broken.append(finding)
        if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}:
            images += 1
    return Inventory(
        root,
        files,
        total,
        markdown,
        images,
        tuple(sorted(broken)),
        tuple(sorted(critical_broken)),
        tuple(sorted(unsafe)),
    )
