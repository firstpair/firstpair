"""A focused Markdown reader for manuscripts delivered as Info manuals.

This is deliberately not a general CommonMark implementation. It accepts the
constructs FirstPair manuscripts actually use — headings, paragraphs, block
quotations, lists, pipe tables, images, fenced code, and Pandoc footnotes —
and passes anything it does not recognise through as literal text rather than
silently dropping an author's words.
"""

from __future__ import annotations

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
    Paragraph,
    Preformatted,
    Quotation,
    Rule,
    Strong,
    Table,
    Text,
)


HEADING = re.compile(r"^(?P<hashes>#{1,6})\s+(?P<title>.*?)\s*$")
ATTRIBUTES = re.compile(r"\s*\{[^{}]*\}\s*$")
BULLET = re.compile(r"^(?P<indent>\s*)[-*+]\s+(?P<text>.*)$")
ORDERED = re.compile(r"^(?P<indent>\s*)(?P<number>\d+)[.)]\s+(?P<text>.*)$")
FOOTNOTE_DEFINITION = re.compile(r"^\[\^(?P<identifier>[^\]]+)\]:\s*(?P<text>.*)$")
IMAGE_ONLY = re.compile(r"^!\[(?P<alt>[^\]]*)\]\((?P<source>[^)]+)\)\s*$")
RULE = re.compile(r"^\s*(?:-{3,}|\*{3,}|_{3,})\s*$")
COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
FENCE = re.compile(r"^\s*```(?P<info>.*)$")

INLINE = re.compile(
    r"(?P<code>`+[^`]+`+)"
    r"|(?P<image>!\[(?P<alt>[^\]]*)\]\((?P<source>[^)\s]+)(?:\s+\"[^\"]*\")?\))"
    r"|(?P<link>\[(?P<label>[^\]]+)\]\((?P<url>[^)\s]+)(?:\s+\"[^\"]*\")?\))"
    r"|(?P<footnote>\[\^(?P<identifier>[^\]]+)\])"
    r"|(?P<strong>\*\*(?P<strongbody>[^*]+)\*\*)"
    r"|(?P<emphasis>(?<![\w*])\*(?P<emphasisbody>[^*\n]+)\*(?![\w*]))"
    r"|(?P<underscore>(?<![\w_])_(?P<underscorebody>[^_\n]+)_(?![\w_]))"
)


def parse(text: str) -> tuple[Block, ...]:
    """Parse a manuscript file into the shared block model."""

    body = COMMENT.sub("", text)
    lines = body.replace("\r\n", "\n").expandtabs(4).split("\n")
    blocks: list[Block] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if not line.strip():
            index += 1
            continue
        fence = FENCE.match(line)
        if fence:
            index += 1
            collected: list[str] = []
            while index < len(lines) and not FENCE.match(lines[index]):
                collected.append(lines[index])
                index += 1
            index += 1
            blocks.append(Preformatted(text="\n".join(collected)))
            continue
        if RULE.match(line) and not BULLET.match(line):
            blocks.append(Rule())
            index += 1
            continue
        heading = HEADING.match(line)
        if heading:
            title = ATTRIBUTES.sub("", heading.group("title")).strip()
            blocks.append(Heading(level=len(heading.group("hashes")), title=_unescape(title)))
            index += 1
            continue
        if line.lstrip().startswith(">"):
            quoted: list[str] = []
            while index < len(lines) and (lines[index].lstrip().startswith(">") or (quoted and lines[index].strip())):
                stripped = lines[index].lstrip()
                quoted.append(stripped[1:].lstrip() if stripped.startswith(">") else stripped)
                index += 1
            attribution = ""
            if quoted and quoted[-1].startswith("—"):
                attribution = quoted.pop().lstrip("—").strip()
            blocks.append(Quotation(blocks=parse("\n".join(quoted)), attribution=attribution))
            continue
        image = IMAGE_ONLY.match(line)
        if image:
            blocks.append(
                Figure(caption=inline(_unescape(image.group("alt"))), source=image.group("source"))
            )
            index += 1
            continue
        footnote = FOOTNOTE_DEFINITION.match(line)
        if footnote:
            collected = [footnote.group("text")]
            index += 1
            while index < len(lines) and lines[index].strip() and not FOOTNOTE_DEFINITION.match(lines[index]):
                collected.append(lines[index].strip())
                index += 1
            blocks.append(
                Footnote(
                    identifier=footnote.group("identifier"),
                    blocks=(Paragraph(body=inline(" ".join(collected))),),
                )
            )
            continue
        if line.lstrip().startswith("|") and "|" in line:
            rows: list[str] = []
            while index < len(lines) and lines[index].lstrip().startswith("|"):
                rows.append(lines[index].strip())
                index += 1
            blocks.append(_table(rows))
            continue
        bullet, ordered = BULLET.match(line), ORDERED.match(line)
        if bullet or ordered:
            items, is_ordered = _list(lines, index)
            index = items[1]
            blocks.append(ItemList(items=items[0], ordered=is_ordered))
            continue
        collected = []
        while index < len(lines) and lines[index].strip():
            candidate = lines[index]
            if (
                HEADING.match(candidate)
                or candidate.lstrip().startswith(">")
                or BULLET.match(candidate)
                or ORDERED.match(candidate)
                or FENCE.match(candidate)
                or IMAGE_ONLY.match(candidate)
                or FOOTNOTE_DEFINITION.match(candidate)
                or candidate.lstrip().startswith("|")
            ) and collected:
                break
            collected.append(candidate.strip())
            index += 1
        blocks.append(Paragraph(body=inline(" ".join(collected))))
    return tuple(blocks)


def _list(lines: list[str], start: int) -> tuple[tuple[tuple[Block, ...], ...], int]:
    ordered = bool(ORDERED.match(lines[start]))
    items: list[tuple[Block, ...]] = []
    current: list[str] = []
    index = start
    while index < len(lines):
        line = lines[index]
        match = ORDERED.match(line) if ordered else BULLET.match(line)
        if match:
            if current:
                items.append(parse("\n".join(current)))
            current = [match.group("text")]
            index += 1
            continue
        if not line.strip():
            following = lines[index + 1] if index + 1 < len(lines) else ""
            if (ORDERED if ordered else BULLET).match(following):
                index += 1
                continue
            break
        if line.startswith(("  ", "\t")):
            current.append(line.strip())
            index += 1
            continue
        break
    if current:
        items.append(parse("\n".join(current)))
    return (tuple(items), index), ordered


def _table(rows: list[str]) -> Table:
    def cells(row: str) -> tuple[str, ...]:
        return tuple(cell.strip() for cell in row.strip().strip("|").split("|"))

    parsed = [cells(row) for row in rows]
    header: tuple[str, ...] = ()
    if len(parsed) > 1 and all(set(cell) <= set("-: ") and cell for cell in parsed[1]):
        header, parsed = parsed[0], parsed[2:]
    return Table(header=header, rows=tuple(parsed))


def _unescape(text: str) -> str:
    return re.sub(r"\\([\\`*_{}\[\]()#+\-.!])", r"\1", text)


def inline(text: str) -> tuple[Inline, ...]:
    """Parse inline markup, keeping unknown syntax as the author wrote it."""

    result: list[Inline] = []
    position = 0
    for match in INLINE.finditer(text):
        if match.start() > position:
            result.append(Text(text=_unescape(text[position : match.start()])))
        if match.group("code"):
            result.append(Literal(text=match.group("code").strip("`")))
        elif match.group("image"):
            result.append(Link(body=inline(_unescape(match.group("alt"))), url=match.group("source")))
        elif match.group("link"):
            result.append(Link(body=inline(match.group("label")), url=match.group("url")))
        elif match.group("footnote"):
            result.append(FootnoteMark(identifier=match.group("identifier")))
        elif match.group("strong"):
            result.append(Strong(body=inline(match.group("strongbody"))))
        elif match.group("emphasis"):
            result.append(Emphasis(body=inline(match.group("emphasisbody"))))
        else:
            result.append(Emphasis(body=inline(match.group("underscorebody"))))
        position = match.end()
    if position < len(text):
        result.append(Text(text=_unescape(text[position:])))
    return tuple(result)
