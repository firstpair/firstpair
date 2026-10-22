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

`publishing/vault/plugin/firstpair-reader/` (2.0) is the common runtime for
reading every FirstPair vault. It is local, inspectable, dependency-free, and
offline, and it supersedes the title readers that grew beside it (Cicero's
Bilingual Source Navigator, the Lighthouse Mobile Reader's reading half, the
Invented Translation Triptych's Reader, `rgbdns-reader`,
`sail-code-fragments`); `FEATURES.md` in the package maps every feature.

- `contract.js` reads one validated book model from every index format:
  `firstpair-reader.v2` (new builders), `parallel-reader.json`, 1.x page
  arrays, Cicero schema 1, `firstpair.reader.v1`, the mobile edition library
  (marker-delimited pages in Part notes), and code books. New builders should
  write v2: `{schema, title, lang, ui_lang, version, source_commit, launcher,
  contents, start_page, cover, parts[{id,title,note}], pages[{id,title,part,
  path|note, marker{start,end}, anchor, markdown, chapter}], aligned,
  dictionaries, words{selector,lang,notes}, fragments, quotes, metrics,
  editions[{id,title,version,family,index}]}`.
- One rail (Previous · [word] · Up · Back · Top · TOC · [word] · Next) at the
  bottom or top; Up and TOC stay inside the Reader; Back restores location,
  scroll, and focus; static notes open the Reader at their place.
- Dictionaries (sharded, bounded cache), aligned columns with phone tabs,
  source rails and the quote finder, fragment cards, metric chips.
- No network and no writes, unless the reader switches on the optional
  editing tools: span text and voice notes in the shared ledger, built on
  `shared/ledger-store.js` and `shared/voice-core.js`.

Opt-in QA against vaults on this machine:
`node publishing/tests/reader-real-vaults.mjs "<vault>" ...`.

## Editorial Triptych

`publishing/vault/plugin/firstpair-triptych/` is the shared editorial plugin
(id `firstpair-triptych`, formerly `lighthouse-triptych` in the Lighthouse
Republics repository). Unlike the read-only standard Reader it writes one
ledger, so it is a separate package rather than a fork of
`firstpair-reader`:

- a pinned Previous / Up / Back / Top / TOC / Next Reader over schema-4
  `_data/triptych-reader.json` and schema-3 fenced `triptych` pages, found in
  whichever top-level book folder holds `_data/triptych-reader.json`;
- whole-pane, sentence, and word choices, proposed edits with variants, and
  span notes (text and/or voice) recorded to
  `Preferences/triptych-decisions.json` (`firstpair.triptych-decisions.v4`)
  with a `.sha256` sidecar and an `EDITING-INSTRUCTIONS.md` digest;
- voice recordings saved and verified byte for byte under
  `Preferences/voice/` before the ledger names them, then transcribed by local
  `mlx_whisper` or an OpenAI-compatible endpoint without replacing the audio;
- a single-edition editing mode;
- visible UI in English, Italian, and Russian, chosen by the canonical
  edition's `lang` in `_data/editions.jsonl`.

Author `main-source.js` and `review-state.js`, then run
`python3 publishing/scripts/bundle-firstpair-triptych.py`; vaults install the
single-file `main.js` with `manifest.json`, `styles.css`, and `README.md`
(the local `package.json` only scopes CommonJS for tests). Book builders read
the package from `$FIRSTPAIR_ROOT` (default `~/src/firstpair`); in Lighthouse
Republics that is `scripts/obsidian_triptych_contract.py`, which also migrates
an installed `lighthouse-triptych` (moving its `data.json` and renaming it in
`community-plugins.json`). `review-state.js` is the shared editorial core; the
Lighthouse mobile reader embeds it, and the Invented Enemy translation
triptych still carries a diverged copy awaiting its own port.

### Ranked metrics

Metrics on the editorial rail are declared by the vault, not built into the
plugin. `<book>/_data/triptych-metrics.json` holds:

```json
{
  "schema": "firstpair.triptych-metrics.v1",
  "metrics": [
    {"key": "length_drift", "letter": "L", "better": "lower",
     "format": "percent", "warn": 35, "bad": 70, "rank": 1,
     "label": {"en": "Length drift", "ru": "...", "it": "..."},
     "description": {"en": "...", "ru": "...", "it": "..."}}
  ],
  "values": {"<page key>": {"<edition id>": {"length_drift": 82.4}}}
}
```

`better` is `lower` or `higher`; `format` is `integer`, `decimal1`,
`decimal2`, or `percent`; `warn` and `bad` are optional thresholds in the
`better` direction. The plugin shows one chip per metric on every pane
(single-edition pages included) in rank order, graded by the thresholds; the
reader may hide and reorder metrics in settings, and Review ranks pages by any
metric and edition, worst first. Values are numbers, never prose, so the file
does not duplicate the text, and fragment payloads are unchanged. The
Lighthouse bilingual builder writes built-in `length_drift`,
`sentence_length`, and `paragraph_split` and merges per-sentence provider
JSONL (`{"edition", "text_sha256", "metrics"}`) aggregated per page by `max`
(or `min` when higher is better) or `mean`; any title or tool can produce the
same file.

### Shared span editor (Triptych 3.3, Reader 2.1)

Span selection and display are one module, `shared/span-editor.js` with
`shared/span-editor.css`, used by FirstPair Triptych and by Reader 2's
optional editing. An improvement to editing is made there once and reaches
every reader at its next bundle. The module owns the word picker (checkboxes
on desktop; on touch devices whole words are tapped or dragged, with no
checkboxes and no **Only**), the colouring of saved spans (one of three
colours, different only where spans overlap, striped where a word lies in
several; notes with a recording use a separate voice palette), the chooser opened by tapping a word in more than one span, the
three-span overlap limit, and the saved-row list with **Change** and
**Remove**. The interval logic it relies on (`spanColors`, `overlapDepth`,
`MAX_SPAN_OVERLAP`) lives in `review-state.js`. A plugin's stylesheet is
generated: `styles-source.css` names shared sheets with
`@import "../shared/<name>.css";` and `bundle-obsidian-plugin.py` inlines
them into `styles.css`, so Obsidian still loads one file. Run the bundler
for both plugins after any change under `shared/` (`--check` fails on a stale
`main.js` or `styles.css`).

### Edition diffs (Triptych 3.4)

A vault comparing editions of one text in one language may ship precomputed
word diffs in `<book>/_data/triptych-diffs.json`
(`firstpair.edition-diffs.v1`). Nothing is diffed on a device. For every
page the builder stores each pair of editions and the whole set, as
`[start, end, kind]` ranges in code points of the pane text:

- `"A|B"` (editions in reading order): the earlier pane marks `del`, the
  later `ins`;
- `"A|B|C"`: each pane marks `uniq` (in no other edition) and
  `share:<edition>` (shared with exactly one other edition).

Pages where the editions agree carry no entry. The precompute is
`publishing/vault/edition_diffs.py` (stdlib only: `page_diffs`,
`diffs_file`); the reader side is `plugin/shared/diff-view.js` with
`shared/diff-view.css` (`parseDiffs`, `diffFor`, `paint`, `paintPane`), a
reader module like the span editor. A reader picks the entry for the panes
it shows: the pair when two show, the set when three do. It paints any
element that declares where its text starts with `data-fp-offset`, walking
text nodes only, so span-note marks underneath survive. FirstPair Triptych
shows a **Diff** chip when the file exists, with a legend for the current
mode; Reader 2 can take the same module for its aligned editions.

### Ported from the Invented translation triptych (3.1)

Phone edition tabs on the snap track (a tapped edition opens first on every
page), drag selection across word chips, Change/Remove on every saved row,
removal of Backlinks/Outgoing-links leaves whose core plugin is disabled, a
scoped Review panel that archives a decision file made on an earlier text to
`Preferences/archive/` and starts a new review, and an edited-copy export
(Review → Edited copy) that applies each preferred Edit to one edition and
writes Markdown and JSON to `Preferences/Exports/` without touching sources.

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

## Layered Vault Guides

Every generated product includes a complete first-use manual as both root
`README.md` and `Guide.md`. The source is assembled from four layers:

1. the canonical FirstPair Obsidian handbook in
   `publishing/vault/guides/master.md`;
2. exactly one product module: desktop, mobile, or preview;
3. exactly one profile module: code, history, or triptych;
4. an optional book-owned `guide.bookSpecific` Markdown fragment.

The complete generated guide quotes the common instructions rather than
requiring a new user to follow several links while setting up Obsidian. It also
links to the maintained web handbook at `/obsidian/` and to the hosted
Omnighost book for the separate Obsidian-to-Ghost publishing workflow.

Generate a reviewable guide without touching a vault:

```sh
~/src/firstpair/publishing/scripts/firstpair-vault guide \
  vault.build.json --product preview --output build/preview-vault-guide.md
```

Guide QA must verify installation, first-open, static Reader, optional plugin,
evidence navigation, personal notes, update safety, troubleshooting, the
selected product/profile sections, book-specific instructions, source revision,
and stable FirstPair links. A title's old guide remains published until the new
complete guide passes this content gate and human first-time-user review.
