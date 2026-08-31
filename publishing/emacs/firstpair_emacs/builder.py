"""Bundle construction.

Building is transactional: everything is written into a temporary directory,
validated there, and only then moved into place. A build refuses to overwrite
an existing bundle, refuses to run against a dirty worktree, and refuses to
ship a bundle whose Info files Emacs could not open.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import tempfile
from dataclasses import replace
from fnmatch import fnmatch
from pathlib import Path

from firstpair_vault.revisions import require_clean_worktree, resolve_source_commit

from . import corpus, glosses as glosses_module, languages, texiwriter
from . import parallel
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
GLOSSARY_PLACES = 8
GLOSSARY_SPLIT = 800
STOPWORDS = frozenset(
    """a an and are as at be but by do for from he her his i if in is it its me my no not
    of on or our so that the their them there they this to us was we were what when who
    will with you your""".split()
)
READER_VERSION_HEADER = re.compile(r"^;; Version: (?P<version>\S+)$", re.MULTILINE)


def _safe(value: str) -> str:
    return "".join(character if character.isalnum() or character in " -_." else "-" for character in value).strip()


def _reader_version() -> str:
    text = (LISP_ROOT / "firstpair-reader.el").read_text(encoding="utf-8")
    match = READER_VERSION_HEADER.search(text)
    if match is None:
        raise ValueError("firstpair-reader.el declares no Version header")
    return match.group("version")


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
    lexicon: languages.Language | None,
    language: str,
    include: frozenset[str],
    exclude: frozenset[str],
    minimum: int,
) -> list[tuple[Span, tuple[languages.Analysis, ...]]]:
    """Decide which marked words the dictionary window should offer."""

    if lexicon is None:
        return []
    found: list[tuple[Span, tuple[languages.Analysis, ...]]] = []
    for span in spans:
        folded = lexicon.normalise(span.text)
        if not folded or folded in exclude:
            continue
        declared = span.kind == language
        if not declared:
            if folded in exclude or (folded in STOPWORDS and folded not in include):
                continue
            if len(folded) < minimum and folded not in include:
                continue
        analyses = lexicon.analyse(folded)
        if not analyses:
            continue
        found.append((span, analyses))
    return found


def _glossary(
    lexicon: languages.Language,
    entries: dict[str, languages.Entry],
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
        key = (entry.headword, entry.part, lexicon.senses(entry))
        target = merged.setdefault(key, {})
        for node, count in places.items():
            target[node] = target.get(node, 0) + count
    representative = {}
    for entry_id in occurrences:
        entry = entries[entry_id]
        representative.setdefault((entry.headword, entry.part, lexicon.senses(entry)), entry)
    large = len(merged) > GLOSSARY_SPLIT
    for key in sorted(merged, key=lambda item: (item[0].lower(), item[1])):
        entry = representative[key]
        # A glossary of many thousands of words lists no occurrences: the
        # references would outweigh the book itself.
        places = {} if large else merged[key]
        body = [
            Strong(body=(Text(text=entry.headword),)),
            Text(text=f" — {lexicon.part_name(entry.part)}. "),
            Text(text=lexicon.senses(entry)),
        ]
        if places:
            body.append(Text(text=" Appears in: "))
            ranked = sorted(places, key=lambda name: -places[name])
            for position, node in enumerate(ranked[:GLOSSARY_PLACES]):
                if position:
                    body.append(Text(text="; "))
                body.append(
                    Reference(label=node_titles.get(node, node), node=node, manual=reader_stem)
                )
            if len(ranked) > GLOSSARY_PLACES:
                body.append(Text(text=f" and {len(ranked) - GLOSSARY_PLACES} more"))
            body.append(Text(text="."))
        items.append((entry.headword, (Paragraph(body=tuple(body)),)))
    name = node_name(f"{lexicon.name} Glossary", taken)
    taken.append(name)
    description = (
        "Every word the dictionary window recognises in this edition, with the "
        "nodes where it occurs."
    )
    if len(items) <= GLOSSARY_SPLIT:
        return Node(
            name=name,
            title=f"{lexicon.name} Glossary",
            description=description,
            blocks=(ItemList(items=tuple(blocks for _, blocks in items)),) if items else (),
            kind="glossary",
        )
    # A large glossary reads better as one node per initial letter.
    groups: dict[str, list[tuple[Block, ...]]] = {}
    for headword, blocks in items:
        initial = next((character.upper() for character in headword if character.isalpha()), "#")
        groups.setdefault(initial, []).append(blocks)
    children: list[Node] = []
    for initial in sorted(groups):
        child_name = node_name(f"{lexicon.name} Glossary {initial}", taken)
        taken.append(child_name)
        children.append(
            Node(
                name=child_name,
                title=f"{lexicon.name} Glossary: {initial}",
                blocks=(ItemList(items=tuple(groups[initial])),),
                kind="glossary",
            )
        )
    return Node(
        name=name,
        title=f"{lexicon.name} Glossary",
        description=description,
        menu=tuple((child.name, f"{len(groups[child.title[-1]])} words") for child in children),
        children=children,
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
    reader_version = _reader_version()
    return f""";;; init.el --- load the {config.core.title} Emacs bundle  -*- lexical-binding: t; -*-

;; Add these lines to your Emacs configuration, or load this file directly:
;;
;;     (load "/absolute/path/to/this/bundle/init.el")
;;
;; Then run M-x firstpair-read.

(let ((bundle (file-name-directory (or load-file-name buffer-file-name)))
      (minimum-version (version-to-list "{reader_version}")))
  ;; Interactively an installed firstpair-reader package wins when it is at
  ;; least as new as this bundle: activate packages if that has not happened
  ;; yet, and otherwise use the bundled reader. In batch (validation, scripts)
  ;; the bundle's own Lisp is used, whatever is installed.
  (unless noninteractive
    (when (and (fboundp 'package-initialize) (not (bound-and-true-p package--initialized)))
      (ignore-errors (package-initialize))))
  (if (and (not noninteractive)
           (fboundp 'package-installed-p)
           (package-installed-p 'firstpair-reader minimum-version)
           (locate-library "firstpair-reader"))
      nil
    (add-to-list 'load-path (expand-file-name "lisp" bundle)))
  (require 'firstpair-reader)
  (firstpair-reader-register bundle))

(provide 'init)
;;; init.el ends here
"""


def _install_script(config: EmacsConfig) -> str:
    stems = f"{config.reader_stem} {config.reference_stem}"
    return f"""#!/bin/sh
# Install the Info manuals of this FirstPair bundle into an Info directory,
# so that `info` and Emacs's `C-h i` list {config.core.title} beside the
# system manuals. The bundle itself is unchanged; M-x firstpair-read keeps
# working from init.el.
#
#   ./install.sh [INFO-DIRECTORY]            install (default: ~/.local/share/info)
#   ./install.sh --remove [INFO-DIRECTORY]   remove again
#
# GNU install-info is used when present; otherwise Emacs updates the
# directory's `dir` file with the same result.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
mode=install
if [ "${{1:-}}" = "--remove" ]; then
  mode=remove
  shift
fi
target="${{1:-${{INFO_DIR:-$HOME/.local/share/info}}}}"
manuals="{stems}"
if command -v install-info >/dev/null 2>&1; then
  mkdir -p "$target"
  for stem in $manuals; do
    if [ "$mode" = install ]; then
      cp "$here/$stem.info" "$target/$stem.info"
      for part in "$here/$stem.info"-*; do [ -f "$part" ] && cp "$part" "$target/"; done
      install-info --info-dir="$target" "$target/$stem.info"
    elif [ -f "$target/$stem.info" ]; then
      install-info --delete --info-dir="$target" "$target/$stem.info"
      rm -f "$target/$stem.info" "$target/$stem.info"-*
    fi
  done
elif command -v emacs >/dev/null 2>&1; then
  if [ "$mode" = install ]; then command=firstpair-reader-install-info; else command=firstpair-reader-uninstall-info; fi
  emacs --batch -Q -L "$here/lisp" -l firstpair-reader \\
    --eval "($command (firstpair-bundle-load \\"$here\\") \\"$target\\")"
else
  echo "install.sh: neither install-info nor emacs is available" >&2
  exit 1
fi
if [ "$mode" = install ]; then
  echo "Installed {config.core.title} into $target."
  echo "Emacs: add   (add-to-list 'Info-directory-list \\"$target\\")   to your init file."
  echo "Shell: export INFOPATH=\\"$target:\\${{INFOPATH:-}}\\"   then run: info {config.reader_stem}"
else
  echo "Removed {config.core.title} from $target."
fi
"""


def build(config_path: Path, product_name: str, *, allow_download: bool = True) -> dict[str, object]:
    config = load(config_path)
    if product_name not in config.products:
        raise ValueError(f"product not declared for this title: {product_name}")
    revision = resolve_source_commit(config.repo_root, config.core.source_commit)
    require_clean_worktree(config.repo_root)
    projection = project(config, product_name)
    if projection.product.edition == "preview":
        # A preview and a complete edition of one book may sit on the same
        # Info path; distinct manual names keep them apart there and in dir.
        config = replace(
            config,
            reader_stem=f"{config.reader_stem}-preview",
            reference_stem=f"{config.reader_stem}-preview-refs",
            direntry=(config.direntry[0], f"{config.direntry[1]}-preview", config.direntry[2]),
        )
    destination = projection.product.output
    if destination.exists():
        raise RuntimeError(f"refusing to replace an existing bundle: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)

    words: languages.Language | None = None
    corpus_spec = None
    if config.lexicon is not None and config.lexicon.mode != "none":
        corpus_spec = corpus.load_corpus(config.lexicon.language)
        cache = corpus.ensure(corpus_spec, allow_download=allow_download)
        words = languages.get(config.lexicon.language)
        supplements = tuple(path for path in (corpus_spec.supplement, config.lexicon.supplement) if path is not None)
        words.load(cache, supplements)

    lexicon_note = ""
    if corpus_spec is not None:
        lexicon_note = (
            f"The dictionary window reads a {config.lexicon.language} lexicon compiled from "
            f"{corpus_spec.name}. {corpus_spec.license} The compiled tables ship in this bundle "
            "under lexicon/, so lookup works with no network and no external program."
        )
        for translation in config.lexicon.translations:
            for identifier in translation.glossaries:
                item = corpus.glossary(corpus_spec, identifier)
                lexicon_note += f" {translation.label} glosses come from {item.name} ({item.license})."
            if translation.dictionary and not translation.glossaries:
                lexicon_note += f" {translation.label} glosses come from the edition's own dictionary."

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
        fold = words.normalise if words is not None else (lambda value: value.lower())
        include = frozenset(fold(word) for word in (config.lexicon.include if config.lexicon else ()))
        exclude = frozenset(fold(word) for word in (config.lexicon.exclude if config.lexicon else ()))
        minimum = config.lexicon.minimum_length if config.lexicon else 3

        def classify(render) -> list[tuple[Span, tuple[languages.Analysis, ...]]]:
            return _classify(render.spans, words, language, include, exclude, minimum)

        marked = {
            config.reader_stem: classify(reader_render),
            config.reference_stem: classify(reference_render),
        }

        projected = None
        occurrences: dict[str, dict[str, int]] = {}
        aligned: dict[str, list[str]] = {}
        if words is not None:
            for node, lines in assembly.vocabulary.items():
                aligned[node] = [surface for line in lines for _, surface in words.tokens(line)]
        if words is not None and config.lexicon is not None:
            vocabulary = [span.text for pairs in marked.values() for span, _ in pairs]
            vocabulary.extend(surface for tokens in aligned.values() for surface in tokens)
            projected = (
                words.project(vocabulary)
                if config.lexicon.mode == "projected"
                else words.complete()
            )
            node_of = {node.name: node for node in assembly.reader.nodes()}
            for span, analyses in marked[config.reader_stem]:
                if span.node not in node_of:
                    continue
                for analysis in analyses:
                    occurrences.setdefault(analysis.entry_id, {}).setdefault(span.node, 0)
                    occurrences[analysis.entry_id][span.node] += 1
            analysed: dict[str, tuple] = {}
            for node, tokens in aligned.items():
                for surface in tokens:
                    form = words.normalise(surface)
                    if form not in analysed:
                        analysed[form] = words.analyse(form)
                    for analysis in analysed[form]:
                        occurrences.setdefault(analysis.entry_id, {}).setdefault(node, 0)
                        occurrences[analysis.entry_id][node] += 1

        if projected is not None and occurrences:
            node_titles = {node.name: node.title for node in assembly.reader.nodes()}
            taken = [node.name for node in assembly.references.nodes()]
            entries = {entry.entry_id: entry for entry in projected.entries}
            glossary = _glossary(
                words,
                entries,
                {key: value for key, value in occurrences.items() if key in entries},
                assembly.page_nodes,
                node_titles,
                config.reader_stem,
                taken,
            )
            assembly.references.top.children.append(glossary)
            assembly.references.top.menu = assembly.references.top.menu + (
                (glossary.name, f"{words.name} words in this edition, with their meanings."),
            )
            reference_render = InfoWriter(assembly.references, produced_by=PRODUCER).render()
            known = {form for form, _ in projected.forms} if projected.forms else None
            marked = {
                stem: [
                    pair
                    for pair in classify(render)
                    if known is None or words.normalise(pair[0].text) in known
                ]
                for stem, render in (
                    (config.reader_stem, reader_render),
                    (config.reference_stem, reference_render),
                )
            }

        (root / assembly.reader.filename).write_bytes(reader_render.data)
        (root / assembly.references.filename).write_bytes(reference_render.data)
        for render in (reader_render, reference_render):
            for subfile_name, payload in render.subfiles:
                (root / subfile_name).write_bytes(payload)
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
                        words.normalise(span.text) if words is not None else span.text.lower(),
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
        # Regions are written grouped by node with a byte-offset index, so a
        # reader loads one node's regions instead of the whole table.
        region_rows: list[tuple[str, str]] = [
            (f"{stem}\0{region.node}", "\t".join((stem, region.node, region.language, region.unit, str(region.start), str(region.end), "source" if region.source else "translation")))
            for stem, render in ((config.reader_stem, reader_render), (config.reference_stem, reference_render))
            for region in render.regions
        ]
        header = "manual\tnode\tlanguage\tunit\tstart\tend\trole\n"
        chunks: list[bytes] = [header.encode("utf-8")]; offset = len(chunks[0]); region_index: dict[str, list[int]] = {}
        current_key = None
        for key, row in sorted(region_rows, key=lambda item: item[0]):
            encoded = f"{row}\n".encode("utf-8")
            if key != current_key:
                region_index[key.replace("\0", "\t")] = [offset, offset]; current_key = key
            region_index[key.replace("\0", "\t")][1] = offset + len(encoded)
            chunks.append(encoded); offset += len(encoded)
        (data_root / "regions.tsv").write_bytes(b"".join(chunks))
        (data_root / "regions.index.json").write_text(json.dumps(region_index, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

        # The edition's translation table: languages, the translations of each
        # (id, title, alignment, coverage by part, default), for the reader's
        # per-language choice. Without an index, the lexicon languages stand in.
        aligned_payload = None
        if config.aligned_index is not None:
            index = parallel.load_index(config.aligned_index)
            aligned_payload = {"schema": "firstpair-emacs-translations-v1", "languages": index["languages"],
                               "translations": [{key: item.get(key) for key in ("id", "lang", "label", "title", "translator", "alignment", "coverage", "default", "orthography") if item.get(key) is not None} for item in index["translations"]]}
            (data_root / "translations.json").write_text(json.dumps(aligned_payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

        lexicon_payload: dict[str, object] = {}
        translations_payload: list[dict[str, object]] = []
        if projected is not None and corpus_spec is not None and config.lexicon is not None:
            lexicon_payload = words.write_tables(
                root / "lexicon",
                projected,
                mode=config.lexicon.mode,
                source={
                    "name": corpus_spec.name,
                    "license": corpus_spec.license,
                    "upstream": corpus_spec.upstream,
                    "files": words.provenance,
                },
            )
            translations_payload, glosses_meta = _translations(
                config, corpus_spec, words, projected, root / "lexicon", allow_download=allow_download
            )
            # The forms table is read on every lookup; sharded by first letter,
            # a lookup reads one slice instead of the whole table.
            forms_path = root / "lexicon" / "forms.tsv"
            if forms_path.is_file():
                lines = forms_path.read_text(encoding="utf-8").splitlines()
                header, rows = lines[0], lines[1:]
                shards: dict[str, list[str]] = {}
                for row in rows:
                    first = row.split("\t", 1)[0][:1].lower()
                    shards.setdefault(first if first.isalpha() else "_", []).append(row)
                forms_dir = root / "lexicon" / "forms"
                forms_dir.mkdir(exist_ok=True)
                lexicon_payload["files"].pop("forms.tsv", None)
                for name, shard_rows in sorted(shards.items()):
                    text = header + "\n" + "".join(f"{row}\n" for row in shard_rows)
                    (forms_dir / f"{name}.tsv").write_text(text, encoding="utf-8")
                    encoded = text.encode("utf-8")
                    lexicon_payload["files"][f"forms/{name}.tsv"] = {"rows": len(shard_rows), "bytes": len(encoded), "sha256": hashlib.sha256(encoded).hexdigest()}
                forms_path.unlink()
            lexicon_payload["glossLanguage"] = corpus_spec.gloss_language
            lexicon_payload["translations"] = translations_payload
            if glosses_meta is not None:
                lexicon_payload["files"].update(glosses_meta["files"])
                lexicon_payload["glosses"] = {key: glosses_meta[key] for key in ("rows", "bytes", "shards")}
            (root / "lexicon" / "LEXICON.json").write_text(
                json.dumps(lexicon_payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8"
            )

        shutil.copytree(LISP_ROOT, root / "lisp", ignore=shutil.ignore_patterns("test", "*.elc", "firstpair-check.el"))
        (root / "init.el").write_text(_init_file(config), encoding="utf-8")
        (root / "install.sh").write_text(_install_script(config), encoding="utf-8")
        (root / "install.sh").chmod(0o755)
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
                "glossLanguage": corpus_spec.gloss_language if corpus_spec else "",
                "translations": [
                    {"id": item.identifier, "label": item.label}
                    for item in (config.lexicon.translations if config.lexicon else ())
                ],
                "name": words.name if words is not None else "",
                "normalise": words.normalise_spec.payload() if words is not None else None,
                "enclitics": list(words.enclitics) if words is not None else [],
                "sourceId": config.lexicon.source_id if config.lexicon else "",
            },
            "alignedUnits": sum(1 for region in reader_render.regions if region.source),
            "translations": [item["id"] for item in aligned_payload["translations"]] if aligned_payload else [item.identifier for item in (config.lexicon.translations if config.lexicon else ())],
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


def _translations(config, corpus_spec, words, projected, directory: Path, *, allow_download: bool):
    """Project every declared target language and write the glosses table."""

    payload: list[dict[str, object]] = []
    found: list[glosses_module.Gloss] = []
    indexed: dict[Path, glosses_module.GlossaryIndex] = {}
    for translation in config.lexicon.translations:
        glossary_index = None
        glossary_items = []
        gloss_pivot = None
        gloss_pivot_name = ""
        for identifier in translation.glossaries:
            glossary_item = corpus.glossary(corpus_spec, identifier)
            if glossary_item.language != translation.identifier:
                raise ValueError(f"glossary {identifier} is {glossary_item.language}, not {translation.identifier}")
            path = corpus.ensure_glossary(corpus_spec, glossary_item, allow_download=allow_download)
            cache_key = (path, glossary_item.kind)
            index = indexed.get(cache_key) or glosses_module.load_glossary(path, glossary_item, fold=words.normalise)
            indexed[cache_key] = index
            glossary_items.append(glossary_item)
            if glossary_item.kind == "gloss-pivot":
                gloss_pivot, gloss_pivot_name = index, glossary_item.name
                continue
            glossary_index = index if glossary_index is None else glosses_module.merge(glossary_index, index)
        dictionary = glosses_module.load_dictionary(translation.dictionary, fold=words.normalise) if translation.dictionary else None
        supplement = glosses_module.load_supplement(translation.supplement, fold=words.normalise) if translation.supplement else None
        glosses, report = glosses_module.project(
            translation.identifier,
            projected,
            fold=words.normalise,
            glossary=glossary_index,
            glossary_name="; ".join(item.name for item in glossary_items),
            dictionary=dictionary,
            dictionary_name=str(translation.dictionary.relative_to(config.repo_root)) if translation.dictionary else "",
            supplement=supplement,
            supplement_name=str(translation.supplement.relative_to(config.repo_root)) if translation.supplement else "",
            related=getattr(words, "related", None),
            senses=words.senses,
            gloss_pivot=gloss_pivot,
            gloss_pivot_name=gloss_pivot_name,
        )
        found.extend(glosses)
        lexicon_covers = translation.identifier == corpus_spec.gloss_language
        payload.append(
            {
                "id": translation.identifier,
                "label": translation.label,
                "lexicon": lexicon_covers,
                "glossaries": [
                    {"id": item.identifier, "name": item.name, "license": item.license, "snapshot": item.snapshot, "kind": item.kind}
                    for item in glossary_items
                ],
                "dictionary": str(translation.dictionary.relative_to(config.repo_root)) if translation.dictionary else None,
                "supplement": str(translation.supplement.relative_to(config.repo_root)) if translation.supplement else None,
                "coverage": {
                    "forms": report["forms"],
                    "covered": report["forms"] if lexicon_covers else report["covered"],
                    "glossed": report["covered"],
                    "derivedEntries": report.get("derivedEntries", 0),
                    "missing": [] if lexicon_covers else report["missing"][:200],
                },
            }
        )
    if not found:
        return payload, None
    return payload, glosses_module.write(directory, found)


def _lexicon_guide(config: EmacsConfig, corpus_spec) -> str:
    if corpus_spec is None or config.lexicon is None:
        return ""
    labels = [translation.label for translation in config.lexicon.translations]
    languages = " and ".join(labels) if len(labels) <= 2 else ", ".join(labels[:-1]) + f", and {labels[-1]}"
    selector = ""
    if len(labels) > 1:
        selector = (
            f" The dictionary answers in {languages}; `C-c C-t` (or `t` in the dictionary "
            "window) cycles between one language at a time and all of them together, and the "
            "window's header line shows the current choice."
        )
    return (
        "## The dictionary window\n\n"
        f"This bundle carries a {config.lexicon.language} lexicon compiled from "
        f"{corpus_spec.name}. Put point on a marked word and press `C-c C-d`; the entry "
        "opens in a third window under the references, with the dictionary form, the "
        "grammatical analysis of the exact form in front of you, and the senses. "
        "`C-c C-n` and `C-c C-p` move between marked words. "
        f"Nothing here needs a network connection or an external dictionary program.{selector}\n\n"
        f"Licence: {corpus_spec.license}"
    )
