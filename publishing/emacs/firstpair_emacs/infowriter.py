"""Deterministic Info file generation.

FirstPair writes Info bytes directly rather than shelling out to makeinfo.
That keeps a bundle buildable on a machine with no Texinfo installation, makes
the output byte-reproducible, and — the reason that matters for the reader —
lets the builder record the exact line and column of every marked span, so the
Emacs reader can highlight Latin words and jump to references without guessing
where the filler put them. The companion Texinfo source is written from the
same model for anyone who wants to re-render the manual.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import re

from .document import (
    Block,
    Emphasis,
    Figure,
    Footnote,
    FootnoteMark,
    Heading,
    Inline,
    ItemList,
    Link,
    Literal,
    Manual,
    Node,
    Paragraph,
    Preformatted,
    Quotation,
    Reference,
    Rule,
    Strong,
    Table,
    Text,
    Verse,
    plain_text,
)
from .markdown import inline as parse_inline


SEPARATOR = "\x1f"
DELIMITER = "\x7f"
OPEN, CLOSE = "\x00", "\x01"
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
WORD = re.compile(r"[^\W\d_]+", re.UNICODE)

FILL_COLUMN = 72
PARAGRAPH_INDENT = 3
QUOTE_INDENT = 5
UNDERLINES = {0: "*", 1: "*", 2: "=", 3: "-", 4: ".", 5: ".", 6: "."}


@dataclass(frozen=True)
class Span:
    node: str
    line: int
    column: int
    length: int
    text: str
    kind: str


@dataclass(frozen=True)
class Region:
    """The lines of one Verse block: a language's text within a unit."""

    node: str
    language: str
    unit: str
    start: int
    end: int
    source: bool


@dataclass
class Rendered:
    data: bytes
    spans: tuple[Span, ...]
    nodes: tuple[str, ...]
    references: dict[str, tuple[dict[str, str], ...]]
    regions: tuple[Region, ...] = ()
    # Indirect (split) manuals: (file name, bytes) for each subfile; empty
    # when the manual fits in one file. `data` is then the main file.
    subfiles: tuple[tuple[str, bytes], ...] = ()


# A manual larger than this is split into subfiles the Info reader loads one
# at a time: Emacs reads a whole Info file into a buffer on first visit, and
# a nine-megabyte book took tens of seconds on a phone.
SPLIT_BYTES = 300_000


@dataclass
class _Buffer:
    """Lines of one node, plus the open spans being tracked through filling."""

    lines: list[str] = field(default_factory=list)
    meta: list[tuple[str, str]] = field(default_factory=list)
    regions: list[tuple[str, str, int, int, bool]] = field(default_factory=list)

    def add(self, line: str) -> None:
        self.lines.append(line)

    def blank(self) -> None:
        if self.lines and self.lines[-1] != "":
            self.lines.append("")


def _clean(text: str) -> str:
    return CONTROL.sub(" ", text)


def _visible(text: str) -> str:
    return text.replace(OPEN, "").replace(CLOSE, "")


def fill(text: str, width: int, indent: int, first_indent: int | None = None) -> list[str]:
    """Wrap marked text to ``width``, ignoring zero-width span markers."""

    words = [word for word in text.split(" ") if word != ""]
    if not words:
        return []
    lines: list[str] = []
    margin = first_indent if first_indent is not None else indent
    current, length = [], 0
    for word in words:
        size = len(_visible(word))
        if current and margin + length + 1 + size > width:
            lines.append(" " * margin + " ".join(current))
            margin, current, length = indent, [word], size
            continue
        length = length + 1 + size if current else size
        current.append(word)
    lines.append(" " * margin + " ".join(current))
    return lines


class InfoWriter:
    def __init__(self, manual: Manual, *, produced_by: str, split_bytes: int = SPLIT_BYTES) -> None:
        self.manual = manual
        self.produced_by = produced_by
        self.split_bytes = split_bytes

    # -- inline rendering ----------------------------------------------------

    def _inline(self, items: tuple[Inline, ...], buffer: _Buffer, footnotes: list[Footnote]) -> str:
        parts: list[str] = []
        for item in items:
            if isinstance(item, Text):
                parts.append(_clean(item.text))
            elif isinstance(item, Emphasis):
                buffer.meta.append(("emphasis", item.language))
                parts.append(OPEN + "_" + self._inline(item.body, buffer, footnotes) + "_" + CLOSE)
            elif isinstance(item, Strong):
                parts.append("*" + self._inline(item.body, buffer, footnotes) + "*")
            elif isinstance(item, Literal):
                parts.append("‘" + _clean(item.text) + "’")
            elif isinstance(item, Link):
                label = self._inline(item.body, buffer, footnotes)
                url = _clean(item.url)
                parts.append(f"{label} ({url})" if label and url not in label else label or url)
            elif isinstance(item, Reference):
                parts.append(self._note(item))
            elif isinstance(item, FootnoteMark):
                index = next(
                    (position + 1 for position, note in enumerate(footnotes) if note.identifier == item.identifier),
                    None,
                )
                if index is not None:
                    parts.append(f"({index})")
        return "".join(parts)

    def _note(self, reference: Reference) -> str:
        """Write REFERENCE in Info syntax.

        A labelled reference ends with a comma rather than a period: Info
        readers hide the comma together with the target, while a period stays
        visible and reads as stray punctuation inside a sentence.
        """

        label = " ".join(_clean(reference.label).replace(":", " -").split())
        node = _clean(reference.node)
        target = f"({reference.manual}){node}" if reference.manual else node
        if label == node and not reference.manual:
            return f"*note {node}::"
        return f"*note {label}: {target},"

    # -- block rendering -----------------------------------------------------

    def _blocks(
        self,
        blocks: tuple[Block, ...],
        buffer: _Buffer,
        footnotes: list[Footnote],
        indent: int = 0,
        *,
        anchors: list[tuple[str, int]] | None = None,
    ) -> None:
        previous_paragraph = False
        for block in blocks:
            if isinstance(block, Footnote):
                continue
            if isinstance(block, Heading):
                buffer.blank()
                if block.anchor and anchors is not None:
                    anchors.append((block.anchor, len(buffer.lines)))
                title = _clean(block.title)
                buffer.add(" " * indent + title)
                buffer.add(" " * indent + UNDERLINES.get(min(block.level, 6), ".") * len(title))
                buffer.blank()
                previous_paragraph = False
            elif isinstance(block, Paragraph):
                text = self._inline(block.body, buffer, footnotes)
                if not _visible(text).strip():
                    continue
                buffer.blank()
                first = indent + PARAGRAPH_INDENT if previous_paragraph else indent
                for line in fill(text, FILL_COLUMN, indent, first):
                    buffer.add(line)
                previous_paragraph = True
            elif isinstance(block, Quotation):
                buffer.blank()
                self._blocks(block.blocks, buffer, footnotes, indent + QUOTE_INDENT, anchors=anchors)
                if block.attribution:
                    buffer.blank()
                    text = OPEN + "_" + _clean(block.attribution) + "_" + CLOSE
                    buffer.meta.append(("attribution", ""))
                    buffer.add(" " * (indent + QUOTE_INDENT + 5) + "-- " + text)
                buffer.blank()
                previous_paragraph = False
            elif isinstance(block, ItemList):
                buffer.blank()
                for position, item in enumerate(block.items, start=1):
                    bullet = f"{position:2d}." if block.ordered else " •"
                    inner = _Buffer(meta=buffer.meta)
                    self._blocks(item, inner, footnotes, 0, anchors=None)
                    rows = [row for row in inner.lines if row.strip()]
                    if not rows:
                        continue
                    lead = " " * indent + bullet + " "
                    buffer.add(lead + rows[0].strip())
                    for row in rows[1:]:
                        buffer.add(" " * (indent + len(bullet) + 1) + row.strip())
                buffer.blank()
                previous_paragraph = False
            elif isinstance(block, Table):
                buffer.blank()
                self._table(block, buffer, footnotes, indent)
                buffer.blank()
                previous_paragraph = False
            elif isinstance(block, Figure):
                buffer.blank()
                caption = self._inline(block.caption, buffer, footnotes)
                for line in fill(f"[Plate: {caption}]", FILL_COLUMN, indent + 3, indent + 3):
                    buffer.add(line)
                buffer.blank()
                previous_paragraph = False
            elif isinstance(block, Preformatted):
                buffer.blank()
                for line in _clean(block.text).split("\n"):
                    buffer.add(" " * (indent + QUOTE_INDENT) + line)
                buffer.blank()
                previous_paragraph = False
            elif isinstance(block, Rule):
                buffer.blank()
                buffer.add(" " * indent + "-" * 20)
                buffer.blank()
                previous_paragraph = False
            elif isinstance(block, Verse):
                buffer.blank()
                margin = indent if block.source else indent + QUOTE_INDENT
                start = len(buffer.lines) + 1
                for line in block.lines:
                    buffer.add(" " * margin + _clean(line))
                buffer.regions.append((block.language, block.unit, start, len(buffer.lines), block.source))
                buffer.blank()
                previous_paragraph = False

    def _table(self, table: Table, buffer: _Buffer, footnotes: list[Footnote], indent: int) -> None:
        columns = max([len(table.header)] + [len(row) for row in table.rows] or [0])
        if not columns:
            return
        widths = [0] * columns
        grid: list[list[str]] = []
        for row in ((table.header,) if table.header else ()) + table.rows:
            rendered = [
                self._inline(parse_inline(cell), buffer, footnotes) if cell else ""
                for cell in list(row) + [""] * (columns - len(row))
            ]
            grid.append(rendered)
        first = 0
        if table.header:
            for position, cell in enumerate(grid[0]):
                widths[position] = max(widths[position], len(_visible(cell)))
            first = 1
        for row in grid[first:]:
            for position, cell in enumerate(row[:-1]):
                widths[position] = max(widths[position], len(_visible(cell)))
        widths = [min(width, 26) for width in widths]
        for position, row in enumerate(grid):
            lead = " " * indent
            pieces = []
            for column, cell in enumerate(row):
                if column == columns - 1:
                    pieces.append(cell)
                else:
                    pieces.append(cell + " " * max(1, widths[column] + 2 - len(_visible(cell))))
            text = lead + "".join(pieces)
            available = FILL_COLUMN - indent - sum(widths[:-1]) - 2 * (columns - 1)
            if len(_visible(text)) > FILL_COLUMN and available > 20:
                head = "".join(pieces[:-1])
                margin = indent + len(_visible(head))
                wrapped = fill(pieces[-1], FILL_COLUMN, margin, margin)
                buffer.add(lead + head + wrapped[0].strip())
                for extra in wrapped[1:]:
                    buffer.add(extra)
            else:
                buffer.add(text.rstrip())
            if position == 0 and table.header:
                buffer.add(lead + "-" * min(FILL_COLUMN - indent, 66))

    # -- node and file assembly ---------------------------------------------

    def _node_text(self, node: Node, header: str) -> tuple[list[str], list[tuple[str, int]], list[tuple[str, str]]]:
        buffer = _Buffer()
        anchors: list[tuple[str, int]] = []
        buffer.add(header)
        buffer.add("")
        title = _clean(node.title)
        buffer.add(title)
        buffer.add(UNDERLINES.get(1, "*") * len(title))
        if node.description:
            buffer.blank()
            for line in fill(_clean(node.description), FILL_COLUMN, 0, 0):
                buffer.add(line)
        footnotes = [block for block in node.blocks if isinstance(block, Footnote)]
        self._blocks(node.blocks, buffer, footnotes, 0, anchors=anchors)
        if node.menu:
            buffer.blank()
            buffer.add("* Menu:")
            buffer.add("")
            width = max((len(name) for name, _ in node.menu), default=0)
            for name, description in node.menu:
                entry = f"* {name}::"
                if description:
                    entry = entry.ljust(width + 4) + "  " + _clean(description)
                buffer.add(entry.rstrip())
        if footnotes:
            buffer.blank()
            buffer.add("   ---------- Footnotes ----------")
            for position, note in enumerate(footnotes, start=1):
                buffer.blank()
                lead = f"   ({position}) "
                inner = _Buffer(meta=buffer.meta)
                head, rest = note.blocks[:1], note.blocks[1:]
                if head and isinstance(head[0], Paragraph):
                    text = self._inline(head[0].body, inner, [])
                    for line in fill(text, FILL_COLUMN, 3, len(lead)):
                        inner.add(line)
                else:
                    self._blocks(head, inner, [], 3)
                self._blocks(rest, inner, [], 3)
                rows = [row for row in inner.lines if row.strip()]
                if not rows:
                    continue
                anchors.append((f"{node.name}-Footnote-{position}", len(buffer.lines)))
                buffer.add(lead + rows[0][len(lead):] if rows[0].startswith(" " * len(lead)) else lead + rows[0].strip())
                for row in rows[1:]:
                    buffer.add(row if row.startswith("   ") else "   " + row.strip())
        buffer.blank()
        return buffer.lines, anchors, buffer.meta, buffer.regions

    def render(self) -> Rendered:
        nodes = self.manual.nodes()
        order = {node.name: position for position, node in enumerate(nodes)}
        parents: dict[str, str] = {}
        for node in nodes:
            for child in node.children:
                parents[child.name] = node.name
        pieces: list[str] = []
        header = f"This is {self.manual.filename}, produced by {self.produced_by}.\n"
        if self.manual.direntry[1]:
            section, name, description = self.manual.direntry
            header += (
                "\nINFO-DIR-SECTION " + section + "\n"
                "START-INFO-DIR-ENTRY\n"
                f"* {name}: ({self.manual.filename.removesuffix('.info')}).   {description}\n"
                "END-INFO-DIR-ENTRY\n"
            )
        pieces.append(header)
        spans: list[Span] = []
        anchor_lines: list[tuple[str, str, int]] = []
        node_starts: list[tuple[str, int]] = []
        references: dict[str, tuple[dict[str, str], ...]] = {}
        body_lines: dict[str, list[str]] = {}
        regions: list[Region] = []
        for node in nodes:
            siblings = [node.name] if node.name not in parents else [
                child.name for child in next(item for item in nodes if item.name == parents[node.name]).children
            ]
            position = siblings.index(node.name) if node.name in siblings else 0
            previous = siblings[position - 1] if position > 0 else parents.get(node.name)
            following = siblings[position + 1] if position + 1 < len(siblings) else None
            if node.name == "Top":
                previous, following = None, (nodes[1].name if len(nodes) > 1 else None)
            fields = [f"File: {self.manual.filename},  Node: {node.name}"]
            if following:
                fields.append(f"Next: {following}")
            if previous:
                fields.append(f"Prev: {previous}")
            fields.append(f"Up: {parents.get(node.name, '(dir)')}")
            lines, anchors, meta, found = self._node_text(node, ",  ".join(fields))
            body_lines[node.name] = lines
            regions.extend(Region(node.name, language, unit, start, end, source) for language, unit, start, end, source in found)
            anchor_lines.extend((name, node.name, line) for name, line in anchors)
            spans.extend(_collect_spans(node.name, lines, meta))
            references[node.name] = tuple(
                {"target": item.target_id, "label": item.label, "node": item.node, "manual": item.manual}
                for item in _references(node.blocks)
            )
        text = pieces[0]
        offsets: dict[str, int] = {}
        anchor_offsets: dict[tuple[str, str], int] = {}
        for node in nodes:
            offsets[node.name] = len(text.encode("utf-8"))
            block = SEPARATOR + "\n" + "\n".join(_strip_markers(line) for line in body_lines[node.name]) + "\n"
            for name, owner, line in anchor_lines:
                if owner != node.name:
                    continue
                consumed = sum(
                    len(_strip_markers(row).encode("utf-8")) + 1
                    for row in body_lines[node.name][:line]
                )
                anchor_offsets[(owner, name)] = (
                    len(text.encode("utf-8")) + len((SEPARATOR + "\n").encode("utf-8")) + consumed
                )
            text += block
            node_starts.append((node.name, offsets[node.name]))
        entries: list[tuple[int, str]] = [(offsets[node.name], f"Node: {node.name}{DELIMITER}{offsets[node.name]}") for node in nodes]
        entries.extend(
            (position, f"Ref: {name}{DELIMITER}{position}") for (_, name), position in anchor_offsets.items()
        )
        tag_rows = [row for _, row in sorted(entries, key=lambda item: (item[0], item[1]))]
        trailer = "\n" + SEPARATOR + "\nLocal Variables:\ncoding: utf-8\nEnd:\n"
        body = text.encode("utf-8")
        preamble_length = len(pieces[0].encode("utf-8"))
        subfiles: list[tuple[str, bytes]] = []
        if len(body) - preamble_length > self.split_bytes and len(node_starts) > 1:
            # Split at node boundaries into subfiles of about `split_bytes`.
            # Tag offsets stay those of the single file; each subfile's
            # Indirect offset is the single-file position of its first node,
            # which is how Emacs's Info-read-subfile locates a node.
            groups: list[list[tuple[str, int]]] = [[]]
            for index, (name, start) in enumerate(node_starts):
                end = node_starts[index + 1][1] if index + 1 < len(node_starts) else len(body)
                current = groups[-1]
                current_size = (end if not current else end - current[0][1])
                if current and current_size > self.split_bytes:
                    groups.append([(name, start)])
                else:
                    current.append((name, start))
            indirect_lines = []
            for number, group in enumerate(groups, 1):
                start = group[0][1]
                end = (groups[number][0][1] if number < len(groups) else len(body))
                subfile_name = f"{self.manual.filename}-{number}"
                header = f"This is {subfile_name}, produced by {self.produced_by}.\n\n".encode("utf-8")
                subfiles.append((subfile_name, header + body[start:end]))
                indirect_lines.append(f"{subfile_name}: {start}")
            main = (
                pieces[0]
                + SEPARATOR + "\nIndirect:\n" + "\n".join(indirect_lines) + "\n"
                + SEPARATOR + "\nTag Table:\n(Indirect)\n" + "\n".join(tag_rows) + "\n"
                + SEPARATOR + "\nEnd Tag Table\n" + trailer
            )
            data = main.encode("utf-8")
        else:
            data = (text + SEPARATOR + "\nTag Table:\n" + "\n".join(tag_rows) + "\n" + SEPARATOR + "\nEnd Tag Table\n" + trailer).encode("utf-8")
        return Rendered(
            data=data,
            spans=tuple(spans),
            nodes=tuple(node.name for node in nodes),
            references=references,
            regions=tuple(regions),
            subfiles=tuple(subfiles),
        )


def _strip_markers(line: str) -> str:
    return _visible(line)


def _references(blocks: tuple[Block, ...]) -> list[Reference]:
    found: list[Reference] = []

    def walk_inlines(items) -> None:
        for item in items:
            if isinstance(item, Reference):
                found.append(item)
            elif isinstance(item, (Emphasis, Strong, Link)):
                walk_inlines(item.body)

    def walk(items) -> None:
        for block in items:
            if isinstance(block, Paragraph):
                walk_inlines(block.body)
            elif isinstance(block, Quotation):
                walk(block.blocks)
            elif isinstance(block, ItemList):
                for entry in block.items:
                    walk(entry)
            elif isinstance(block, Footnote):
                walk(block.blocks)
            elif isinstance(block, Figure):
                walk_inlines(block.caption)

    walk(blocks)
    return found


def _collect_spans(node: str, lines: list[str], meta: list[tuple[str, str]]) -> list[Span]:
    """Turn the marker pairs left by rendering into word-level span records."""

    spans: list[Span] = []
    stack: list[tuple[int, int, int]] = []
    index = 0
    for number, line in enumerate(lines, start=1):
        column = 0
        for character in line:
            if character == OPEN:
                stack.append((index, number, column))
                index += 1
                continue
            if character == CLOSE:
                if not stack:
                    continue
                identifier, start_line, start_column = stack.pop()
                record = meta[identifier] if identifier < len(meta) else ("emphasis", "")
                kind = record[1] or record[0]
                spans.extend(
                    _words(node, lines, start_line, start_column, number, column, kind)
                )
                continue
            column += 1
    return spans


def _words(
    node: str,
    lines: list[str],
    start_line: int,
    start_column: int,
    end_line: int,
    end_column: int,
    kind: str,
) -> list[Span]:
    found: list[Span] = []
    for number in range(start_line, end_line + 1):
        text = _visible(lines[number - 1])
        begin = start_column if number == start_line else 0
        finish = end_column if number == end_line else len(text)
        for match in WORD.finditer(text[begin:finish]):
            found.append(
                Span(
                    node=node,
                    line=number,
                    column=begin + match.start(),
                    length=len(match.group(0)),
                    text=match.group(0),
                    kind=kind,
                )
            )
    return found
