from __future__ import annotations

from pathlib import Path

from .model import Projection, VaultConfig


GUIDE_ROOT = Path(__file__).resolve().parents[1] / "guides"
MASTER_URL = "https://firstpair.org/obsidian/"
OMNIGHOST_URL = "https://firstpair.org/read/omnighost/"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def compose_guide(
    config: VaultConfig,
    projection: Projection,
    *,
    source_revision: str | None = None,
) -> str:
    introduction = f"""<!-- firstpair-vault-guide-v2 -->

# {config.title}: Obsidian Vault Guide

Welcome. This is the complete first-use manual for the **{projection.product.name}**
vault accompanying *{config.title}*. You do not need previous Obsidian
experience. Begin with “Install Obsidian,” then return to the book-specific
notes near the end.

The maintained web edition of the general handbook is at
[{MASTER_URL}]({MASTER_URL}). For publishing from Obsidian, read
[*Omnighost for First Pair Press*]({OMNIGHOST_URL}).
"""
    sections = [
        introduction.strip(),
        _read(GUIDE_ROOT / "master.md"),
        _read(GUIDE_ROOT / "profiles" / f"{config.profile}.md"),
        _read(GUIDE_ROOT / "products" / f"{projection.product.name}.md"),
    ]
    if config.book_guide:
        sections.append("## Instructions specific to this book\n\n" + _read(config.book_guide))
    else:
        sections.append(
            "## Instructions specific to this book\n\n"
            "Open `Home.md`, choose **Open the Reader**, and use the Files pane "
            "to explore the evidence included with this edition."
        )
    sections.append(
        "## Build identity\n\n"
        f"- Source revision: `{source_revision or config.source_commit}`\n"
        f"- Vault profile: `{config.profile}`\n"
        f"- Product: `{projection.product.name}`\n"
        f"- Edition: `{projection.product.edition}`"
    )
    return "\n\n".join(sections).rstrip() + "\n"
