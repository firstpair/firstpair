"""Texinfo source generation.

Every bundle ships the Texinfo source beside the Info file it delivers. The
source is what makes the edition auditable and re-renderable: a reader can run
makeinfo, texi2pdf, or texi2html over it and get the same manual in another
form. It is written from the same document model as the Info file, so the two
cannot describe different books.
"""

from __future__ import annotations

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
)
from .markdown import inline as parse_inline


SECTION_COMMANDS = {1: "@unnumbered", 2: "@unnumberedsec", 3: "@unnumberedsubsec", 4: "@unnumberedsubsubsec"}


def escape(text: str) -> str:
    return text.replace("@", "@@").replace("{", "@{").replace("}", "@}")


def _inline(items: tuple[Inline, ...], footnotes: dict[str, Footnote]) -> str:
    parts: list[str] = []
    for item in items:
        if isinstance(item, Text):
            parts.append(escape(item.text))
        elif isinstance(item, Emphasis):
            parts.append("@emph{" + _inline(item.body, footnotes) + "}")
        elif isinstance(item, Strong):
            parts.append("@strong{" + _inline(item.body, footnotes) + "}")
        elif isinstance(item, Literal):
            parts.append("@code{" + escape(item.text) + "}")
        elif isinstance(item, Link):
            label = _inline(item.body, footnotes)
            parts.append(f"@uref{{{escape(item.url)}, {label}}}" if label else f"@uref{{{escape(item.url)}}}")
        elif isinstance(item, Reference):
            label = escape(" ".join(item.label.replace(":", " -").split()))
            node = escape(item.node)
            if item.manual:
                parts.append(f"@ref{{{node}, , {label}, {escape(item.manual)}}}")
            elif label == node:
                parts.append(f"@ref{{{node}}}")
            else:
                parts.append(f"@ref{{{node}, , {label}}}")
        elif isinstance(item, FootnoteMark):
            note = footnotes.get(item.identifier)
            if note is not None:
                parts.append("@footnote{" + _blocks(note.blocks, footnotes).strip() + "}")
    return "".join(parts)


def _blocks(blocks: tuple[Block, ...], footnotes: dict[str, Footnote]) -> str:
    out: list[str] = []
    for block in blocks:
        if isinstance(block, Footnote):
            continue
        if isinstance(block, Heading):
            command = SECTION_COMMANDS.get(min(block.level, 4), "@unnumberedsubsubsec")
            if block.anchor:
                out.append(f"@anchor{{{escape(block.anchor)}}}")
            out.append(f"{command} {escape(block.title)}")
        elif isinstance(block, Paragraph):
            out.append(_inline(block.body, footnotes))
        elif isinstance(block, Quotation):
            out.append("@quotation")
            out.append(_blocks(block.blocks, footnotes).strip())
            if block.attribution:
                out.append("@author " + escape(block.attribution))
            out.append("@end quotation")
        elif isinstance(block, ItemList):
            out.append("@enumerate" if block.ordered else "@itemize @bullet")
            for item in block.items:
                out.append("@item")
                out.append(_blocks(item, footnotes).strip())
            out.append("@end enumerate" if block.ordered else "@end itemize")
        elif isinstance(block, Table):
            columns = max([len(block.header)] + [len(row) for row in block.rows] or [1])
            fractions = " ".join([f"{1 / columns:.2f}"] * columns)
            out.append(f"@multitable @columnfractions {fractions}")
            if block.header:
                out.append("@headitem " + " @tab ".join(_inline(parse_inline(cell), footnotes) for cell in block.header))
            for row in block.rows:
                cells = list(row) + [""] * (columns - len(row))
                out.append("@item " + " @tab ".join(_inline(parse_inline(cell), footnotes) for cell in cells))
            out.append("@end multitable")
        elif isinstance(block, Figure):
            out.append("@display")
            out.append("[Plate: " + _inline(block.caption, footnotes) + "]")
            out.append("@end display")
        elif isinstance(block, Preformatted):
            out.append("@example")
            out.append(escape(block.text))
            out.append("@end example")
        elif isinstance(block, Rule):
            out.append("@sp 1")
    return "\n\n".join(part for part in out if part.strip())


def _node(node: Node, level: int) -> str:
    footnotes = {block.identifier: block for block in node.blocks if isinstance(block, Footnote)}
    out = [f"@node {escape(node.name)}"]
    command = "@top" if node.name == "Top" else SECTION_COMMANDS.get(level, "@unnumberedsubsubsec")
    out.append(f"{command} {escape(node.title)}")
    if node.description:
        out.append(escape(node.description))
    body = _blocks(node.blocks, footnotes)
    if body:
        out.append(body)
    if node.menu and node.kind == "contents":
        # A table of contents lists nodes that belong to other parents; Texinfo
        # wants a menu to list children only, so write it as references.
        entries = [
            "@item\n@ref{" + escape(name) + "}" + (f" --- {escape(description)}" if description else "")
            for name, description in node.menu
        ]
        out.append("\n".join(["@itemize @bullet", *entries, "@end itemize"]))
    elif node.menu:
        entries = [
            f"* {escape(name)}::" + (f"  {escape(description)}" if description else "")
            for name, description in node.menu
        ]
        out.append("\n".join(["@menu", *entries, "@end menu"]))
    return "\n\n".join(out)


def write(manual: Manual, *, produced_by: str) -> str:
    section, name, description = manual.direntry
    lines = [
        "\\input texinfo   @c -*- texinfo -*-",
        "@c This file is generated by " + produced_by + ". Do not edit it by hand.",
        f"@setfilename {manual.filename}",
        f"@settitle {escape(manual.title)}",
        "@documentencoding UTF-8",
        "@paragraphindent 3",
        "@allowcodebreaks false",
    ]
    if name:
        lines += [
            f"@dircategory {escape(section)}",
            "@direntry",
            f"* {escape(name)}: ({manual.filename.removesuffix('.info')}).   {escape(description)}",
            "@end direntry",
        ]
    body = [_node(manual.top, 0)]

    def walk(node: Node, level: int) -> None:
        for child in node.children:
            body.append(_node(child, level))
            walk(child, min(level + 1, 4))

    walk(manual.top, 1)
    return "\n".join(lines) + "\n\n" + "\n\n".join(body) + "\n\n@bye\n"
