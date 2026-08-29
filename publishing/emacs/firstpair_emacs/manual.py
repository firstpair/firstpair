"""Assembly of the two manuals a bundle delivers.

The reader manual carries the book: a top node, one node per part, one node
per chapter, the guide, and the colophon. The reference manual carries
everything the book points at: one node per record, one node per evidence
target, and the glossary. Splitting them is what lets the Emacs reader keep a
reference open below the text without disturbing the reading position.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path
from typing import Iterable

from .config import EmacsConfig, RecordBlock, RecordSet
from .document import (
    Block,
    Emphasis,
    Footnote,
    Heading,
    ItemList,
    Manual,
    Node,
    Paragraph,
    Preformatted,
    Quotation,
    Reference,
    Strong,
    Table,
    Text,
    anchor_name,
    block_text,
    node_name,
    plain_text,
)
from . import parallel
from .markdown import inline, parse
from .projection import Projection, Record


READER_TOP = "Top"


@dataclass
class Assembly:
    reader: Manual
    references: Manual
    page_nodes: dict[str, str]
    record_nodes: dict[str, str]
    anchored: dict[str, tuple[str, ...]]
    unmatched: tuple[tuple[str, str], ...]
    vocabulary: dict[str, list[str]]


def _page_blocks(
    source: Path, page_id: str, *, source_language: str = "", translations: tuple[str, ...] = ()
) -> tuple[tuple[Block, ...], str, list[str]]:
    if parallel.is_chapter(source):
        if not source_language:
            raise ValueError(f"aligned page {page_id} needs emacs.lexicon.sourceId")
        blocks, title, lines = parallel.load(source, source_language, translations)
        return blocks, title, lines
    blocks = list(parse(source.read_text(encoding="utf-8")))
    title = ""
    if blocks and isinstance(blocks[0], Heading) and blocks[0].level == 1:
        title = blocks[0].title
        blocks = blocks[1:]
    taken: list[str] = []
    result: list[Block] = []
    for block in blocks:
        if isinstance(block, Heading) and block.level == 1:
            block = Heading(level=2, title=block.title)
        if isinstance(block, Heading):
            name = anchor_name(page_id, block.title, taken)
            taken.append(name)
            block = Heading(level=block.level, title=block.title, anchor=name)
        result.append(block)
    return tuple(result), title, []


def _record_blocks(record: Record, spec: RecordSet, reader_manual: str, page_nodes: dict[str, str]) -> tuple[Block, ...]:
    blocks: list[Block] = []
    for item in spec.blocks:
        value = record.fields.get(item.field)
        if value in (None, "", [], {}):
            continue
        blocks.extend(_render_field(item, value))
    if record.referenced_by:
        blocks.append(Paragraph(body=(Strong(body=(Text(text="Quoted in:"),)),)))
        blocks.append(
            ItemList(
                items=tuple(
                    (
                        Paragraph(
                            body=(
                                Reference(
                                    label=page_nodes[page],
                                    node=page_nodes[page],
                                    target_id=page,
                                    manual=reader_manual,
                                ),
                            )
                        ),
                    )
                    for page in record.referenced_by
                )
            )
        )
    return tuple(blocks)


def _render_field(item: RecordBlock, value: object) -> list[Block]:
    if isinstance(value, list):
        text = "; ".join(str(entry) for entry in value)
    else:
        text = str(value)
    text = " ".join(text.split())
    if not text:
        return []
    body = inline(text)
    if item.language:
        body = (Emphasis(body=body, language=item.language),)
    if item.style == "quotation":
        return [
            Heading(level=3, title=item.label),
            Quotation(blocks=(Paragraph(body=body),), language=item.language),
        ]
    if item.style == "field":
        return [Paragraph(body=(Strong(body=(Text(text=f"{item.label}:"),)), Text(text=" ")) + body)]
    if item.style == "verbatim":
        return [Heading(level=3, title=item.label), Preformatted(text=text)]
    return [Heading(level=3, title=item.label), Paragraph(body=body)]


def _evidence_blocks(target, bundle_path: str) -> tuple[Block, ...]:
    blocks: list[Block] = [
        Paragraph(
            body=(
                Strong(body=(Text(text="Kind:"),)),
                Text(text=f" {target.kind}. "),
                Strong(body=(Text(text="Rights:"),)),
                Text(text=f" {target.rights}."),
            )
        )
    ]
    suffix = target.source.suffix.lower()
    if suffix in {".md", ".markdown", ".txt"}:
        text = target.source.read_text(encoding="utf-8", errors="replace")
        parsed = parse(text) if suffix != ".txt" else (Preformatted(text=text.strip()),)
        blocks.extend(
            block for block in parsed if not (isinstance(block, Heading) and block.level == 1)
        )
    else:
        blocks.append(
            Paragraph(
                body=inline(
                    f"This target is delivered as a file in the bundle: `{bundle_path}`. "
                    "Open it with C-c C-f from the reference window."
                )
            )
        )
    if target.metadata:
        blocks.append(Heading(level=3, title="Metadata"))
        blocks.append(
            Table(
                header=("Field", "Value"),
                rows=tuple((key, str(value)) for key, value in sorted(target.metadata.items())),
            )
        )
    return tuple(blocks)


def link_records(
    blocks: tuple[Block, ...],
    anchors: list[tuple[str, Reference]],
) -> tuple[tuple[Block, ...], set[str]]:
    """Cite each record after the first exact occurrence of its quoted text.

    The author's words stay untouched; a parenthetical cross-reference to the
    record follows them, which Info readers display as "(see Label)". An
    emphasised quotation is cited after the emphasis closes so the citation
    itself is never mistaken for quoted Latin.
    """

    matched: set[str] = set()
    ordered = sorted(anchors, key=lambda item: len(item[0]), reverse=True)

    def citation(reference: Reference) -> tuple:
        return (Text(text=" ("), reference, Text(text=")"))

    def hits(text: str) -> list[tuple[int, str, Reference]]:
        found: list[tuple[int, str, Reference]] = []
        for needle, reference in ordered:
            if reference.target_id in matched:
                continue
            position = text.find(needle)
            if position >= 0:
                found.append((position, needle, reference))
                matched.add(reference.target_id)
        return sorted(found, key=lambda item: item[0] + len(item[1]))

    def walk_inline(items: tuple) -> tuple:
        result: list = []
        for item in items:
            if isinstance(item, (Emphasis, Strong)):
                result.append(item)
                for _, _, reference in hits(plain_text(item.body)):
                    result.extend(citation(reference))
                continue
            if not isinstance(item, Text):
                result.append(item)
                continue
            text = item.text
            consumed = 0
            for position, needle, reference in hits(text):
                end = position + len(needle)
                if end < consumed:
                    continue
                result.append(Text(text=text[consumed:end]))
                result.extend(citation(reference))
                consumed = end
            if consumed < len(text):
                result.append(Text(text=text[consumed:]))
        return tuple(result)

    def walk(items: tuple[Block, ...]) -> tuple[Block, ...]:
        result: list[Block] = []
        for block in items:
            if isinstance(block, Paragraph):
                result.append(Paragraph(body=walk_inline(block.body)))
            elif isinstance(block, Quotation):
                result.append(replace(block, blocks=walk(block.blocks)))
            elif isinstance(block, ItemList):
                result.append(replace(block, items=tuple(walk(entry) for entry in block.items)))
            elif isinstance(block, Footnote):
                result.append(replace(block, blocks=walk(block.blocks)))
            else:
                result.append(block)
        return tuple(result)

    return walk(blocks), matched


def assemble(
    config: EmacsConfig,
    projection: Projection,
    *,
    guide: str,
    colophon: tuple[Block, ...],
    evidence_paths: dict[str, str],
) -> Assembly:
    reader_file = f"{config.reader_stem}.info"
    reference_file = f"{config.reference_stem}.info"
    taken_reader: list[str] = [READER_TOP]
    taken_reference: list[str] = [READER_TOP]
    source_language = config.lexicon.source_id if config.lexicon else ""
    translations = tuple(item.identifier for item in config.lexicon.translations) if config.lexicon else ()

    page_nodes: dict[str, str] = {}
    page_titles: dict[str, str] = {}
    page_blocks: dict[str, tuple[Block, ...]] = {}
    vocabulary: dict[str, list[str]] = {}
    for page in projection.pages:
        blocks, heading, lines = _page_blocks(
            page.source, page.page_id, source_language=source_language, translations=translations
        )
        title = page.title or heading
        name = node_name(title, taken_reader)
        taken_reader.append(name)
        page_nodes[page.page_id] = name
        page_titles[page.page_id] = title
        page_blocks[page.page_id] = blocks
        if lines:
            vocabulary[name] = lines

    specs = {record_set.set_id: record_set for record_set in config.records}
    record_nodes: dict[str, str] = {}
    reference_children: dict[str, list[Node]] = {}
    anchors_by_page: dict[str, list[tuple[str, Reference]]] = {}
    for record in projection.records:
        name = node_name(record.label or record.record_id, taken_reference)
        taken_reference.append(name)
        record_nodes[record.record_id] = name
        node = Node(
            name=name,
            title=record.label or record.record_id,
            blocks=_record_blocks(record, specs[record.origin], config.reader_stem, page_nodes),
            kind="record",
            page_id=record.record_id,
        )
        reference_children.setdefault(record.section, []).append(node)
        for text in record.anchors:
            for page_id in record.referenced_by:
                anchors_by_page.setdefault(page_id, []).append(
                    (
                        text,
                        Reference(
                            label=record.label or record.record_id,
                            node=name,
                            target_id=record.record_id,
                            manual=config.reference_stem,
                        ),
                    )
                )

    for target in projection.evidence:
        name = node_name(target.label or target.target_id, taken_reference)
        taken_reference.append(name)
        record_nodes[target.target_id] = name
        reference_children.setdefault("Evidence", []).append(
            Node(
                name=name,
                title=target.label or target.target_id,
                blocks=_evidence_blocks(target, evidence_paths.get(target.target_id, "")),
                kind="evidence",
                page_id=target.target_id,
            )
        )

    anchored: dict[str, tuple[str, ...]] = {}
    unmatched: list[tuple[str, str]] = []
    for page_id, blocks in page_blocks.items():
        pairs = anchors_by_page.get(page_id, [])
        if not pairs:
            continue
        linked, matched = link_records(blocks, pairs)
        page_blocks[page_id] = linked
        anchored[page_id] = tuple(sorted(matched))
        for text, reference in pairs:
            if reference.target_id not in matched:
                unmatched.append((page_id, reference.target_id))

    parts = {title: description for title, description in config.parts}
    grouped: list[tuple[str, list[str]]] = []
    for page in projection.pages:
        part = config.page_parts.get(page.page_id, "")
        if grouped and grouped[-1][0] == part:
            grouped[-1][1].append(page.page_id)
        else:
            grouped.append((part, [page.page_id]))

    children: list[Node] = []
    menu: list[tuple[str, str]] = []
    for part, page_ids in grouped:
        page_children = [
            Node(
                name=page_nodes[page_id],
                title=page_titles[page_id],
                blocks=page_blocks[page_id],
                kind="chapter",
                page_id=page_id,
            )
            for page_id in page_ids
        ]
        if not part:
            children.extend(page_children)
            menu.extend((node.name, _summary(node)) for node in page_children)
            continue
        name = node_name(part, taken_reader)
        taken_reader.append(name)
        children.append(
            Node(
                name=name,
                title=part,
                description=parts.get(part, ""),
                children=page_children,
                menu=tuple((node.name, _summary(node)) for node in page_children),
                kind="part",
            )
        )
        menu.append((name, parts.get(part, "")))

    guide_blocks = parse(guide)
    if guide_blocks and isinstance(guide_blocks[0], Heading) and guide_blocks[0].level == 1:
        guide_blocks = guide_blocks[1:]
    guide_node = Node(
        name=node_name("Reading This Edition in Emacs", taken_reader),
        title="Reading This Edition in Emacs",
        blocks=guide_blocks,
        kind="guide",
    )
    colophon_node = Node(
        name=node_name("Colophon", taken_reader),
        title="Colophon",
        blocks=colophon,
        kind="colophon",
    )
    contents_node = Node(
        name=node_name("Contents", taken_reader),
        title="Contents",
        description="Every node of this edition, in reading order.",
        menu=tuple(
            (page_nodes[page.page_id], _first_sentence(page_blocks[page.page_id]))
            for page in projection.pages
        ),
        kind="contents",
    )
    children = [contents_node, *children, guide_node, colophon_node]
    top_menu = [(contents_node.name, "Every node in reading order.")] + menu + [
        (guide_node.name, "How this edition works in Emacs."),
        (colophon_node.name, "How this edition was built."),
    ]
    reader_top = Node(
        name=READER_TOP,
        title=config.core.title,
        description=_top_description(config, projection),
        blocks=_top_blocks(config, projection),
        menu=tuple(top_menu),
        children=children,
        kind="top",
    )
    reader = Manual(
        filename=reader_file,
        title=config.core.title,
        top=reader_top,
        direntry=config.direntry,
    )

    section_nodes: list[Node] = []
    for section, nodes in reference_children.items():
        name = node_name(section, taken_reference)
        taken_reference.append(name)
        section_nodes.append(
            Node(
                name=name,
                title=section,
                children=nodes,
                menu=tuple((node.name, _summary(node)) for node in nodes),
                kind="section",
            )
        )
    reference_top = Node(
        name=READER_TOP,
        title=f"{config.core.title}: References",
        description=(
            "Sources, records, and evidence for "
            f"{config.core.title}. The reader opens these below the text; "
            "you can also read this manual on its own."
        ),
        menu=tuple((node.name, "") for node in section_nodes),
        children=section_nodes,
        kind="top",
    )
    references = Manual(
        filename=reference_file,
        title=f"{config.core.title}: References",
        top=reference_top,
        direntry=(
            config.direntry[0],
            config.reference_stem,
            f"References and sources for {config.core.title}.",
        ),
    )
    return Assembly(
        reader=reader,
        references=references,
        page_nodes=page_nodes,
        record_nodes=record_nodes,
        anchored=anchored,
        unmatched=tuple(unmatched),
        vocabulary=vocabulary,
    )


def _summary(node: Node) -> str:
    return _first_sentence(node.blocks)


def _first_sentence(blocks: Iterable[Block]) -> str:
    """Summarise a node by its first paragraph, skipping plates and headings."""

    blocks = tuple(blocks)
    paragraphs = [block for block in blocks if isinstance(block, Paragraph)]
    text = block_text(paragraphs[:1] if paragraphs else blocks).strip()
    if not text:
        return ""
    sentence = text.split("\n")[0]
    for stop in (". ", "? ", "! "):
        position = sentence.find(stop)
        if position > 0:
            sentence = sentence[: position + 1]
            break
    words = sentence.split()
    if len(words) > 12:
        sentence = " ".join(words[:12]) + "…"
    return sentence.strip()


def _top_description(config: EmacsConfig, projection: Projection) -> str:
    pieces = [config.subtitle.rstrip(".") + "."] if config.subtitle else []
    if config.author:
        pieces.append(f"By {config.author}.")
    pieces.append(
        f"This is the {projection.product.edition} edition, delivered as an Info manual "
        "with its references and its lexicon."
    )
    return " ".join(pieces)


def _top_blocks(config: EmacsConfig, projection: Projection) -> tuple[Block, ...]:
    return (
        Paragraph(
            body=inline(
                "Press *n* and *p* to move between nodes, *RET* to follow a reference, "
                "*u* to go up, and *l* to go back. With the FirstPair reader loaded, "
                "references open in a window below this one and dictionary entries "
                "open in a third window."
            )
        ),
    )
