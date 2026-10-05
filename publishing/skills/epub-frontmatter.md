# EPUB covers and publication-information pages

The source repository owns its cover artwork, author, title, subtitle, semantic
version, and build configuration. To build an image cover followed immediately
by a separate publication-information page, configure:

```json
"epub": {
  "coverImage": "cover/book-cover.png",
  "imprint": true,
  "includeRenderedCover": false,
  "titlePage": false
}
```

`imprint: true` uses **First Pair Press** and `https://firstpair.press`. Other
publishers may supply an object with `publisher` and `publisherUrl`. The imprint
contains the title, optional subtitle, author, date, and complete
`semantic-version-githash` release stamp. It uses an English written date and
machine-readable ISO date; the publisher website uses semantic code markup and
a monospace font. Metadata uses an edition-specific identifier, matching date,
author, and publisher. The first two linear spine documents are always cover
and imprint, followed by the original contents and chapters. The page remains
reflowable, including at larger reader font sizes.

The shared builder installs frontmatter **after** `postEpub`, so a custom
semantic exporter may replace Pandoc's initial EPUB without losing the cover
or imprint. Chapter bytes and mathematical expressions are preserved.

## An EPUB-only patch release

After committing and pushing finished sources, run:

```sh
publishing/scripts/build-library-book.sh --repo-root /absolute/source/repo \
  --config book.build.json --epub-only
```

Use the shared script's absolute path when outside FirstPair. The default output
is `<configured-dist>-epub`; `--dist` overrides that directory. This mode runs
`prebuild`, `prepare`, EPUB generation, and `postEpub` hooks. It does not run PDF
renderers, HTML or MOBI builders, `postPdf`, `postBuild`, or full-package
validators. A source repository whose preparation hook needs a reviewed PDF
must provide that existing PDF; preparation must not quietly regenerate
unrequested formats.

The release contains a stable EPUB, a **regular** versioned EPUB file,
`EPUB-VERSION.md`, and `epub-release.json` with file SHA-256, full source and
builder commits, date, and the frontmatter validation receipt. It does not
write `VERSION.md` or claim that earlier PDF/HTML artifacts have the new
version. A conflicting existing immutable versioned EPUB is rejected. If the
caller explicitly selects an old shared-format dist, versioned EPUB symlinks
are materialized before the stable EPUB is replaced, preserving old bytes.

Run source-specific EPUB checks and EPUBCheck on the actual final covered EPUB,
then visually inspect the cover and information page at mobile and desktop
sizes. Full-edition publication tools still require their full package contract;
this narrow EPUB release manifest does not authorize a mixed-version package
publication. Deliver copies as regular versioned files.

## Custom source-owned exporters

A renderer can invoke the same normalizer directly after generating an EPUB:

```sh
/usr/bin/python3 /absolute/firstpair/publishing/scripts/epub_frontmatter.py add \
  output.epub --title 'Book title' --subtitle 'Optional subtitle' \
  --author 'Alexy Khrabrov' --publisher 'First Pair Press' \
  --publisher-url https://firstpair.press --date 2026-10-04 \
  --version 1.2.4-abcdef12 --stem book-title --cover-image cover/book-cover.png

/usr/bin/python3 /absolute/firstpair/publishing/scripts/epub_frontmatter.py verify \
  output.epub --version 1.2.4-abcdef12 --date 2026-10-04
```

`--cover-image` installs a PNG or JPEG, including for an EPUB that previously
had no image cover. Without it, an existing declared image cover is required.
The operation is atomic and idempotent with respect to reading order: repeated
runs never append duplicate imprint pages. The verifier checks the actual
archive, metadata, cover resource, linear spine order, version/date agreement,
and machine-font publisher website, rather than trusting a build log.

Regression coverage uses real Pandoc EPUBs:

```sh
/usr/bin/python3 publishing/tests/test-epub-frontmatter.py
```

The tests prove chapter-byte preservation, cover resource identity, repeatable
spine structure, rejection of malformed version identity and reordered spine,
atomic failure, post-renderer ordering, and EPUB-only preservation of existing
PDF/HTML/version markers.
