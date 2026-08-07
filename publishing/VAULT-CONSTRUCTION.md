# Generalized Obsidian Vault Construction

## Status

FirstPair now owns a compatibility-first vault framework under
`publishing/vault/`. It does not replace any working title-owned builder or
published vault. Migration is complete only when a generated candidate passes
the shared differential gate, the profile gate, the title's existing validator,
and human Reader review.

## Product Matrix

Profile and product are independent axes:

| Profile | Desktop | Mobile | Preview |
| --- | --- | --- | --- |
| Code | complete approved source snapshot and excerpt links | Reader plus referenced code closure | preview Reader plus public code closure |
| History | complete permitted evidence graph and anthology | Reader plus cited source and compact visual closure | preview Reader plus disclosed evidence closure |
| Triptych | aligned witnesses, editorials, annotations, and review state | stacked aligned passages and cited editorial closure | responsive disclosed triptych; same package on desktop and mobile |

Preview is one responsive product. It is never produced by deleting files from
a full vault. Every product is projected directly from canonical Reader and
evidence inputs.

## Ownership

Book repositories own:

- manuscript and Reader order;
- evidence records and exact mappings;
- rights and disclosure decisions;
- source revision;
- title-specific assertions and review exceptions.

FirstPair owns:

- schemas and canonical model;
- deterministic projection and hashing;
- process and workspace safety;
- the standard offline Reader plugin;
- shared structural, link, privacy, and product validation;
- differential comparison, archival transformation, and delivery.

## Configuration

Each adopting source repository adds `vault.build.json`. Its evidence records
lower code ranges, historical passages, and aligned triptych rows into a single
typed-target shape. Product selection then determines the closure included in
desktop, mobile, or preview output.

Use `publishing/vault/schema/vault.build.schema.json` as the contract. Run a
read-only plan before generation:

```sh
~/src/firstpair/publishing/scripts/firstpair-vault \
  plan vault.build.json --product all
```

Generation is transactional, refuses to overwrite an existing vault, rejects
path traversal and symlinked inputs, enforces rights metadata and product
ceilings, installs the standard plugin disabled by default, and writes
`VAULT-MANIFEST.json`. It also refuses while Obsidian is running.

## Standard Reader

`publishing/vault/plugin/firstpair-reader/` is the common runtime. It is local,
inspectable, dependency-free, and offline. Its first stable contract includes:

- data-driven Reader order;
- the shared Previous / Up / Back / Top / TOC / Next rail;
- bounded Reader-local Back history;
- desktop and phone-width layout;
- a complete static Markdown fallback;
- no vault create/modify subscriptions and no network access.

Profile capabilities are declared in the vault manifest and indexes. Future
code-range, quotation-rail, anthology, bilingual, annotation, and triptych UI
must extend this package through versioned data contracts or a documented
extension interface. A title must not fork the core Reader to change labels,
colors, target data, or layout preferences.

## Differential QA

Capture the working vault before generating a candidate:

```sh
~/src/firstpair/publishing/scripts/firstpair-vault \
  snapshot --baseline '/path/to/working vault' > vault.qa.json
```

Review the generated contract and add title-specific `requiredPaths`,
`requiredGlobs`, and `reviewPaths`. Do not blindly use raw byte or file counts
as quality measures: deduplication and better indexes can legitimately make a
candidate smaller. Prefer semantic minimums for Reader pages, code files,
sources, triptych rows, evidence targets, images, and plugin payload.

Compare without modifying either tree:

```sh
~/src/firstpair/publishing/scripts/firstpair-vault compare \
  --baseline '/path/to/working vault' \
  --candidate '/path/to/candidate vault' \
  --contract vault.qa.json
```

The shared gate fails on:

- missing Home or required title surfaces;
- unresolved local Reader/evidence links;
- traversal, symlinks, Git metadata, personal workspace files, or `.DS_Store`;
- semantic coverage below the reviewed baseline contract;
- Reader or evidence counts below a compatible baseline manifest;
- missing required paths or globs;
- product file or byte ceilings;
- invalid standard plugin package or workspace seed.

Changed `reviewPaths` become explicit human-review warnings. A comparison pass
is necessary but not sufficient: retain the old vault until the existing
source validator, new profile validator, static Reader review, plugin tests,
desktop visual review, phone-width visual review, archive verification, and
publication dry run also pass.

## Replacement Gate

A candidate may replace a working vault only when all of these are recorded:

1. exact baseline path, version, source commit, and archive hash;
2. exact candidate path, version, source commit, manifest digest, and archive hash;
3. zero shared hard regressions;
4. zero profile-validator failures;
5. the existing title validator passes against the candidate or its assertions
   are explicitly ported and equivalently tested;
6. every comparison warning has a reviewer disposition;
7. Reader, source navigation, code/source/triptych interaction, first-open,
   desktop, and mobile/preview visual checks pass;
8. rollback retains the previous archive and catalog metadata;
9. replacement is explicitly approved as a separate publication action.

During migration, generate candidates under a distinct `*-candidate` output.
Never point `library:publish`, Obsidian Sync, or the public catalog at a
candidate merely because it built successfully.

## Migration Order

1. Sail Rust Book proves code snapshots and excerpt-to-source mappings.
2. Cicero or Lighthouse proves claims, sources, anthology links, and rights.
3. Rosetta proves synchronized triptychs and annotation state.
4. After all three profiles pass, integrate declared vault products into
   `book.build.json` and `library:publish` while retaining compatibility flags.

Old builders remain available as independent baseline producers for at least
one complete release cycle after a title migrates.
