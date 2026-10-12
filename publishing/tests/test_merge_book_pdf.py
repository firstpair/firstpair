"""Navigation preservation controls using generated PDFs, never book edits."""
import importlib.util
from io import BytesIO
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from pypdf import PageObject, PdfReader, PdfWriter
from pypdf.annotations import Link
from pypdf.generic import Destination, Fit, NameObject, TextStringObject

HELPER = Path(__file__).resolve().parents[1] / "python/merge_book_pdf.py"
spec = importlib.util.spec_from_file_location("merge_book_pdf", HELPER)
merge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(merge)


class MergeBookPdf(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="firstpair-pdf-merge-test-")
        self.root = Path(self.temp.name)
        self.cover = self.root / "cover.pdf"
        self.body = self.root / "body.pdf"
        self.output = self.root / "merged.pdf"

    def tearDown(self):
        self.temp.cleanup()

    def write(self, writer, path):
        with path.open("wb") as stream:
            writer.write(stream)

    def blank_cover(self):
        writer = PdfWriter()
        writer.add_blank_page(width=200, height=300)
        writer.add_metadata({"/Title": "Cover metadata"})
        self.write(writer, self.cover)

    def body_writer(self):
        writer = PdfWriter()
        writer.add_blank_page(width=210, height=310)
        writer.add_blank_page(width=220, height=320)
        writer.add_named_destination("chapter", 1)
        parent = writer.add_outline_item("First", 0)
        writer.add_outline_item("Second", 1, parent=parent)
        link = writer.add_annotation(0, Link(rect=(10, 10, 20, 20), target_page_index=1))
        # pypdf's annotation constructor emits an integer destination; local
        # PDF navigation requires the actual Page indirect reference.
        link[NameObject("/Dest")][0] = writer.pages[1].indirect_reference
        writer.add_annotation(1, Link(rect=(20, 20, 30, 30), url="https://example.com"))
        writer.add_metadata({"/Title": "Body metadata", "/Author": "Test author"})
        return writer

    def test_append_rebases_names_outline_direct_links_and_keeps_uri(self):
        self.blank_cover(); self.write(self.body_writer(), self.body)
        source = merge.navigation(PdfReader(self.body))
        result = merge.merge_book_pdf(self.cover, self.body, self.output)
        reader = PdfReader(self.output, strict=True)
        final = merge.navigation(reader)
        self.assertEqual(result, {"pages": 3, "namedDestinations": 1, "outlines": 2,
                                  "annotationCounts": {"/Link": 2}})
        self.assertEqual(final["named"]["chapter"][0], 2)
        self.assertEqual(final["outlines"], merge.shifted(source, 1)["outlines"])
        self.assertEqual(final["annotations"][1:], merge.shifted(source, 1)["annotations"])
        self.assertEqual(reader.metadata.title, "Body metadata")
        self.assertEqual(reader.metadata.author, "Test author")

    def test_orphan_destination_refused_and_existing_output_preserved(self):
        self.blank_cover(); writer = self.body_writer()
        orphan = writer._add_object(PageObject.create_blank_page(width=210, height=310))
        writer.add_named_destination_object(Destination("orphan", orphan, Fit.fit()))
        self.write(writer, self.body); self.output.write_bytes(b"existing output")
        with self.assertRaisesRegex(ValueError, "outside the active Page tree"):
            merge.merge_book_pdf(self.cover, self.body, self.output)
        self.assertEqual(self.output.read_bytes(), b"existing output")
        self.assertEqual(list(self.root.glob(".*-merge-*.pdf")), [])

    def test_integer_local_link_refused_before_creating_output(self):
        self.blank_cover(); writer = self.body_writer()
        # Build the deliberately invalid destination with PDF scalar types.
        from pypdf.generic import NumberObject
        writer.pages[0]["/Annots"][0].get_object()["/Dest"][0] = NumberObject(1)
        self.write(writer, self.body)
        with self.assertRaisesRegex(ValueError, "active Page indirect reference"):
            merge.merge_book_pdf(self.cover, self.body, self.output)
        self.assertFalse(self.output.exists())

    def test_undefined_named_link_refused(self):
        self.blank_cover(); writer = self.body_writer()
        writer.pages[0]["/Annots"][0].get_object()[NameObject("/Dest")] = TextStringObject("missing")
        self.write(writer, self.body)
        with self.assertRaisesRegex(ValueError, "Undefined named destination"):
            merge.merge_book_pdf(self.cover, self.body, self.output)
        self.assertFalse(self.output.exists())

    def test_duplicate_names_refused(self):
        cover = PdfWriter(); cover.add_blank_page(width=200, height=300)
        cover.add_named_destination("chapter", 0); self.write(cover, self.cover)
        self.write(self.body_writer(), self.body)
        with self.assertRaisesRegex(ValueError, "conflicting named destinations"):
            merge.merge_book_pdf(self.cover, self.body, self.output)

    def test_invalid_completed_temp_never_replaces_existing_output(self):
        self.blank_cover(); self.write(self.body_writer(), self.body)
        self.output.write_bytes(b"existing output")
        with patch.object(PdfWriter, "write", side_effect=lambda stream: stream.write(b"broken PDF")):
            with self.assertRaises(Exception):
                merge.merge_book_pdf(self.cover, self.body, self.output)
        self.assertEqual(self.output.read_bytes(), b"existing output")
        self.assertEqual(list(self.root.glob(".*-merge-*.pdf")), [])

    @unittest.skipUnless(shutil.which("typst"), "Typst is required for the native TOC control")
    def test_native_typst_named_toc_links_survive_merge_and_metadata_clone(self):
        self.blank_cover()
        source = '''#set page(width: 300pt, height: 400pt, margin: 30pt)
#outline(title: [Contents])
#pagebreak()
= First <first>
#link(<second>)[Next]
#pagebreak()
= Second <second>
#link("https://example.com")[External]
'''
        native = subprocess.run(["typst", "compile", "-", "-"], input=source.encode(), capture_output=True, check=True)
        self.body.write_bytes(native.stdout)
        before = merge.navigation(PdfReader(self.body))
        result = merge.merge_book_pdf(self.cover, self.body, self.output)
        reader = PdfReader(self.output, strict=True)
        self.assertEqual(result["annotationCounts"], {"/Link": 4})
        self.assertEqual(merge.navigation(reader)["annotations"][1:], merge.shifted(before, 1)["annotations"])
        self.assertEqual({name: value[0] for name, value in merge.navigation(reader)["named"].items()},
                         {"first": 2, "second": 3})
        # The existing metadata setter uses this public clone path.
        clone = PdfWriter(clone_from=reader); clone.add_metadata({"/Title": "Final title"})
        stream = BytesIO(); clone.write(stream); stream.seek(0)
        self.assertEqual(merge.navigation(PdfReader(stream)), merge.navigation(reader))


if __name__ == "__main__":
    unittest.main()
