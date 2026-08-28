"""The standalone ``firstpair-reader`` Emacs package.

Every bundle ships the reader inside ``lisp/`` so it is self-contained. A
reader of several FirstPair books may prefer one installed copy: this module
assembles the same three files, with package metadata and the FirstPair
Emacs handbook as the package's own Info manual, into a directory and a tar
that ``package-install-file`` accepts. ``package-vc-install`` can take the
same files straight from the repository's ``publishing/emacs/lisp``.
"""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
import re
import tarfile

from .builder import PRODUCER, _dir_file
from .document import Block, Heading, Link, Manual, Node, Paragraph, node_name
from .infowriter import InfoWriter
from .markdown import parse
from . import texiwriter


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
LISP_ROOT = PACKAGE_ROOT / "lisp"
HANDBOOK = PACKAGE_ROOT / "guides" / "master.md"
NAME = "firstpair-reader"
FILES = ("firstpair-bundle.el", "firstpair-lexicon.el", "firstpair-reader.el")
SUMMARY = "Read FirstPair books in Emacs Info"
DIRENTRY = ("Emacs", "FirstPair Reader", "Read FirstPair books: text above, references below, dictionary under both.")
VERSION_HEADER = re.compile(r"^;; Version: (?P<version>\S+)$", re.MULTILINE)
REQUIRES_HEADER = re.compile(r"^;; Package-Requires: (?P<requires>.+)$", re.MULTILINE)


def version() -> str:
    text = (LISP_ROOT / "firstpair-reader.el").read_text(encoding="utf-8")
    match = VERSION_HEADER.search(text)
    if match is None:
        raise ValueError("firstpair-reader.el declares no Version header")
    return match.group("version")


def _requires() -> str:
    text = (LISP_ROOT / "firstpair-reader.el").read_text(encoding="utf-8")
    match = REQUIRES_HEADER.search(text)
    return match.group("requires").strip() if match else '((emacs "28.1"))'


def handbook_manual() -> Manual:
    """Turn the shared handbook into an Info manual: one node per section."""

    blocks = list(parse(HANDBOOK.read_text(encoding="utf-8")))
    if blocks and isinstance(blocks[0], Paragraph) and all(isinstance(item, Link) for item in blocks[0].body):
        blocks = blocks[1:]
    title = "The FirstPair Guide to Reading Books in Emacs"
    if blocks and isinstance(blocks[0], Heading) and blocks[0].level == 1:
        title = blocks[0].title
        blocks = blocks[1:]
    sections: list[tuple[str, list[Block]]] = [("", [])]
    for block in blocks:
        if isinstance(block, Heading) and block.level == 2:
            sections.append((block.title, []))
        else:
            sections[-1][1].append(block)
    taken = ["Top"]
    children: list[Node] = []
    for heading, body in sections[1:]:
        name = node_name(heading, taken)
        taken.append(name)
        children.append(Node(name=name, title=heading, blocks=tuple(body), kind="chapter"))
    top = Node(
        name="Top",
        title=title,
        blocks=tuple(sections[0][1]),
        menu=tuple((child.name, "") for child in children),
        children=children,
        kind="top",
    )
    return Manual(filename=f"{NAME}.info", title=title, top=top, direntry=DIRENTRY)


def _pkg_file(release: str) -> str:
    return (
        f";;; {NAME}-pkg.el --- package definition  -*- lexical-binding: t; -*-\n"
        f'(define-package "{NAME}" "{release}" "{SUMMARY}"\n'
        f"  '{_requires()}\n"
        "  :keywords '(\"docs\" \"hypermedia\")\n"
        '  :url "https://firstpair.org/emacs/")\n'
        "\n;; Local Variables:\n;; no-byte-compile: t\n;; End:\n"
    )


def assemble(output: Path) -> dict[str, object]:
    """Write ``<output>/firstpair-reader-<version>/`` and the matching tar."""

    release = version()
    for name in FILES:
        text = (LISP_ROOT / name).read_text(encoding="utf-8")
        found = VERSION_HEADER.search(text)
        if found is None or found.group("version") != release:
            raise ValueError(f"{name} does not declare Version {release}")
    directory = output / f"{NAME}-{release}"
    if directory.exists():
        raise RuntimeError(f"refusing to replace an existing package directory: {directory}")
    directory.mkdir(parents=True)
    for name in FILES:
        directory.joinpath(name).write_bytes((LISP_ROOT / name).read_bytes())
    (directory / f"{NAME}-pkg.el").write_text(_pkg_file(release), encoding="utf-8")
    manual = handbook_manual()
    rendered = InfoWriter(manual, produced_by=PRODUCER).render()
    (directory / manual.filename).write_bytes(rendered.data)
    (directory / "dir").write_text(_dir_file([manual]), encoding="utf-8")
    (directory / f"{NAME}.texi").write_text(texiwriter.write(manual, produced_by=PRODUCER), encoding="utf-8")
    (directory / "README.md").write_text(HANDBOOK.read_text(encoding="utf-8"), encoding="utf-8")

    files: dict[str, str] = {}
    archive = output / f"{NAME}-{release}.tar"
    with tarfile.open(archive, "w", format=tarfile.USTAR_FORMAT) as tar:
        for path in sorted(directory.rglob("*")):
            if not path.is_file():
                continue
            payload = path.read_bytes()
            files[path.relative_to(directory).as_posix()] = hashlib.sha256(payload).hexdigest()
            info = tarfile.TarInfo(path.relative_to(output).as_posix())
            info.size = len(payload)
            info.mtime = 0
            info.mode = 0o644
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            tar.addfile(info, io.BytesIO(payload))
    manifest = {
        "schema": "firstpair-reader-package-v1",
        "name": NAME,
        "version": release,
        "directory": str(directory),
        "tar": str(archive),
        "tarSha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "nodes": len(manual.nodes()),
        "files": files,
    }
    (output / f"{NAME}-{release}.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest
