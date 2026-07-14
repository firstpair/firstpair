# FirstPair Agent Guidance

FirstPair is the shared publishing and public-delivery repository. Preserve
book-specific source repositories as the authority for manuscripts, metadata,
versions, and built artifacts; FirstPair owns the public catalog, preview
pages, and object-storage delivery URLs.

## Content Ownership

Do not deposit project-owned editorial content in FirstPair unless the user
explicitly names an exception. Announcements, blog posts, textpacks, pitch
packets, manuscript excerpts, and their assets belong in the specific project
or book source repository that owns the work. FirstPair may hold First Pair
house content, public catalog/readme surfaces, upload manifests, reader route
maps, and generated deployment metadata needed to publish or host those sources.

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
/read/<book-stem>/guide/
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

The general delivery command is:

```sh
npm run library:publish -- /absolute/path/to/book-or-dist --slug <book-stem>
```

The command accepts a dist directory or a book/repository directory containing a
known dist layout, refreshes `book-uploads/staging/<book-stem>/`, updates the
upload source map and catalog entry, uploads that single book package, syncs the
reader map, writes `public/<book-stem>/README.md`, copies versioned PDF/EPUB
files to `~/icloud/books`, runs the catalog/build/smoke checks, deploys to
Vercel production, and verifies that the live `firstpair.org` catalog points at
the new Blob URLs. Use `--dry-run` before first-time packages, `--stage-only`
when only the ignored staging package and source map should be prepared, and
`--no-deploy` when the package should be uploaded without changing the live
site.

### Preview → full publishing (the `--full` gate)

A book may split its build output into two publish-complete directories,
`dist-preview/` and `dist-full/`, each carrying a `VERSION.md` with
`edition: preview` or `edition: full`. Without `--full`, `library:publish`
selects the **preview** edition; `--full` selects the **full** edition.

Publishing the **full** edition over a book whose catalog entry is currently a
**preview** REQUIRES `--full`. The script refuses without it, because that
publish replaces the public preview listing and pushes the complete text to the
library and to `~/icloud/books`.

**Warning — mandatory for agents:** pushing the full book is a hard-to-reverse,
outward-facing action. If there is any chance a publish run would push the full
version — the target resolves to `dist-full`, `--full` is (or would need to be)
passed, or the book is currently listed as a preview — STOP, warn the user in
plain terms that this will make the **complete book** public and overwrite the
preview, and ask for explicit confirmation first. Never add `--full` on the
user's behalf to get past the gate. When unsure which edition a run would
publish, do a `--dry-run` and show the resolved `distDir`/`edition` before doing
anything live.

Hosted HTML readers must include a visible link back to the First Pair library.
Implement that navigation in the FirstPair reader proxy, not by rewriting and
reuploading every generated HTML artifact. The link should point to `/`, render
on single-file, chapter, and rendered vault-guide HTML pages, and stay hidden
in print output.

When `--vault` includes a Markdown guide, preserve that source as a versioned
regular file in staging and `~/icloud/books`, embed the same bytes as
`README.md` at the vault archive root, and render a self-contained HTML
derivative with Pandoc for Blob upload. Store `/read/<book-stem>/guide/` in the
catalog's `vaultGuide` field and the backing HTML Blob URL in
`vaultGuideSource`; do not expose the raw Markdown Blob as the reader link.

Before regenerating, editing, validating with write-capable tools, zipping, or
otherwise programmatically touching an Obsidian vault directory, ask the user to
close that vault in Obsidian and wait for confirmation. Obsidian may keep
workspace, plugin, and index files open or rewrite them in the background;
writing the vault while it is open can race those writes and poison the
generated edition. Once confirmed closed, regenerate the vault from source, then
validate it before staging or publishing.

Before resolving even a dry-run vault plan, look for the source repository's
`scripts/check-obsidian-vault.py`. If present, `library:publish` must run it
against the resolved vault and fail closed before staging or ZIP creation. A
repository with both `pyproject.toml` and `uv.lock` is validated through its
locked uv project; an executable or readable standalone validator is invoked
directly or with `python3`. Repositories without a source-owned validator keep
the structural `Home.md` plus `_data/units.jsonl` compatibility check.

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
