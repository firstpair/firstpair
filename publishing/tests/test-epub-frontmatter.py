#!/usr/bin/env python3
"""Real Pandoc EPUB regression checks; no PDF renderer or network required."""
from pathlib import Path
import base64
import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from zipfile import ZipFile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'publishing/scripts/epub_frontmatter.py'
BUILDER = ROOT / 'publishing/scripts/build-library-book.sh'
PYTHON = '/usr/bin/python3' if Path('/usr/bin/python3').exists() else 'python3'
NS = {'opf': 'http://www.idpf.org/2007/opf', 'h': 'http://www.w3.org/1999/xhtml'}


class ImprintTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)
        self.manuscript = self.path / 'book.md'
        self.manuscript.write_text('# Learning\n\nThe original text remains unchanged. The quantity $x^2$ is mathematical content.\n')
        self.cover = self.path / 'cover.png'
        self.cover.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='))
        self.epub = self.path / 'book.epub'
        subprocess.run(['pandoc', str(self.manuscript), '--to=epub3', '--mathml', '--toc',
                        '--epub-title-page=false', '--metadata=title=Fixture', '--metadata=author=Alexy Khrabrov',
                        '-o', str(self.epub)], check=True, capture_output=True)

    def tearDown(self):
        self.temp.cleanup()

    def add(self, **overrides):
        values = {'title': 'Fixture & its methods', 'author': 'Alexy Khrabrov', 'date': '2026-10-04',
                  'version': '1.2.4-abcdef12', 'stem': 'fixture', 'cover-image': str(self.cover)}
        values.update(overrides)
        return subprocess.run([PYTHON, str(SCRIPT), 'add', str(self.epub),
                *[entry for key, value in values.items() for entry in (f'--{key}', value)]], capture_output=True, text=True)

    def test_new_cover_second_imprint_and_chapter_integrity(self):
        with ZipFile(self.epub) as archive:
            chapters = {name: archive.read(name) for name in archive.namelist() if '/ch' in name and name.endswith('.xhtml')}
        result = self.add()
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        self.assertEqual(receipt['version'], '1.2.4-abcdef12')
        with ZipFile(self.epub) as archive:
            self.assertEqual(archive.infolist()[0].filename, 'mimetype')
            self.assertEqual(archive.infolist()[0].compress_type, 0)
            for name, data in chapters.items():
                self.assertEqual(archive.read(name), data)
            imprint = ET.fromstring(archive.read(receipt['imprint']))
            self.assertIsNotNone(imprint.find('.//h:a[@class="publisher-site"]/h:code', NS))
            self.assertEqual(archive.read('EPUB/media/firstpair-cover.png'), self.cover.read_bytes())
        # Running the source-owned packaging step twice must not append pages.
        second = self.add()
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(json.loads(second.stdout)['spineDocuments'], receipt['spineDocuments'])

    def test_bad_version_does_not_modify_artifact(self):
        original = self.epub.read_bytes()
        result = self.add(version='1.2.4')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.epub.read_bytes(), original)

    def test_missing_image_does_not_modify_artifact(self):
        original = self.epub.read_bytes()
        result = self.add(**{'cover-image': str(self.path / 'missing.png')})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.epub.read_bytes(), original)

    def test_verify_rejects_reordered_spine(self):
        self.assertEqual(self.add().returncode, 0)
        with ZipFile(self.epub) as source:
            entries = [(info, source.read(info.filename)) for info in source.infolist()]
        with ZipFile(self.epub, 'w') as target:
            for info, data in entries:
                if info.filename.endswith('.opf'):
                    root = ET.fromstring(data)
                    spine = root.find('opf:spine', NS)
                    spine.insert(0, spine[1])
                    del spine[2]
                    data = ET.tostring(root)
                target.writestr(info, data)
        result = subprocess.run([PYTHON, str(SCRIPT), 'verify', str(self.epub)], capture_output=True)
        self.assertNotEqual(result.returncode, 0)

    def test_epub_only_uses_source_and_preserves_other_formats(self):
        (self.path / 'metadata.yaml').write_text('title: Fixture\nauthor: Alexy Khrabrov\nlang: en\ntitle_stem: fixture\n')
        # A custom renderer replaces Pandoc output with an EPUB without a cover.
        # The common cover/imprint pass must run after this hook.
        (self.path / 'custom.epub').write_bytes(self.epub.read_bytes())
        config = {'schemaVersion': 1, 'bookRoot': '.', 'manuscript': 'book.md', 'metadata': 'metadata.yaml',
                  'version': '1.2.4', 'dist': 'dist', 'mobi': False, 'cleanDist': True,
                  'epub': {'coverImage': 'cover.png', 'imprint': True},
                  'hooks': {'postEpub': 'cp "${repoRoot}/custom.epub" "${epub}"',
                            'postBuild': 'exit 61'},
                  'validators': 'exit 62', 'pdfFormats': [{'name': 'forbidden', 'renderer': 'hook', 'run': 'exit 63'}]}
        (self.path / 'book.build.json').write_text(json.dumps(config))
        dist = self.path / 'dist'
        dist.mkdir()
        for filename in ('fixture.pdf', 'fixture.html', 'VERSION.md'):
            (dist / filename).write_text('previous reviewed artifact')
        before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in dist.iterdir()}
        for args in (['git', 'init', '-q'], ['git', 'add', '.'], ['git', '-c', 'user.email=test@example.org', '-c', 'user.name=Fixture', 'commit', '-qm', 'fixture']):
            subprocess.run(args, cwd=self.path, check=True, capture_output=True)
        result = subprocess.run([str(BUILDER), '--repo-root', str(self.path), '--epub-only'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(before, {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in dist.iterdir()})
        output = self.path / 'dist-epub'
        receipt = json.loads((output / 'epub-release.json').read_text())
        self.assertTrue(receipt['frontmatter']['passed'])
        self.assertFalse((output / receipt['file']).is_symlink())
        self.assertEqual((output / receipt['file']).read_bytes(), (output / 'fixture.epub').read_bytes())
        self.assertFalse((output / 'VERSION.md').exists())
        self.assertTrue((output / 'EPUB-VERSION.md').exists())


if __name__ == '__main__':
    unittest.main()
