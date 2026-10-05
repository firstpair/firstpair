#!/usr/bin/env python3
"""Add and verify a versioned imprint immediately after an EPUB's image cover.

This postprocessor is also usable by source-owned renderers which do not call
build-library-book. It preserves chapter bytes and never invents source identity.
"""
from __future__ import annotations

import argparse
from datetime import date
import html
import json
from pathlib import Path
import posixpath
import re
import tempfile
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

OPF = 'http://www.idpf.org/2007/opf'
DC = 'http://purl.org/dc/elements/1.1/'
XHTML = 'http://www.w3.org/1999/xhtml'
EPUB = 'http://www.idpf.org/2007/ops'
NS = {'opf': OPF, 'dc': DC, 'h': XHTML, 'epub': EPUB}
IMPRINT_ID = 'firstpair-imprint'
IMPRINT_HREF = 'text/firstpair-imprint.xhtml'
STAMP = re.compile(r'^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?-[0-9a-f]{7,40}$')


def archive_path(base: str, href: str) -> str:
    value = posixpath.normpath(posixpath.join(posixpath.dirname(base), unquote(urlsplit(href).path)))
    if value.startswith('../') or value.startswith('/'):
        raise ValueError(f'EPUB resource escapes the archive: {href}')
    return value


def read_package(archive: ZipFile):
    root = ET.fromstring(archive.read('META-INF/container.xml'))
    rootfile = root.find('.//{urn:oasis:names:tc:opendocument:xmlns:container}rootfile')
    if rootfile is None or not rootfile.get('full-path'):
        raise ValueError('EPUB has no package document')
    name = rootfile.get('full-path')
    package = ET.fromstring(archive.read(name))
    metadata = package.find('opf:metadata', NS)
    manifest = package.find('opf:manifest', NS)
    spine = package.find('opf:spine', NS)
    if any(value is None for value in (metadata, manifest, spine)):
        raise ValueError('EPUB must contain metadata, manifest, and spine')
    items = {item.get('id'): item for item in manifest}
    return name, package, metadata, manifest, spine, items


def image_cover_id(archive: ZipFile, opf_name: str, spine, items) -> str:
    covers = [item for item in items.values() if 'cover-image' in item.get('properties', '').split()]
    if len(covers) != 1:
        raise ValueError('EPUB must declare exactly one cover-image')
    cover_path = archive_path(opf_name, covers[0].get('href', ''))
    if cover_path not in archive.namelist():
        raise ValueError('EPUB cover image is missing')
    for itemref in spine:
        item = items.get(itemref.get('idref'))
        if item is None or item.get('media-type') != 'application/xhtml+xml':
            continue
        path = archive_path(opf_name, item.get('href', ''))
        document = ET.fromstring(archive.read(path))
        body = document.find('h:body', NS)
        is_cover = body is not None and (body.get('id') == 'cover' or 'cover' in body.get(f'{{{EPUB}}}type', '').split())
        if not is_cover:
            continue
        refs = [value for element in document.iter() for key, value in element.attrib.items()
                if key in ('src', '{http://www.w3.org/1999/xlink}href')]
        if cover_path in [archive_path(path, ref) for ref in refs]:
            return item.get('id')
    raise ValueError('EPUB must contain a cover XHTML spine document referencing its cover-image')


def set_metadata(metadata, name: str, value: str, element_id: str | None = None):
    matches = metadata.findall(f'dc:{name}', NS)
    node = matches[0] if matches else ET.SubElement(metadata, f'{{{DC}}}{name}')
    for duplicate in matches[1:]:
        metadata.remove(duplicate)
    node.text = value
    if element_id:
        node.set('id', element_id)
    return node


def serialize_xml(root, default_namespace: str) -> bytes:
    ET.register_namespace('', default_namespace)
    ET.register_namespace('dc', DC)
    ET.register_namespace('epub', EPUB)
    return b'<?xml version="1.0" encoding="utf-8"?>\n' + ET.tostring(root, encoding='utf-8') + b'\n'


def imprint_document(args, language: str) -> bytes:
    escaped = {key: html.escape(str(value), quote=True) for key, value in vars(args).items() if value is not None}
    published = date.fromisoformat(args.date)
    display_date = f'{published.day} {published.strftime("%B")} {published.year}'
    subtitle = f'<p class="subtitle">{escaped["subtitle"]}</p>' if args.subtitle else ''
    website = urlsplit(args.publisher_url).netloc + urlsplit(args.publisher_url).path.rstrip('/')
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="{XHTML}" xmlns:epub="{EPUB}" lang="{html.escape(language)}" xml:lang="{html.escape(language)}">
<head><meta charset="utf-8" /><title>Publication information — {escaped['title']}</title>
<style type="text/css">
body {{ margin: 0; padding: 2.2em 1.3em; background: #fff; color: #17212a; font-family: Georgia, serif; line-height: 1.5; }}
main {{ max-width: 32em; margin: 0 auto; text-align: center; }}
h1 {{ font-size: 1.65em; line-height: 1.2; margin: 0 0 0.65em; font-weight: normal; }}
.subtitle {{ font-size: 1em; margin: 0 auto 1.7em; }}
.author {{ font-size: 1.1em; margin: 1.7em 0 2.2em; }}
.edition {{ border-top: 1px solid #a2a2a2; padding-top: 1.5em; }}
.edition p {{ margin: 0.5em 0; }}
.version {{ overflow-wrap: anywhere; word-wrap: break-word; }}
.publisher {{ margin-top: 2.2em; }}
.publisher p {{ margin: 0.4em 0; }}
.publisher-site, .publisher-site code {{ font-family: "Courier New", Courier, monospace; font-size: 1em; color: #17212a; background: transparent; }}
a.publisher-site {{ text-decoration: none; }}
</style></head>
<body epub:type="frontmatter"><main epub:type="titlepage" id="publication-information">
<h1>{escaped['title']}</h1>{subtitle}
<p class="author">{escaped['author']}</p>
<div class="edition"><p><time datetime="{escaped['date']}">{display_date}</time></p>
<p class="version">Version {escaped['version']}</p></div>
<div class="publisher"><p>{escaped['publisher']}</p>
<p><a class="publisher-site" href="{escaped['publisher_url']}"><code>{html.escape(website)}</code></a></p></div>
</main></body></html>
'''.encode('utf-8')


def add_imprint(args):
    if not STAMP.fullmatch(args.version):
        raise ValueError('version must contain semantic version and a 7–40 character Git hash')
    date.fromisoformat(args.date)
    parsed_url = urlsplit(args.publisher_url)
    if parsed_url.scheme != 'https' or not parsed_url.netloc or parsed_url.query or parsed_url.fragment:
        raise ValueError('publisher URL must be an absolute HTTPS URL without query or fragment')
    path = Path(args.epub)
    with ZipFile(path) as source:
        opf_name, package, metadata, manifest, spine, items = read_package(source)
        replacements = {}
        if args.cover_image:
            cover_source = Path(args.cover_image)
            suffix = cover_source.suffix.lower()
            media_types = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'}
            if suffix not in media_types:
                raise ValueError('cover image must be PNG or JPEG')
            try:
                cover_id = image_cover_id(source, opf_name, spine, items)
                cover_href = items[cover_id].get('href')
            except ValueError:
                cover_id, cover_href = 'firstpair-cover', 'text/firstpair-cover.xhtml'
                if cover_id not in items:
                    items[cover_id] = ET.SubElement(manifest, f'{{{OPF}}}item', {
                        'id': cover_id, 'href': cover_href, 'media-type': 'application/xhtml+xml'})
            items[cover_id].attrib.pop('properties', None)
            image_href = f'media/firstpair-cover{suffix}'
            for item in manifest:
                props = [prop for prop in item.get('properties', '').split() if prop != 'cover-image']
                if props:
                    item.set('properties', ' '.join(props))
                else:
                    item.attrib.pop('properties', None)
            for item in list(manifest):
                if item.get('id') == 'firstpair-cover-image':
                    manifest.remove(item)
            ET.SubElement(manifest, f'{{{OPF}}}item', {'id': 'firstpair-cover-image', 'href': image_href,
                'media-type': media_types[suffix], 'properties': 'cover-image'})
            for meta in list(metadata):
                if meta.get('name') == 'cover':
                    metadata.remove(meta)
            ET.SubElement(metadata, f'{{{OPF}}}meta', {'name': 'cover', 'content': 'firstpair-cover-image'})
            replacements[archive_path(opf_name, image_href)] = cover_source.read_bytes()
            image_ref = posixpath.relpath(image_href, posixpath.dirname(cover_href))
            replacements[archive_path(opf_name, cover_href)] = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="{XHTML}" xmlns:epub="{EPUB}" lang="en"><head>
<meta charset="utf-8" /><title>Cover — {html.escape(args.title)}</title>
<style type="text/css">html, body {{ margin: 0; padding: 0; text-align: center; }}
img {{ display: block; max-width: 100%; max-height: 100vh; margin: 0 auto; object-fit: contain; }}</style>
</head><body id="cover" epub:type="cover"><img src="{html.escape(image_ref)}" alt="{html.escape(args.title)} — book cover" /></body></html>
'''.encode('utf-8')
        else:
            cover_id = image_cover_id(source, opf_name, spine, items)
        language = metadata.findtext('dc:language', 'en', NS)
        set_metadata(metadata, 'title', args.title)
        creator = set_metadata(metadata, 'creator', args.author)
        if not creator.get('id'):
            creator.set('id', 'firstpair-author')
        role = next((node for node in metadata.findall('opf:meta', NS)
                     if node.get('refines') == f'#{creator.get("id")}' and node.get('property') == 'role'), None)
        if role is None:
            role = ET.SubElement(metadata, f'{{{OPF}}}meta', {'refines': f'#{creator.get("id")}', 'property': 'role', 'scheme': 'marc:relators'})
        role.text = 'aut'
        set_metadata(metadata, 'publisher', args.publisher)
        set_metadata(metadata, 'date', args.date)
        identifier = f'urn:firstpair:book:{args.stem}:{args.version}'
        set_metadata(metadata, 'identifier', identifier, 'firstpair-edition-id')
        package.set('unique-identifier', 'firstpair-edition-id')
        modified = next((node for node in metadata.findall('opf:meta', NS) if node.get('property') == 'dcterms:modified'), None)
        if modified is None:
            modified = ET.SubElement(metadata, f'{{{OPF}}}meta', {'property': 'dcterms:modified'})
        modified.text = f'{args.date}T00:00:00Z'
        for node in list(spine):
            if node.get('idref') in (cover_id, IMPRINT_ID):
                spine.remove(node)
        spine.insert(0, ET.Element(f'{{{OPF}}}itemref', {'idref': cover_id, 'linear': 'yes'}))
        spine.insert(1, ET.Element(f'{{{OPF}}}itemref', {'idref': IMPRINT_ID, 'linear': 'yes'}))
        for node in list(manifest):
            if node.get('id') == IMPRINT_ID:
                manifest.remove(node)
        ET.SubElement(manifest, f'{{{OPF}}}item', {'id': IMPRINT_ID, 'href': IMPRINT_HREF, 'media-type': 'application/xhtml+xml'})
        replacements[archive_path(opf_name, IMPRINT_HREF)] = imprint_document(args, language)
        # Make the page available in the EPUB 3 landmark navigation as well as
        # ordinary reading order, without changing any chapter content.
        for item in manifest:
            if 'nav' not in item.get('properties', '').split():
                continue
            nav_name = archive_path(opf_name, item.get('href'))
            nav = ET.fromstring(source.read(nav_name))
            body = nav.find('h:body', NS)
            landmarks = next((node for node in nav.findall('.//h:nav', NS)
                              if 'landmarks' in node.get(f'{{{EPUB}}}type', '').split()), None)
            if landmarks is None:
                landmarks = ET.SubElement(body, f'{{{XHTML}}}nav', {f'{{{EPUB}}}type': 'landmarks', 'hidden': 'hidden'})
            listing = landmarks.find('h:ol', NS)
            if listing is None:
                listing = ET.SubElement(landmarks, f'{{{XHTML}}}ol')
            for node in list(listing):
                if node.get('id') == 'firstpair-imprint-landmark':
                    listing.remove(node)
            node = ET.Element(f'{{{XHTML}}}li', {'id': 'firstpair-imprint-landmark'})
            link = ET.SubElement(node, f'{{{XHTML}}}a', {
                'href': posixpath.relpath(archive_path(opf_name, IMPRINT_HREF), posixpath.dirname(nav_name)),
                f'{{{EPUB}}}type': 'titlepage'})
            link.text = 'Publication information'
            listing.insert(1, node)
            replacements[nav_name] = serialize_xml(nav, XHTML)
        # Synchronize NCX identity for older reading systems.
        for item in manifest:
            if item.get('media-type') != 'application/x-dtbncx+xml':
                continue
            ncx_name = archive_path(opf_name, item.get('href'))
            ncx = ET.fromstring(source.read(ncx_name))
            for node in ncx.iter():
                if node.tag.endswith('}meta') and node.get('name') == 'dtb:uid':
                    node.set('content', identifier)
            replacements[ncx_name] = serialize_xml(ncx, 'http://www.daisy.org/z3986/2005/ncx/')
        replacements[opf_name] = serialize_xml(package, OPF)
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f'.{path.name}.', suffix='.tmp', delete=False) as temporary:
            temporary_path = Path(temporary.name)
        try:
            with ZipFile(temporary_path, 'w') as target:
                target.writestr('mimetype', b'application/epub+zip', compress_type=ZIP_STORED)
                for entry in source.infolist():
                    if entry.filename == 'mimetype':
                        continue
                    target.writestr(entry, replacements.pop(entry.filename, source.read(entry.filename)))
                for name, content in replacements.items():
                    target.writestr(name, content, compress_type=ZIP_DEFLATED)
            verify_imprint(temporary_path, args.version, args.date)
            temporary_path.replace(path)
        finally:
            temporary_path.unlink(missing_ok=True)
    return verify_imprint(path, args.version, args.date)


def verify_imprint(path: Path, version: str | None = None, published_date: str | None = None):
    with ZipFile(path) as archive:
        opf_name, package, metadata, manifest, spine, items = read_package(archive)
        cover_id = image_cover_id(archive, opf_name, spine, items)
        ordered = [item.get('idref') for item in spine]
        if ordered[:2] != [cover_id, IMPRINT_ID] or ordered.count(IMPRINT_ID) != 1:
            raise ValueError('EPUB spine must begin with image cover then exactly one publication-information page')
        if any(node.get('linear', 'yes') != 'yes' for node in list(spine)[:2]):
            raise ValueError('cover and imprint must participate in linear reading order')
        identifier_id = package.get('unique-identifier')
        identifier = metadata.find(f'dc:identifier[@id="{identifier_id}"]', NS)
        if identifier is None or not identifier.text or not identifier.text.startswith('urn:firstpair:book:'):
            raise ValueError('EPUB lacks an edition-specific First Pair identifier')
        expected_version = identifier.text.rsplit(':', 1)[-1]
        if not STAMP.fullmatch(expected_version) or (version and version != expected_version):
            raise ValueError('EPUB edition identifier does not match the required semantic-Git version')
        date_text = metadata.findtext('dc:date', '', NS)
        date.fromisoformat(date_text)
        if published_date and date_text != published_date:
            raise ValueError('EPUB date metadata differs from its release date')
        imprint_name = archive_path(opf_name, items[IMPRINT_ID].get('href'))
        raw = archive.read(imprint_name).decode()
        document = ET.fromstring(raw)
        content = ' '.join(' '.join(document.itertext()).split())
        for field in ('title', 'creator', 'publisher'):
            text = metadata.findtext(f'dc:{field}', '', NS)
            if not text or text not in content:
                raise ValueError(f'EPUB imprint differs from {field} metadata')
        if f'Version {expected_version}' not in content:
            raise ValueError('EPUB imprint does not display its full semantic-Git version')
        if document.find(f'.//h:time[@datetime="{date_text}"]', NS) is None:
            raise ValueError('EPUB imprint does not display its publication date')
        site = document.find('.//h:a[@class="publisher-site"]/h:code', NS)
        if site is None or not site.text or 'monospace' not in raw:
            raise ValueError('EPUB imprint publisher website must use machine-font code markup and CSS')
        return {'passed': True, 'cover': archive_path(opf_name, items[cover_id].get('href')), 'imprint': imprint_name,
                'version': expected_version, 'date': date_text, 'identifier': identifier.text,
                'spineDocuments': len(ordered)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    add = sub.add_parser('add')
    add.add_argument('epub')
    for key in ('title', 'author', 'date', 'version', 'stem'):
        add.add_argument(f'--{key}', required=True)
    add.add_argument('--subtitle', default='')
    add.add_argument('--cover-image', help='Source-owned PNG/JPEG to install as the cover')
    add.add_argument('--publisher', default='First Pair Press')
    add.add_argument('--publisher-url', default='https://firstpair.press')
    verify = sub.add_parser('verify')
    verify.add_argument('epub')
    verify.add_argument('--version')
    verify.add_argument('--date')
    args = parser.parse_args()
    try:
        result = add_imprint(args) if args.command == 'add' else verify_imprint(Path(args.epub), args.version, args.date)
    except (ValueError, KeyError, OSError, ET.ParseError) as error:
        parser.exit(1, f'EPUB frontmatter check failed: {error}\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
