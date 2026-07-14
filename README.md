# First Pair Press Library

This repository is the public library and publishing method for First Pair
Press. It powers [firstpair.org](https://firstpair.org), records the public
catalog, hosts preview pages, maps hosted reader routes, and preserves the
delivery manifests for Blob-backed PDF, EPUB, and HTML editions.

The book-specific source repositories remain the authority for manuscripts,
metadata, version manifests, editorial history, and source builds. This
repository receives finished public packages and makes them readable,
downloadable, and reviewable.

## Press Stories

The library is the place to read and download books. The story of First Pair
Press lives at [firstpair.press](https://firstpair.press/).

Start with these two method posts:

- [The First Pair Bell Labs Manifesto](https://firstpair.press/firstpair-manifesto/)
- [Making Text Shine](https://firstpair.press/firstpair-typography-innovation/)

Those posts describe the publishing philosophy: books as semantic source, AI as
a useful research and editing filter, small tools connected by plain text, and
multiple renderers competing from the same durable manuscript. Individual books
will have their stories there too: why they exist, how they were made, what
sources shaped them, and what the public edition is meant to do.

## What Lives Here

- `public/catalog.json` is the public library catalog. The Vue app renders from
  it instead of hardcoding book entries.
- `public/<book-stem>/README.md` documents each public book package.
- `public/<book-stem>/preview/` holds static landing pages and manifests for
  preview editions.
- `reader-map.mjs` maps hosted reader routes to Blob-backed single-file,
  chapter, tutorial, and rendered vault-guide HTML packages.
- `book-uploads/book-package-sources.json` records the local package source for
  each catalog slug.
- `book-uploads/blob-manifest.json` records uploaded hashes and Blob URLs so
  unchanged files can be skipped.
- `publishing/` contains shared build, delivery, versioning, and textpack
  scripts used across First Pair work.

Heavy book payloads do not live in deployable `public/`. PDF, EPUB, single HTML,
chapter HTML, companion vaults, and rendered vault guides are uploaded to
Vercel Blob one title at a time.
`firstpair.org` exposes PDF and EPUB as downloads and HTML through hosted reader
routes:

```text
/read/<book-stem>/
/read/<book-stem>/chapters/
/read/<book-stem>/guide/
```

When `library:publish` is run with `--vault`, it keeps the canonical Markdown
guide in staging and iCloud, embeds the same bytes as `README.md` in the vault
archive, and uses Pandoc to make a self-contained HTML derivative for the
hosted guide route. The catalog records the route as `vaultGuide` and the Blob
URL as `vaultGuideSource`; readers never need to render a raw Markdown Blob.

## The Method

First Pair treats a book as a living system rather than a frozen file.

The manuscript begins as semantic source: plain text, structured enough to be
rendered in several ways, and readable enough to inspect in a terminal. AI can
help research, compare, summarize, check consistency, and remove mechanical
friction, but human authorship remains responsible for judgment, taste,
argument, and publication.

The build path favors reproducibility:

1. Source repositories produce stable artifacts from manuscript, metadata,
   assets, and version manifests.
2. Build scripts generate reader-facing PDF, EPUB, single-file HTML, and chapter
   HTML outputs.
3. Version manifests record names, stems, build dates, and source commits where
   available.
4. First Pair receives the public package, uploads the heavy artifacts to Blob,
   updates the catalog and reader map, and verifies the live routes.

Different books can use different renderers. The common principle is that
source endures while renderers compete. Markdown and Pandoc provide portable
semantic structure. Typst and troff/neatroff provide distinct PDF paths. EPUB
and HTML make the text portable to readers and browsers. The outputs are not
the source of truth; they are proofs and public editions derived from source.

## Publishing Deliverables

A full public delivery usually includes:

- PDF download
- EPUB download
- hosted single-file HTML reader
- hosted chapter reader
- optional downloadable Obsidian vault and hosted rendered vault guide
- `public/<book-stem>/README.md`
- catalog metadata in `public/catalog.json`
- Blob upload records in `book-uploads/blob-manifest.json`
- reader route mapping in `reader-map.mjs`
- versioned PDF and EPUB copies in `~/icloud/books`

The general command is:

```sh
npm run library:publish -- /absolute/path/to/book-or-dist --slug <book-stem>
```

Use `--dry-run` to inspect artifact resolution, `--stage-only` to refresh only
local staging and the source map, and `--no-deploy` when the package should be
uploaded without changing production.

Add `--vault` when the source book has a validated vault under
`dist-obsidian/`; use `--vault-dir` and `--vault-guide` only when discovery
cannot select the intended vault and Markdown guide unambiguously.

Before a public change is considered done, the normal checks are:

```sh
npm run check:catalog
npm run prod:build
npm run smoke:site
```

For full book deliveries, exact source-to-destination copies should also be
verified with byte checks such as `cmp`.

## Full Books And Preview Editions

Full books are complete public editions. Their catalog entries normally include
`kicker: "Finished book"`, `tags` including `finished`, public PDF and EPUB
downloads, hosted readers, and a `source` URL when the source repository is
public. The source repository owns the manuscript, metadata, version contract,
and build logic. First Pair owns the public catalog, package README, Blob URLs,
reader routes, and site presentation.

Preview editions are public excerpts, not the complete books. Their catalog
entries normally include `kicker: "Preview edition"`, `tags` including
`preview`, and a `homepage` under:

```text
/<book-stem>/preview/
```

A preview package should make the offer clear: cover, front matter, complete
table of contents, and an opening excerpt or preview movement, with PDF, EPUB,
single-file HTML, and chapter-reader access. Preview entries do not expose a
GitHub Source action by default. The source repository may be private, in flux,
or not yet ready to represent the full manuscript publicly.

The difference is editorial, not merely technical. A full book says, "this is
the complete edition." A preview says, "this is enough to understand the book,
inspect the method, and decide whether to keep reading." The First Pair Press
posts tell the larger story around both.
