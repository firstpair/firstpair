---
name: firstpair-preview-setup
description: Repo-local skill for building and publishing public preview packages for First Pair books. Use when a book should be published as a limited preview rather than a full manuscript: cover, complete table of contents, opening chapters up to 10 percent of the book, PDF, EPUB, single HTML, and chapter HTML outputs, package README/PREVIEW docs, and a static website landing page under public/<book-stem>/preview.
---

# First Pair Preview Setup

Use this workflow when a book should be published publicly as a preview, not as
a full reader edition.

The core rule is simple: a preview contains the cover, front matter, the full
table of contents, and the opening chapter or opening few chapters, capped at
10 percent of the book's body text. Do not publish the full manuscript through
this workflow.

## Canonical Package

Publish each preview package from First Pair at:

```text
/Users/alexy/src/firstpair/public/<book-stem>/preview/
```

The public URL is:

```text
/<book-stem>/preview/
```

On production, this resolves under the First Pair website domain:

```text
https://firstpair.org/<book-stem>/preview/
```

Keep the deployable package lightweight:

```text
public/<book-stem>/preview/
  index.html
  README.md
  PREVIEW.md
  assets/
    <book-stem>-cover.<ext>
    <book-stem>-headboard.<ext>  # optional wide detail-page art
```

Do not place public preview artifacts in `public/books/`. Do not keep duplicate
copies in legacy preview folders. Upload PDF, EPUB, single HTML, and chapter
HTML to Vercel Blob one title at a time. Link PDF and EPUB Blob URLs as
downloads, but link HTML through hosted reader routes on `firstpair.org`, such
as `/read/<book-stem>/` and `/read/<book-stem>/chapters/`. Keep the HTML Blob
URLs only as backing source fields in `public/catalog.json`.

After changing a public package, update:

```text
public/catalog.json
```

The Vue site reads the library from that catalog.

Keep the canonical visual assets in the source repository. Declare the card
cover with `epub.coverImage` (or another supported cover field) and optional
wide detail art with top-level `headboardImage` in `book.build.json`.
`library:publish` stages and uploads both images and records their Blob URLs in
the catalog. A static preview page may keep lightweight local copies under its
`assets/` directory so the package remains portable before upload.

## Source Repositories

Source repositories own the manuscripts, metadata, versions, preview cutoff,
and build logic. First Pair receives only the public-facing package.

For `Lighthouse Republics`, source the editions from the Venezia worktrees:

- South/main: `/Users/alexy/src/venezia/usavenice`
- East: `/Users/alexy/src/venezia/usavenice-codex-murakami`
- West: `/Users/alexy/src/venezia/usavenice-codex-hemingway`

The canonical GitHub remote for the source book is:

```text
git@github.com:firstpair/two-republics.git
```

The First Pair website repo is:

```text
/Users/alexy/src/firstpair
git@github.com:firstpair/firstpair.git
```

Do not revive fixed-page Scribe image EPUBs for previews unless explicitly
asked. The active comparison direction is reflowable/editorial/Rosetta.

## Preview Cut Rule

1. Count body words from the complete generated manuscript, excluding cover,
   table of contents, bibliography, anthology, indices, figures ledger, and
   build metadata.
2. Set the preview ceiling at 10 percent of that body word count.
3. Choose a clean section boundary at or below the ceiling. Prefer the first
   chapter if it is close to the target; otherwise include the first few
   consecutive chapters.
4. Keep the excerpt consecutive from the beginning of the body. Do not cherry
   pick later chapters into the public preview.
5. Preserve the complete public table of contents so readers can see the shape
   of the full book.
6. Add a clear preview note near the front matter stating that the file is a
   limited preview, not the complete edition.

When the 10 percent cutoff falls in the middle of a chapter, cut before that
chapter unless the user explicitly asks for a longer sample.

## Build Shape

Use source-derived preview manuscripts rather than PDF slicing. PDF slicing can
produce plausible-looking previews while leaving EPUB navigation, metadata,
cross-links, and title pages wrong.

Recommended working layout in each source worktree:

```text
book/preview/
  metadata.yaml
  manuscript.md
  cover.md
  epub.css
  dist/
```

The preview manuscript should be generated from the same authored source files
as the full book, with body content truncated only after the selected section
boundary. Keep helper scripts in the source repo when they are book-specific.
When publishing browser editions, build both a single-file HTML artifact and a
chapter HTML directory from the preview manuscript or preview EPUB. Do not copy
the full-book HTML into a preview package.

For QueryGraph-family books that already fit First Pair's generic build shape,
use:

```sh
cd /Users/alexy/src/firstpair
REPO_ROOT=/path/to/source-repo \
BOOK_ROOT=book/preview \
BOOK_MANUSCRIPT=book/preview/manuscript.md \
BOOK_FORMATS=typst,troff \
publishing/scripts/build-book.sh
```

For `usavenice`, inspect the local `scripts/build_books.sh` contract first. If
it does not support alternate preview inputs, add a narrowly scoped preview
builder in the source repo rather than mutating the full-book build path.

Rosetta previews should be built from preview-aligned South/East/West sources.
If the existing Rosetta builder only reads full manuscripts, extend it with a
preview input mode or a preview section limit. Do not post-process the full
Rosetta EPUB/PDF by page count.

## Public README And PREVIEW.md

Every public package must include:

- `README.md`: short public entry point with the dedicated URL, included files,
  and preview limitation.
- `PREVIEW.md`: detailed public manifest explaining every edition, every
  format, source commits used when known, word-count percentage, build date,
  checksums, and validation results.
- `index.html`: static landing page that links to the README, PREVIEW manifest,
  and all artifact files.

Public-facing docs must not expose local filesystem paths such as
`/Users/alexy/...`. Keep local paths in this setup file or private build logs.

## HTML Landing Page Rules

Use a static `index.html` under the package folder, not a Vue route, for the
dedicated preview URL. This keeps the preview package portable and makes it
easy to mirror or archive.

The page should:

- identify the package as a public preview, not the complete book;
- link to all PDF and EPUB artifacts that actually exist;
- link to hosted single-file and chapter readers for HTML reading;
- link to `README.md` and `PREVIEW.md`;
- describe available editions in plain reader language;
- avoid local paths, private notes, and build-only jargon;
- remain readable without JavaScript.

After adding or changing the page, build the First Pair site:

```sh
cd /Users/alexy/src/firstpair
npm run build
```

Then verify the generated static page exists:

```sh
test -f site-dist/<book-stem>/preview/index.html
test -f dist-prod/<book-stem>/preview/index.html
```

## Validation

Before publishing a preview package, verify each local artifact package:

```sh
find book-uploads/staging/<book-stem>/preview/artifacts -type f | sort
pdfinfo book-uploads/staging/<book-stem>/preview/artifacts/<edition>/<artifact>.pdf
unzip -t book-uploads/staging/<book-stem>/preview/artifacts/<edition>/<artifact>.epub
```

Repeat `pdfinfo` and `unzip -t` for every PDF/EPUB pair.

Check the preview ceiling:

```sh
wc -w < /path/to/full/body-only.md
wc -w < /path/to/preview/body-only.md
```

The preview body word count must be less than or equal to 10 percent of the
full body word count, unless the user explicitly approves a different limit.

Check the public package for local path leaks:

```sh
rg -n '/Users/alexy|sources/|Local file|Local files|source_manifest|downloaded local PDF' \
  public/<book-stem>/preview
```

The command should return no public-path leaks. It may still find artifact
filenames or ordinary source words; review matches before deciding they are
failures.

Run the site smoke after building:

```sh
npm run build
npm run smoke:site
```

The smoke should confirm that every catalog PDF, EPUB, and preview landing page
is reachable, including single-file HTML and chapter HTML routes.

## Upload Cadence

Do not bulk-upload the public binary library as part of routine site polishing.
PDF and EPUB previews are heavyweight deliverables. HTML previews are lighter,
but should still be uploaded as part of the same one-book package so catalog
state and public routes stay coherent.

When a new preview is ready, upload one preview package at a time:

```sh
npm run books:upload -- <book-stem>
```

Verify that package's live landing page, PDF, EPUB, single HTML, and chapter
HTML before moving to the next book. If the only changes are app shell, styling,
catalog copy, or docs, avoid a deployment path that re-sends unchanged book
binaries. Wait for the next single-book package delivery if needed.

## Deployment

Publishing is a website deployment task, separate from building artifacts.

Use the First Pair site's normal deployment path after the package is complete.
Do not announce the dedicated URL as live until the deployed site has been
checked at:

```text
/<book-stem>/preview/
```

The final report should separate:

- preview sources generated;
- PDF/EPUB artifacts built;
- package docs updated;
- First Pair site built;
- deployment completed or not completed;
- public URL verified or not verified.
