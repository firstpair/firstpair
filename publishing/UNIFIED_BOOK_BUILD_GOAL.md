# Unified Book Build Goal

Started: 2026-07-11
Status: active
Branch convention: `firstpair` in every participating Git repository

## Objective

Implement the unified First Pair book build contract, then migrate every source
repository currently delivering a title to the First Pair library. Each
repository must invoke the shared builder, produce a publish-complete artifact
directory, and pass build and artifact verification before work begins on the
next repository.

This is an implementation goal, not a public-release goal. Building full
editions is allowed when needed to verify the source pipeline. Publishing,
uploading, deploying, copying to iCloud, or replacing a public preview with a
full edition is out of scope. In particular, this goal must never invoke
`library:publish` without `--dry-run`, and must never bypass the `--full` safety
gate.

## Governing Documents

- [Unified Book Build Script Proposal](UNIFIED_BOOK_BUILD_SCRIPT_PROPOSAL.md)
- [Opus review](../OPUS_UNIFIED_PUBLISHING_REVIEW.md)
- [FirstPair publishing contract](PUBLISH.md)
- [FirstPair agent delivery rules](../AGENTS.md)

The proposal supplies the catalog inventory, architecture, dist contract, and
migration order. The Opus review tightens the definition of done: pinned tools,
one canonical configuration format, mandatory rendered-output verification,
automatic non-Git version stamps, and FirstPair publisher hardening before
source-repository migration.

## Fixed Decisions

1. Source repos retain ownership of manuscripts, metadata, editorial policy,
   preview cuts, diagrams, and source assembly.
2. FirstPair owns the shared build entrypoint, toolchain contract, artifact
   verification, and publishable-dist contract.
3. `book.build.json` is the canonical checked-in configuration format. Command
   line options may override it. Environment variables are compatibility inputs
   only and are not used in new wrappers.
4. Homebrew pins the native publishing tools, including Pandoc, Typst, Poppler,
   Ghostscript, Groff, Calibre, and supporting utilities.
5. Python is pinned by asdf and resolved through uv-managed project
   environments. Python book builders are wrapped, not rewritten.
6. Neatroff is built from source at a recorded commit. The shared setup script
   verifies or checks out that commit before building.
7. Pandoc with Typst is the standard PDF/EPUB/HTML path. Neatroff is the source
   build for troff/First Pair proof variants; Groff remains available where an
   existing book explicitly requires it.
8. Every PDF passes mandatory structural and rendered-layout checks. Every EPUB
   passes archive, metadata, and content checks. Single-file and chapter HTML
   outputs pass existence, link, and content checks.
9. A non-Git source tree receives a deterministic content-hash source stamp,
   never a manually supplied `nogit` placeholder.
10. Work proceeds sequentially. A source repository is not considered migrated
    until its branch, wrapper/config, build, shared verification, manifest check,
    and publisher dry-run all pass.

## Shared FirstPair Deliverables

- [x] Update the proposal to incorporate the accepted Opus review changes and
      these fixed toolchain decisions.
- [x] Add the pinned Homebrew/asdf/uv/neatroff toolchain manifest and bootstrap
      or verification script.
- [x] Add `publishing/scripts/build-library-book.sh` with JSON config and CLI
      overrides.
- [x] Consolidate or compatibility-wrap the existing shared book builders.
- [x] Add mandatory PDF, EPUB, HTML, and chapter-package verification.
- [x] Add fixture coverage for single-format, dual-format, and preview/full
      books.
- [x] Harden dist discovery for `book/` and `docs/books/<slug>/dist`.
- [x] Print resolved `edition` in publisher dry-run output.
- [x] Normalize legacy stable/versioned manifest aliases.
- [x] Honor `primary_format`/`public_format` for dual-format packages.
- [x] Fix suffixed PDF iteration in the marker checker and artifact publisher.
- [x] Document the shared invocation and migration contract in `PUBLISH.md`.
- [x] Run FirstPair syntax, fixture, unit, catalog, and production-build checks.

## Repository Migration Ledger

The order deliberately starts with the closest existing builds, establishes the
preview/full reference early, then handles custom Python and dual-format books.
APC40 follows once its authoritative local checkout is located.

| Order | Catalog slug | Source repository | Branch | Shared build | Verification | Status |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `typesec` | `/Users/alexy/src/typesec` | `firstpair` | passed | passed | complete (`888af9e`..`2045a92`) |
| 2 | `grust` | `/Users/alexy/src/grust` | `firstpair` | passed | passed | complete (`9fa4722`, `5493b69`) |
| 3 | `lakecat` | `/Users/alexy/src/lakecat` | `firstpair` | passed | passed | complete (`a07c773e`, `6108aa39`) |
| 4 | `invented-enemy` | `/Users/alexy/src/russophobia` | `firstpair` | passed | passed | complete (`7ec9e4d`) |
| 5 | `sail-rust-book` | `/Users/alexy/src/book-sources/sail-rust-book` | `firstpair` | passed | passed | complete (`08fda92`, `af0cffa`, `344e879`) |
| 6 | `zucchero` | `/Users/alexy/src/zucchero` | `firstpair` | passed | passed | complete (`42791a2`, `31e876d`) |
| 7 | `from-1-to-0` | `/Users/alexy/from-1-to-0` | `firstpair` | passed | passed | complete (`7d20d75`, `e669830`) |
| 8 | `rio-grande` | `/Users/alexy/src/book-sources/rio-grande-history` | `firstpair` | passed | passed | complete (`f8409f1`, `e3f2013`, `b46ca96`) |
| 9 | `omnighost` | `/Users/alexy/src/omnighost` | `firstpair` | pending | pending | pending |
| 10 | `lighthouse-republics` | `/Users/alexy/src/venezia/usavenice` | `firstpair` | pending | pending | pending |
| 11 | `apc40-mk2-ableton-start` | authoritative checkout to be resolved from `alexy/music` | `firstpair` | pending | pending | pending |

If the Sail book root is itself a nested Git repository, branch and record the
actual owning repository rather than assuming the parent path. If a named source
tree is not under Git, preserve it as a documented exception and use the
content-hash version fallback; do not initialize or publish a repository merely
to satisfy this ledger.

## Per-Repository Gate

For each source repository, in order:

1. Read its `AGENTS.md`, `PUBLISH.md`, current build wrapper, metadata, manifest,
   and dirty state.
2. Create or switch to the local `firstpair` branch without discarding existing
   work. If an unrelated dirty state overlaps required files, adapt to it and
   record the condition.
3. Add `book.build.json` and reduce the existing `build.sh` to source-owned hooks
   plus invocation of the FirstPair builder.
4. Build the requested safe/default edition. For preview/full repositories,
   build and verify both editions locally when feasible, but publish neither.
5. Run the shared output verifier and `check-version-marker.sh` against every
   publish-complete dist.
6. Run `library:publish --dry-run --no-build --no-smoke --no-deploy` and record
   the resolved `distDir`, `edition`, stable artifacts, and versioned names.
7. Run repo-local checks required by its guidance.
8. Update this ledger only after all applicable checks pass. Do not start the
   next repository while the current repository has an unexplained build or
   verification failure.

## Completion Criteria

This goal is complete only when:

- all shared FirstPair deliverables are implemented and tested;
- every currently cataloged source repository has either passed the migration
  gate or has a concrete, externally blocked exception documented here;
- all migrated repositories are left on their local `firstpair` branch;
- no public upload, deploy, iCloud delivery, or full-over-preview publication
  occurred; and
- the proposal, publishing documentation, and this ledger describe the final
  implementation rather than an intended future state.

## Execution Log

- 2026-07-11: Goal opened on FirstPair branch `firstpair`. Original proposal and
  Opus review accepted as governing inputs. User specified Homebrew for native
  tool pinning, asdf plus uv for Python, Pandoc plus Typst for standard output,
  and source-pinned Neatroff for troff output.
- 2026-07-11: Shared builder, exact toolchain lock, source-pinned Neatroff and
  utmac setup, asdf/uv Python helper environment, mandatory rendered-output
  verifier, publisher compatibility fixes, JSON schema, and all three real
  build fixture classes implemented. Fixture suite passes including `book/` and
  `docs/books/<slug>/dist` publisher resolution and visible dry-run editions.
- 2026-07-11: FirstPair JSON, shell, and Node syntax checks, `git diff --check`,
  `npm run test:book-build`, `npm run check:catalog`, and `npm run prod:build`
  passed. Homebrew formulae from the lock are pinned locally.
- 2026-07-11: TypeSec migrated on branch `firstpair`. Its 36-page PDF, repaired
  EPUB metadata, MOBI, single-file HTML, 20-page chapter reader, manifest,
  versioned links, shared verifier, and publisher dry-run (`edition: full`) all
  passed. Unrelated announcement post/textpack changes remain untouched.
- 2026-07-11: Shared output normalization now strips Pandoc-generated trailing
  HTML/CSS whitespace. Mermaid CLI 11.15.0 is npm-lock-pinned and preferred by
  source hooks. The manifest/link contract also preserves version-only Kindle
  EPUB aliases alongside hash-stamped delivery aliases.
- 2026-07-11: PDF geometry checks were refined after visual inspection of
  Grust's code-heavy pages 6, 7, and 26. Narrow median code lines are accepted
  only when the page still occupies the normal text measure; a synthetic
  60-line narrow-column PDF remains a required failing regression fixture.
- 2026-07-11: Grust migrated on branch `firstpair`. Its source-owned seven
  diagram/cover prebuild and EPUB/page-label hooks now run through the shared
  builder; asdf 3.14.5 plus uv lock `pypdf`. The 29-page PDF, EPUB, MOBI,
  single HTML, 16 chapter pages, manifest/links, visual checks, and publisher
  dry-run (`edition: full`) passed.
- 2026-07-11: LakeCat migrated on branch `firstpair`. Its source-owned eight
  diagram renderer and EPUB/PDF/artifact validators now run as shared hooks;
  automatic iCloud copying was removed from the build. The 56-page PDF, EPUB,
  MOBI, single HTML, 19 chapter pages, manifest/links, and publisher dry-run
  (`edition: full`) passed.
- 2026-07-11: Invented Enemy migrated on branch `firstpair`. Its source-owned
  asdf 3.12.3 plus uv assembly hook retains the preview ceiling and the Pandoc
  reader flags that prevent dash rules from becoming narrow tables. The
  11-page preview and 211-page full PDF, EPUB, HTML/chapter packages,
  manifests, links, and shared verifiers passed. Publisher dry-run from the
  repository root selected `book/dist-preview` with `edition: preview`; no
  full-publication flag or delivery action was used.
- 2026-07-11: Sail migrated on branch `firstpair`. The source-owned preparation
  hook stages twenty chapters, renders 76 SVG diagrams, adds stable chapter
  anchors, and rewrites source Markdown navigation for EPUB/HTML. Mandatory PDF
  geometry checks found two legacy-clipped right-edge sequence labels on pages
  34 and 215; the renderer now turns rightmost self-calls inward, and both
  pages were visually rechecked. The corrected 303-page PDF, EPUB, MOBI,
  single HTML, 20 chapter pages plus index, manifest/links, and parent-root
  publisher dry-run (`edition: full`) passed. Existing dirty legacy binaries
  and unrelated Sail code-book output remain untouched.
- 2026-07-11: Publisher discovery now prefers dist paths declared by the
  canonical `book.build.json`, covering nested book roots such as Sail's. The
  shared verifier now checks relative HTML/EPUB resources and rejects leaked
  source `.md` links. Both behaviors have regression fixtures, and the complete
  Typst/Neatroff/preview-full fixture matrix passes.
- 2026-07-11: Zucchero migrated on branch `firstpair` without modifying or
  staging its active caption/private-book work. A source-owned asdf 3.12.3 plus
  uv wrapper imports the existing Python manuscript generator with private
  lyrics forcibly disabled; FirstPair renders the public package. The 5-page
  bilingual PDF, EPUB, single HTML, chapter package, manifest/links, and
  publisher dry-run (`edition: full`) passed. SHA-256 manifests proved every
  ignored private artifact remained byte-identical, and private appendix
  markers were absent from all public formats.
- 2026-07-11: From 1 to 0 migrated on branch `firstpair` with preview as the
  default and separate publish-complete `book/dist-preview` and
  `book/dist-full` packages. Its source validator preserves the 2,684-word
  preview under the 2,865-word ceiling. Verification found that raw file
  concatenation violated Pandoc's blank-before-header rule and collapsed the
  full chapter reader; the assembler now inserts explicit chapter boundaries.
  The corrected 7-page preview and 59-page full PDFs, EPUBs, 7-page preview and
  11-page full HTML readers, manifests/links, and preview-safe publisher
  dry-run all passed. The unrelated `PROMPTS.md` change remains untouched.
- 2026-07-11: Rio Grande migrated on branch `firstpair`. Its asdf 3.12.3 plus
  uv/pypdf hook wraps the existing Python editor, regenerates the authoritative
  manuscript without tracked changes, and creates a source-owned 765-word
  preview (1.76 percent) with complete placeholder navigation. Custom
  Pandoc/Typst PDF hooks preserve the facsimile cover, coauthor page, A5 size,
  exact title/author metadata, and 26 full-edition bookmarks. The 13-page
  preview and 172-page full PDF, EPUB, full MOBI, HTML readers, manifests, and
  preview-safe dry-run passed. Legacy tracked PDF/EPUB/MOBI hashes remained
  byte-identical. FirstPair also gained `epub.includeRenderedCover: false` so
  an HTML cover can coexist with a canonical EPUB cover without a duplicate
  spine entry; the complete fixture matrix remains green.
