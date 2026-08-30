"""Verification of a delivered Emacs bundle.

A bundle is checked the way a reader will meet it: the sealed inventory must
match the files on disk, both Info files must parse into the nodes their tag
tables promise, every menu entry and cross-reference must resolve inside the
bundle, and, when Emacs and Texinfo are available, Emacs must open every node
with the FirstPair reader loaded and ``makeinfo`` must accept the Texinfo
source. Any failure is a stop condition.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from .inventory import scan


MANIFEST = "FIRSTPAIR-EMACS-MANIFEST.json"
SEPARATOR = "\x1f"
DELIMITER = "\x7f"
HEADER = re.compile(r"^File: (?P<file>[^,\t\n]+),\s+Node: (?P<node>[^,\t\n]+)(?P<rest>.*)$")
POINTER = re.compile(r"(Next|Prev|Up): ([^,\t\n]+)")
MENU_ENTRY = re.compile(r"^\* (?P<label>[^:\n]+):(?::|[ \t]*(?P<target>[^.,\n]+)[.,])", re.MULTILINE)
NOTE = re.compile(r"\*note\s+(?P<label>[^:]+?):(?:(?P<short>:)|\s*(?P<target>\([^)]+\))?(?P<node>[^.,]+)[.,])")
EMACS_CHECK = Path(__file__).resolve().parents[1] / "lisp" / "firstpair-check.el"


class BundleError(ValueError):
    pass


@dataclass
class InfoFile:
    stem: str
    nodes: dict[str, str] = field(default_factory=dict)
    tags: dict[str, int] = field(default_factory=dict)
    anchors: set[str] = field(default_factory=set)
    pointers: list[tuple[str, str, str]] = field(default_factory=list)
    menu: list[tuple[str, str]] = field(default_factory=list)
    notes: list[tuple[str, str, str]] = field(default_factory=list)


def parse_info(path: Path) -> InfoFile:
    """Parse an Info file structurally, without interpreting its prose."""

    text = path.read_bytes().decode("utf-8")
    parsed = InfoFile(stem=path.name.removesuffix(".info"))
    pieces = text.split(SEPARATOR + "\n")
    if not pieces or not pieces[0].startswith(f"This is {path.name},"):
        raise BundleError(f"{path.name} lacks the Info preamble")
    # An indirect manual keeps its nodes in subfiles; rebuild the single-file
    # byte stream the tag offsets refer to (preamble, then each subfile's
    # nodes) and parse the nodes from there.
    indirect = next((piece for piece in pieces if piece.startswith("Indirect:")), None)
    if indirect is not None:
        stream = pieces[0].encode("utf-8")
        node_pieces: list[str] = []
        for line in indirect.splitlines()[1:]:
            if not line.strip():
                continue
            name, _, offset = line.rpartition(": ")
            subfile = path.parent / name
            if not subfile.is_file():
                raise BundleError(f"{path.name} names a missing subfile: {name}")
            payload = subfile.read_bytes()
            marker = payload.find(SEPARATOR.encode("utf-8"))
            if marker < 0 or not payload.startswith(f"This is {name},".encode("utf-8")):
                raise BundleError(f"{name} lacks the Info subfile preamble")
            if len(stream) != int(offset):
                raise BundleError(f"{path.name} indirect offset for {name} is {offset}, expected {len(stream)}")
            nodes_bytes = payload[marker:]
            stream += nodes_bytes
            node_pieces.extend(nodes_bytes.decode("utf-8").split(SEPARATOR + "\n")[1:])
        tag_pieces = [piece for piece in pieces[1:] if piece.startswith(("Tag Table:", "End Tag Table", "Local Variables:"))]
        pieces = [pieces[0]] + node_pieces + tag_pieces
        text = stream.decode("utf-8") + "".join(SEPARATOR + "\n" + piece for piece in tag_pieces)
    for piece in pieces[1:]:
        if piece.startswith("Indirect:"):
            continue
        if piece.startswith("Tag Table:"):
            for line in piece.splitlines()[1:]:
                if DELIMITER not in line or line == "(Indirect)":
                    continue
                name, offset = line.split(DELIMITER, 1)
                if name.startswith("Node: "):
                    parsed.tags[name[len("Node: ") :]] = int(offset)
                elif name.startswith("Ref: "):
                    parsed.anchors.add(name[len("Ref: ") :])
            continue
        if piece.startswith("End Tag Table") or piece.startswith("Local Variables:"):
            continue
        header, _, body = piece.partition("\n")
        match = HEADER.match(header)
        if not match:
            raise BundleError(f"{path.name} has a node without a header: {header[:60]!r}")
        if match.group("file") != path.name:
            raise BundleError(f"{path.name} node claims another file: {match.group('file')}")
        node = match.group("node")
        if node in parsed.nodes:
            raise BundleError(f"{path.name} defines node twice: {node}")
        parsed.nodes[node] = body
        for kind, target in POINTER.findall(match.group("rest")):
            parsed.pointers.append((node, kind, target))
        for entry in MENU_ENTRY.finditer(body):
            parsed.menu.append((node, (entry.group("target") or entry.group("label")).strip()))
        flat = re.sub(r"\s+", " ", body)
        for note in NOTE.finditer(flat):
            if note.group("short"):
                parsed.notes.append((node, "", note.group("label").strip()))
            else:
                parsed.notes.append((node, (note.group("target") or "").strip("()"), note.group("node").strip()))
    if set(parsed.tags) != set(parsed.nodes):
        missing = sorted(set(parsed.nodes) ^ set(parsed.tags))
        raise BundleError(f"{path.name} tag table disagrees with its nodes: {missing[:5]}")
    encoded = text.encode("utf-8")
    for name, offset in parsed.tags.items():
        lines = encoded[offset : offset + 4096].decode("utf-8", errors="replace").split("\n", 2)
        if len(lines) < 2 or lines[0] != SEPARATOR or f"Node: {name}" not in lines[1]:
            raise BundleError(f"{path.name} tag offset for {name} does not point at its node")
    return parsed


def _check_links(manuals: dict[str, InfoFile]) -> list[str]:
    problems: list[str] = []
    for manual in manuals.values():
        for node, kind, target in manual.pointers:
            if target == "(dir)":
                continue
            if target not in manual.nodes:
                problems.append(f"{manual.stem}: {node} {kind} -> missing {target}")
        for node, target in manual.menu:
            if target not in manual.nodes:
                problems.append(f"{manual.stem}: menu of {node} -> missing {target}")
        for node, file_stem, target in manual.notes:
            owner = manuals.get(file_stem) if file_stem else manual
            if owner is None:
                problems.append(f"{manual.stem}: {node} refers to unknown manual {file_stem}")
            elif target not in owner.nodes and target not in owner.anchors:
                problems.append(f"{manual.stem}: {node} refers to missing {file_stem or manual.stem} node {target}")
    return problems


def _run_makeinfo(root: Path, stems: list[str]) -> dict[str, object]:
    executable = shutil.which("makeinfo")
    if executable is None:
        return {"available": False}
    results = {}
    with tempfile.TemporaryDirectory() as temporary:
        for stem in stems:
            source = root / "texi" / f"{stem}.texi"
            completed = subprocess.run(
                [executable, "--no-split", "-o", str(Path(temporary) / f"{stem}.info"), str(source)],
                capture_output=True,
                text=True,
                check=False,
            )
            warnings = [line for line in completed.stderr.splitlines() if "warning" in line]
            errors = [line for line in completed.stderr.splitlines() if "error" in line.lower() and "warning" not in line]
            results[stem] = {"exitCode": completed.returncode, "warnings": len(warnings), "errors": errors[:10]}
    return {"available": True, "manuals": results}


def _run_emacs(root: Path, manuals: dict[str, InfoFile]) -> dict[str, object]:
    executable = shutil.which("emacs")
    if executable is None:
        return {"available": False}
    with tempfile.TemporaryDirectory() as temporary:
        nodes_path = Path(temporary) / "nodes.json"
        nodes_path.write_text(
            json.dumps({stem: sorted(manual.nodes) for stem, manual in manuals.items()}),
            encoding="utf-8",
        )
        completed = subprocess.run(
            [
                executable,
                "--batch",
                "-Q",
                "-l",
                str(root / "init.el"),
                "-l",
                str(EMACS_CHECK),
                "--eval",
                f'(firstpair-check "{root.as_posix()}" "{nodes_path.as_posix()}")',
            ],
            capture_output=True,
            text=True,
            check=False,
        )
    if completed.returncode != 0:
        raise BundleError("Emacs could not open the bundle: " + completed.stderr.strip()[-2000:])
    payload = None
    for line in completed.stdout.splitlines():
        if line.startswith("{"):
            payload = json.loads(line)
    if payload is None:
        raise BundleError("Emacs check produced no report: " + completed.stderr.strip()[-2000:])
    return {"available": True, **payload}


def verify_bundle(root: Path, *, run_emacs: bool = True, run_makeinfo: bool = True) -> dict[str, object]:
    root = root.resolve(strict=True)
    manifest_path = root / MANIFEST
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if payload.get("schema") != "firstpair-emacs-manifest-v1":
        raise BundleError("unsupported Emacs bundle manifest")
    scanned = scan(root)
    files = dict(scanned.files)
    files.pop(MANIFEST, None)
    if files != payload.get("files"):
        raise BundleError("bundle files differ from the sealed manifest")
    if scanned.bytes - manifest_path.stat().st_size != payload.get("totalBytes"):
        raise BundleError("bundle byte total differs from the sealed manifest")
    if scanned.unsafe:
        raise BundleError("bundle violates safety gates: " + "; ".join(scanned.unsafe))

    bundle = json.loads((root / "data" / "bundle.json").read_text(encoding="utf-8"))
    if bundle.get("schema") != "firstpair-emacs-bundle-v1":
        raise BundleError("unsupported bundle description")
    stems = [bundle["readerManual"], bundle["referenceManual"]]
    for required in ("init.el", "install.sh", "dir", "Guide.md", "README.md", "data/reader.json", "data/records.json", "data/references.json", "data/marked.tsv", "lisp/firstpair-bundle.el", "lisp/firstpair-lexicon.el", "lisp/firstpair-reader.el"):
        if not (root / required).is_file():
            raise BundleError(f"bundle lacks {required}")
    for stem in stems:
        for name in (f"{stem}.info", f"texi/{stem}.texi"):
            if not (root / name).is_file():
                raise BundleError(f"bundle lacks {name}")
    manuals = {stem: parse_info(root / f"{stem}.info") for stem in stems}
    problems = _check_links(manuals)
    if problems:
        raise BundleError("unresolved Info links: " + "; ".join(problems[:10]))

    marked_nodes: set[tuple[str, str]] = set()
    with (root / "data" / "marked.tsv").open(encoding="utf-8") as handle:
        header = handle.readline().rstrip("\n").split("\t")
        if header != ["manual", "node", "line", "column", "length", "form", "entries"]:
            raise BundleError("marked.tsv has an unexpected header")
        for line in handle:
            row = line.rstrip("\n").split("\t")
            if len(row) != 7:
                raise BundleError("marked.tsv row is malformed")
            if row[1] not in manuals[row[0]].nodes:
                raise BundleError(f"marked.tsv names a missing node: {row[0]} {row[1]}")
            marked_nodes.add((row[0], row[1]))

    regions_path = root / "data" / "regions.tsv"
    if regions_path.is_file():
        with regions_path.open(encoding="utf-8") as handle:
            handle.readline()
            for line in handle:
                row = line.rstrip("\n").split("\t")
                if len(row) != 7 or row[1] not in manuals[row[0]].nodes:
                    raise BundleError(f"regions.tsv names a missing node: {row[:2]}")

    if bundle["lexicon"]["mode"] != "none":
        lexicon = json.loads((root / "lexicon" / "LEXICON.json").read_text(encoding="utf-8"))
        if lexicon.get("schema") != "firstpair-lexicon-v1":
            raise BundleError("unsupported lexicon description")
        for name, meta in lexicon["files"].items():
            if files.get(f"lexicon/{name}") != meta["sha256"]:
                raise BundleError(f"lexicon table digest drift: {name}")

    report: dict[str, object] = {
        "passed": True,
        "bundle": str(root),
        "sourceCommit": payload.get("sourceCommit"),
        "product": payload.get("product"),
        "files": len(files),
        "totalBytes": payload.get("totalBytes"),
        "nodes": {stem: len(manual.nodes) for stem, manual in manuals.items()},
        "references": sum(len(manual.notes) for manual in manuals.values()),
        "markedNodes": len(marked_nodes),
        "unmatchedAnchors": len(payload.get("unmatchedAnchors", [])),
    }
    if run_makeinfo:
        report["makeinfo"] = _run_makeinfo(root, stems)
        if report["makeinfo"].get("available"):
            failed = [stem for stem, item in report["makeinfo"]["manuals"].items() if item["exitCode"] != 0]
            if failed:
                raise BundleError(f"makeinfo rejected the Texinfo source: {failed}")
    if run_emacs:
        report["emacs"] = _run_emacs(root, manuals)
        if report["emacs"].get("available"):
            if report["emacs"].get("unresolved"):
                raise BundleError(f"Emacs could not resolve references: {report['emacs']['unresolved'][:5]}")
            if report["emacs"].get("missingMarks"):
                raise BundleError(f"Emacs could not locate marked words: {report['emacs']['missingMarks'][:5]}")
    return report
