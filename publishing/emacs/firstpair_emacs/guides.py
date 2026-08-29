"""Layered first-use guide for an Emacs bundle.

The same rule as the vault guide applies: a bundle ships one complete manual
that quotes the shared instructions rather than sending a first-time user to
chase links. Four layers compose it — the shared Emacs handbook, one product
module, one profile module, and the title's own notes.
"""

from __future__ import annotations

from pathlib import Path

from .config import EmacsConfig
from .projection import Projection


GUIDE_ROOT = Path(__file__).resolve().parents[1] / "guides"
HANDBOOK_URL = "https://firstpair.org/emacs/"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def compose(
    config: EmacsConfig,
    projection: Projection,
    *,
    source_revision: str,
    lexicon_summary: str = "",
) -> str:
    title = config.core.title
    introduction = f"""# {title}: Emacs Edition Guide

This is the complete first-use manual for the **{projection.product.name}** Emacs
bundle of *{title}*. You do not need previous Emacs experience beyond starting
it. Begin with "Open the book", then read the reader keys, then the notes for
this book near the end.

The maintained web edition of the shared handbook is at [{HANDBOOK_URL}]({HANDBOOK_URL}).
"""
    sections = [
        introduction.strip(),
        _read(GUIDE_ROOT / "master.md"),
        _read(GUIDE_ROOT / "profiles" / f"{config.core.profile}.md"),
        _read(GUIDE_ROOT / "products" / f"{projection.product.name}.md"),
    ]
    if lexicon_summary:
        sections.append(lexicon_summary.strip())
    if config.book_guide:
        sections.append("## Instructions specific to this book\n\n" + _read(config.book_guide))
    sections.append(
        "## Build identity\n\n"
        f"- Source revision: `{source_revision}`\n"
        f"- Profile: `{config.core.profile}`\n"
        f"- Product: `{projection.product.name}`\n"
        f"- Edition: `{projection.product.edition}`\n"
        f"- Reader manual: `{config.reader_stem}.info`\n"
        f"- Reference manual: `{config.reference_stem}.info`"
    )
    return "\n\n".join(sections).rstrip() + "\n"
