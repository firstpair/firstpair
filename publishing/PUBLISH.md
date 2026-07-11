# First Pair Press Publishing Workflow

This is the working Bell Labs publishing model for First Pair Press. It joins
three local precedents:

- the First Pair manifesto: books are semantic source, not static artifacts;
- the QueryGraph publishing contract: stable artifacts, versioned names, and a
  `VERSION.md` delivery manifest;
- the usavenice book pipeline: Pandoc as the linker, Typst as the modern PDF
  path, troff as the classic path, and generated artifacts verified instead of
  merely hoped for.

The goal is not nostalgia. The goal is a readable, inspectable workshop where a
human and an AI can collaborate without hiding the handoff.

## Repository Shape

```text
publishing/
  Brewfile
  PUBLISH.md
  book.build.schema.json
  toolchain.lock.json
  scripts/
    build-library-book.sh
    build-founding-docs.sh
    build-book.sh
    build-firstpair-book.sh
    check-version-marker.sh
    ensure-python-env.sh
    md-to-utmac.py
    publish-versioned-artifacts.sh
    publish-versioned-blog.sh
    render-mermaid.mjs
    setup-utmac.sh
    textpack.py
  skills/
    *.md
  tmac/
    fp.tmac
  QUERYGRAPH_WORKFLOWS.md

fp.tr                     # First Pair founding documents in pure .FP troff
dist/                     # built founding-document PDF and manifest

proofs/<book>/
  README.md
  AI.md
  VERSION
  metadata.yaml
  cover.md
  manuscript.md
  source.fp.tr
  epub.css
  build.sh
  build/                  # ignored generated intermediates
  dist/                   # stable and versioned proof artifacts
```

The proof book is deliberately small. A small book lets the whole toolchain be
understood by a person, inspected by an AI, rebuilt quickly, and compared across
engines without burying the reader in ceremony.

## Source Contract

The portable manuscript is plain Markdown with YAML metadata. It should be
pleasant to read in a terminal, in a text editor, and through Pandoc.

The Bell Labs manuscript is `source.fp.tr`: hand-authored troff using the
First Pair `.FP.*` macros from `publishing/tmac/fp.tmac`. That source is not
generated from Markdown. It exists so a human and an AI can author directly in
troff while still leaning on utmac for typography.

Every proof book should include:

- `metadata.yaml`: reader-facing title, subtitle, author, publisher, and
  `title_stem`.
- `manuscript.md`: the semantic source.
- `source.fp.tr`: the pure First Pair troff source.
- `AI.md`: collaboration rules for future agents.
- `README.md`: human build notes and current artifact inventory.
- `VERSION`: the book's semantic version.

AI-visible notes are allowed in source support files. They are not allowed to be
the only place where publishing decisions live. If a choice changes the book,
the source, script, or runbook must say so.

## Build Graph

```text
Markdown source
  |
  +-- Pandoc -> Typst PDF
  |
  +-- Pandoc -> EPUB3
  |
  +-- Pandoc -> ms -> groff PDF fallback
  |
  +-- Pandoc JSON -> utmac .tr -> Neatroff PDF
  |
  +-- Pandoc JSON -> utmac .tr -> explicit utmac proof PDF

First Pair troff source
  |
  +-- fp.tmac + utmac -> Neatroff PDF

First Pair founding source
  |
  +-- fp.tr -> fp.tmac + utmac -> Neatroff PDF

QueryGraph-family book source
  |
  +-- Mermaid renderer -> persistent .mmd/.png assets
  |
  +-- Pandoc -> Typst PDF
  |
  +-- Pandoc -> EPUB3/MOBI
  |
  +-- Pandoc -> ms -> groff PDF
  |
  +-- VERSION.md -> versioned iCloud/archive delivery

QueryGraph-family blog source
  |
  +-- Markdown + local assets -> .textpack
  |
  +-- VERSION.md -> versioned ~/icloud/blogs delivery
```

Pandoc is the linker. Typst is the contemporary book renderer. Neatroff is the
Bell Labs lineage rendered with current local tools. In this proof, Neatroff
has two paths: the hand-authored `.FP.*` troff source and the generated utmac
`.tr` source. Raw Pandoc `ms` is kept for the groff fallback because Pandoc's
groff-oriented `ms` output is not a good Neatroff dialect.

## Neatroff And Utmac

The active local Neatroff source lives at:

```text
~/src/neatroff_make
```

Install or verify that tree through FirstPair, not through individual book
projects:

```sh
~/src/firstpair/publishing/scripts/install-toolchain.sh
```

The installer uses `publishing/Brewfile`, pins the installed formulae with
Homebrew, verifies their exact versions against `toolchain.lock.json`, checks
out the locked `neatroff_make` root and component commits, runs `make neat`, and
exposes stable user-level wrappers under
`~/.local/bin`:

```text
neatroff
neatpdf
neatpost
neateqn
neatrefer
neatpic
neattbl
neatsoin
```

It also writes `~/.local/share/firstpair/neatroff.env` for scripts that want to
import the canonical `NEATROFF_ROOT` and PATH shape.

The Node-side rendering dependency, Mermaid CLI, is pinned in `package-lock.json`.
Shared hooks prefer FirstPair's `node_modules/.bin`, so diagram builds do not
depend on an unversioned global `mmdc`.

The build script prefers the `~/src/neatroff_make` tree when it contains:

```text
neatroff/roff
neatpost/pdf
neatpost/post
neateqn/eqn
neatrefer/refer
troff/pic/pic
troff/tbl/tbl
```

If that tree is not built, run:

```sh
cd ~/src/neatroff_make
make init
make neat
```

The utmac macro set comes from Pierre Jean Fichet's `utmac`. The GitHub repo is
archived and points to Codeberg as the current upstream, so the setup script
uses Codeberg at the commit recorded in `toolchain.lock.json`:

```sh
publishing/scripts/setup-utmac.sh
```

That script clones `utmac` into `.tools/utmac`, refuses to move a dirty checkout
to another commit, runs the utmac makefile to
generate `u-idx.tmac` and `u-ref.tmac`, and leaves the checkout untracked. It
does not vendor the macro source into this repo.

## Unified Library Book Builds

Every catalog book now converges on one source-repository entrypoint:

```sh
~/src/firstpair/publishing/scripts/build-library-book.sh \
  --repo-root "$PWD"
```

The source repository checks in `book.build.json`, validated against
`publishing/book.build.schema.json`. That JSON file is the only canonical
configuration surface. Command-line flags select or override an edition;
environment variables remain available to hooks and legacy scripts but do not
duplicate the build configuration.

A source wrapper should only locate its repository and delegate:

```sh
#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
exec "$HOME/src/firstpair/publishing/scripts/build-library-book.sh" \
  --repo-root "$repo_root" "$@"
```

The shared builder owns:

- exact toolchain verification before rendering;
- Git or deterministic content-hash source stamps;
- Pandoc/Typst PDF, EPUB3, single-file HTML, chapter HTML, and optional MOBI;
- source-pinned utmac/Neatroff PDF variants;
- stable and versioned artifact links plus key-value `VERSION.md`;
- a compatibility `kindle_link` using the version-only catalog name when that
  differs from the hash-stamped delivery link;
- mandatory PDF geometry/raster checks and EPUB/HTML package checks; and
- the final `check-version-marker.sh` gate.

Source-owned hooks retain assembly, diagrams, EPUB repair, specialist format
variants, preview limits, and title-specific validators. Python hooks declare a
project path and are run through that repository's asdf-pinned, uv-locked
environment. Working Python book builders are wrapped, not translated into
shell or JavaScript.

For preview/full books:

```sh
book/build.sh preview
book/build.sh full
book/build.sh both
```

Each selected edition must be publish-complete and carry `edition: preview` or
`edition: full`. A build never publishes. A publisher dry-run is the only
allowed automatic handoff during migration:

```sh
npm run library:publish -- /path/to/source-repo --slug <slug> \
  --dry-run --no-build --no-smoke --no-deploy --no-icloud
```

The dry-run output includes both `distDir` and `edition`. Publishing a full
edition over a preview remains guarded by `--full` and explicit human approval.

Run the shared regression fixtures with:

```sh
npm run test:book-build
```

They perform real single-format, Typst/Neatroff dual-format, and preview/full
builds, then exercise publisher discovery for `book/` and
`docs/books/<slug>/dist` layouts.

Current local caveat: Neatroff itself builds and runs. When Libertinus font
descriptions are not present in `~/src/neatroff_make/devutf`, the build creates
local font aliases from utmac's expected Libertinus names to the URW/Nimbus
fonts already generated by `neatroff_make`. The clean next step is still to add
real Libertinus TTF/OTF files to `~/src/neatroff_make/fonts` and run
`make neat` again.

## Build A Proof

Build the founding documents:

```sh
publishing/scripts/build-founding-docs.sh
```

The script writes:

```text
dist/fp.pdf
dist/fp.tr
dist/fp.log
dist/VERSION.md
```

`fp.tr` is the canonical pure troff setting of the two founding documents:
the First Pair Bell Labs manifesto and the concrete Bell Labs publishing
workflow.

Build the small proof book:

```sh
proofs/kiffness-loop-lab/build.sh
```

The script writes stable files under `proofs/kiffness-loop-lab/dist/`:

```text
firstpair-loop-lab-typst.pdf
firstpair-loop-lab-typst.epub
firstpair-loop-lab-firstpair.pdf
firstpair-loop-lab-firstpair.tr
firstpair-loop-lab-neatroff.pdf
firstpair-loop-lab-groff.pdf
firstpair-loop-lab-utmac.pdf
firstpair-loop-lab-utmac.tr
VERSION.md
```

It also creates versioned symlinks using `<stem> (<version>-<hash>)` names. When
there is no commit yet, the hash is `draft`.

`firstpair-loop-lab-firstpair.pdf` is the pure First Pair troff proof:

```sh
cd proofs/kiffness-loop-lab
neatroff -M ../../.tools/utmac -mu-en -mus -m../../publishing/tmac/fp.tmac \
  source.fp.tr | neatpdf > dist/firstpair-loop-lab-firstpair.pdf
```

`firstpair-loop-lab-utmac.pdf` and `firstpair-loop-lab-neatroff.pdf` are
Neatroff builds of the Markdown-derived utmac source. They are useful renderer
checks, but they are not the hand-authored `.FP.*` source.

## QueryGraph-Family Workflows

FirstPair is now the canonical local home for the reusable QueryGraph-family
publishing helpers. The original `/Users/alexy/src/querygraph/publishing`
directory remains a useful snapshot, but new shared workflow changes should
land here first.

The imported comparison map lives at:

```text
publishing/QUERYGRAPH_WORKFLOWS.md
```

The imported workflow cards live under:

```text
publishing/skills/
```

The older environment-configured `build-book.sh` remains a compatibility path
for repositories not yet migrated. New and migrated library books use
`book.build.json` plus `build-library-book.sh`.

Book build, single formatter:

```sh
REPO_ROOT=/path/to/repo \
BOOK_ROOT=docs/book \
BOOK_MANUSCRIPT=docs/book/manuscript.md \
~/src/firstpair/publishing/scripts/build-book.sh
```

Book build, Typst plus groff/ms:

```sh
REPO_ROOT=/path/to/repo \
BOOK_ROOT=docs/book \
BOOK_MANUSCRIPT=docs/book/manuscript.md \
BOOK_FORMATS=typst,troff \
~/src/firstpair/publishing/scripts/build-book.sh
```

Book artifact contract check:

```sh
~/src/firstpair/publishing/scripts/check-version-marker.sh \
  /path/to/repo/docs/book/dist
```

Book delivery to iCloud Books:

```sh
~/src/firstpair/publishing/scripts/publish-versioned-artifacts.sh \
  /path/to/repo/docs/book/dist "$HOME/icloud/books"
```

Public library delivery, including staging, Blob upload, catalog sync, reader
routes, README generation, versioned iCloud copies, site verification,
production deployment, and a live catalog check:

```sh
cd ~/src/firstpair
npm run library:publish -- /path/to/repo/docs/book/dist --slug <book-stem>
```

Use `--dry-run` to inspect the resolved artifact paths without writing, and
`--stage-only` to refresh only `book-uploads/staging/<book-stem>/` plus
`book-uploads/book-package-sources.json`. Use `--no-deploy` when you want the
Blob upload and local catalog update without changing `firstpair.org`.

Blog textpack delivery:

```sh
REPO_ROOT=/path/to/repo \
BLOG_DOMAIN=querygraph.ai \
~/src/firstpair/publishing/scripts/publish-versioned-blog.sh \
  docs/blog/<slug> "$HOME/icloud/blogs"
```

The `VERSION.md` checker and delivery helper discover all formatter suffixes
from the manifest. They handle classic QueryGraph fields such as
`pdf_file_typst` and FirstPair fields such as `pdf_file_firstpair`,
`pdf_file_neatroff`, `pdf_file_groff`, and `pdf_file_utmac`.

## Usavenice Carryover

The active usavenice pipeline remains book-rooted rather than `docs/book`:

```text
/Users/alexy/src/venezia/usavenice/book/
```

Its current runbook establishes several rules this repo preserves:

- use Pandoc as the linker and build both Typst and troff variants;
- keep persistent Mermaid diagrams and generated `combined.md` inspectable;
- write `book/dist/VERSION.md` and use it for exact delivery filenames;
- copy stable bytes to versioned `~/icloud/books` names and verify with `cmp`;
- run visual QA through the repo's pinned Python environment when image
  tooling is involved;
- treat groff `ms` output as a compatibility path while Neatroff/utmac becomes
  the FirstPair-native classic path.

## Human-AI Pairing Rules

1. The human owns intent, taste, risk, and publication.
2. The AI may propose structure, generate mechanical conversions, check
   consistency, and explain uncertainty.
3. No hidden edits: every transformation must leave source, script, log, or
   manifest evidence.
4. Prefer small files with plain names over clever abstractions.
5. Keep final artifacts boringly reproducible.
6. If a renderer fails, preserve the exact generated source and error log.

This is the real First Pair: not an author replaced by a tool, and not a tool
pretending to be an author, but a pair that can inspect each other's work.

## Verification

Before calling a proof book done, run:

```sh
publishing/scripts/build-founding-docs.sh
publishing/scripts/check-version-marker.sh dist
proofs/kiffness-loop-lab/build.sh
publishing/scripts/check-version-marker.sh proofs/kiffness-loop-lab/dist
bash -n publishing/scripts/*.sh
python3 -m py_compile publishing/scripts/*.py
node --check publishing/scripts/render-mermaid.mjs
git diff --check
```

Useful artifact probes:

```sh
pdfinfo proofs/kiffness-loop-lab/dist/firstpair-loop-lab-typst.pdf
pdfinfo proofs/kiffness-loop-lab/dist/firstpair-loop-lab-firstpair.pdf
pdfinfo proofs/kiffness-loop-lab/dist/firstpair-loop-lab-neatroff.pdf
unzip -l proofs/kiffness-loop-lab/dist/firstpair-loop-lab-typst.epub | head
sed -n '1,120p' proofs/kiffness-loop-lab/dist/VERSION.md
```

Delivery to iCloud Books is intentionally not automatic in this first proof.
That should be added only after the artifact contract stabilizes.
