# FirstPair Vault Generalization Goal

Last updated: 2026-08-06

## Objective

Migrate every Obsidian vault published by FirstPair to a shared,
compatibility-first construction and delivery process. Preserve each current
public vault until a separately generated candidate is demonstrably as good or
better. The migration is complete only when every title passes its native
validator, FirstPair structural and privacy validation, differential QA,
profile-specific checks, guide QA, deterministic archive checks, desktop and
phone Reader review, and a publication dry run.

This document is the authoritative plan, status ledger, evidence index, and
handoff for the goal.

## Non-negotiable rules

- A title repository owns its manuscript, Reader order, evidence, rights,
  source revision, book-specific guide, and title assertions.
- FirstPair owns the typed projection model, shared Reader, layered guide,
  transactional builder, privacy rules, differential QA, archiver, and
  publication integration.
- Generate candidates beside or outside working vaults. Never overwrite a
  working or published vault as part of migration QA.
- Check that Obsidian is closed before any write-capable vault operation.
- Preserve existing plugins and advanced behavior until an equivalent shared
  contract has passed the title's native validator and visual review.
- Commit build descriptions before building. A candidate must bind to a clean,
  exact source revision.
- Preserve the old archive, digest, catalog metadata, and rollback route for at
  least one complete release after replacement.

## Published migration inventory

| Title | Profile | Public products | Authoritative repository | Current state |
| --- | --- | --- | --- | --- |
| Lighthouse Republics | history/triptych | preview desktop, mobile, guide | `~/src/venezia/usavenice` | adopted at `bd3b1c0`; both candidates pass all automated gates |
| Sail Rust Book | code | desktop, guide | `~/src/book-sources/sail-rust-book` | adopted at `732f4ab`; candidate passes all automated gates |
| From 1 to 0 | history/code archive | desktop, guide | `~/src/from-1-to-0` | adopted at `13366c7`; candidate passes all automated gates |
| Cicero on Himself | history/bilingual | full working, public preview, mobile, guide | `~/src/cicero` | adopted at `96d69a1`; all three clean-worktree candidates pass all automated gates |
| Verdun | history/code | desktop, mobile, guide | `~/src/verdun` | adopted at `bb8a3a9`; both candidates pass all automated gates |
| RGBDNS | code/history archive | desktop, guide | `~/src/rgbdns` | adopted at `b3825d5`; candidate passes all automated gates |
| Rosetta | triptych/editorial | desktop, mobile, guide | `~/src/review/invented` plus FirstPair book source | adopted at `fd59548`; both candidates pass all automated gates and branch is pushed to GitHub |

## Shared architecture work

The existing v1 model proves deterministic Reader pages, typed evidence,
desktop/mobile/preview projection, layered guides, the standard offline Reader,
transactional construction, and differential QA. Full migration additionally
requires reusable contracts for:

1. exact code excerpts mapped to immutable source ranges;
2. claims, sources, anthology passages, translations, and rights-aware files;
3. aligned triptych units, equality state, and editable review decisions;
4. images and derived media with provenance and product-specific variants;
5. title-owned plugin capabilities and staged migration to shared extensions;
6. release workspace seeds separated from private or volatile workspace state;
7. native-validator invocation and machine-readable result capture;
8. deterministic archive identity and rollback metadata;
9. compatibility projection from a native title build without flattening its
   richer semantics;
10. layered complete guides for profile, product, and title.

The intended dependency direction is:

```text
title sources + title contract
          |
          v
FirstPair typed canonical model
          |
          +--> desktop projection
          +--> mobile projection
          +--> preview projection
          |
          v
shared Reader + profile extensions + layered Guide
          |
          v
native validator + FirstPair validator + differential QA
          |
          v
candidate archive and publication dry run
```

## Execution order

1. Complete the shared contracts and migration-result format.
2. Adopt Sail Rust Book as the code-profile reference.
3. Adopt Cicero as the history, bilingual, and multi-product reference using a
   clean isolated worktree until its unrelated local edits are resolved.
4. Adopt Rosetta/Invented Enemy as the triptych and retained-review-state
   reference.
5. Adopt Lighthouse Republics, From 1 to 0, Verdun, and RGBDNS.
6. Run the complete cross-title gate and record human visual dispositions.
7. Prepare replacement manifests and publication dry runs. Publication or
   replacement remains a separate explicit approval.

## Acceptance matrix

Each product must record:

- source repository and exact commit;
- baseline directory/archive and SHA-256;
- candidate directory/archive and SHA-256;
- candidate manifest digest;
- native-validator command and result;
- FirstPair validation and differential comparison result;
- Reader, evidence, plugin, image, and profile semantic counts;
- all broken-link and unsafe-path dispositions;
- desktop and phone-width visual-review result;
- complete guide result;
- rebuild reproducibility result;
- publication dry-run result;
- rollback archive and catalog record.

## Status ledger

### Completed

- Implemented and tested the v1 typed framework, three profiles, three product
  projections, standard offline Reader, layered guide composition, safe
  transactional builder, inventory, and differential comparison.
- Published the comprehensive Obsidian handbook at
  <https://firstpair.org/obsidian/>.
- Added complete guide layers for desktop, mobile, preview, code, history, and
  triptych products with optional book-owned instructions.
- Fixed the publication route synchronizer so future releases preserve the
  handbook route (`0fdfde1`).
- Removed the impossible self-hash requirement from title-owned contracts:
  committed configurations may request `sourceCommit: "HEAD"`; the clean build
  resolves and records the exact 40-character revision in the guide and
  manifest. Exact external pins remain supported.
- Added a shell-free native-driver boundary for rich existing vault builders.
  FirstPair supplies a transactional candidate path and complete guide, invokes
  the title producer and validator as argument arrays, enforces shared privacy
  and link rules, and records a concrete FirstPair candidate manifest. This
  retains title semantics while centralizing construction policy.
- Ordered that boundary explicitly: a title validator certifies the untouched
  native artifact and its native manifest first; FirstPair then installs the
  complete standardized guide and applies its independent privacy, link, and
  packaging gates. This prevents shared guide files from invalidating a
  title-owned byte-count manifest.
- Centralized the deterministic first-open workspace in FirstPair. Native
  builders emit no device state; after native validation, the shared layer
  installs the same archive-validated Home workspace used by typed builds.
- For legacy native builders that still emit workspace aliases, FirstPair
  preserves them through native validation, removes the three volatile/private
  aliases at the composition boundary, and then installs the canonical seed.
- Generalized publication discovery for compact mobile Readers: a product may
  use the shared root manifest or a title-owned child mobile manifest, paired
  with a mobile library, reader index, or unit ledger. The title's validator
  still supplies the semantic proof before any archive is staged.
- Added a composed-candidate seal verifier for publication. Native validation
  proves the untouched title artifact; the final FirstPair manifest then binds
  every post-composition file, byte total, source revision, product, and native
  validator command. Publication verifies that seal instead of incorrectly
  rerunning a title byte-count validator after shared files were added.
- Added a closed-Obsidian visual fallback gate. It renders each candidate's
  actual Home and complete Guide at 1440-pixel desktop and 390-pixel phone
  widths, captures full-page evidence, and rejects missing entry navigation,
  missing heading structure, or horizontal overflow. Native plugin suites
  remain responsible for title-specific interactive surfaces.
- Captured baseline QA contracts for Sail; Cicero desktop, mobile, and preview;
  and Invented Enemy desktop and mobile under
  `~/src/books-local-backups/firstpair-vault-candidates/qa-2026-08-06/`.
- Verified Sail's existing vault: 21 chapters, 2,027 code files, and 20,201
  mapped fragments.
- Verified Cicero full and preview from a clean worktree at `b215f47`; verified
  the mobile working vault with the live-workspace allowance.
- Built a non-replacing clean Invented Enemy candidate. Its native desktop and
  mobile validator passes. Differential QA preserves 27 Reader pages and 2,658
  triptych documents, introduces no link regression, and removes both unsafe
  workspace paths from each product.
- Landed committed title-owned contracts for all seven published vault titles
  and generated twelve non-replacing products from exact clean revisions.
- Passed native semantic validation, composed-manifest sealing, shared privacy
  and critical-link validation, baseline differential comparison, complete
  guide composition, deterministic double-archive comparison, ZIP integrity,
  and desktop/phone fallback visual QA for every product.
- Passed publication dry-run routing for Lighthouse preview/mobile, Cicero
  preview/mobile, Sail, From 1 to 0, RGBDNS, and Verdun desktop/mobile. Rosetta
  remains explicitly private editorial tooling and is not routed into the
  public publisher.

### Candidate evidence

Every hash below is the SHA-256 of two independently produced, byte-identical
archives. ZIP integrity and the four-view visual report pass. Visual reports
and screenshots are under
`~/src/books-local-backups/firstpair-vault-candidates/visual-qa-2026-08-06/`.

| Product | Source revision | Archive SHA-256 |
| --- | --- | --- |
| Sail desktop | `732f4ab` | `57f6eb6cb2b23d81a2465893397ae734850b336efd6efd005e840efcb66782dc` |
| Lighthouse preview | `bd3b1c0` | `d7653b580ee861e6cd8df65e97c957bfc11b64bf11fd88173d740fa03bafb88e` |
| Lighthouse mobile | `bd3b1c0` | `285ed1cb64f63efe01f8973eff3fafeb6b0698df44c643ba61a1b0152425c48c` |
| From 1 to 0 desktop | `13366c7` | `0c84a37126783242779fe9c7c5fb5df7bd732e5a9b03adbf91452bbee26f9de7` |
| RGBDNS desktop | `b3825d5` | `6e37116c5ab558187417becd81d863ee87ff1fb5d917092c5aee0de67952439e` |
| Rosetta desktop | `fd59548` | `a0404a1f7a926445179f7f431260fb0a55f5bfc388893a502a226eb752844958` |
| Rosetta mobile | `fd59548` | `d24cba06853fbd90ea10455fe40e9633b720f72c548b6aab2430b2cf3df02f0a` |
| Cicero desktop | `319e9b4` | `dd9693f529cee315fb4e1c356d3b4823abd4e8bf7cc819ad1fbcdae263f67a2d` |
| Cicero mobile | `319e9b4` | `b4c81f52a3a84ec2827eefa45ca2271d1f7f00ecb38b3dc722ff5693ae0389d8` |
| Cicero preview | `319e9b4` | `6b386de2eda49d438e21fcd0de051e19fbeb0e047501273735346bb3e8cffa34` |
| Verdun desktop | `bb8a3a9` | `365c2980711038b0fdefa551e776971baabd7e3d181050c4b10b9eab15301c11` |
| Verdun mobile | `bb8a3a9` | `d12340572e4297a9a91ab7520a94c30c0dbca69a2e06c2681855f2563462c750` |

### Reference outcomes

- Sail's committed adoption contract and tab-normalizing source projection are
  landed through `732f4ab`. Its desktop candidate passes the native validator
  and FirstPair differential QA: 21 Reader pages and three plugin files are
  preserved, code files increase from 2,027 to 2,301, generated fragments reach
  21,475, and unsafe paths remain zero. Two independent archives are
  byte-identical at
  `57f6eb6cb2b23d81a2465893397ae734850b336efd6efd005e840efcb66782dc`.
- Shared link inventory now excludes fenced and inline code from link parsing,
  preventing Cargo, Rust, Python, and documentation syntax from being counted
  as broken Obsidian navigation while retaining all real Markdown links.
- Shared link resolution now follows CommonMark angle-quoted and percent-
  encoded destinations, including asset paths containing spaces.
- Lighthouse now has a committed preview/mobile adoption contract at
  `e1e8bd7`. Its non-replacing preview candidate passes the native and
  differential gates, preserving 88 Reader pages, 24 source documents, and
  four plugin files with no unsafe paths or broken-link regression.

### Preserved state and publication boundary

- Cicero's bibliographic workflow changes are committed at `319e9b4`. All
  three current candidates were built directly from the active, clean Cicero
  repository; the temporary isolated-worktree accommodation is no longer
  needed. The shared vault launcher runs under zsh as of FirstPair `bbf9333`.
- Verdun's generated and temporary trees were preserved and classified through
  ignore rules; none was deleted or committed.
- The public catalog entry named Rosetta currently points to a Lighthouse
  Republics Preview Vault archive rather than the Invented Enemy Rosetta. This
  pre-existing alias defect is recorded, not silently replaced.
- No existing public vault, catalog URL, Blob object, iCloud delivery, or
  working-vault state was replaced. Candidate acceptance authorizes a future
  controlled publication decision; it does not itself authorize publication.

## Definition of done

The migration-build goal is complete: every row in the published migration inventory has a
committed title-owned contract, all declared products have non-replacing
candidates, every automated acceptance field is green or explicitly
dispositioned, migration commits are synchronized, FirstPair's complete suite
passes, and replacement-ready archives with rollback baselines are retained.
No public vault is replaced merely by completing this goal; replacement and
publication require the separate approval defined by the FirstPair workflow.
