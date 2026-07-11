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
| 1 | `typesec` | `/Users/alexy/src/typesec` | `firstpair` | passed | passed | complete (`888af9e`, `41a31f5`) |
| 2 | `grust` | `/Users/alexy/src/grust` | `firstpair` | pending | pending | pending |
| 3 | `lakecat` | `/Users/alexy/src/lakecat` | `firstpair` | pending | pending | pending |
| 4 | `invented-enemy` | `/Users/alexy/src/russophobia` | non-Git source tree; record changes locally | pending | pending | pending |
| 5 | `sail-rust-book` | `/Users/alexy/src/book-sources/sail-rust-book` | `firstpair` | pending | pending | pending |
| 6 | `zucchero` | `/Users/alexy/src/zucchero` | `firstpair` | pending | pending | pending |
| 7 | `from-1-to-0` | `/Users/alexy/from-1-to-0` | `firstpair` | pending | pending | pending |
| 8 | `rio-grande` | `/Users/alexy/src/book-sources/rio-grande-history` | `firstpair` | pending | pending | pending |
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
