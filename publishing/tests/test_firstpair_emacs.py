from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PUBLISHING = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PUBLISHING / "vault"))
sys.path.insert(0, str(PUBLISHING / "emacs"))

from firstpair_emacs import corpus, package  # noqa: E402
from firstpair_emacs.builder import build, plan  # noqa: E402
from firstpair_emacs.config import load  # noqa: E402
from firstpair_emacs.document import Manual, Node, Paragraph, Reference, Text, Emphasis, node_name  # noqa: E402
from firstpair_emacs.guides import compose  # noqa: E402
from firstpair_emacs.infowriter import InfoWriter  # noqa: E402
from firstpair_emacs.manual import link_records  # noqa: E402
from firstpair_emacs.markdown import parse  # noqa: E402
from firstpair_emacs.projection import project  # noqa: E402
from firstpair_emacs.verify import BundleError, parse_info, verify_bundle  # noqa: E402
from firstpair_vault.config import ConfigError  # noqa: E402


CHAPTER = """# Proem: I Discover That I Am Not Dead

I am told that I have been dead for more than two thousand years.[^one]

Atticus once wrote: *Ubi nihil erit, quod scribas, id ipsum scribito.* He meant it.

> *Res publica res populi.*
>
> — Cicero, De re publica

## A second heading

| Field | Value |
| --- | --- |
| Work | Letters to Atticus |

![A portrait of Cicero.](book/images/cicero.jpg)

- first item
- second item with `code`

[^one]: The footnote text.
"""

RECORDS = [
    {
        "id": "quote-att-4-8a",
        "work_title": "Letters to Atticus",
        "citation": "4.8a",
        "latin": "Ubi nihil erit, quod scribas, id ipsum scribito.",
        "english": "When you have nothing to write, write and say so.",
        "translator": "E. O. Winstedt",
        "book_sources": ["chapter.md"],
        "aliases": ["Ubi nihil erit, quod scribas, id ipsum scribito."],
    },
    {
        "id": "quote-rep-1-39",
        "work_title": "De re publica",
        "citation": "1.39",
        "latin": "Res publica res populi.",
        "english": "The republic is the people's affair.",
        "translator": "C. W. Keyes",
        "book_sources": ["chapter.md", "second.md"],
        "aliases": ["Res publica res populi.", "the people's affair"],
    },
]


def lexicon_cached() -> bool:
    try:
        corpus.ensure(corpus.load_corpus("latin"), allow_download=False)
    except (RuntimeError, FileNotFoundError):
        return False
    return True


class Fixture(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        (self.root / "chapter.md").write_text(CHAPTER, encoding="utf-8")
        (self.root / "second.md").write_text(
            "# Book I: The Young Advocate\n\nHe called it the people's affair and moved on.\n",
            encoding="utf-8",
        )
        (self.root / "notes.md").write_text("# Research note\n\nA dossier paragraph.\n", encoding="utf-8")
        (self.root / "guide.md").write_text("Open the Proem first.\n", encoding="utf-8")
        with (self.root / "records.jsonl").open("w", encoding="utf-8") as handle:
            for row in RECORDS:
                handle.write(json.dumps(row) + "\n")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_config(self, **overrides) -> Path:
        value = {
            "schemaVersion": 1,
            "slug": "fixture",
            "title": "Fixture Book",
            "profile": "history",
            "sourceCommit": "HEAD",
            "guide": {"bookSpecific": "guide.md"},
            "reader": [
                {"id": "proem", "title": "Proem", "source": "chapter.md", "preview": True, "part": "Part I"},
                {"id": "book-1", "title": "Book I", "source": "second.md", "part": "Part I"},
            ],
            "evidence": [
                {"id": "note", "kind": "source-passage", "source": "notes.md", "label": "Research note", "referencedBy": ["proem"]}
            ],
            "products": {"desktop": {"output": "candidate/desktop"}},
            "emacs": {
                "direntry": {"name": "fixture", "description": "A fixture."},
                "subtitle": "A Test",
                "author": "Nobody",
                "parts": [{"title": "Part I", "description": "The first part."}],
                "lexicon": {"language": "latin", "mode": "none"},
                "records": [
                    {
                        "id": "passages",
                        "source": "records.jsonl",
                        "label": "{work_title} {citation}",
                        "section": "Passages",
                        "referencedBy": "book_sources",
                        "referenceMatch": "source",
                        "anchors": ["aliases"],
                        "blocks": [
                            {"field": "latin", "label": "Latin", "style": "quotation", "language": "latin"},
                            {"field": "english", "label": "English", "style": "quotation"},
                            {"field": "translator", "label": "Translator", "style": "field"},
                        ],
                    }
                ],
                "products": {
                    "desktop": {"output": "emacs/desktop"},
                    "preview": {"output": "emacs/preview", "edition": "preview"},
                },
            },
        }
        value.update(overrides)
        path = self.root / "vault.build.json"
        path.write_text(json.dumps(value), encoding="utf-8")
        return path

    def commit(self) -> None:
        subprocess.run(["git", "init", "-q", "--initial-branch=main", str(self.root)], check=True)
        subprocess.run(["git", "-C", str(self.root), "config", "user.name", "Emacs Test"], check=True)
        subprocess.run(["git", "-C", str(self.root), "config", "user.email", "emacs@example.invalid"], check=True)
        subprocess.run(["git", "-C", str(self.root), "add", "."], check=True)
        subprocess.run(["git", "-C", str(self.root), "commit", "-q", "-m", "fixture"], check=True)


class ConfigTests(Fixture):
    def test_reads_the_emacs_block_over_the_shared_core(self) -> None:
        config = load(self.write_config())
        self.assertEqual("fixture", config.reader_stem)
        self.assertEqual("fixture-refs", config.reference_stem)
        self.assertEqual({"proem": "Part I", "book-1": "Part I"}, config.page_parts)
        self.assertEqual("latin", config.lexicon.language)
        self.assertEqual(("passages",), tuple(record.set_id for record in config.records))

    def test_rejects_unknown_products_and_parts(self) -> None:
        with self.assertRaises(ConfigError):
            load(self.write_config(emacs={"products": {"mobile": {"output": "x"}}}))
        path = self.write_config(reader=[{"id": "proem", "title": "Proem", "source": "chapter.md", "part": "Part I"}])
        config = load(path)
        self.assertEqual({"proem": "Part I"}, config.page_parts)

    def test_preview_projects_only_referenced_records(self) -> None:
        config = load(self.write_config())
        desktop, preview = project(config, "desktop"), project(config, "preview")
        self.assertEqual(2, len(desktop.records))
        self.assertEqual(1, len(preview.pages))
        self.assertEqual({"quote-att-4-8a", "quote-rep-1-39"}, {record.record_id for record in preview.records})
        self.assertEqual(("proem",), preview.records[1].referenced_by)
        guide = compose(config, preview, source_revision="0" * 40)
        self.assertIn("Install Emacs", guide)
        self.assertIn("Using a history edition", guide)
        self.assertIn("This preview bundle", guide)
        self.assertIn("Open the Proem first.", guide)


def has(program: str) -> bool:
    return shutil.which(program) is not None


class PackageTests(unittest.TestCase):
    def test_assembles_an_installable_package_with_its_handbook(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            manifest = package.assemble(output)
            release = manifest["version"]
            directory = output / f"firstpair-reader-{release}"
            for name in ("firstpair-reader.el", "firstpair-bundle.el", "firstpair-lexicon.el", "firstpair-reader-pkg.el", "firstpair-reader.info", "dir", "README.md"):
                self.assertTrue((directory / name).is_file(), name)
            self.assertIn(f'(define-package "firstpair-reader" "{release}"', (directory / "firstpair-reader-pkg.el").read_text())
            parsed = parse_info(directory / "firstpair-reader.info")
            self.assertIn("Install Emacs", parsed.nodes)
            self.assertIn("Add the manuals to Info's directory", parsed.nodes)
            with self.assertRaises(RuntimeError):
                package.assemble(output)
            if not has("emacs"):
                return
            user_dir = output / "elpa"
            script = f"""(progn
  (require 'package)
  (setq package-user-dir "{user_dir.as_posix()}")
  (package-initialize)
  (package-install-file "{manifest['tar']}")
  (require 'firstpair-reader)
  (info "(firstpair-reader)Top")
  (princ (format "installed=%S node=%S discover=%S\n"
                 (package-installed-p 'firstpair-reader)
                 Info-current-node
                 (fboundp 'firstpair-reader-discover))))"""
            completed = subprocess.run(["emacs", "--batch", "-Q", "--eval", script], capture_output=True, text=True, check=False)
            self.assertEqual(0, completed.returncode, completed.stderr[-2000:])
            self.assertIn("installed=t", completed.stdout)
            self.assertIn('node="Top"', completed.stdout)
            self.assertIn("discover=t", completed.stdout)


class ModelTests(unittest.TestCase):
    def test_node_names_avoid_info_delimiters(self) -> None:
        self.assertEqual("Letters to Atticus 4-8a", node_name("Letters to Atticus 4.8a"))
        self.assertEqual("Proem - I Discover", node_name("Proem: I Discover"))
        self.assertEqual("Section 2", node_name("Section", ["Section"]))
        self.assertEqual("Top Matter", node_name("Top"))

    def test_markdown_covers_the_manuscript_constructs(self) -> None:
        blocks = parse(CHAPTER)
        kinds = [type(block).__name__ for block in blocks]
        self.assertEqual(
            ["Heading", "Paragraph", "Paragraph", "Quotation", "Heading", "Table", "Figure", "ItemList", "Footnote"],
            kinds,
        )
        self.assertEqual("Cicero, De re publica", blocks[3].attribution)
        self.assertEqual(("Field", "Value"), blocks[5].header)

    def test_citations_follow_the_quoted_words(self) -> None:
        blocks = (Paragraph(body=(Text(text="He wrote: "), Emphasis(body=(Text(text="Res publica res populi."),)), Text(text=" Indeed."))),)
        reference = Reference(label="De re publica 1.39", node="De re publica 1-39", target_id="rep", manual="fixture-refs")
        linked, matched = link_records(blocks, [("Res publica res populi.", reference)])
        self.assertEqual({"rep"}, matched)
        body = linked[0].body
        self.assertIsInstance(body[1], Emphasis)
        self.assertEqual(Text(text=" ("), body[2])
        self.assertEqual(reference, body[3])
        self.assertEqual(Text(text=")"), body[4])

    def test_info_writer_records_exact_positions(self) -> None:
        top = Node(name="Top", title="Fixture", menu=(("Alpha", ""),))
        alpha = Node(
            name="Alpha",
            title="Alpha",
            blocks=(Paragraph(body=(Text(text="Plain then "), Emphasis(body=(Text(text="amicitia vera"),), language="latin"), Text(text=" ("), Reference(label="A. Ref", node="Beta 1-2", manual="other"), Text(text=")"))),),
        )
        top.children.append(alpha)
        rendered = InfoWriter(Manual(filename="fixture.info", title="Fixture", top=top, direntry=("Books", "fixture", "d")), produced_by="test").render()
        text = rendered.data.decode("utf-8")
        self.assertIn("*note A. Ref: (other)Beta 1-2,", text)
        spans = [span for span in rendered.spans if span.node == "Alpha"]
        self.assertEqual(["amicitia", "vera"], [span.text for span in spans])
        node_text = text.split("\x1f\n")[2]
        lines = node_text.split("\n")
        for span in spans:
            self.assertEqual(span.text, lines[span.line - 1][span.column : span.column + span.length])
            self.assertEqual("latin", span.kind)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "fixture.info"
            path.write_bytes(rendered.data)
            parsed = parse_info(path)
        self.assertEqual({"Top", "Alpha"}, set(parsed.nodes))
        self.assertEqual([("Alpha", "other", "Beta 1-2")], parsed.notes)


class BuildTests(Fixture):
    def test_builds_and_verifies_a_complete_bundle(self) -> None:
        path = self.write_config()
        self.commit()
        planned = plan(path, "desktop")
        self.assertEqual(2, planned["records"])
        manifest = build(path, "desktop", allow_download=False)
        bundle = self.root / "emacs" / "desktop"
        self.assertEqual("firstpair-emacs-manifest-v1", manifest["schema"])
        self.assertEqual([], manifest["unmatchedAnchors"])
        for name in ("fixture.info", "fixture-refs.info", "texi/fixture.texi", "init.el", "dir", "lisp/firstpair-reader.el"):
            self.assertTrue((bundle / name).is_file(), name)
        self.assertFalse((bundle / "lisp" / "firstpair-check.el").exists())
        self.assertEqual((bundle / "Guide.md").read_bytes(), (bundle / "README.md").read_bytes())
        reader = " ".join((bundle / "fixture.info").read_text(encoding="utf-8").split())
        self.assertIn("(*note Letters to Atticus 4.8a: (fixture-refs)Letters to Atticus 4-8a,)", reader)
        self.assertIn("Node: Part I", reader)
        references = " ".join((bundle / "fixture-refs.info").read_text(encoding="utf-8").split())
        self.assertIn("Quoted in:", references)
        self.assertIn("*note Proem: (fixture)Proem,", references)
        self.assertIn("Node: Research note", references)
        records = json.loads((bundle / "data" / "records.json").read_text(encoding="utf-8"))
        self.assertEqual({"quote-att-4-8a", "quote-rep-1-39", "note"}, {row["id"] for row in records})
        report = verify_bundle(bundle)
        self.assertTrue(report["passed"])
        self.assertEqual({"fixture": 7, "fixture-refs": 6}, report["nodes"])
        if report.get("emacs", {}).get("available"):
            self.assertEqual([], list(report["emacs"]["unresolved"]))
            self.assertEqual(report["emacs"]["visited"], 13)
        if report.get("makeinfo", {}).get("available"):
            self.assertTrue(all(item["exitCode"] == 0 for item in report["makeinfo"]["manuals"].values()))
        with self.assertRaises(RuntimeError):
            build(path, "desktop", allow_download=False)
        self.assertTrue((bundle / "install.sh").stat().st_mode & 0o100)
        self.assertIn("(add-to-list 'load-path (expand-file-name \"lisp\" bundle) t)", (bundle / "init.el").read_text())
        if has("install-info") or has("emacs"):
            info_dir = self.root / "info-dir"
            for mode in ("install", "remove"):
                arguments = ["sh", str(bundle / "install.sh")] + (["--remove"] if mode == "remove" else []) + [str(info_dir)]
                completed = subprocess.run(arguments, capture_output=True, text=True, check=False)
                self.assertEqual(0, completed.returncode, completed.stderr)
                present = (info_dir / "fixture.info").exists()
                self.assertEqual(mode == "install", present)
                listing = (info_dir / "dir").read_text(encoding="utf-8") if (info_dir / "dir").exists() else ""
                self.assertEqual(mode == "install", "(fixture)" in listing, listing)
        if has("emacs"):
            info_dir = self.root / "info-elisp"
            script = f"""(progn
  (add-to-list 'load-path "{(bundle / 'lisp').as_posix()}")
  (require 'firstpair-reader)
  (let ((bundle (firstpair-bundle-load "{bundle.as_posix()}")))
    (cl-letf (((symbol-function 'firstpair-reader--install-info-program) (lambda () nil)))
      (firstpair-reader-install-info bundle "{info_dir.as_posix()}")
      (princ (format "installed=%S\n" (file-exists-p "{(info_dir / 'dir').as_posix()}")))
      (firstpair-reader-uninstall-info bundle "{info_dir.as_posix()}")
      (princ (format "removed=%S\n" (not (file-exists-p "{(info_dir / 'fixture.info').as_posix()}")))))))"""
            completed = subprocess.run(["emacs", "--batch", "-Q", "--eval", script], capture_output=True, text=True, check=False)
            self.assertEqual(0, completed.returncode, completed.stderr[-2000:])
            self.assertIn("installed=t", completed.stdout)
            self.assertIn("removed=t", completed.stdout)
            listing = (info_dir / "dir").read_text(encoding="utf-8")
            self.assertNotIn("(fixture)", listing)
            self.assertIn("* Menu:", listing)
        (bundle / "dir").write_text("changed\n", encoding="utf-8")
        with self.assertRaises(BundleError):
            verify_bundle(bundle, run_emacs=False, run_makeinfo=False)

    def test_refuses_a_dirty_worktree(self) -> None:
        path = self.write_config()
        self.commit()
        (self.root / "chapter.md").write_text(CHAPTER + "\nMore.\n", encoding="utf-8")
        with self.assertRaises(RuntimeError):
            build(path, "preview", allow_download=False)

    @unittest.skipUnless(lexicon_cached(), "pinned Latin corpus is not cached")
    def test_projected_lexicon_marks_latin_and_builds_a_glossary(self) -> None:
        path = self.write_config()
        raw = json.loads(path.read_text(encoding="utf-8"))
        raw["emacs"]["lexicon"] = {"language": "latin", "mode": "projected", "exclude": ["res"]}
        path.write_text(json.dumps(raw), encoding="utf-8")
        self.commit()
        manifest = build(path, "preview", allow_download=False)
        bundle = self.root / "emacs" / "preview"
        self.assertGreater(manifest["lexicon"]["entries"], 0)
        self.assertGreater(manifest["markedWords"], 0)
        marked = (bundle / "data" / "marked.tsv").read_text(encoding="utf-8").splitlines()
        forms = {line.split("\t")[5] for line in marked[1:]}
        self.assertIn("scribito", forms)
        self.assertIn("populi", forms)
        self.assertNotIn("res", forms)
        self.assertTrue((bundle / "fixture-preview.info").is_file())
        references = (bundle / "fixture-preview-refs.info").read_text(encoding="utf-8")
        self.assertIn("Node: Latin Glossary", references)
        self.assertIn("scribo", references)
        for name in ("entries.tsv", "forms.tsv", "stems.tsv", "endings.tsv", "LEXICON.json"):
            self.assertTrue((bundle / "lexicon" / name).is_file(), name)
        report = verify_bundle(bundle)
        self.assertTrue(report["passed"])
        if report.get("emacs", {}).get("available"):
            self.assertEqual([], list(report["emacs"]["missingMarks"]))
            self.assertEqual(report["emacs"]["expectedMarks"], report["emacs"]["locatedMarks"])
            self.assertGreater(report["emacs"]["lexiconTested"], 0)
            self.assertEqual([], list(report["emacs"]["lexiconFailures"]))


if __name__ == "__main__":
    unittest.main()
