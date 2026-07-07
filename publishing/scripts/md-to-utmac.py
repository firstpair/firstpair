#!/usr/bin/env python3
"""Convert a small Pandoc-readable Markdown book into utmac troff source.

This is intentionally conservative. Pandoc owns Markdown parsing; this script
only maps the subset First Pair wants for human-readable proof books into the
utmac macros used by Neatroff.
"""

from __future__ import annotations

import json
import subprocess
import sys
import textwrap
from pathlib import Path
from typing import Any


def pandoc_json(path: Path) -> dict[str, Any]:
    proc = subprocess.run(
        [
            "pandoc",
            "--from=markdown+yaml_metadata_block+pipe_tables+implicit_figures",
            "--to=json",
            str(path),
        ],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    )
    return json.loads(proc.stdout)


def stringify_meta(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    tag = value.get("t")
    contents = value.get("c")
    if tag == "MetaString":
        return str(contents)
    if tag == "MetaInlines":
        return stringify_inlines(contents)
    if tag == "MetaBlocks":
        return " ".join(block_text(block) for block in contents)
    if tag == "MetaList":
        return ", ".join(stringify_meta(item) for item in contents)
    return ""


def stringify_inlines(inlines: list[Any]) -> str:
    parts: list[str] = []
    for inline in inlines:
        tag = inline.get("t")
        c = inline.get("c")
        if tag == "Str":
            parts.append(str(c))
        elif tag in {"Space", "SoftBreak", "LineBreak"}:
            parts.append(" ")
        elif tag in {"Emph", "Strong", "SmallCaps", "Strikeout", "Superscript", "Subscript"}:
            parts.append(stringify_inlines(c))
        elif tag == "Code":
            parts.append(str(c[1]))
        elif tag == "Math":
            parts.append(str(c[1]))
        elif tag == "Quoted":
            quote = '"' if c[0].get("t") == "DoubleQuote" else "'"
            parts.append(quote + stringify_inlines(c[1]) + quote)
        elif tag == "Link":
            label = stringify_inlines(c[1])
            target = c[2][0]
            if target.startswith("#"):
                parts.append(label)
            else:
                parts.append(f"{label} ({target})")
        elif tag == "Image":
            label = stringify_inlines(c[1])
            target = c[2][0]
            parts.append(f"[Figure: {label or target}]")
        elif tag == "RawInline":
            parts.append(str(c[1]))
        else:
            parts.append("")
    return " ".join("".join(parts).split())


def roff_line(text: str) -> str:
    text = text.replace("\\", r"\e")
    if text.startswith((".", "'")):
        text = r"\&" + text
    return text


def wrapped(text: str) -> list[str]:
    text = " ".join(text.split())
    if not text:
        return []
    return [roff_line(line) for line in textwrap.wrap(text, width=76)]


def block_text(block: Any) -> str:
    tag = block.get("t")
    c = block.get("c")
    if tag in {"Para", "Plain"}:
        return stringify_inlines(c)
    if tag == "Header":
        return stringify_inlines(c[2])
    if tag == "CodeBlock":
        return str(c[1])
    if tag == "BlockQuote":
        return " ".join(block_text(child) for child in c)
    if tag == "BulletList":
        return " ".join(" ".join(block_text(child) for child in item) for item in c)
    if tag == "OrderedList":
        return " ".join(" ".join(block_text(child) for child in item) for item in c[1])
    return ""


def render_blocks(blocks: list[Any]) -> list[str]:
    out: list[str] = []
    for block in blocks:
        tag = block.get("t")
        c = block.get("c")
        if tag == "Header":
            level = min(int(c[0]) + 1, 4)
            title = stringify_inlines(c[2])
            out.append(f".H{level} {roff_line(title)}")
        elif tag in {"Para", "Plain"}:
            text = stringify_inlines(c)
            if text:
                out.append(".PP")
                out.extend(wrapped(text))
        elif tag == "BlockQuote":
            text = block_text(block)
            if text:
                out.append(".PQ")
                out.extend(wrapped(text))
        elif tag == "BulletList":
            for item in c:
                text = " ".join(block_text(child) for child in item)
                if text:
                    out.append(r".PI \(bu")
                    out.extend(wrapped(text))
        elif tag == "OrderedList":
            start = int(c[0][0])
            for index, item in enumerate(c[1], start=start):
                text = " ".join(block_text(child) for child in item)
                if text:
                    out.append(f'.PI "{index}."')
                    out.extend(wrapped(text))
        elif tag == "CodeBlock":
            out.append(".PX")
            for line in str(c[1]).splitlines():
                out.append(roff_line(line))
        elif tag == "HorizontalRule":
            out.append(".sp 1")
        elif tag == "Table":
            out.append(".PP")
            out.extend(wrapped("[Table omitted in utmac proof source; see Markdown/EPUB edition.]"))
        else:
            text = block_text(block)
            if text:
                out.append(".PP")
                out.extend(wrapped(text))
    return out


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: md-to-utmac.py manuscript.md output.tr", file=sys.stderr)
        return 2

    source = Path(sys.argv[1])
    output = Path(sys.argv[2])
    doc = pandoc_json(source)
    meta = doc.get("meta", {})

    title = stringify_meta(meta.get("title", {})) or source.stem
    subtitle = stringify_meta(meta.get("subtitle", {}))
    author = stringify_meta(meta.get("author", {})) or "First Pair Press"

    lines = [
        r".\" Generated from Markdown by publishing/scripts/md-to-utmac.py",
        f".DA {roff_line(author)}",
        f".DT {roff_line(title)}",
    ]
    if subtitle:
        lines.append(f".DS {roff_line(subtitle)}")
    lines.extend(
        [
            ".DK first pair, human ai, reproducible books, bell labs publishing",
            ".H1 " + roff_line(title),
        ]
    )
    if subtitle:
        lines.extend([".PQ", roff_line(subtitle)])
    lines.extend(render_blocks(doc.get("blocks", [])))
    lines.append("")

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
