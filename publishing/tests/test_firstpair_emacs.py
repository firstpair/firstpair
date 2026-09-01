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

from firstpair_emacs import corpus, glosses, package  # noqa: E402
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
                "launcher": "dante.sh",
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
        self.assertEqual("dante.sh", config.launcher)
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

    @unittest.skipUnless(has("emacs"), "Emacs is not installed")
    def test_dictionary_has_source_headword_and_two_sense_rows_per_language(self) -> None:
        script = f'''(progn
  (add-to-list 'load-path "{package.LISP_ROOT.as_posix()}")
  (require 'firstpair-reader)
  (setq debug-on-error t print-escape-newlines t
        firstpair-reader-touch t firstpair-lexicon-languages nil)
  (let ((fixture (firstpair-bundle--create :translations nil)))
  (cl-letf (((symbol-function 'firstpair-lexicon-analyse)
             (lambda (_bundle word)
               (cond ((equal word "missing") nil)
                     ((equal word "short") '((:entry "short|adjective")))
                     ((equal word "oscura")
                      '((:entry "oscuro|adjective")
                        (:entry "Oscuro|name")
                        (:entry "oscurare|verb")))
                     (t '((:entry "amore|noun") (:entry "Amore|name"))))))
            ((symbol-function 'firstpair-lexicon-entry)
             (lambda (_bundle id)
               (cond ((string-prefix-p "amore|" id) '(:headword "amore"))
                     ((string-prefix-p "Amore|" id) '(:headword "Amore"))
                     ((string-prefix-p "short|" id) '(:headword "short"))
                     ((string-prefix-p "oscuro|" id) '(:headword "oscuro"))
                     ((string-prefix-p "Oscuro|" id) '(:headword "Oscuro"))
                     ((string-prefix-p "oscurare|" id) '(:headword "oscurare")))))
            ((symbol-function 'firstpair-lexicon-selected)
             (lambda (_bundle)
               (if (equal firstpair-lexicon-languages '("ru"))
                   '(((id . "ru") (label . "Русский")))
                 '(((id . "en") (label . "English"))
                   ((id . "ru") (label . "Русский"))))))
            ((symbol-function 'firstpair-lexicon-definitions)
             (lambda (_bundle language word _readings)
               (cond
                ((equal word "short")
                 (if (equal language "en")
                     '((:headword "short" :part "adjective" :definitions ("brief")))
                   '((:headword "краткий" :part "прилагательное"
                                :definitions ("краткий" "короткий")))))
                ((equal word "missing") nil)
                ((equal language "en")
                 '((:headword "love" :part "noun"
                              :definitions ("love" "affection"))
                   (:headword "devotion" :part "noun"
                              :definitions ("love" "devotion"))))
                (t
                 '((:headword "любовь" :part "существительное"
                              :definitions ("любовь" "чувство"))))))))
    (princ (format "reader-bar=%s\\n"
                   (mapconcat (lambda (item)
                                (if (stringp item) (substring-no-properties item) ""))
                              (firstpair-reader--reader-bar fixture) "")))
    (with-current-buffer (firstpair-lexicon-render fixture "amore")
      (let ((compact (buffer-substring-no-properties (point-min) (point-max))))
        (princ (format "compact=%S lines=%d headword-face=%S header=%S truncated=%S more=%S key=%S bar=%S\\n"
                       compact (length (split-string compact "\\n" t))
                       (get-text-property (point-min) 'face)
                       header-line-format truncate-lines firstpair-lexicon-has-more
                       (key-binding (kbd "m"))
                       (mapconcat (lambda (item)
                                    (if (stringp item) (substring-no-properties item) ""))
                                  mode-line-format "")))
        (let ((alignment
               (catch 'alignment
                 (dolist (item mode-line-format)
                   (when (and (stringp item)
                              (> (length item) 0)
                              (get-text-property 0 'display item))
                     (throw 'alignment (get-text-property 0 'display item))))
                 nil)))
          (princ (format "dictionary-bar=%s align=%S\\n"
                         (mapconcat (lambda (item)
                                      (if (stringp item)
                                          (substring-no-properties item) ""))
                                    mode-line-format "")
                         alignment)))
        (firstpair-lexicon-toggle-details)
        (princ (format "expanded=%S truncated=%S wrapped=%S bar=%S\\n"
                       (buffer-substring-no-properties (point-min) (point-max))
                       truncate-lines word-wrap
                       (mapconcat (lambda (item)
                                    (if (stringp item) (substring-no-properties item) ""))
                                  mode-line-format "")))
        (firstpair-lexicon-toggle-details)
        (princ (format "collapsed-again=%S\\n"
                       (equal compact (buffer-substring-no-properties
                                       (point-min) (point-max)))))
        (firstpair-lexicon-toggle-details)
        (setq firstpair-lexicon-languages '("ru"))
        (firstpair-lexicon-render fixture "amore")
        (princ (format "expanded-ru=%S more=%S bar=%S\\n"
                       firstpair-lexicon-expanded firstpair-lexicon-has-more
                       (mapconcat (lambda (item)
                                    (if (stringp item) (substring-no-properties item) ""))
                                  mode-line-format "")))
        (firstpair-lexicon-toggle-details)
        (princ (format "collapsed-ru=%S\\n" firstpair-lexicon-expanded))
        (setq firstpair-lexicon-languages nil)
        (firstpair-lexicon-render fixture "short")
        (princ (format "short=%S expanded=%S more=%S\\n"
                       (buffer-substring-no-properties (point-min) (point-max))
                       firstpair-lexicon-expanded firstpair-lexicon-has-more))
        (setq firstpair-lexicon-languages '("ru"))
        (firstpair-lexicon-render fixture "short")
        (princ (format "ru-only=%S\\n"
                       (buffer-substring-no-properties (point-min) (point-max))))
        (firstpair-lexicon-render fixture "missing")
        (princ (format "missing=%S\\n"
                       (buffer-substring-no-properties (point-min) (point-max))))
        (firstpair-lexicon-render fixture "oscura")
        (princ (format "ambiguous=%S\\n"
                       (car (split-string
                             (buffer-substring-no-properties (point-min) (point-max))
                             "\\n" t))))))))))'''
        completed = subprocess.run(
            ["emacs", "--batch", "-Q", "--eval", script],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(0, completed.returncode, completed.stderr)
        output = completed.stdout
        self.assertIn('compact="amore\\nlove\\naffection\\nлюбовь\\nчувство\\n" lines=5', output)
        self.assertIn("headword-face=firstpair-lexicon-headword", output)
        self.assertIn("header=nil truncated=t more=t key=firstpair-lexicon-toggle-details", output)
        self.assertIn('expanded="amore\\nlove\\naffection\\ndevotion\\nлюбовь\\nчувство\\n"', output)
        self.assertIn("truncated=nil wrapped=t", output)
        self.assertIn("collapsed-again=t", output)
        self.assertIn('expanded-ru=t more=nil bar=" Close   Lang   Less ', output)
        self.assertIn("collapsed-ru=nil", output)
        self.assertIn('short="short\\nbrief\\nкраткий\\nкороткий\\n" expanded=nil more=nil', output)
        self.assertIn('ru-only="short\\nкраткий\\nкороткий\\n"', output)
        self.assertIn('missing="missing\\nNo entry in the selected dictionaries.\\n"', output)
        self.assertIn('ambiguous="oscuro · oscurare"', output)
        self.assertIn("reader-bar= Next ▶   ◀w ", output)
        self.assertLess(output.index("Next ▶"), output.index("◀w"))
        self.assertRegex(output, r"dictionary-bar=.*◀w.*Next ▶")
        self.assertRegex(output, r"dictionary-bar=.* align=\(space :align-to \(- right [0-9]+\)\)")
        self.assertNotIn("English", output)
        self.assertNotIn("Русский", output)
        self.assertNotIn("adjective", output)
        self.assertNotIn("существительное", output)
        self.assertRegex(output, r"bar=.*More")
        self.assertRegex(output, r"expanded=.*bar=.*Less")

    @unittest.skipUnless(has("emacs"), "Emacs is not installed")
    def test_return_advances_poem_but_keeps_info_links(self) -> None:
        script = f'''(progn
  (add-to-list 'load-path "{package.LISP_ROOT.as_posix()}")
  (require 'firstpair-reader)
  (princ (format "bindings=%S/%S\\n"
                 (lookup-key firstpair-reader-mode-map (kbd "RET"))
                 (lookup-key firstpair-reader-mode-map [return])))
  (let (called)
    (cl-letf (((symbol-function 'firstpair-reader--role) (lambda (&optional _buffer) 'reader))
              ((symbol-function 'firstpair-reader--bundle) (lambda () 'fixture))
              ((symbol-function 'firstpair-reader--source-node-p)
               (lambda (_bundle) t))
              ((symbol-function 'firstpair-reader--link-at-point-p) (lambda () nil))
              ((symbol-function 'firstpair-reader-next-marked-lookup)
               (lambda () (interactive) (setq called 'next)))
              ((symbol-function 'firstpair-reader-follow-nearest-node)
               (lambda (&optional _fork) (interactive) (setq called 'follow))))
      (firstpair-reader-return)
      (princ (format "poem=%S\\n" called))
      (setq called nil)
      (cl-letf (((symbol-function 'firstpair-reader--link-at-point-p) (lambda () t)))
        (firstpair-reader-return))
      (princ (format "poem-link=%S\\n" called))
      (setq called nil)
      (cl-letf (((symbol-function 'firstpair-reader--source-node-p)
                 (lambda (_bundle) nil)))
        (firstpair-reader-return))
      (princ (format "reader-menu=%S\\n" called))
      (setq called nil)
      (cl-letf (((symbol-function 'firstpair-reader--role)
                 (lambda (&optional _buffer) 'references)))
        (firstpair-reader-return))
      (princ (format "references=%S\\n" called)))))'''
        completed = subprocess.run(
            ["emacs", "--batch", "-Q", "--eval", script],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertIn("bindings=firstpair-reader-return/firstpair-reader-return", completed.stdout)
        self.assertIn("poem=next", completed.stdout)
        self.assertIn("poem-link=follow", completed.stdout)
        self.assertIn("reader-menu=follow", completed.stdout)
        self.assertIn("references=follow", completed.stdout)

    @unittest.skipUnless(has("emacs"), "Emacs is not installed")
    def test_dictionary_window_fits_compact_rows_and_caps_expanded_rows(self) -> None:
        script = f'''(progn
  (add-to-list 'load-path "{package.LISP_ROOT.as_posix()}")
  (require 'firstpair-reader)
  (setq debug-on-error t firstpair-reader-touch t
        firstpair-reader-lexicon-height 10 firstpair-lexicon-languages nil)
  (let ((fixture (firstpair-bundle--create :translations nil)))
    (cl-letf (((symbol-function 'firstpair-lexicon-analyse)
               (lambda (_bundle _word) '((:entry "amore|noun"))))
              ((symbol-function 'firstpair-lexicon-entry)
               (lambda (_bundle _id) '(:headword "amore")))
              ((symbol-function 'firstpair-lexicon-selected)
               (lambda (_bundle)
                 (if (equal firstpair-lexicon-languages '("ru"))
                     '(((id . "ru") (label . "Русский")))
                   '(((id . "en") (label . "English"))
                     ((id . "ru") (label . "Русский"))))))
              ((symbol-function 'firstpair-lexicon-definitions)
               (lambda (_bundle language _word _readings)
                 (list (list :headword (if (equal language "ru") "любовь" "love")
                             :part "noun"
                             :definitions
                             (mapcar (lambda (number) (format "%s-%d" language number))
                                     (number-sequence 1 12)))))))
      (let ((dictionary (firstpair-lexicon-render fixture "amore"))
            (reader (get-buffer-create "*FirstPair fit reader*")))
        (delete-other-windows)
        (firstpair-reader--reset-roles)
        (firstpair-reader--claim (selected-window) 'reader)
        (set-window-buffer (selected-window) reader)
        (let ((window (firstpair-reader--show dictionary 'lexicon)))
          (princ (format "both=%d/%d start=%d\\n"
                         (window-body-height window) (window-total-height window)
                         (window-start window)))
          (setq firstpair-lexicon-languages '("ru"))
          (firstpair-lexicon-render fixture "amore")
          (princ (format "ru=%d/%d start=%d\\n"
                         (window-body-height window) (window-total-height window)
                         (window-start window)))
          (with-current-buffer dictionary (firstpair-lexicon-toggle-details))
          (princ (format "expanded=%d/%d start=%d\\n"
                         (window-body-height window) (window-total-height window)
                         (window-start window)))
          (with-current-buffer dictionary (firstpair-lexicon-toggle-details))
          (princ (format "less=%d/%d start=%d\\n"
                         (window-body-height window) (window-total-height window)
                         (window-start window))))))))'''
        completed = subprocess.run(
            ["emacs", "--batch", "-Q", "--eval", script],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertIn("both=5/6 start=1", completed.stdout)
        self.assertIn("ru=3/4 start=1", completed.stdout)
        self.assertIn("expanded=9/10 start=1", completed.stdout)
        self.assertIn("less=3/4 start=1", completed.stdout)

    @unittest.skipUnless(has("emacs"), "Emacs is not installed")
    def test_dictionary_retries_small_reference_pane_and_restores_borrowed_pane(self) -> None:
        script = f'''(progn
  (add-to-list 'load-path "{package.LISP_ROOT.as_posix()}")
  (require 'firstpair-reader)
  (setq debug-on-error t firstpair-reader-lexicon-height 10)
  (let ((reader-buffer (get-buffer-create "*FirstPair small reader*"))
        (references-buffer (get-buffer-create "*FirstPair small references*"))
        (dictionary-buffer (get-buffer-create firstpair-lexicon-buffer)))
    (with-current-buffer dictionary-buffer
      (let ((inhibit-read-only t))
        (erase-buffer)
        (insert "amore\\nlove\\naffection\\nлюбовь\\nчувство\\n"))
      (special-mode))
    (delete-other-windows)
    (firstpair-reader--reset-roles)
    (let* ((reader (firstpair-reader--claim (selected-window) 'reader))
           (references (firstpair-reader--claim
                        (split-window reader (- window-min-height) 'below)
                        'references)))
      (set-window-buffer reader reader-buffer)
      (set-window-buffer references references-buffer)
      (let ((lexicon (firstpair-reader--show dictionary-buffer 'lexicon)))
        (princ (format "retry-same=%S refs-role=%S refs-buffer=%S lex-role=%S\\n"
                       (eq lexicon references)
                       (window-parameter references 'firstpair-role)
                       (eq (window-buffer references) references-buffer)
                       (window-parameter lexicon 'firstpair-role)))
        (firstpair-reader-close-dictionary)
        (princ (format "retry-close=%S/%S lexicon=%S\\n"
                       (window-parameter references 'firstpair-role)
                       (eq (window-buffer references) references-buffer)
                       (firstpair-reader--window 'lexicon))))
      (with-current-buffer references-buffer
        (Info-mode)
        (setq Info-current-node "Top"))
      (let ((windows (length (window-list)))
            (lexicon (firstpair-reader--show dictionary-buffer 'lexicon)))
        (princ (format "top-borrow=%S windows=%d/%d role=%S\\n"
                       (eq lexicon references) windows (length (window-list))
                       (window-parameter lexicon 'firstpair-role)))
        (firstpair-reader-close-dictionary)
        (princ (format "top-restored=%S/%S node=%S\\n"
                       (window-parameter references 'firstpair-role)
                       (eq (window-buffer references) references-buffer)
                       (with-current-buffer references-buffer Info-current-node))))
      (cl-letf (((symbol-function 'firstpair-reader--split)
                 (lambda (_anchor _lines) nil)))
        (let ((lexicon (firstpair-reader--show dictionary-buffer 'lexicon)))
          (princ (format "borrow-same=%S role=%S buffer=%S\\n"
                         (eq lexicon references)
                         (window-parameter references 'firstpair-role)
                         (eq (window-buffer references) dictionary-buffer)))
          (firstpair-reader-close-dictionary)
          (princ (format "restored=%S/%S lexicon=%S\\n"
                         (window-parameter references 'firstpair-role)
                         (eq (window-buffer references) references-buffer)
                         (firstpair-reader--window 'lexicon))))))))'''
        completed = subprocess.run(
            ["emacs", "--batch", "-Q", "--eval", script],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertIn("retry-same=nil refs-role=references refs-buffer=t lex-role=lexicon", completed.stdout)
        self.assertIn("retry-close=references/t lexicon=nil", completed.stdout)
        self.assertIn("top-borrow=t windows=2/2 role=lexicon", completed.stdout)
        self.assertIn('top-restored=references/t node="Top"', completed.stdout)
        self.assertIn("borrow-same=t role=lexicon buffer=t", completed.stdout)
        self.assertIn("restored=references/t lexicon=nil", completed.stdout)


class GlossTests(unittest.TestCase):
    def test_indexes_kaikki_rows_by_headword_and_form(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "kaikki.jsonl"
            path.write_text(
                json.dumps({"word": "scribo", "pos": "verb", "senses": [{"glosses": ["писать"]}, {"glosses": ["сочинять"]}], "forms": [{"form": "scrībis"}, {"form": "scriptum"}]}, ensure_ascii=False)
                + "\n"
                + json.dumps({"word": "nihil", "pos": "pronoun", "senses": [{"glosses": ["ничто"]}]}, ensure_ascii=False)
                + "\n",
                encoding="utf-8",
            )
            index = glosses.index_kaikki(path)
        self.assertEqual(("писать", "сочинять"), tuple(index.by_headword["scribo"][0]["definitions"]))
        self.assertEqual("scribo", index.by_form["scribis"][0]["headword"])
        self.assertIn("nihil", index.by_form)


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

    def test_info_writer_splits_large_manuals_into_subfiles(self) -> None:
        top = Node(name="Top", title="Fixture", menu=tuple((f"Canto {n}", "") for n in range(1, 9)))
        for n in range(1, 9):
            top.children.append(Node(name=f"Canto {n}", title=f"Canto {n}", blocks=(Paragraph(body=(Text(text=f"canto {n} " * 120),)),)))
        manual = Manual(filename="fixture.info", title="Fixture", top=top, direntry=("Books", "fixture", "d"))
        rendered = InfoWriter(manual, produced_by="test", split_bytes=2000).render()
        names = [name for name, _ in rendered.subfiles]
        self.assertGreater(len(names), 2)
        self.assertEqual("fixture.info-1", names[0])
        main = rendered.data.decode("utf-8")
        self.assertIn("\x1f\nIndirect:\nfixture.info-1: ", main)
        self.assertIn("\x1f\nTag Table:\n(Indirect)\n", main)
        self.assertNotIn("Canto 3 " * 3, main)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "fixture.info").write_bytes(rendered.data)
            for name, payload in rendered.subfiles:
                (root / name).write_bytes(payload)
            parsed = parse_info(root / "fixture.info")
            self.assertEqual({"Top", *(f"Canto {n}" for n in range(1, 9))}, set(parsed.nodes))
            if has("emacs"):
                script = (
                    f'(progn (require (quote info)) (Info-find-node "{root / "fixture.info"}" "Canto 7")'
                    ' (princ (format "%s|%s" Info-current-subfile (buffer-substring-no-properties (point) (min (point-max) (+ (point) 60))))))'
                )
                completed = subprocess.run(["emacs", "--batch", "-Q", "--eval", script], capture_output=True, text=True, check=False)
                self.assertEqual(0, completed.returncode, completed.stderr)
                subfile, _, head = completed.stdout.partition("|")
                self.assertTrue(subfile.endswith("fixture.info-" + str(names.index(next(n for n, b in rendered.subfiles if b"Node: Canto 7," in b)) + 1)), completed.stdout)
                self.assertTrue(head.startswith("\nCanto 7\n*******"), head)


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
        for name in ("fixture.info", "fixture-refs.info", "texi/fixture.texi", "init.el", "dante.sh", "dir", "lisp/firstpair-reader.el"):
            self.assertTrue((bundle / name).is_file(), name)
        self.assertFalse((bundle / "lisp" / "firstpair-check.el").exists())
        self.assertEqual((bundle / "Guide.md").read_bytes(), (bundle / "README.md").read_bytes())
        self.assertIn("./dante.sh", (bundle / "Guide.md").read_text(encoding="utf-8"))
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
        self.assertTrue((bundle / "dante.sh").stat().st_mode & 0o100)
        updater = (bundle / "dante.sh").read_text(encoding="utf-8")
        self.assertIn('release_url=${FIRSTPAIR_READER_RELEASE_URL:-${reader_url}.sha256}', updater)
        self.assertIn('if [ "$installed_version" = "$remote_version" ]', updater)
        self.assertLess(updater.index('if [ "$installed_version" = "$remote_version" ]'), updater.index("archive=$temporary/firstpair-reader.tar"))
        self.assertIn("package-install-file archive", updater)
        self.assertIn("package-delete descriptor t t", updater)
        self.assertLess(updater.index("package-install-file archive"), updater.index("package-delete descriptor t t"))
        self.assertIn("FIRSTPAIR_BUNDLE=$bundle FIRSTPAIR_BUNDLE_INIT=$bundle/init.el", updater)
        self.assertIn('(load (expand-file-name (getenv "FIRSTPAIR_BUNDLE_INIT")) nil nil)', updater)
        self.assertIn("Reader update check is unavailable; opening the local book.", updater)
        self.assertIn("Reader download is unavailable; opening the local book.", updater)
        self.assertEqual(0, subprocess.run(["sh", "-n", str(bundle / "dante.sh")], check=False).returncode)
        init_text = (bundle / "init.el").read_text()
        self.assertIn("(add-to-list 'load-path (expand-file-name \"lisp\" bundle))", init_text)
        self.assertIn("(locate-library \"firstpair-reader\")", init_text)
        self.assertIn(
            f"(minimum-version (version-to-list \"{package.version()}\"))",
            init_text,
        )
        self.assertIn("(package-installed-p 'firstpair-reader minimum-version)", init_text)
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
        (self.root / "la-ru.json").write_text(
            json.dumps({"schema": "firstpair-reader-dictionary-v1", "sourceLanguage": "la", "targetLanguage": "ru",
                        "entries": {"scribito": [{"headword": "scribo", "partOfSpeech": "verb", "definitions": ["писать"]}]}}, ensure_ascii=False),
            encoding="utf-8",
        )
        (self.root / "ru-supplement.json").write_text(json.dumps({"populi": ["народа"]}, ensure_ascii=False), encoding="utf-8")
        (self.root / "russian.jsonl").write_text(
            json.dumps({"id": "quote-att-4-8a", "russian": "Когда нечего будет писать, напиши именно это.", "russian_translator": "First Pair editorial translation"}, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        raw["emacs"]["lexicon"] = {
            "language": "latin", "mode": "projected", "exclude": ["res"],
            "translations": [
                {"id": "en", "label": "English"},
                {"id": "ru", "label": "Русский", "dictionary": "la-ru.json", "supplement": "ru-supplement.json"},
            ],
        }
        raw["emacs"]["records"][0]["merge"] = [{"source": "russian.jsonl", "identifier": "id"}]
        raw["emacs"]["records"][0]["blocks"].append({"field": "russian", "label": "Русский", "style": "quotation"})
        path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
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
        for name in ("entries.tsv", "forms/s.tsv", "forms/p.tsv", "stems.tsv", "endings.tsv", "glosses/s.tsv", "glosses/p.tsv", "LEXICON.json"):
            self.assertTrue((bundle / "lexicon" / name).is_file(), name)
        self.assertFalse((bundle / "lexicon" / "glosses.tsv").exists(), "glosses ship as shards")
        self.assertFalse((bundle / "lexicon" / "forms.tsv").exists(), "forms ship as shards")
        self.assertTrue((bundle / "data" / "regions.index.json").is_file(), "regions carry a byte index")
        glosses_table = "".join(path.read_text(encoding="utf-8") for path in sorted((bundle / "lexicon" / "glosses").glob("*.tsv")))
        self.assertIn("ru\tscribito\tform\tscribo\tverb\tписать\tla-ru.json", glosses_table)
        self.assertIn("ru\tpopuli\tform\tpopuli\t\tнарода\tru-supplement.json", glosses_table)
        lexicon_meta = json.loads((bundle / "lexicon" / "LEXICON.json").read_text(encoding="utf-8"))
        by_id = {item["id"]: item for item in lexicon_meta["translations"]}
        self.assertTrue(by_id["en"]["lexicon"])
        self.assertEqual(by_id["en"]["coverage"]["covered"], by_id["en"]["coverage"]["forms"])
        self.assertGreaterEqual(by_id["ru"]["coverage"]["glossed"], 2)
        self.assertIn("scribas", by_id["ru"]["coverage"]["missing"])
        description = json.loads((bundle / "data" / "bundle.json").read_text(encoding="utf-8"))
        self.assertEqual([{"id": "en", "label": "English"}, {"id": "ru", "label": "Русский"}], description["lexicon"]["translations"])
        self.assertIn("Когда нечего будет писать", references)
        report = verify_bundle(bundle)
        self.assertTrue(report["passed"])
        if report.get("emacs", {}).get("available"):
            self.assertEqual([], list(report["emacs"]["missingMarks"]))
            self.assertEqual(report["emacs"]["expectedMarks"], report["emacs"]["locatedMarks"])
            self.assertGreater(report["emacs"]["lexiconTested"], 0)
            self.assertEqual([], list(report["emacs"]["lexiconFailures"]))
        if has("emacs"):
            script = f"""(progn
  (add-to-list 'load-path "{(bundle / 'lisp').as_posix()}")
  (require 'firstpair-reader)
  (let ((bundle (firstpair-bundle-load "{bundle.as_posix()}")))
    (setq firstpair-lexicon-languages '("ru"))
    (with-current-buffer (firstpair-lexicon-render bundle "scribito")
      (princ (format "ru-only=%S header=%S\\n" (and (search-forward "писать" nil t) (not (progn (goto-char (point-min)) (search-forward "write" nil t)))) header-line-format)))
    (princ (format "cycle=%s\\n" (firstpair-lexicon-cycle-languages bundle)))
    (with-current-buffer (firstpair-lexicon-render bundle "scribito")
      (goto-char (point-min))
      (princ (format "both=%S\\n" (and (search-forward "write" nil t) (search-forward "писать" nil t) t))))
    (princ (format "gloss=%s\\n" (firstpair-lexicon-gloss bundle "scribito")))))"""
            completed = subprocess.run(["emacs", "--batch", "-Q", "--eval", script], capture_output=True, text=True, check=False)
            self.assertEqual(0, completed.returncode, completed.stderr[-2000:])
            self.assertIn("ru-only=t", completed.stdout)
            self.assertIn("header=nil", completed.stdout)
            self.assertIn("cycle=English + Русский", completed.stdout)
            self.assertIn("both=t", completed.stdout)
            self.assertIn("писать", completed.stdout)
            self.assertIn("scribito → scribo", completed.stdout)


if __name__ == "__main__":
    unittest.main()


class ItalianTests(unittest.TestCase):
    """The Italian analyser, on a hand-made slice of the Wiktionary extraction."""

    ROWS = [
        {"word": "amore", "pos": "noun", "lang_code": "it", "senses": [{"glosses": ["love"]}], "forms": [{"form": "amóre", "tags": ["canonical"]}, {"form": "amori", "tags": ["plural"]}, {"form": "amor", "tags": ["apocopic", "alternative"]}]},
        {"word": "dire", "pos": "verb", "lang_code": "it", "senses": [{"glosses": ["to say"]}], "forms": [{"form": "avére", "tags": ["auxiliary", "transitive"]}, {"form": "dìce", "tags": ["third-person", "singular", "present", "indicative"]}, {"form": "dicéva", "tags": ["third-person", "singular", "imperfect", "indicative"]}, {"form": "dirò", "tags": ["first-person", "singular", "future"]}]},
        {"word": "avere", "pos": "verb", "lang_code": "it", "senses": [{"glosses": ["to have"]}], "forms": [{"form": "hò", "tags": ["first-person", "singular", "present"]}]},
        {"word": "hai", "pos": "verb", "lang_code": "it", "senses": [{"glosses": ["second-person singular present indicative of avere and (obsolete) havere"], "tags": ["form-of"], "form_of": [{"word": "avere and"}]}]},
        {"word": "eterno", "pos": "adj", "lang_code": "it", "senses": [{"glosses": ["eternal"]}], "forms": [{"form": "eterna", "tags": ["feminine", "singular"]}]},
        {"word": "etterno", "pos": "adj", "lang_code": "it", "senses": [{"glosses": ["archaic form of eterno"], "tags": ["alt-of"], "alt_of": [{"word": "eterno"}]}]},
        {"word": "etterna", "pos": "adj", "lang_code": "it", "senses": [{"glosses": ["feminine singular of etterno"], "tags": ["form-of"], "form_of": [{"word": "etterno"}]}]},
        {"word": "il", "pos": "article", "lang_code": "it", "senses": [{"glosses": ["the"]}]},
        {"word": "l", "pos": "article", "lang_code": "it", "senses": [{"glosses": ["apocopic form of il"], "tags": ["alt-of"], "alt_of": [{"word": "il"}]}]},
        {"word": "in", "pos": "prep", "lang_code": "it", "senses": [{"glosses": ["in"]}]},
        {"word": "nel", "pos": "contraction", "lang_code": "it", "senses": [{"glosses": ["contraction of in il; in the"], "tags": ["alt-of"], "alt_of": [{"word": "in il"}]}]},
        {"word": "-io", "pos": "suffix", "lang_code": "it", "senses": [{"glosses": ["suffix"]}]},
        {"word": "inferno", "pos": "noun", "lang_code": "it", "senses": [{"glosses": ["hell"]}]},
        {"word": "mostrare", "pos": "verb", "lang_code": "it", "senses": [{"glosses": ["to show"]}], "forms": [{"form": "mostrò", "tags": ["third-person", "singular", "past", "historic"]}]},
        {"word": "carità", "pos": "noun", "lang_code": "it", "senses": [{"glosses": ["charity"]}]},
        {"word": "essere", "pos": "verb", "lang_code": "it", "senses": [{"glosses": ["to be"]}]},
        {"word": "egli", "pos": "pron", "lang_code": "it", "senses": [{"glosses": ["he"]}]},
        {"word": "e", "pos": "verb", "lang_code": "it", "senses": [{"glosses": ["third-person singular of essere"], "tags": ["form-of"], "form_of": [{"word": "essere"}]}]},
        {"word": "e", "pos": "pron", "lang_code": "it", "senses": [{"glosses": ["alternative form of egli"], "tags": ["alt-of"], "alt_of": [{"word": "egli"}]}]},
        {"word": "e", "pos": "conj", "lang_code": "it", "senses": [{"glosses": ["and"]}]},
        {"word": "ira", "pos": "noun", "lang_code": "it", "senses": [{"glosses": ["anger"]}], "forms": [{"form": "io", "tags": ["historic", "third-person", "singular"]}]},
        {"word": "io", "pos": "pron", "lang_code": "it", "senses": [{"glosses": ["I"]}]},
        {"word": "A", "pos": "noun", "lang_code": "it", "senses": [{"glosses": ["the letter A"]}]},
        {"word": "a", "pos": "prep", "lang_code": "it", "senses": [{"glosses": ["to"]}]},
    ]

    def setUp(self) -> None:
        from firstpair_emacs.languages import get

        self.temporary = tempfile.TemporaryDirectory()
        cache = Path(self.temporary.name)
        (cache / "enwiktionary-italian.jsonl").write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in self.ROWS) + "\n", encoding="utf-8")
        self.italian = get("italian")
        self.italian.load(cache)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def first(self, word: str) -> tuple[str, str, str]:
        analyses = self.italian.analyse(word)
        self.assertTrue(analyses, word)
        return self.italian.entry(analyses[0].entry_id).headword, analyses[0].features, analyses[0].note

    def test_tokens_split_elisions(self) -> None:
        self.assertEqual(["l’", "altre", "ch’", "io", "’l"], [surface for _, surface in self.italian.tokens("l’altre ch’io ’l")])

    def test_forms_ignore_stress_marks_and_follow_links(self) -> None:
        self.assertEqual(("dire", "third-person singular present indicative", ""), self.first("dice"))
        self.assertEqual("avere", self.first("ho")[0])
        self.assertEqual("avere", self.first("hai")[0])
        # The auxiliary named in dire's conjugation table is not a form of dire.
        self.assertEqual({"avere"}, {self.italian.entry(a.entry_id).headword for a in self.italian.analyse("avere")})
        self.assertEqual("eterno", self.first("etterna")[0])
        self.assertEqual({"in", "il"}, {self.italian.entry(a.entry_id).headword for a in self.italian.analyse("nel")})

    def test_exact_common_lemmas_beat_historical_homographs(self) -> None:
        self.assertEqual("e", self.first("e")[0])
        self.assertEqual("io", self.first("io")[0])
        self.assertEqual("a", self.first("a")[0])
        readings = self.italian.analyse("e")
        features = {}
        for reading in readings:
            features.setdefault(self.italian.entry(reading.entry_id).headword, set()).add(reading.features)
        self.assertTrue(all("alternative" not in value for value in features["essere"]))
        self.assertTrue(all("third-person" not in value for value in features["egli"]))

    def test_entry_glosses_prefer_matching_case_and_part(self) -> None:
        from firstpair_emacs import glosses

        projection = self.italian.project(["a", "e", "io"])
        rows = {
            "a": ({"headword": "A", "partOfSpeech": "noun", "definitions": ["Т"]},
                  {"headword": "a", "partOfSpeech": "prep", "definitions": ["к"]}),
            "e": ({"headword": "e", "partOfSpeech": "adv", "definitions": ["так"]},
                  {"headword": "e", "partOfSpeech": "conj", "definitions": ["и"]}),
            "io": ({"headword": "Io", "partOfSpeech": "name", "definitions": ["Ио"]},
                   {"headword": "io", "partOfSpeech": "pron", "definitions": ["я"]}),
        }
        glossary = glosses.GlossaryIndex(by_headword=rows, by_form=rows)
        found, _ = glosses.project("ru", projection, fold=self.italian.normalise, glossary=glossary)
        by_entry = {}
        for item in found:
            if item.kind == "entry":
                by_entry.setdefault(item.key, []).append(item)
        self.assertEqual("к", by_entry["a|prep"][0].definitions[0])
        self.assertEqual("и", by_entry["e|conj"][0].definitions[0])
        self.assertEqual("я", by_entry["io|pron"][0].definitions[0])

    def test_dante_restorations_are_named(self) -> None:
        self.assertEqual(("amore", "apocopic alternative", ""), self.first("amor"))
        self.assertEqual("old form of diceva", self.first("dicea")[2])
        self.assertEqual("elision of inferno", self.first("’nferno")[2])
        self.assertEqual("il", self.first("l’")[0])
        self.assertEqual("mostrò + mi", self.first("mostrommi")[2])
        self.assertEqual("old form of carità", self.first("caritate")[2])
        self.assertEqual((), self.italian.analyse("ïo")[:0])
        self.assertFalse(any(self.italian.entry(a.entry_id).headword == "-io" for a in self.italian.analyse("ïo")))

    def test_projection_and_tables(self) -> None:
        projection = self.italian.project(["Amor", "dicea", "nel", "xyzzy"])
        self.assertEqual(("xyzzy",), projection.unknown)
        self.assertEqual({"amor", "dicea", "nel"}, {form for form, _ in projection.forms})
        with tempfile.TemporaryDirectory() as temporary:
            payload = self.italian.write_tables(Path(temporary), projection, mode="projected", source={})
            self.assertEqual(3, payload["forms"])
            forms = (Path(temporary) / "forms.tsv").read_text(encoding="utf-8")
            self.assertIn("dicea\tdire|verb\tthird-person singular imperfect indicative (old form of diceva)", forms)

    def test_shared_dictionary_projection(self) -> None:
        from firstpair_emacs import dictionaries

        payload, report = dictionaries.project(
            self.italian, ["Amor", "dicea", "sapïenza"], target="en", label="English", license="CC BY-SA 4.0", attribution="test",
        )
        self.assertEqual("firstpair-reader-dictionary-v1", payload["schema"])
        self.assertEqual(["love"], payload["entries"]["amor"][0]["definitions"])
        self.assertIn("apocopic", payload["entries"]["amor"][0]["grammar"])
        self.assertEqual(["sapienza"], report["unanalysed"])
        russian, report = dictionaries.project(
            self.italian, ["Amor", "dicea"], target="ru", label="Русский", license="CC BY-SA 4.0", attribution="test",
            supplement={"amore": ("любовь",)}, supplement_name="test-supplement",
        )
        self.assertEqual(["любовь"], russian["entries"]["amor"][0]["definitions"])
        self.assertEqual(["dicea"], report["missing"])


class AlignedTests(Fixture):
    """An aligned edition: chapters in the shared schema become verse regions."""

    def test_builds_regions_and_hides_unselected_translations(self) -> None:
        chapter = {
            "schema": "firstpair-aligned-chapter-v1", "id": "canto-1", "title": "Inferno — Canto 1",
            "units": [
                {"id": "u1", "source": ["Nel mezzo del cammin di nostra vita", "mi ritrovai per una selva oscura,"],
                 "translations": {"en": ["Midway upon the journey of our life", "I found myself within a forest dark,"], "ru": ["Земную жизнь пройдя до половины,", "Я очутился в сумрачном лесу,"]}},
                {"id": "u2", "source": ["ché la diritta via era smarrita."], "translations": {"en": ["For the straightforward pathway had been lost."], "ru": ["Утратив правый путь во тьме долины."]}},
            ],
        }
        (self.root / "canto-1.json").write_text(json.dumps(chapter, ensure_ascii=False), encoding="utf-8")
        path = self.write_config(
            reader=[{"id": "canto-1", "title": "Inferno — Canto 1", "source": "canto-1.json", "part": "Inferno"}],
            evidence=[],
        )
        raw = json.loads(path.read_text(encoding="utf-8"))
        raw["emacs"]["parts"] = [{"title": "Inferno"}]
        raw["emacs"]["records"] = []
        raw["emacs"]["lexicon"] = {"language": "italian", "mode": "none", "sourceId": "it",
                                   "translations": [{"id": "en", "label": "English"}, {"id": "ru", "label": "Русский"}]}
        path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
        self.commit()
        manifest = build(path, "desktop", allow_download=False)
        bundle = self.root / "emacs" / "desktop"
        self.assertEqual(2, manifest["alignedUnits"])
        regions = (bundle / "data" / "regions.tsv").read_text(encoding="utf-8").splitlines()
        self.assertEqual(7, len(regions))  # header + 2 units x 3 languages
        self.assertTrue(any("\tit\tu1\t" in row and row.endswith("\tsource") for row in regions))
        info = (bundle / "fixture.info").read_text(encoding="utf-8")
        self.assertIn("Nel mezzo del cammin di nostra vita\nmi ritrovai per una selva oscura,\n", info)
        self.assertIn("     Земную жизнь пройдя до половины,", info)
        self.assertTrue(verify_bundle(bundle, run_makeinfo=False, run_emacs=has("emacs"))["passed"])
        if not has("emacs"):
            return
        script = f"""(progn
  (load "{(bundle / 'init.el').as_posix()}")
  (firstpair-read)
  (with-current-buffer firstpair-reader-buffer
    (Info-goto-node "(fixture)Inferno — Canto 1")
    (let ((count (lambda () (length (seq-filter (lambda (o) (overlay-get o 'firstpair-region)) firstpair-reader--overlays)))))
      (goto-char (point-min))
      (let ((header-link (text-property-not-all
                          (line-beginning-position) (line-end-position)
                          'link-args nil))
            called)
        (goto-char header-link)
        (cl-letf (((symbol-function 'firstpair-reader-next-marked-lookup)
                   (lambda () (interactive) (setq called 'next)))
                  ((symbol-function 'firstpair-reader-follow-nearest-node)
                   (lambda (&optional _fork) (interactive) (setq called 'follow))))
          (firstpair-reader-return))
        (princ (format "header-link=%S predicate=%S ret=%S\\\\n"
                       (and header-link t) (and (firstpair-reader--link-at-point-p) t)
                       called)))
      (princ (format "all=%d\\\\n" (funcall count)))
      (setq firstpair-lexicon-languages '("ru"))
      (firstpair-reader-refresh-regions)
      (princ (format "ru-only=%d\\\\n" (funcall count)))
      (goto-char (point-min)) (search-forward "Midway")
      (princ (format "english-hidden=%S\\\\n" (invisible-p (point))))
      (goto-char (point-min)) (search-forward "Земную")
      (princ (format "russian-visible=%S\\\\n" (not (invisible-p (point)))))
      (goto-char (point-min)) (search-forward "Nel") (backward-word 1)
      (princ (format "ret-binding=%S\\\\n" (key-binding (kbd "RET"))))
      (call-interactively (key-binding (kbd "RET")))
      (with-current-buffer firstpair-lexicon-buffer
        (princ (format "ret-word=%S languages=%S first-row=%S\\\\n"
                       firstpair-lexicon-word firstpair-lexicon-languages
                       (buffer-substring-no-properties
                        (point-min) (line-end-position))))))))"""
        completed = subprocess.run(["emacs", "--batch", "-Q", "--eval", script], capture_output=True, text=True, check=False)
        self.assertEqual(0, completed.returncode, completed.stderr[-2000:])
        self.assertIn("all=0", completed.stdout)
        self.assertIn("header-link=t predicate=t ret=follow", completed.stdout)
        self.assertIn("ru-only=2", completed.stdout)
        self.assertIn("english-hidden=t", completed.stdout)
        self.assertIn("russian-visible=t", completed.stdout)
        self.assertIn("ret-binding=firstpair-reader-return", completed.stdout)
        self.assertIn('ret-word="mezzo" languages=("ru") first-row="mezzo"', completed.stdout)

    def test_many_translations_per_language_rotate_and_pair(self) -> None:
        chapter = {
            "schema": "firstpair-aligned-chapter-v1", "id": "canto-1", "title": "Inferno — Canto 1",
            "units": [
                {"id": "u1", "source": ["Nel mezzo del cammin di nostra vita"],
                 "translations": {"en-longfellow": ["Midway upon the journey of our life"], "en-cary": ["In the midway of this our mortal life,"], "en-third": ["Halfway through the course of our life"], "ru-min": ["В средине нашей жизненной дороги,"], "ru-lozinsky": ["Земную жизнь пройдя до половины,"]}},
                {"id": "u2", "source": ["mi ritrovai per una selva oscura,"],
                 "translations": {"en-longfellow": ["I found myself within a forest dark,"], "en-cary": ["I found me in a gloomy wood, astray"], "en-third": ["I came to myself in a shadowed wood"], "ru-min": ["Объятый сном, я в темный лес вступил,"], "ru-lozinsky": ["Я очутился в сумрачном лесу,"]}},
            ],
        }
        (self.root / "canto-1.json").write_text(json.dumps(chapter, ensure_ascii=False), encoding="utf-8")
        index = {
            "schema": "firstpair-parallel-reader-v1", "title": "Fixture", "unit": "tercet",
            "sourceLanguage": {"id": "it", "lang": "it", "label": "Italiano", "position": "left"},
            "languages": [{"id": "en", "label": "English"}, {"id": "ru", "label": "Русский"}],
            "translations": [
                {"id": "en-longfellow", "lang": "en", "label": "English", "title": "Longfellow (1867)", "alignment": "line", "coverage": ["Inferno"], "default": True, "defaultVisible": True},
                {"id": "en-cary", "lang": "en", "label": "English", "title": "Cary (1814)", "alignment": "proportional", "coverage": ["Inferno"], "default": False, "defaultVisible": False},
                {"id": "en-third", "lang": "en", "label": "English", "title": "Third English", "alignment": "line", "coverage": ["Inferno"], "default": False, "defaultVisible": False},
                {"id": "ru-min", "lang": "ru", "label": "Русский", "title": "Мин (1855)", "alignment": "line", "coverage": ["Inferno"], "default": True, "defaultVisible": True},
                {"id": "ru-lozinsky", "lang": "ru", "label": "Русский", "title": "Лозинский (1939)", "alignment": "line", "coverage": ["Inferno"], "default": False, "defaultVisible": False},
            ],
            "dictionaries": {}, "pages": [{"id": "canto-1", "title": "Inferno — Canto 1", "path": "canto-1.json", "part": "Inferno"}],
        }
        (self.root / "parallel-reader.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
        path = self.write_config(reader=[{"id": "canto-1", "title": "Inferno — Canto 1", "source": "canto-1.json", "part": "Inferno"}], evidence=[])
        raw = json.loads(path.read_text(encoding="utf-8"))
        raw["emacs"]["parts"] = [{"title": "Inferno"}]
        raw["emacs"]["records"] = []
        raw["emacs"]["aligned"] = {"index": "parallel-reader.json"}
        raw["emacs"]["lexicon"] = {"language": "italian", "mode": "none", "sourceId": "it",
                                   "translations": [{"id": "en", "label": "English"}, {"id": "ru", "label": "Русский"}]}
        path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
        self.commit()
        manifest = build(path, "desktop", allow_download=False)
        bundle = self.root / "emacs" / "desktop"
        self.assertEqual(["en-longfellow", "en-cary", "en-third", "ru-min", "ru-lozinsky"], manifest["translations"])
        table = json.loads((bundle / "data" / "translations.json").read_text(encoding="utf-8"))
        self.assertEqual(["en", "ru"], [item["id"] for item in table["languages"]])
        self.assertEqual("proportional", table["translations"][1]["alignment"])
        regions = (bundle / "data" / "regions.tsv").read_text(encoding="utf-8").splitlines()
        self.assertEqual(13, len(regions))  # header + 2 units x (source + 5 translations)
        self.assertTrue(any("\ten-cary\tu1\t" in row for row in regions))
        self.assertTrue(verify_bundle(bundle, run_makeinfo=False, run_emacs=has("emacs"))["passed"])
        if not has("emacs"):
            return
        script = f"""(progn
  (load "{(bundle / 'init.el').as_posix()}")
  (firstpair-read)
  (with-current-buffer firstpair-reader-buffer
    (Info-goto-node "(fixture)Inferno — Canto 1")
    (let ((hidden (lambda () (length (seq-filter (lambda (o) (overlay-get o 'firstpair-region)) firstpair-reader--overlays))))
          (run-feedback
           (lambda ()
             (let (shown)
               (message nil)
               (unless (memq #'firstpair-reader--show-terminal-translation-feedback
                             post-command-hook)
                 (error "Translation feedback was not deferred to post-command-hook"))
               (cl-letf (((symbol-function 'message)
                          (lambda (format-string &rest args)
                            (setq shown (apply #'format format-string args)))))
                 (run-hooks 'post-command-hook))
               (when (memq #'firstpair-reader--show-terminal-translation-feedback
                           post-command-hook)
                 (error "Translation feedback hook was not one-shot"))
               shown))))
      (goto-char (point-min))
      (firstpair-reader-next-marked)
      (princ (format "WORD %s\n" (thing-at-point 'word t)))
      (firstpair-reader-next-marked)
      (princ (format "WORD %s\n" (thing-at-point 'word t)))
      (goto-char (point-min))
      (search-forward "cammin")
      (backward-word 1)
      (let ((reader-window (selected-window)))
        (cl-letf (((symbol-function 'mouse-set-point) (lambda (_event) nil))
                  ((symbol-function 'read-string)
                   (lambda (&rest _args) (error "Touch lookup opened a prompt"))))
          (firstpair-reader-touch-click '(mouse-1 nil)))
        (princ
         (format "CLICK word=%S reader-read-only=%S dict-read-only=%S focus=%S\n"
                 (with-current-buffer firstpair-lexicon-buffer firstpair-lexicon-word)
                 buffer-read-only
                 (with-current-buffer firstpair-lexicon-buffer buffer-read-only)
                 (eq reader-window (selected-window)))))
      (let ((a (funcall hidden)))
        (let ((before (copy-tree firstpair-reader-translation-choices))
              (current (firstpair-reader-show-current-translations)))
          (princ (format "CURRENT %s | unchanged=%S | key=%S | menu=%s | header=%S installed=%S\n"
                         current (equal before firstpair-reader-translation-choices)
                         (key-binding "=")
                         (firstpair-reader--current-translations-menu-label)
                         (firstpair-reader--translation-header-line)
                         firstpair-reader--translation-header-installed))
          (let* ((bundle (firstpair-reader--bundle))
                 (windows (length (window-list)))
                 (next-item
                  (lookup-key firstpair-reader-mode-map [menu-bar translation-next]))
                 (previous-item
                  (lookup-key firstpair-reader-mode-map [menu-bar translation-previous]))
                 (next-binding next-item)
                 (previous-binding previous-item)
                 (menu-order
                  (mapcar #'car (cdr (lookup-key firstpair-reader-mode-map [menu-bar]))))
                 (regions (firstpair-bundle-regions-for-node
                           bundle (firstpair-bundle-manual) Info-current-node))
                 (goto-language
                  (lambda (lang)
                    (let ((region
                           (seq-find
                            (lambda (row)
                              (let ((translation
                                     (and (not (plist-get row :source))
                                          (firstpair-bundle-translation
                                           bundle (plist-get row :language)))))
                                (and translation
                                     (equal (alist-get 'lang translation) lang))))
                            regions)))
                      (goto-char (point-min))
                      (forward-line (1- (plist-get region :start)))))))
            (funcall goto-language "en")
            (call-interactively next-binding)
            (let ((after-en (mapcar (lambda (lang)
                                      (firstpair-reader-translation-for bundle lang))
                                    '("en" "ru")))
                  (feedback-en-next (funcall run-feedback)))
              (funcall goto-language "ru")
              (call-interactively next-binding)
              (let ((after-ru-next (mapcar (lambda (lang)
                                             (firstpair-reader-translation-for bundle lang))
                                           '("en" "ru")))
                    (feedback-ru-next (funcall run-feedback)))
                (call-interactively previous-binding)
                (let ((after-ru-prev (mapcar (lambda (lang)
                                               (firstpair-reader-translation-for bundle lang))
                                             '("en" "ru")))
                      (feedback-ru-prev (funcall run-feedback)))
                  (funcall goto-language "en")
                  (call-interactively previous-binding)
                  (let ((feedback-en-prev (funcall run-feedback)))
                  (require 'tmm)
                  (defvar tmm-table-undef nil)
                  (defvar tmm-km-list nil)
                  (setq tmm-table-undef nil tmm-km-list nil)
                  (map-keymap
                   (lambda (event binding)
                     (tmm-get-keymap (cons event binding)))
                   (lookup-key firstpair-reader-mode-map [menu-bar]))
                  (princ
                   (format "TERMINAL next=%S previous=%S en-next=%s/%s ru-next=%s/%s ru-prev=%s/%s en-prev=%s/%s feedback=%S/%S/%S/%S windows=%d/%d completions=%S override=%S order=%S tty=%S\n"
                           next-binding previous-binding
                           (car after-en) (cadr after-en)
                           (car after-ru-next) (cadr after-ru-next)
                           (car after-ru-prev) (cadr after-ru-prev)
                           (firstpair-reader-translation-for bundle "en")
                           (firstpair-reader-translation-for bundle "ru")
                           feedback-en-next feedback-ru-next
                           feedback-ru-prev feedback-en-prev
                           windows (length (window-list))
                           (and (get-buffer "*Completions*") t)
                           (assq 'firstpair-reader-mode minor-mode-overriding-map-alist)
                           menu-order (mapcar #'car tmm-km-list)))))))
            (setq firstpair-reader-translation-choices before)
            (firstpair-reader-refresh-regions)
            (cl-letf (((symbol-function 'display-graphic-p)
                       (lambda (&optional _frame) t)))
              (princ (format "GUI menu=%S\n"
                             (keymapp
                              (lookup-key firstpair-reader-mode-map
                                          [menu-bar translations])))))))
        (firstpair-reader-rotate-translation)
        (let ((b (funcall hidden)) (label (firstpair-reader-translations-label (firstpair-bundle-current))))
          (firstpair-reader-second-translation)
          (let* ((c (funcall hidden))
                 (bundle (firstpair-reader--bundle))
                 (second (alist-get "en" firstpair-reader-second-translations nil nil #'equal))
                 (region (seq-find
                          (lambda (row) (equal (plist-get row :language) second))
                          (firstpair-bundle-regions-for-node
                           bundle (firstpair-bundle-manual) Info-current-node))))
            (goto-char (point-min))
            (forward-line (1- (plist-get region :start)))
            (firstpair-reader-terminal-next-translation)
            (let ((primary-after (firstpair-reader-translation-for bundle "en"))
                  (second-after (alist-get "en" firstpair-reader-second-translations nil nil #'equal))
                  (target-after (firstpair-reader--translation-target-at-point bundle))
                  (second-feedback (funcall run-feedback))
                  (second-header (firstpair-reader--translation-header-line)))
            (firstpair-reader-second-translation)
              (princ (format "%d %d %d %d %s | slots=%s/%s target=%S feedback=%S header=%S"
                             a b c (funcall hidden) label primary-after
                             second-after target-after second-feedback
                             second-header)))))))))"""
        result = subprocess.run(["emacs", "--batch", "-Q", "--eval", script], capture_output=True, text=True, check=False)
        self.assertEqual(0, result.returncode, result.stderr)
        words = [line.split(" ", 1)[1] for line in result.stdout.splitlines() if line.startswith("WORD ")]
        self.assertEqual(["Nel", "mezzo"], words, result.stdout)  # the arrows walk the Italian, not the translations
        self.assertIn('CLICK word="cammin" reader-read-only=t dict-read-only=t focus=t', result.stdout)
        self.assertIn("CURRENT English: Longfellow (1867); Русский: Мин (1855) | unchanged=t | key=firstpair-reader-show-current-translations | menu=Showing: English: Longfellow (1867); Русский: Мин (1855)", result.stdout)
        self.assertIn('header=" Longfellow · Мин " installed=t', result.stdout)
        self.assertIn("TERMINAL next=firstpair-reader-terminal-next-translation previous=firstpair-reader-terminal-previous-translation en-next=en-cary/ru-min ru-next=en-cary/ru-lozinsky ru-prev=en-cary/ru-min en-prev=en-longfellow/ru-min", result.stdout)
        self.assertIn('feedback="English: Cary (1814) ≈"/"Русский: Лозинский (1939)"/"Русский: Мин (1855)"/"English: Longfellow (1867)"', result.stdout)
        self.assertIn("windows=2/2 completions=nil override=nil", result.stdout)
        self.assertIn("order=(translations translation-next translation-previous)", result.stdout)
        self.assertIn('tty=("Tr-prev" "Tr-next")', result.stdout)
        self.assertIn("GUI menu=t", result.stdout)
        output = result.stdout.strip().splitlines()[-1].split(" ", 4)
        self.assertEqual(["6", "6", "4", "6"], output[:4], result.stdout)  # show one second edition, then hide it in one tap despite a third
        self.assertIn("Cary (1814) ≈", output[4])
        self.assertIn("slots=en-cary/en-third", output[4])
        self.assertIn('target=("en" . second)', output[4])
        self.assertIn('feedback="English: Third English"', output[4])
        self.assertIn('header=" Cary · Third English · Мин "', output[4])
        # Resume: the state file records the node and the choices; a fresh Emacs returns to them.
        state_file = self.root / "reader-state.el"
        script = f"""(progn
  (setq firstpair-reader-state-file "{state_file.as_posix()}")
  (load "{(bundle / 'init.el').as_posix()}")
  (firstpair-read)
  (with-current-buffer firstpair-reader-buffer
    (Info-goto-node "(fixture)Inferno — Canto 1")
    (firstpair-reader-rotate-translation)
    (firstpair-reader-save-state))
  (setq firstpair-reader--states nil firstpair-reader-translation-choices nil)
  (firstpair-read)
  (with-current-buffer firstpair-reader-buffer
    (princ (format "%s|%s|%s|%s" Info-current-node (alist-get "en" firstpair-reader-translation-choices nil nil #'equal)
                   (key-binding "d") (and (string-match-p "Dict" (format "%S" mode-line-format)) t)))))"""
        result = subprocess.run(["emacs", "--batch", "-Q", "--eval", script], capture_output=True, text=True, check=False)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("Inferno — Canto 1|en-cary|firstpair-reader-describe-word|t", result.stdout.strip().splitlines()[-1], result.stdout)
        self.assertIn(":node", state_file.read_text(encoding="utf-8"))


class GlossaryKindTests(unittest.TestCase):
    def test_entry_translations_and_pivot_indexes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            italian = root / "it.jsonl"
            italian.write_text(json.dumps({"word": "chiudere", "pos": "verb", "translations": [{"lang_code": "ru", "word": "закрыть"}, {"lang_code": "en", "word": "close"}]}, ensure_ascii=False) + "\n", encoding="utf-8")
            english = root / "en.jsonl"
            english.write_text(json.dumps({"word": "shrewd", "pos": "adj", "senses": [{"glosses": ["showing clever resourcefulness"], "translations": [
                {"lang_code": "it", "word": "accorto"},
                {"lang_code": "it", "word": "scaltro, astuto"},
                {"lang_code": "ru", "word": "проницательный"},
                {"lang_code": "ru", "word": "хитрый"},
            ]}]}, ensure_ascii=False) + "\n", encoding="utf-8")
            from firstpair_emacs.languages.italian import normalise as fold

            direct = glosses.index_entry_translations(italian, "ru", fold=fold)
            self.assertEqual(["закрыть"], direct.by_headword["chiudere"][0]["definitions"])
            pivot = glosses.index_pivot(english, "it", "ru", fold=fold)
            self.assertEqual(["проницательный, хитрый (shrewd: showing clever resourcefulness)"], pivot.by_headword["accorto"][0]["definitions"])
            self.assertIn("astuto", pivot.by_headword)

            class Item:
                kind = "pivot"; source_code = "it"; target_code = "ru"; sha256 = "abc123def456"

            cached = glosses.load_glossary(english, Item(), fold=fold)
            self.assertIn("accorto", cached.by_headword)
            self.assertTrue(any(path.suffix == ".json" and "pivot" in path.name for path in root.iterdir()))
            again = glosses.load_glossary(english, Item(), fold=fold)
            self.assertEqual(cached.by_headword["accorto"], again.by_headword["accorto"])


class SecondPassTests(unittest.TestCase):
    def test_related_lemmas_and_gloss_words_fill_gaps_with_labels(self) -> None:
        from firstpair_emacs.languages import get

        rows = [
            {"word": "gaio", "pos": "adj", "lang_code": "it", "senses": [{"glosses": ["merry, cheerful"]}]},
            {"word": "gaietto", "pos": "adj", "lang_code": "it", "senses": [{"glosses": ["lively, merry (dated)"], "synonyms": [{"word": "gaio"}]}]},
            {"word": "gaetta", "pos": "adj", "lang_code": "it", "senses": [{"glosses": ["Dantesque form of gaietto"], "tags": ["alt-of"], "alt_of": [{"word": "gaietto"}]}]},
            {"word": "accismare", "pos": "verb", "lang_code": "it", "senses": [{"glosses": ["to adorn, to deck out"]}]},
            {"word": "gaetto", "pos": "adj", "lang_code": "it", "senses": [{"glosses": ["Dantesque form of gaietto"]}], "forms": [{"form": "gaetti", "tags": ["masculine", "plural"]}]},
        ]
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary)
            (cache / "enwiktionary-italian.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
            italian = get("italian"); italian.load(cache)
            self.assertEqual(["gaio"], italian.related("gaietto|adj"))
            self.assertEqual("gaietto", italian.entry(italian.analyse("gaetta")[0].entry_id).headword)
            self.assertEqual("gaietto", italian.entry(italian.analyse("gaetti")[0].entry_id).headword)
            self.assertEqual("masculine plural; Dantesque form of", italian.analyse("gaetti")[0].features)
            english = cache / "en.jsonl"
            english.write_text(json.dumps({"word": "adorn", "pos": "verb", "senses": [{"glosses": ["to make more beautiful"], "translations": [{"lang_code": "ru", "word": "украшать"}]}]}) + "\n", encoding="utf-8")
            pivot = glosses.index_gloss_pivot(english, "ru")
            self.assertEqual(["украшать"], pivot.by_headword["adorn"][0]["definitions"])
            self.assertEqual(["adorn", "deck"], glosses.gloss_words("to adorn, to deck out"))
            projection = italian.project(["gaetta", "accismare"])
            found, report = glosses.project(
                "ru", projection, fold=italian.normalise,
                supplement={"gaio": ("весёлый",)}, supplement_name="test-supplement",
                related=italian.related, senses=italian.senses, gloss_pivot=pivot, gloss_pivot_name="test-pivot",
            )
            by_key = {(g.kind, g.key): g for g in found}
            self.assertEqual(("весёлый",), by_key[("entry", "gaietto|adj")].definitions)
            self.assertEqual("via gaio", by_key[("entry", "gaietto|adj")].source)
            self.assertIn("украшать (via English: adorn", by_key[("entry", "accismare|verb")].definitions[0])
            self.assertEqual(2, report["derivedEntries"])
            self.assertEqual([], report["missing"])
