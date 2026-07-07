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
  PUBLISH.md
  scripts/
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

Install or refresh that tree through FirstPair, not through individual book
projects:

```sh
~/src/firstpair/publishing/scripts/setup-neatroff.sh
```

The setup script clones or updates `~/src/neatroff_make`, runs `make init` when
needed, runs `make neat`, and exposes stable user-level wrappers under
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
uses Codeberg by default:

```sh
publishing/scripts/setup-utmac.sh
```

That script clones `utmac` into `.tools/utmac`, runs the utmac makefile to
generate `u-idx.tmac` and `u-ref.tmac`, and leaves the checkout untracked. It
does not vendor the macro source into this repo.

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

Use these scripts from FirstPair against a target repo by setting `REPO_ROOT`.
The scripts keep helper lookup local to FirstPair while reading manuscripts,
metadata, versions, and validators from the target repo.

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
