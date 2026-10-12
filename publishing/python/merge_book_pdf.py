#!/usr/bin/env python3
"""Join a generated cover and body while retaining valid PDF navigation.

Inputs must already have destinations in their active page trees. The completed
temporary PDF is reopened and compared before replacing the output.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import stat
from tempfile import NamedTemporaryFile

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, Destination, IndirectObject, NullObject


def _scalar(value):
    if isinstance(value, NullObject) or value is None:
        return None
    if isinstance(value, (int, float)):
        return value
    return str(value)


def navigation(reader: PdfReader) -> dict:
    """Return immutable navigation facts, rejecting orphan local destinations."""
    active = {
        (page.indirect_reference.idnum, page.indirect_reference.generation): index
        for index, page in enumerate(reader.pages)
    }

    def page_index(reference):
        if not isinstance(reference, IndirectObject):
            reference = getattr(reference, "indirect_reference", None)
        if not isinstance(reference, IndirectObject) or reference.pdf is not reader:
            raise ValueError("Local destination requires an active Page indirect reference")
        key = reference.idnum, reference.generation
        if key not in active or reference.get_object().get("/Type") != "/Page":
            raise ValueError("Local destination points outside the active Page tree")
        return active[key]

    def explicit_destination(value):
        if isinstance(value, Destination):
            value = value.dest_array
        if not isinstance(value, ArrayObject) or len(value) < 2:
            raise ValueError("Malformed explicit local destination")
        return (page_index(value[0]), tuple(_scalar(v) for v in value[1:]))

    named = {
        str(name): explicit_destination(destination)
        for name, destination in reader.named_destinations.items()
    }

    def local_destination(value):
        if isinstance(value, str):
            if str(value) not in named:
                raise ValueError(f"Undefined named destination: {value}")
            return ("named", str(value))
        return ("explicit", explicit_destination(value))

    outlines = []

    def outline_items(items, depth=0):
        for item in items:
            if isinstance(item, list):
                outline_items(item, depth + 1)
            elif isinstance(item, Destination):
                outlines.append((depth, str(item.title), explicit_destination(item)))
            else:
                raise ValueError("Unsupported outline destination")

    outline_items(reader.outline)
    annotations = []
    for page in reader.pages:
        entries = []
        for reference in page.get("/Annots", []):
            annotation = reference.get_object()
            dest = local_destination(annotation["/Dest"]) if "/Dest" in annotation else None
            action = annotation.get("/A")
            action_fact = None
            if action is not None:
                action = action.get_object()
                if action.get("/S") == "/GoTo":
                    if "/D" not in action:
                        raise ValueError("GoTo action lacks its destination")
                    action_fact = ("/GoTo", local_destination(action["/D"]))
                elif action.get("/S") == "/URI":
                    action_fact = ("/URI", str(action.get("/URI", "")))
                else:
                    action_fact = (str(action.get("/S")),)
            entries.append((
                str(annotation.get("/Subtype")),
                tuple(_scalar(v) for v in annotation.get("/Rect", [])),
                dest, action_fact,
            ))
        annotations.append(entries)
    return {
        "pages": len(reader.pages),
        "boxes": [tuple(page.mediabox) for page in reader.pages],
        "named": named,
        "outlines": outlines,
        "annotations": annotations,
    }


def shifted(facts: dict, offset: int) -> dict:
    def explicit(value):
        return value[0] + offset, value[1]

    def local(value):
        if value is None or value[0] == "named":
            return value
        return "explicit", explicit(value[1])

    result = dict(facts)
    result["named"] = {name: explicit(value) for name, value in facts["named"].items()}
    result["outlines"] = [(depth, title, explicit(value)) for depth, title, value in facts["outlines"]]
    result["annotations"] = [
        [(kind, rect, local(dest),
          ("/GoTo", local(action[1])) if action and action[0] == "/GoTo" else action)
         for kind, rect, dest, action in page]
        for page in facts["annotations"]
    ]
    return result


def merge_book_pdf(cover: Path, body: Path, output: Path) -> dict:
    cover, body, output = Path(cover), Path(body), Path(output)
    if output.is_symlink() or output.resolve() in (cover.resolve(), body.resolve()):
        raise ValueError("Output must be distinct from its input PDFs and not a symlink")
    cover_reader = PdfReader(cover, strict=True)
    body_reader = PdfReader(body, strict=True)
    cover_facts, body_facts = navigation(cover_reader), navigation(body_reader)
    if not cover_facts["pages"] or not body_facts["pages"]:
        raise ValueError("Cover and body must both contain pages")
    if cover_facts["named"].keys() & body_facts["named"].keys():
        raise ValueError("Cover and body contain conflicting named destinations")
    rebased = shifted(body_facts, cover_facts["pages"])
    expected = {
        "pages": cover_facts["pages"] + body_facts["pages"],
        "boxes": cover_facts["boxes"] + body_facts["boxes"],
        "named": {**cover_facts["named"], **rebased["named"]},
        "outlines": cover_facts["outlines"] + rebased["outlines"],
        "annotations": cover_facts["annotations"] + rebased["annotations"],
    }
    writer = PdfWriter()
    writer.append(cover_reader)
    writer.append(body_reader)
    writer.pdf_header = max(cover_reader.pdf_header, body_reader.pdf_header)
    metadata = dict(body_reader.metadata or {})
    writer.metadata = metadata
    xmp = body_reader.xmp_metadata
    if xmp is not None:
        writer.xmp_metadata = xmp
    mode = stat.S_IMODE(output.stat().st_mode) if output.exists() else 0o644
    temporary_path = None
    try:
        with NamedTemporaryFile(mode="wb", prefix=f".{output.stem}-merge-", suffix=".pdf",
                                dir=output.parent, delete=False) as temporary:
            temporary_path = Path(temporary.name)
            writer.write(temporary)
            temporary.flush()
            os.fsync(temporary.fileno())
        completed = PdfReader(temporary_path, strict=True)
        if navigation(completed) != expected:
            raise ValueError("Merged PDF changed its destinations, outlines or annotations")
        if dict(completed.metadata or {}) != metadata:
            raise ValueError("Merged PDF changed body metadata")
        if xmp is not None and completed.xmp_metadata.stream.get_data() != xmp.stream.get_data():
            raise ValueError("Merged PDF changed body XMP metadata")
        os.chmod(temporary_path, mode)
        os.replace(temporary_path, output)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
    kinds = Counter(annotation[0] for page in expected["annotations"] for annotation in page)
    return {"pages": expected["pages"], "namedDestinations": len(expected["named"]),
            "outlines": len(expected["outlines"]), "annotationCounts": dict(kinds)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cover", type=Path)
    parser.add_argument("body", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(merge_book_pdf(args.cover, args.body, args.output), sort_keys=True))


if __name__ == "__main__":
    main()
