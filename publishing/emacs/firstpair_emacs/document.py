"""The canonical document model shared by every FirstPair Emacs writer.

A bundle is projected once into this model and then written twice: as the
Info file the reader opens, and as the Texinfo source that lets anyone rebuild
or re-render the same manual. Both writers consume these structures, so the
two outputs cannot drift apart in content.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Sequence


# --- inline model -----------------------------------------------------------


@dataclass(frozen=True)
class Text:
    text: str


@dataclass(frozen=True)
class Emphasis:
    body: tuple["Inline", ...]
    language: str = ""


@dataclass(frozen=True)
class Strong:
    body: tuple["Inline", ...]


@dataclass(frozen=True)
class Literal:
    text: str


@dataclass(frozen=True)
class Link:
    body: tuple["Inline", ...]
    url: str


@dataclass(frozen=True)
class Reference:
    """A cross-reference to another node, written as an Info menu-style note."""

    label: str
    node: str
    target_id: str = ""
    manual: str = ""


@dataclass(frozen=True)
class FootnoteMark:
    identifier: str


Inline = Text | Emphasis | Strong | Literal | Link | Reference | FootnoteMark


# --- block model ------------------------------------------------------------


@dataclass(frozen=True)
class Heading:
    level: int
    title: str
    anchor: str = ""


@dataclass(frozen=True)
class Paragraph:
    body: tuple[Inline, ...]


@dataclass(frozen=True)
class Quotation:
    blocks: tuple["Block", ...]
    attribution: str = ""
    language: str = ""


@dataclass(frozen=True)
class ItemList:
    items: tuple[tuple["Block", ...], ...]
    ordered: bool = False


@dataclass(frozen=True)
class Table:
    header: tuple[str, ...]
    rows: tuple[tuple[str, ...], ...]


@dataclass(frozen=True)
class Figure:
    caption: tuple[Inline, ...]
    source: str


@dataclass(frozen=True)
class Preformatted:
    text: str


@dataclass(frozen=True)
class Rule:
    pass


@dataclass(frozen=True)
class Footnote:
    identifier: str
    blocks: tuple["Block", ...]


Block = Heading | Paragraph | Quotation | ItemList | Table | Figure | Preformatted | Rule | Footnote


# --- node model -------------------------------------------------------------


@dataclass
class Node:
    """One Info node: the unit the reader moves through with n, p, u and l."""

    name: str
    title: str
    blocks: tuple[Block, ...] = ()
    children: list["Node"] = field(default_factory=list)
    menu: tuple[tuple[str, str], ...] = ()
    kind: str = "page"
    page_id: str = ""
    description: str = ""

    def walk(self) -> Iterable["Node"]:
        yield self
        for child in self.children:
            yield from child.walk()


@dataclass
class Manual:
    """A complete Info file: one top node, a node tree, and its identity."""

    filename: str
    title: str
    top: Node
    direntry: tuple[str, str, str] = ("Books", "", "")

    def nodes(self) -> list[Node]:
        return list(self.top.walk())


def node_name(title: str, taken: Sequence[str] = ()) -> str:
    """Return an Info-safe, unique node name for a human title.

    Info node names may not contain a comma, a colon, or parentheses, and a
    period ends the target of a labelled cross-reference, so citations such
    as "4.8a" become "4-8a". Leading or trailing whitespace is not preserved
    by readers.
    """

    cleaned = []
    for character in title:
        if character in ",:":
            cleaned.append(" -" if character == ":" else "")
        elif character in "()[]":
            cleaned.append("")
        elif character == ".":
            cleaned.append("-")
        elif character == "\t":
            cleaned.append(" ")
        else:
            cleaned.append(character)
    name = " ".join("".join(cleaned).split()).strip(" .-")
    name = name or "Section"
    if name.lower() == "top":
        name = "Top Matter"
    candidate, ordinal = name, 1
    existing = {value.lower() for value in taken}
    while candidate.lower() in existing:
        ordinal += 1
        candidate = f"{name} {ordinal}"
    return candidate


def anchor_name(prefix: str, title: str, taken: Sequence[str] = ()) -> str:
    slug = "".join(
        character.lower() if character.isalnum() else "-" for character in title
    ).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    base = f"{prefix}-{slug}" if slug else prefix
    candidate, ordinal = base, 1
    existing = set(taken)
    while candidate in existing:
        ordinal += 1
        candidate = f"{base}-{ordinal}"
    return candidate


def plain_text(inlines: Iterable[Inline]) -> str:
    """Flatten inline content to the text a search or an index should see."""

    parts: list[str] = []
    for item in inlines:
        if isinstance(item, Text):
            parts.append(item.text)
        elif isinstance(item, (Emphasis, Strong, Link)):
            parts.append(plain_text(item.body))
        elif isinstance(item, Literal):
            parts.append(item.text)
        elif isinstance(item, Reference):
            parts.append(item.label)
    return "".join(parts)


def block_text(blocks: Iterable[Block]) -> str:
    parts: list[str] = []
    for block in blocks:
        if isinstance(block, Paragraph):
            parts.append(plain_text(block.body))
        elif isinstance(block, Heading):
            parts.append(block.title)
        elif isinstance(block, Quotation):
            parts.append(block_text(block.blocks))
        elif isinstance(block, ItemList):
            parts.extend(block_text(item) for item in block.items)
        elif isinstance(block, Table):
            parts.append(" ".join(block.header))
            parts.extend(" ".join(row) for row in block.rows)
        elif isinstance(block, Figure):
            parts.append(plain_text(block.caption))
        elif isinstance(block, Preformatted):
            parts.append(block.text)
        elif isinstance(block, Footnote):
            parts.append(block_text(block.blocks))
    return "\n".join(parts)
