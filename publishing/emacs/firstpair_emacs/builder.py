"""Bundle construction.

Building is transactional: everything is written into a temporary directory,
validated there, and only then moved into place. A build refuses to overwrite
an existing bundle, refuses to run against a dirty worktree, and refuses to
ship a bundle whose Info files Emacs could not open.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
from dataclasses import replace
from fnmatch import fnmatch
from pathlib import Path

from firstpair_vault.revisions import require_clean_worktree, resolve_source_commit

from . import corpus, lexicon as lexicon_module, texiwriter
from .config import EmacsConfig, load
from .document import (
    Block,
    Heading,
    ItemList,
    Manual,
    Node,
    Paragraph,
    Reference,
    Strong,
    Table,
    Text,
    node_name,
)
from .guides import compose
from .infowriter import InfoWriter, Span
from .inventory import scan
from .manual import assemble
from .markdown import inline
from .projection import Projection, project


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
LISP_ROOT = PACKAGE_ROOT / "lisp"
VERSION = "1.0"
PRODUCER = f"firstpair-emacs {VERSION}"
STOPWORDS = frozenset(
    """a an and are as at be but by do for from he her his i if in is it its me my no not
    of on or our so that the their them there they this to us was we were what when who
    will with you your""".split()
)


def _safe(value: str) -> str:
    return "".join(character if character.isalnum() or character in " -_." else "-" for character in value).strip()


def plan(config_path: Path, product_name: str) -> dict[str, object]:
    config = load(config_path)
    projection = project(config, product_name)
    return {
        "slug": config.core.slug,
        "title": config.core.title,
        "profile": config.core.profile,
        "product": product_name,
        "edition": projection.product.edition,
        "output": str(projection.product.output),
        "readerPages": len(projection.pages),
        "records": len(projection.records),
        "evidenceTargets": len(projection.evidence),
        "evidenceCollections": len(projection.collections),
        "lexicon": None if config.lexicon is None else config.lexicon.language,
        "sourceCommit": resolve_source_commit(config.repo_root, config.core.source_commit),
    }


def _copy_evidence(root: Path, projection: Projection) -> dict[str, str]:
    paths: dict[str, str] = {}
    evidence_root = root / "evidence"
    for target in projection.evidence:
        if target.rights == "restricted" and target.source.suffix.lower() != ".json":
            continue
        name = f"{_safe(target.target_id)}{target.source.suffix or '.txt'}"
        destination = evidence_root / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(target.source, destination)
        paths[target.target_id] = f"evidence/{name}"
    for collection in projection.collections:
        if collection.rights == "restricted":
            continue
        base = evidence_root / _safe(collection.collection_id)
        for source in sorted(collection.source.rglob("*")):
            relative = source.relative_to(collection.source)
            if source.is_symlink():
                raise RuntimeError(f"collection contains a symlink: {collection.collection_id}/{relative}")
            if not source.is_file():
                continue
            text = relative.as_posix()
            if not any(fnmatch(text, pattern) for pattern in collection.include):
                continue
            if any(fnmatch(text, pattern) for pattern in collection.exclude):
                continue
            destination = base / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
        paths[collection.collection_id] = f"evidence/{_safe(collection.collection_id)}"
    return paths


def _colophon(config: EmacsConfig, projection: Projection, revision: str, lexicon_note: str) -> tuple[Block, ...]:
    rows = [
        ("Title", config.core.title),
        ("Profile", config.core.profile),
        ("Product", projection.product.name),
        ("Edition", projection.product.edition),
        ("Source revision", revision),
        ("Reader pages", str(len(projection.pages))),
        ("Reference records", str(len(projection.records) + len(projection.evidence))),
        ("Built by", PRODUCER),
    ]
    blocks: list[Block] = [
        Paragraph(
            body=inline(
                "This edition was generated from the book's source repository. "
                "Every node, reference, and dictionary entry below is derived from "
                "the files recorded here."
            )
        ),
        Table(header=("Field", "Value"), rows=tuple(rows)),
    ]
    if lexicon_note:
        blocks.append(Heading(level=2, title="Lexicon"))
        blocks.append(Paragraph(body=inline(lexicon_note)))
    return tuple(blocks)


def _classify(
    spans: tuple[Span, ...],
    words: lexicon_module.WordsData | None,
    language: str,
    include: frozenset[str],
    exclude: frozenset[str],
    minimum: int,
) -> list[tuple[Span, tuple[lexicon_module.Analysis, ...]]]:
    """Decide which marked words the dictionary window should offer."""

    if words is None:
        return []
    found: list[tuple[Span, tuple[lexicon_module.Analysis, ...]]] = []
    for span in spans:
        folded = lexicon_module.normalise(span.text)
        if not folded or folded in exclude:
            continue
        declared = span.kind == language
        if not declared:
            if folded in exclude or (folded in STOPWORDS and folded not in include):
                continue
            if len(folded) < minimum and folded not in include:
                continue
        analyses = words.analyse(folded)
        if not analyses:
            continue
        found.append((span, analyses))
    return found


def _glossary(
    entries: dict[str, lexicon_module.Entry],
    occurrences: dict[str, dict[str, int]],
    page_nodes: dict[str, str],
    node_titles: dict[str, str],
    reader_stem: str,
    taken: list[str],
) -> Node:
    items: list[Block] = []
    merged: dict[tuple[str, str, str], dict[str, int]] = {}
    for entry_id, places in occurrences.items():
        entry = entries[entry_id]
        key = (entry.headword, entry.part, lexicon_module._clean_senses(entry.senses))
        target = merged.setdefault(key, {})
        for node, count in places.items():
            target[node] = target.get(node, 0) + count
    representative = {}
    for entry_id in occurrences:
        entry = entries[entry_id]
        representative.setdefault((entry.headword, entry.part, lexicon_module._clean_senses(entry.senses)), entry)
    for key in sorted(merged, key=lambda item: (item[0].lower(), item[1])):
        entry = representative[key]
        places = merged[key]
        body = [
            Strong(body=(Text(text=entry.headword),)),
            Text(text=f" — {lexicon_module.PART_NAMES.get(entry.part, entry.part)}. "),
            Text(text=lexicon_module._clean_senses(entry.senses)),
        ]
        if places:
            body.append(Text(text=" Appears in: "))
            for position, node in enumerate(sorted(places, key=lambda name: -places[name])):
                if position:
                    body.append(Text(text="; "))
                body.append(
                    Reference(label=node_titles.get(node, node), node=node, manual=reader_stem)
                )
            body.append(Text(text="."))
        items.append((Paragraph(body=tuple(body)),))
    name = node_name("Latin Glossary", taken)
    taken.append(name)
    return Node(
        name=name,
        title="Latin Glossary",
        description=(
            "Every word the dictionary window recognises in this edition, with the "
            "nodes where it occurs."
        ),
        blocks=(ItemList(items=tuple(items)),) if items else (),
        kind="glossary",
    )


def _dir_file(manuals: list[Manual]) -> str:
    lines = [
        "This is the file .../dir, which contains the",
        "topmost node of the Info hierarchy, called (dir)Top.",
        "The first time you invoke Info you start off looking at this node.",
        "",
        "\x1f",
        "File: dir,\tNode: Top,\tThis is the top of the INFO tree",
        "",
        "  This (the Directory node) gives a menu of major topics.",
        "",
        "* Menu:",
        "",
    ]
    sections: dict[str, list[str]] = {}
    for manual in manuals:
        category, name, description = manual.direntry
        stem = manual.filename.removesuffix(".info")
        sections.setdefault(category, []).append(f"* {name}: ({stem}).   {description}")
    for category in sorted(sections):
        lines.append(category)
        lines.extend(sections[category])
        lines.append("")
    return "\n".join(lines) + "\n"


def _init_file(config: EmacsConfig) -> str:
    return f""";;; init.el --- load the {config.core.title} Emacs bundle  -*- lexical-binding: t; -*-

;; Add these lines to your Emacs configuration, or load this file directly:
;;
;;     (load "/absolute/path/to/this/bundle/init.el")
;;
;; Then run M-x firstpair-read.

(let ((bundle (file-name-directory (or load-file-name buffer-file-name))))
  (add-to-list 'load-path (expand-file-name "lisp" bundle))
  (require 'firstpair-reader)
  (firstpair-reader-register bundle))

(provide 'init)
;;; init.el ends here
"""


def build(config_path: Path, product_name: str, *, allow_download: bool = True) -> dict[str, object]:
    config = load(config_path)
    if product_name not in config.products:
        raise ValueError(f"product not declared for this title: {product_name}")
    revision = resolve_source_commit(config.repo_root, config.core.source_commit)
    require_clean_worktree(config.repo_root)
    projection = project(config, product_name)
    destination = projection.product.output
    if destination.exists():
        raise RuntimeError(f"refusing to replace an existing bundle: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)

    words = None
    corpus_spec = None
    if config.lexicon is not None and config.lexicon.mode != "none":
        corpus_spec = corpus.load_corpus(config.lexicon.language)
        cache = corpus.ensure(corpus_spec, allow_download=allow_download)
        words = lexicon_module.load_words(cache, corpus_spec.supplement)

    lexicon_note = ""
    if corpus_spec is not None:
        lexicon_note = (
            f"The dictionary window reads a {config.lexicon.language} lexicon compiled from "
            f"{corpus_spec.name}. {corpus_spec.license} The compiled tables ship in this bundle "
            "under lexicon/, so lookup works with no network and no external program."
        )

    with tempfile.TemporaryDirectory(prefix=f".{destination.name}-", dir=destination.parent) as temporary:
        root = Path(temporary) / destination.name
        root.mkdir()
        evidence_paths = _copy_evidence(root, projection)
        guide = compose(config, projection, source_revision=revision, lexicon_summary=_lexicon_guide(config, corpus_spec))
        assembly = assemble(
            config,
            projection,
            guide=guide,
            colophon=_colophon(config, projection, revision, lexicon_note),
            evidence_paths=evidence_paths,
        )
        reader_render = InfoWriter(assembly.reader, produced_by=PRODUCER).render()
        reference_render = InfoWriter(assembly.references, produced_by=PRODUCER).render()

        language = config.lexicon.language if config.lexicon else ""
        include = frozenset(lexicon_module.normalise(word) for word in (config.lexicon.include if config.lexicon else ()))
        exclude = frozenset(lexicon_module.normalise(word) for word in (config.lexicon.exclude if config.lexicon else ()))
        minimum = config.lexicon.minimum_length if config.lexicon else 3

        def classify(render) -> list[tuple[Span, tuple[lexicon_module.Analysis, ...]]]:
            return _classify(render.spans, words, language, include, exclude, minimum)

        marked = {
            config.reader_stem: classify(reader_render),
            config.reference_stem: classify(reference_render),
        }

        projected = None
        occurrences: dict[str, dict[str, int]] = {}
        if words is not None and config.lexicon is not None:
            vocabulary = [span.text for pairs in marked.values() for span, _ in pairs]
            projected = (
                lexicon_module.project(words, vocabulary)
                if config.lexicon.mode == "projected"
                else lexicon_module.complete(words)
            )
            node_of = {node.name: node for node in assembly.reader.nodes()}
            for span, analyses in marked[config.reader_stem]:
                if span.node not in node_of:
                    continue
                for analysis in analyses:
                    occurrences.setdefault(analysis.entry_id, {}).setdefault(span.node, 0)
                    occurrences[analysis.entry_id][span.node] += 1

        if projected is not None and occurrences:
            node_titles = {node.name: node.title for node in assembly.reader.nodes()}
            taken = [node.name for node in assembly.references.nodes()]
            entries = {entry.entry_id: entry for entry in projected.entries}
            glossary = _glossary(
                entries,
                {key: value for key, value in occurrences.items() if key in entries},
                assembly.page_nodes,
                node_titles,
                config.reader_stem,
                taken,
            )
            assembly.references.top.children.append(glossary)
            assembly.references.top.menu = assembly.references.top.menu + (
                (glossary.name, f"{language.capitalize()} words in this edition, with their meanings."),
            )
            reference_render = InfoWriter(assembly.references, produced_by=PRODUCER).render()
            known = {form for form, _ in projected.forms} if projected.forms else None
            marked = {
                stem: [
                    pair
                    for pair in classify(render)
                    if known is None or lexicon_module.normalise(pair[0].text) in known
                ]
                for stem, render in (
                    (config.reader_stem, reader_render),
                    (config.reference_stem, reference_render),
                )
            }

        (root / assembly.reader.filename).write_bytes(reader_render.data)
        (root / assembly.references.filename).write_bytes(reference_render.data)
        (root / "dir").write_text(_dir_file([assembly.reader, assembly.references]), encoding="utf-8")
        texi_root = root / "texi"
        texi_root.mkdir()
        for manual in (assembly.reader, assembly.references):
            stem = manual.filename.removesuffix(".info")
            (texi_root / f"{stem}.texi").write_text(
                texiwriter.write(manual, produced_by=PRODUCER), encoding="utf-8"
            )

        data_root = root / "data"
        data_root.mkdir()
        pages = [
            {
                "id": page.page_id,
                "title": page.title,
                "node": assembly.page_nodes[page.page_id],
                "part": config.page_parts.get(page.page_id, ""),
            }
            for page in projection.pages
        ]
        records = [
            {
                "id": record.record_id,
                "label": record.label,
                "kind": record.kind,
                "section": record.section,
                "node": assembly.record_nodes[record.record_id],
                "rights": record.rights,
                "quotedIn": [assembly.page_nodes[page] for page in record.referenced_by],
            }
            for record in projection.records
        ] + [
            {
                "id": target.target_id,
                "label": target.label,
                "kind": target.kind,
                "section": "Evidence",
                "node": assembly.record_nodes[target.target_id],
                "rights": target.rights,
                "file": evidence_paths.get(target.target_id, ""),
                "quotedIn": [assembly.page_nodes[page] for page in target.referenced_by if page in assembly.page_nodes],
            }
            for target in projection.evidence
        ]
        references = {
            "reader": {node: list(items) for node, items in reader_render.references.items() if items},
            "references": {node: list(items) for node, items in reference_render.references.items() if items},
        }
        (data_root / "reader.json").write_text(json.dumps(pages, indent=2) + "\n", encoding="utf-8")
        (data_root / "records.json").write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")
        (data_root / "references.json").write_text(json.dumps(references, indent=2) + "\n", encoding="utf-8")

        marked_rows = sorted(
            {
                "\t".join(
                    (
                        stem,
                        span.node,
                        str(span.line),
                        str(span.column),
                        str(span.length),
                        lexicon_module.normalise(span.text),
                        ",".join(dict.fromkeys(analysis.entry_id for analysis in analyses)),
                    )
                )
                for stem, pairs in marked.items()
                for span, analyses in pairs
            }
        )
        (data_root / "marked.tsv").write_text(
            "manual\tnode\tline\tcolumn\tlength\tform\tentries\n" + "".join(f"{row}\n" for row in marked_rows),
            encoding="utf-8",
        )

        lexicon_payload: dict[str, object] = {}
        if projected is not None and corpus_spec is not None and config.lexicon is not None:
            lexicon_payload = lexicon_module.write_tables(
                root / "lexicon",
                words,
                projected,
                language=config.lexicon.language,
                mode=config.lexicon.mode,
                source={
                    "name": corpus_spec.name,
                    "license": corpus_spec.license,
                    "upstream": corpus_spec.upstream,
                    "files": words.provenance,
                },
            )

        shutil.copytree(LISP_ROOT, root / "lisp", ignore=shutil.ignore_patterns("test", "*.elc", "firstpair-check.el"))
        (root / "init.el").write_text(_init_file(config), encoding="utf-8")
        (root / "Guide.md").write_text(guide, encoding="utf-8")
        (root / "README.md").write_text(guide, encoding="utf-8")

        bundle = {
            "schema": "firstpair-emacs-bundle-v1",
            "title": config.core.title,
            "slug": config.core.slug,
            "product": projection.product.name,
            "edition": projection.product.edition,
            "sourceCommit": revision,
            "readerManual": config.reader_stem,
            "referenceManual": config.reference_stem,
            "lexicon": {
                "language": config.lexicon.language if config.lexicon else "",
                "mode": config.lexicon.mode if config.lexicon else "none",
                "entries": lexicon_payload.get("entries", 0),
                "forms": lexicon_payload.get("forms", 0),
            },
            "pages": len(pages),
            "records": len(records),
            "markedWords": len(marked_rows),
        }
        (data_root / "bundle.json").write_text(json.dumps(bundle, indent=2) + "\n", encoding="utf-8")

        scanned = scan(root)
        if scanned.unsafe:
            raise RuntimeError("bundle validation failed: " + "; ".join(scanned.unsafe))
        if projection.product.max_files is not None and len(scanned.files) > projection.product.max_files:
            raise RuntimeError("bundle exceeds maxFiles")
        if projection.product.max_bytes is not None and scanned.bytes > projection.product.max_bytes:
            raise RuntimeError("bundle exceeds maxBytes")
        manifest = {
            **bundle,
            "schema": "firstpair-emacs-manifest-v1",
            "unmatchedAnchors": [{"page": page, "record": record} for page, record in assembly.unmatched],
            "files": scanned.files,
            "totalBytes": scanned.bytes,
        }
        encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
        manifest["manifestDigest"] = hashlib.sha256(encoded).hexdigest()
        (root / "FIRSTPAIR-EMACS-MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        root.rename(destination)
    return manifest


def _lexicon_guide(config: EmacsConfig, corpus_spec) -> str:
    if corpus_spec is None or config.lexicon is None:
        return ""
    return (
        "## The dictionary window\n\n"
        f"This bundle carries a {config.lexicon.language} lexicon compiled from "
        f"{corpus_spec.name}. Put point on a marked word and press `C-c C-d`; the entry "
        "opens in a third window under the references, with the dictionary form, the "
        "grammatical analysis of the exact form in front of you, and the senses. "
        "`C-c C-n` and `C-c C-p` move between marked words. "
        "Nothing here needs a network connection or an external dictionary program.\n\n"
        f"Licence: {corpus_spec.license}"
    )
