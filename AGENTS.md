# FirstPair Agent Guidance

FirstPair is the shared publishing and public-delivery repository. Preserve
book-specific source repositories as the authority for manuscripts, metadata,
versions, and built artifacts; FirstPair owns the public catalog, preview
pages, and object-storage delivery URLs.

## Public Book Delivery

Public books have one lightweight metadata directory under `public/`. Use the
book's stable stem for the directory name:

```text
public/<book-stem>/
```

For LakeCat, the destination is:

```text
public/lakecat/
```

The public library catalog lives at:

```text
public/catalog.json
```

Every public-facing book or preview listed on the site must be represented in
that catalog. Do not hardcode library entries in the Vue app when they can live
in the catalog.

Heavy book payloads do not live in deployable `public/`. Upload PDF, EPUB,
single-file HTML, and chapter HTML packages to Vercel Blob one title at a time.
Expose PDF and EPUB as download URLs. Expose HTML only through hosted reader
routes on `firstpair.org`:

```text
/read/<book-stem>/
/read/<book-stem>/chapters/
```

Record both the hosted reader routes and the backing Blob source URLs in
`public/catalog.json`:

```text
public/catalog.json
public/<book-stem>/README.md
book-uploads/book-package-sources.json
book-uploads/blob-manifest.json
```

`book-uploads/book-package-sources.json` maps each catalog slug to the local
artifact package to upload. `book-uploads/blob-manifest.json` records uploaded
hashes and Blob URLs so unchanged files and chapter packages are skipped.
`book-uploads/staging/` is ignored and may hold local operational copies, but
must not be deployed or committed as book payload.

Hosted HTML readers must include a visible link back to the First Pair library.
Implement that navigation in the FirstPair reader proxy, not by rewriting and
reuploading every generated HTML artifact. The link should point to `/`, render
on single-file and chapter HTML pages, and stay hidden in print output.

Create or update `public/<book-stem>/README.md`. The README should briefly
overview the book, link the Blob-backed PDF and EPUB downloads, link the hosted
single-file and chapter readers, and point back to the original source
repository that owns the manuscript, metadata, version manifest, and builds.

Deliver the same PDF and EPUB to `~/icloud/books` as regular files carrying
their versioned names. Do not create iCloud symlinks: the reading-library files
must remain self-contained if moved or synchronized.

Verify every delivery by exact path and URL:

```sh
npm run books:upload -- <book-stem>
npm run check:catalog
npm run prod:build
npm run smoke:site
cmp -s /absolute/source/book.pdf "$HOME/icloud/books/<versioned-name>.pdf"
cmp -s /absolute/source/book.epub "$HOME/icloud/books/<versioned-name>.epub"
```

For unchanged payloads, `npm run books:upload -- <book-stem>` should report
`skipped: true` for existing file units and `uploadedFileCount: 0` for skipped
chapter packages.

## Public Preview Delivery

Public previews live inside the same title directory as the finished book would
use, under a `preview/` package:

```text
public/<book-stem>/preview/
```

Each preview package keeps its landing page, README, and manifest in `public/`;
preview artifacts are Blob-backed and linked from the page, docs, and catalog:

```text
public/<book-stem>/preview/index.html
public/<book-stem>/preview/README.md
public/<book-stem>/preview/PREVIEW.md
```

Do not create a separate `public/books/` namespace. Do not keep duplicate public
artifact copies in old preview locations. The source book repository remains
the authority for manuscript text, metadata, versions, and build logic; FirstPair
receives only the public package.

After adding or moving a public package, update `public/catalog.json`, run the
site build, and check every catalog PDF, EPUB, hosted HTML reader, hosted
chapter reader, and preview landing page.

## Deployment Cadence

Binary book artifacts are heavyweight public deliverables. Do not redeploy the
entire binary library just to ship app-shell, catalog-text, or documentation
changes.

When adding or refreshing public book artifacts, upload one book package at a
time:

```sh
npm run books:upload -- <book-stem>
```

Finish and verify that book's live routes before starting another book upload.
If a later change only touches Vue/CSS/docs/catalog text, do not intentionally
re-upload unchanged PDF or EPUB files. Prefer a deployment path that reuses the
already-live book artifacts, or wait until the next single-book artifact
delivery if the hosting surface cannot update code without resending binaries.

## Repository Hygiene

The worktree may contain unrelated application or preview changes. Preserve
them. Stage or commit only the public-book delivery and guidance files when the
user asks for a commit.
