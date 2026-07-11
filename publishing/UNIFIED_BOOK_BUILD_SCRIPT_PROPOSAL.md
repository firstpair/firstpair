# Unified Book Build Script Proposal

Review date: 2026-07-11

This proposal covers the books currently delivered through the First Pair
library catalog. The goal is to keep each source repository authoritative for
its manuscript, metadata, edition policy, and local validation, while moving the
repeatable build and delivery contract into FirstPair.

The unified script should live in this repository and be invoked by thin
`build.sh` wrappers in source repos:

```sh
~/src/firstpair/publishing/scripts/build-library-book.sh
```

It should not replace the public publishing script. The handoff should be:

```text
source repo build.sh
  -> firstpair/publishing/scripts/build-library-book.sh
  -> publish-complete dist directory
  -> firstpair npm run library:publish -- <dist-or-repo> --slug <slug>
```

## Accepted Review Changes

The implementation incorporates the review in
[`../OPUS_UNIFIED_PUBLISHING_REVIEW.md`](../OPUS_UNIFIED_PUBLISHING_REVIEW.md)
and the subsequent toolchain decision:

- native publishing tools are installed and pinned through Homebrew, with exact
  executable versions recorded in `toolchain.lock.json`;
- Python-owning repositories pin Python with asdf and lock project environments
  with uv;
- Neatroff and each independently cloned component repository are locked to
  source commits, as is utmac;
- `book.build.json` is the sole canonical configuration form, with CLI edition
  selection/overrides and environment compatibility only for existing hooks;
- PDF geometry and representative raster verification, EPUB package checks,
  and HTML/chapter checks are mandatory shared build steps; and
- non-Git/no-commit repositories use deterministic content hashes for
  `source_commit` and `version_stamp`.

These constraints change the standard of done, not the architecture: the
shared layer still standardizes the build graph and artifact contract while
source repositories keep authorship and editorial logic.

## Current Library Inventory

The live catalog currently has 11 book slugs. These are the build-script states
to normalize.

| Slug | Source/build root reviewed | Current entrypoint | Current state |
| --- | --- | --- | --- |
| `apc40-mk2-ableton-start` | `alexy/music` GitHub path `codex/docs/books/apc40-mk2-ableton-start` | `build.sh` | Builds PDF/EPUB/MOBI and versioned copies. Live FirstPair staging also has HTML, chapter HTML, and a tutorial artifact, but the reviewed source wrapper does not currently produce those through the common emitter. |
| `typesec` | `/Users/alexy/src/typesec/docs/book` | `docs/book/build.sh` | Good QueryGraph-style baseline. Builds PDF, EPUB, MOBI, HTML, chapter HTML, `VERSION.md`; publisher dry-run resolves cleanly from repo root. |
| `grust` | `/Users/alexy/src/grust/docs/book` | `docs/book/build.sh` | Good baseline with `build.mjs`, rendered markdown, page-label fix, HTML emitter, MOBI. Dist lives at `docs/book/build/dist`; publisher dry-run resolves cleanly. |
| `lakecat` | `/Users/alexy/src/lakecat/docs/book` | `docs/book/build.sh` | Good baseline with persistent diagram rendering and HTML emitter. It still has repo-local iCloud copy logic and an incomplete manifest: current `VERSION.md` omits `pdf_file`/`pdf_link`, though publisher can infer them from files. |
| `sail-rust-book` | `/Users/alexy/src/book-sources/sail-rust-book/sail-rust-book` | `sail-rust-book/build.sh` | Builds source staging, diagrams, Typst PDF, EPUB, MOBI, HTML, chapters, and `VERSION.md`. Publisher resolves only when pointed at the `book/` output directory; repo-root resolution misses this layout. |
| `zucchero` | `/Users/alexy/src/zucchero/docs/book` | `python3 tools/build_book.py` | Python builder creates PDF, EPUB, HTML, chapters, checksums, and a Markdown-style `VERSION.md`. Publisher dry-run works by inference, but iCloud names fall back to stable names because the manifest is not key-value parseable. |
| `omnighost` | `/Users/alexy/src/omnighost/docs/book` | `docs/book/build.sh` | Dual Typst/troff build with suffixed manifest fields. Current source dist lacks HTML/chapter artifacts, so publisher dry-run fails. Needs either HTML emission restored or stable public aliases. |
| `lighthouse-republics` | `/Users/alexy/src/venezia/usavenice/book` | `scripts/build_books.sh` | Rich full-book build with Typst/troff, diagrams, visual counts, HTML emitter, and iCloud delivery. Publisher correctly refuses repo-root publish over the current preview listing without `--full`. No source-side `dist-preview` package exists yet. |
| `rio-grande` | `/Users/alexy/src/rio-grande` | `build.sh` | Standalone `firstpair/rio-grande` checkout. The shared wrapper builds publish-complete preview and full packages while preserving the source-owned Python editor and PDF hooks. |
| `invented-enemy` | `/Users/alexy/src/russophobia/book` | `book/build.sh` | Best current preview/full pattern. Builds `dist-preview/` and `dist-full/`, each with PDF, EPUB, HTML, chapters, and `VERSION.md` carrying `edition`. Publisher dry-run selects preview by default. |
| `from-1-to-0` | `/Users/alexy/from-1-to-0/book` | `book/build.sh`, `book/preview/build.sh` | Full and preview wrappers exist; preview enforces the 10 percent ceiling. Current source dist lacks HTML and `VERSION.md`, so publisher dry-run fails. Should be moved to the Russophobia-style `dist-preview`/`dist-full` shape. |

## Proposed Script Contract

Create `publishing/scripts/build-library-book.sh` as the stable FirstPair build
entrypoint. Existing source-repo `build.sh` files should become small wrappers
that set configuration and delegate to it.

The script should read a checked-in `book.build.json`. CLI flags may select an
edition or override an operational path. Environment variables are retained
only for process/tool compatibility and legacy hooks; they are not a second
configuration surface:

```sh
~/src/firstpair/publishing/scripts/build-library-book.sh \
  --repo-root /path/to/source-repo
```

The equivalent repository configuration is machine-readable and schema-backed:

```sh
{
  "$schema": "../firstpair/publishing/book.build.schema.json",
  "schemaVersion": 1,
  "bookRoot": "book",
  "metadata": "book/metadata.yaml",
  "version": "1.3",
  "defaultEdition": "preview",
  "hooks": { "prebuild": "book/assemble.sh" },
  "editions": {
    "preview": {
      "manuscript": "book/manuscript-preview.md",
      "dist": "book/dist-preview",
      "stem": "invented-enemy-preview"
    },
    "full": {
      "manuscript": "book/manuscript-full.md",
      "dist": "book/dist-full",
      "stem": "the-invented-enemy"
    }
  }
}
```

The central script should own these common operations:

- version detection from `BOOK_VERSION`, `VERSION`, `Cargo.toml`, or
  `package.json`;
- `version_stamp` creation as `<version>-<short-git-hash>`, with override;
- safe temp directories, `TMPDIR`, and `CALIBRE_CONFIG_DIRECTORY`;
- cover rendering with `{{KINDLE_NAME}}` or `{{BOOK_NAME}}` replacement;
- Typst PDF generation and `pdfunite` cover/body assembly;
- EPUB generation with metadata, CSS, resource paths, and title-page policy;
- optional MOBI generation through `ebook-convert`;
- HTML and chapter HTML generation by reusing `emit-html-book.sh`;
- versioned symlink/copy creation;
- key-value `VERSION.md` generation;
- mandatory shared rendered-layout and package validation plus local validators,
  for example `check_epub_metadata.sh`,
  `check_pdf_layout.sh`, page-label fixers, or preview word-count checks;
- optional tutorial artifact registration;
- optional post-build `check-version-marker.sh`.

The script should deliberately not own these book-specific operations:

- deciding the manuscript contents;
- assembling complex source trees into a single manuscript;
- enforcing historical, copyright, or preview-cut editorial policy;
- generating highly specific diagrams, figures, screenshots, or tutorials;
- choosing whether a full book should replace a preview in the public library.

Those remain source-repo hooks.

## Publishable Dist Contract

Every directory intended for `npm run library:publish` should be complete on
its own. It should contain:

```text
VERSION.md
<stable-stem>.pdf
<stable-stem>.epub
<stable-stem>.html
<stable-stem>-chapters/
optional: <stable-stem>.mobi
optional: tutorial HTML
optional: versioned symlinks/copies
```

`VERSION.md` should use simple key-value lines, not Markdown bullets, because
the FirstPair publisher reads it as a key-value manifest:

```text
title: TypeSec
subtitle: Type-Level Security for Agentic AI
title_stem: typesec
edition: full
version: 0.12.0
version_stamp: 0.12.0-4a9b5f
source_commit: 4a9b5f
built_at: 2026-07-10T00:00:00Z
pdf_file: typesec.pdf
epub_file: typesec.epub
html_file: typesec.html
html_chapters_dir: typesec-chapters
pdf_link: typesec (0.12.0-4a9b5f).pdf
epub_link: typesec (0.12.0-4a9b5f).epub
html_link: typesec (0.12.0-4a9b5f).html
html_chapters_link: typesec (0.12.0-4a9b5f)-chapters
```

For preview/full books, the script should write two publish-complete
directories:

```text
book/dist-preview/VERSION.md   # edition: preview
book/dist-full/VERSION.md      # edition: full
```

Default behavior should be preview-first:

```sh
book/build.sh              # build both if cheap, or preview by default
book/build.sh preview
book/build.sh full
book/build.sh both
```

Full public publication still belongs to `scripts/publish-book-to-library.mjs`
and its `--full` gate. The build script may create `dist-full`; it must not
publish it.

## FirstPair Script Changes Needed First

Before source repos depend on the unified builder, fix these FirstPair-side
edges:

1. Add `book/` as a recognized dist candidate when it contains `VERSION.md`
   plus artifacts. This lets `sail-rust-book` resolve from its repo root.
2. Add `docs/books/<slug>/dist` as a recognized candidate for APC40-style
   books.
3. Print `edition` in `library:publish --dry-run` output, because the safety
   guidance says agents should show resolved `distDir` and `edition`.
4. Normalize legacy manifest aliases while migrating:
   `stable_pdf` -> `pdf_file`, `stable_epub` -> `epub_file`,
   `versioned_pdf` -> `pdf_link`, `versioned_epub` -> `epub_link`.
5. Fix `publishing/scripts/check-version-marker.sh` and
   `publishing/scripts/publish-versioned-artifacts.sh`: their suffixed PDF
   loops mirror the EPUB loop but currently do not read from `suffixes_for pdf`.
6. Add a `primary_format` or `public_format` field for dual-format dists.
   `omnighost` and `lighthouse-republics` can keep Typst/troff outputs, but
   library publishing should know which public pair to expose without relying
   on filename sort order.

## Migration Plan

1. Implement and test the central script against a disposable fixture in
   FirstPair. Include one single-format book, one dual-format book, and one
   preview/full book.
2. Convert `typesec`, `grust`, and `lakecat` first. These already use the
   shared HTML emitter and the standard `docs/book` shape. LakeCat should lose
   its local iCloud copy block in favor of the FirstPair helper.
3. Convert `sail-rust-book` next. Preserve its source staging and diagram
   rendering as hooks, but standardize its output discovery and versioned PDF
   and EPUB names.
4. Convert `zucchero` by keeping Python for public-safe manuscript generation
   and moving artifact rendering/manifest writing to FirstPair. Its manifest
   should stop using Markdown bullets for machine-readable fields.
5. Convert `omnighost` by moving the dual Typst/troff graph onto
   `BOOK_FORMATS=typst,troff`, restoring HTML/chapter output, and declaring a
   primary public format or stable aliases.
6. Treat `invented-enemy` as the preview/full reference implementation. The
   central script should be able to reproduce its current `dist-preview` and
   `dist-full` shape.
7. Convert `from-1-to-0` to the same `dist-preview`/`dist-full` shape. Preserve
   its current 10 percent preview ceiling check as a source-repo validator.
8. Convert `lighthouse-republics` after the full/preview gate is settled. Keep
   the current full build, but add a source-owned preview dist if it should stay
   preview-listed in the public catalog.
9. Wrap `rio-grande` rather than rewriting it. First add a source-side manifest
   and HTML emission from the generated manuscript or EPUB XHTML; then add a
   preview dist generator that reproduces the existing FirstPair preview cut.
10. Bring APC40 back into the same contract once the local source checkout is
    accessible. The remote wrapper needs common HTML/chapter generation,
    tutorial registration, and key-value manifest aliases before it matches the
    live library package.

## Verification Matrix

Each migrated repo should pass this before being considered converted:

```sh
# In the source repo
./docs/book/build.sh
~/src/firstpair/publishing/scripts/check-version-marker.sh <dist-dir>

# In FirstPair
npm run library:publish -- <source-repo-or-dist> --slug <slug> \
  --dry-run --no-build --no-smoke --no-deploy
```

For preview/full books, verify both selections explicitly:

```sh
npm run library:publish -- <source-repo> --slug <slug> \
  --dry-run --no-build --no-smoke --no-deploy

npm run library:publish -- <source-repo> --slug <slug> \
  --full --dry-run --no-build --no-smoke --no-deploy
```

The first command should resolve `edition: preview`; the second should resolve
`edition: full` and should remain dry-run only unless the user explicitly
confirms full publication.

## Recommended Wrapper Shape

After migration, source repo wrappers should be boring. For a standard
QueryGraph-style book:

```sh
#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
exec "$HOME/src/firstpair/publishing/scripts/build-library-book.sh" \
  --repo-root "$repo_root" \
  --book-root docs/book \
  --manuscript docs/book/typesec.md \
  --metadata docs/book/metadata.yaml \
  --cover docs/book/cover.md \
  --dist docs/book/dist \
  --formats typst \
  --html \
  --mobi \
  "$@"
```

For a preview/full narrative book:

```sh
#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
exec "$HOME/src/firstpair/publishing/scripts/build-library-book.sh" \
  --repo-root "$repo_root" \
  --book-root book \
  --edition-mode preview-full \
  --prebuild "python3 book/assemble.py" \
  --preview-manuscript book/manuscript-preview.md \
  --full-manuscript book/manuscript-full.md \
  --preview-dist book/dist-preview \
  --full-dist book/dist-full \
  --html \
  "$@"
```

## Design Principle

Centralize the build graph and artifact contract, not the authorship logic.
The common script should make every source repo produce the same kind of
publishable package. It should not make every book look like it was assembled
the same way.
