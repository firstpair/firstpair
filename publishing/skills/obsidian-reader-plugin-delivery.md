# Skill: Obsidian Reader, Setup, and Plugin Delivery

New and migrated books use the standard package at
`publishing/vault/plugin/firstpair-reader/`. Title-specific behavior should be
expressed through versioned indexes, manifest capabilities, styles, or a
documented extension contract. Do not fork the core Reader for ordinary labels,
colors, source maps, code maps, or target data. Existing plugins remain the
baseline until the candidate passes `publishing/VAULT-CONSTRUCTION.md`.

Use when designing, installing, validating, or updating the optional Obsidian
Reader for a full, preview, or mobile First Pair vault.

The Reader is a chapter-scale presentation layer driven by generated local
data. It must remain coupled to a complete static Markdown fallback. The plugin
is an enhancement, not permission to make the book, navigation, or sources
unreadable in Restricted mode.

## Reader Contract

1. Generate one ordered Reader index from canonical manuscript structure. Bind
   it to one schema version, edition, book version, and source commit. Store
   extensionless vault-relative launcher, contents, Part, and page-note paths;
   explicit page IDs; contiguous one-based order; Part ownership; and complete
   page Markdown.
2. Reject unsupported schemas, absolute or escaping paths, duplicate IDs or
   notes, non-contiguous order, missing Parts, incorrect Part titles, duplicate
   unit ownership, and disagreement between Part and page order. Never derive
   reading order from backlinks, filenames, or the graph.
3. Make **Open the Reader** the first prominent link on root `Home.md`. Let the
   plugin recognize the launcher, contents, Part, and Reader-page notes and
   replace their ordinary Markdown leaf with one dedicated ItemView.
4. Restore the canonical cover before the opening Reader page. Use the source
   PNG in full or preview vaults and the hash-bound compact derivative in the
   mobile vault.
5. Render exactly one navigation rail, bottom by default. A plugin setting may
   move that same rail to the top; do not render duplicate plugin rails.
6. Use this edge-to-edge control order:

   ```text
   Previous page | Previous word | Up | Back | Top | TOC | Next word | Next page
   ```

   Page controls traverse bounded canonical order, name the destination, and
   own the flexible outside tracks. The double-chevron word controls sit
   immediately inside them, step through source-language words on the current
   page, visibly mark and scroll the selected word, and open its local
   dictionary entry. They never change pages. Up opens the containing Part, or
   contents from a Part. Back restores the prior Reader position after
   footnote, Top, TOC, Up, Previous-page, and Next-page jumps. Top returns to
   the true page start. TOC opens grouped contents and marks the current page.
7. Keep first and last boundaries explicit, not circular. Use native buttons,
   accessible labels, visible keyboard focus, fixed dimensions, and clear
   disabled states. Add command-palette actions for opening the Reader,
   Previous, Next, Back, and Contents.
8. Treat Back as bounded internal Reader continuation history, not an exit to
   the Markdown note open before the Reader. Before every jump, capture mode,
   page or Part identity, scroll offset, and the exact ordinary-footnote
   reference when applicable. Store stable serializable locators rather than DOM
   elements, because a page or Part render invalidates old nodes. Restore
   snapshots last-in-first-out, including repeated Back actions, without pushing
   a new snapshot during restoration. Keep the stack bounded, clear it when a
   new external Reader launch or index identity starts a session, and disable
   Back only while the stack is empty. Back is plugin-only because static
   Markdown has no runtime position history.
9. Use Obsidian's `setIcon` and Lucide names for visibility-critical controls.
   The Back control uses a fixed-size `rotate-ccw` icon that stays recognizable
   while disabled; do not depend on a Unicode circular arrow or inherited font.
10. Make the reading column scroll independently. At phone widths, Previous
    page and Next page use flexible outside tracks with one ellipsized
    destination line; Previous word and Next word are compact double-chevron
    controls nested immediately inside them; Up, Back, Top, and TOC are compact
    icon-only controls; Next page remains at the far right; page-progress text
    is hidden; and tables and images scroll or scale inside the column without
    widening the viewport.
11. Keep static launcher, contents, Part, and page notes as a complete fallback.
    Place Previous, Next, Up, Top, and TOC links above and below static page
    text because Markdown cannot read the plugin's top-or-bottom setting.
12. Normalize renderer-only source syntax in the derived Reader without
    changing canonical manuscript bytes. In particular, strip trailing Pandoc
    heading attributes such as `{.unnumbered}` and
    `{.unnumbered .unlisted}` from both static Reader notes and page Markdown
    embedded in the Reader index; Obsidian otherwise displays them literally.
    Do the same for source-specific IDs such as `{#anthology-a03}`. Preserve
    braces that are ordinary prose rather than recognized heading attributes.

## Source Navigation Contract

1. Generate a local, versioned quote index with exact note and block targets,
   Latin, English, reviewed aliases, citation, witness locators, editions,
   translators or editors, separate rights, hashes, contributing divisions,
   and pairing cardinality.
2. Reject malformed blocks, traversal, absolute paths, duplicate IDs,
   unsupported schemas, missing text, and targets absent from the local vault.
   Keep unresolved gap records outside runtime matching.
3. Turn reviewed standalone quotations into colored source rails. Clicking the
   rail, quotation, or adjacent citation marker opens the exact bilingual
   block. Make reviewed quotations embedded in prose visible inline links.
4. Do not classify every numbered citation as a bilingual source marker. For
   every ordinary footnote left after reviewed source decoration, resolve its
   local hash target inside the custom Reader, scroll that target into the
   Reader's own viewport, focus it, and mark it visibly. Browser-native page
   hash behavior is not sufficient when the ItemView owns an independent
   scroll container.
5. Preserve the same exact quotation links in static Markdown. Runtime fuzzy
   matching is an explicit selection or cursor command, not a substitute for
   reviewed provenance.
6. Normalize punctuation, quantity marks, common Latin `i/j` and `u/v`
   differences, and ligatures only for matching. Strong unique matches may open
   directly; close matches should open a chooser showing both languages, work,
   citation, and confidence. Never make a network search when local evidence is
   absent.
7. Compose witness bibliography from structured title, edition, editor,
   translator, publisher, and date fields. Before appending an editor or
   translator credit, detect whether the title already contains that same role
   and contributor. Reject repeated semicolon segments and repeated contributor
   credits in the canonical corpus, generated JSON indexes, full notes, and
   compact mobile notes; do not repair only the visible Markdown.
8. For a source anthology, translate canonical Pandoc IDs to the visible
   Obsidian heading before emitting a citation. The generated source note must
   omit the `{#...}` text, and a citation must use the exact heading target;
   opening the top of a long anthology is not successful navigation.
9. When a Reader follows an anthology citation, do not let native hash handling
   mark the whole destination section. Open the source note without the hash,
   wait for preview rendering, locate the matching heading with a bounded
   retry, scroll it into view, and apply the Reader's highlight class to that
   heading only. Offer this as the default **Highlight only the linked
   anthology title** setting, alongside an independent **Open source anthology
   in a new tab** setting. Preserve both preferences in plugin `data.json`.

## Aligned Editions

An aligned (triptych) vault carries `_data/parallel-reader.json`
(`firstpair-parallel-reader-v1`): the source language with its `position`,
the translations in display order with `defaultVisible`, one dictionary path
per translation, and the ordered pages, each a
`firstpair-aligned-chapter-v1` JSON of units with `source` lines and
`translations` keyed by language id. The plugin renders the source column
first and the enabled translations after it.

1. Two layouts, chosen per device: `columns` (side by side; on a phone, a
   horizontally swiped strip, one language per screen) and `stacked` (the
   source stanza flush left, each translation under it, indented, labelled
   only when more than one translation is on). The toolbar button cycles
   `auto → columns → stacked`; `auto` stacks when the Reader pane is narrower
   than 700 px or a mobile device reports portrait orientation, and re-applies
   on rotation and resize without re-rendering. Persist the choice in plugin
   `data.json`, and expose it with the other options in a `PluginSettingTab`
   (Settings → FirstPair Reader): `layout`, and `reserveDrawerColumn` (default
   on) which keeps the grid at the full track count when a translation is
   switched off so the drawer opens over the empty track rather than a
   visible column; `keepDrawerOpen` (a standing dictionary column that keeps
   the last entry across page turns, no Close button); `dictionaryLanguages`
   (`shown`: only the translations on screen; `all`: every language, shown
   ones first). The drawer is placed by measurement from the strip grid — the
   reserved track or the last visible column in column layout, a right-hand
   panel in stacked layout — never from the viewport edge, so it is exact in
   any pane. Never leave a blank view: an error while opening is shown
   with a Retry button. Test the plugin in jsdom against a mocked `obsidian`
   module (`publishing/tests/obsidian-mock.cjs`,
   `test-firstpair-reader-dom.mjs`): open, render, tap a word, switch layout,
   follow Home links, half-synced vault, resume. The Reader persists its
   state per edition title in `settings.state` (page id, scroll offset,
   enabled languages, columns, open dictionary word), saved on every page
   turn, toggle, lookup, scroll (debounced), and on close, and restored in
   `onOpen`; `resume` in settings turns it off. The Emacs reader does the
   same in `firstpair-reader-state-file` keyed by the bundle's true
   directory, with saves suppressed while `firstpair-read` opens the Top
   nodes so setup never overwrites the remembered place.
2. The dictionary drawer, in column layout, is sized to the last column
   (never narrower than 15 rem nor wider than 90 vw) so the other columns stay
   readable; in stacked layout it is `min(30rem, 90vw)`.
3. Dictionaries are `firstpair-reader-dictionary-v1` (one file, `entries`
   keyed by folded form) or `firstpair-reader-dictionary-index-v1`: an
   `index.json` with `shards` keyed by headword prefix and `prefixLength`,
   written by `firstpair_emacs.dictionaries.write_sharded` so no file exceeds
   4 MB — Obsidian Sync's per-file ceiling on the standard plan, and a size a
   phone parses on first tap. The plugin resolves a word by its longest
   prefix present in `shards`, then shorter ones. A missing dictionary file is
   reported in the drawer as not yet synced, never as an empty drawer.
4. Reader links in ordinary notes: `[Open the Reader](firstpair:reader)` and
   `[Canto 1](firstpair:page:<page-id>)` are bound by the Markdown
   post-processor, so `Home.md`'s table of contents opens pages directly in
   reading view. `obsidian://firstpair-reader?page=<id>` does the same from
   outside the vault. Both are in addition to the ribbon icon and command.
5. Several translations of one language: `translations[]` entries carry
   `lang`, `title` (translator and date), `alignment` (`line`,
   `proportional`, or `prose` — only `line` asserts the same verses on a
   row; the others are shown with ≈), `coverage` (the `part` values the
   translation covers), and `default`; `languages[]` lists the languages in
   column order. The plugin keeps one column per enabled language, its
   header naming the translation and rotating through the language's
   translations that cover the current page on click; **+** adds a second
   column of the same language, **−** removes it; the choice is remembered
   per edition title in `settings.choices`. Dictionaries stay keyed by
   language. The Emacs builder reads the same index through
   `emacs.aligned.index`, renders every translation as a region, ships
   `data/translations.json`, and rotates with `C-c C-v` / `C-c C-b`.
6. The source-owned validator must check the index schema, every shard's size,
   and the total entry count, and a public edition must refuse any language it
   does not license (Dante's rejects Cyrillic in a public chapter).

## Bibliographic Integrity Gate

1. Preserve the source title as display text, but compare contributor identity
   through a separate normalized key. Ignore case, spacing, punctuation,
   diacritics, and a trailing `et al.` for identity matching so a title credit
   such as `chiefly translated by C. D. Yonge` is not followed by a second
   structured credit for `C. D. Yonge et al.`. Do not rewrite the displayed
   title or erase a genuinely different editor or translator.
2. Make the bibliography composer fail closed when its completed description
   contains an exact repeated semicolon segment or repeats the same role and
   contributor. Apply that invariant to automatic alignments, curated
   replacements, unresolved clusters, plugin-index rows, and rendered notes.
3. Test both the known embedded-credit case and a deliberately malformed
   repeated-credit fixture. Then generate the entire bilingual publication in
   memory and report its work, passage, gap, and note counts with zero findings.
4. After changing composition, close Obsidian and rebuild every retained full,
   preview, mobile, or candidate vault tree. A source test cannot prove that an
   older generated tree or connected Sync product is clean.
5. Scan the actual generated `.md`, `.json`, and `.jsonl` files. Parse edition
   fields structurally and also run a literal adjacent-credit search so the
   audit covers canonical rows, plugin payloads, full source notes, and compact
   mobile notes. Report files and bibliography values checked, not only a
   passing exit code.
6. Reopen the connected vault, wait for indexing and **Fully synced**, and
   inspect the exact source note and edition line that exposed the defect. The
   visible credit must occur once after Sync; a clean local build alone is not
   deployment evidence.

Validated Cicero example: five retained vault trees, 5,893 Markdown or JSON
files, and 147,383 bibliography values scanned with zero repetitions, followed
by a live Winstedt source-note check after **Fully synced**. Preserve this
method, not those title-specific counts.

## Plugin Package And Performance

1. Publish an inspectable local package containing exactly:

   ```text
   manifest.json
   main.js
   styles.css
   README.md
   ```

2. Build `main.js` as a dependency-free, self-contained module unless a source
   repository has another verified Obsidian bundling contract. Do not ship
   sibling development modules, tests, package metadata, or build scripts as
   runtime dependencies.
3. Make no network requests and collect no telemetry. Read only generated local
   Reader and quote indexes and local Markdown source notes.
4. Do not subscribe to vault create or modify events merely to keep the Reader
   current. On `file-open`, return before loading Reader data unless the path
   belongs to the Reader surface. Ordinary notes do not enter Back history;
   internal Reader actions capture continuation snapshots immediately before
   their jumps. Load and normalize indexes once and cache them until the
   configured path changes.
5. Provide settings for Reader rail position, quote-index path, minimum fuzzy
   confidence, title-only anthology highlighting, and opening a source in the
   same leaf or a new tab. Preserve the Reader's `data.json` across generated-
   vault refreshes.
6. Install the package under `.obsidian/plugins/<plugin-id>/`, but leave the
   distributed `community-plugins.json` empty. Readers inspect and enable the
   plugin deliberately; core-only reading works immediately.

## First Open And Sync Setup

1. Seed root `Home.md` as the only first-open text. On desktop, select File
   Explorer first and retain Search and Bookmarks plus a collapsed Home outline.
   On mobile, let Obsidian construct native drawers from the same Home leaf.
2. Keep `.obsidian/workspace-first-open.json` deterministic and source-owned.
   Preserve local workspace aliases during normal closed-vault rebuilds; use an
   explicit reset mode only to replace stale volatile aliases.
3. For mobile Sync, enable images, all other file types, active community-plugin
   list, and installed community-plugin list on every device — **starting with
   the originating Mac vault**, where Obsidian creates every selective-sync and
   vault-configuration toggle off when a vault is first connected or re-linked.
   JSON indexes, WebP images, dictionary shards, plugin installation, and
   plugin activation are separate Sync planes. A Markdown-only file count can
   represent a completed selective pass. These controls are device-specific,
   and **Fully synced** covers only enabled categories. Recheck every required
   control on both devices after restart, and first of all whenever a sync
   problem is reported: an unset toggle is the usual cause.
4. Keep community plugins disabled through first Sync. Enable the Reader only
   after content, images, JSON indexes, plugin files, and configuration reach
   the device and the vault is responsive.
5. Treat live Obsidian as the final handoff check: correct local vault and
   remote, active or completed Sync, opening Reader page and cover, expected
   controls, source navigation, and actual phone behavior.

## Build And Test

For a source plugin with generated `main.js`, the minimum checks are:

```sh
node build-main.js --check
node --test test/*.test.js
node --check main.js
```

Also run the source-owned full, preview, and mobile vault validators. Exercise
the Reader at desktop and phone widths, including first and last pages, a page
beginning with an image, all enabled and disabled controls, empty and populated
Back history, top and bottom rail settings, source rails, inline source links,
long titles, wide tables, illustrations, and pixel-level icon visibility. A DOM
node or passing click test is not proof that an icon is visible; use a
screenshot or pixel check for visibility regressions.

Reader tests should include a heading with multiple Pandoc classes, a normal
heading with prose braces that must survive, and a generated-vault scan proving
that no renderer-only heading attribute remains in either Markdown or the
Reader JSON index. They should also render one reviewed bilingual citation and
one ordinary footnote in the same page, click both, and prove that the first
opens the source navigator while the second scrolls, focuses, and visibly marks
its local note target at phone width. Then verify Back restores the exact
footnote marker and prior positions after Top, TOC, Up, Previous, and Next.
Exercise repeated LIFO returns, the history bound, cross-page rerenders, and the
invariant that Back restoration does not create another history entry.

For anthology navigation, include at least one non-initial entry such as A3.
Assert that the generated note has no visible `{#anthology-...}` text, the
citation targets the exact visible heading, title-only mode highlights that
heading without highlighting the surrounding source block, and new-tab mode
leaves the originating Reader page intact. Test both settings after a full
plugin reload on iOS.

Serve visual fixtures from the plugin root, not from a nested test directory,
so relative assets such as `../styles.css` resolve exactly as they do in the
vault. Before accepting a phone screenshot or pixel check, require successful
responses for the stylesheet, fonts, icons, and images and reject any visual QA
run with asset 404s. An unstyled fixture is not Reader evidence.

Use the strict validator before first opening the generated vault. After live
Obsidian has evolved its workspace, use a separately named live mode that
relaxes only volatile workspace aliases and their aggregate-byte effect. Never
weaken Reader, source, plugin, image, link, count, size-limit, or individual-hash
checks merely to make a live vault pass.

## Delivering An Update

1. Make the plugin change in its source repository. Bump the plugin version for
   every delivered behavior or interface change, and bind the built `main.js`
   and `styles.css` hashes plus plugin version in each vault manifest.
2. For a full generated-vault rebuild, close Obsidian and use the full or mobile
   vault workflow. Reopen only after the generated and local vaults validate.
3. For a plugin-only update to an existing Sync remote, first open the local
   vault and wait for Sync to become active. Then run only a source-owned narrow
   refresh command designed for watched delivery.
4. The narrow refresh may replace only an allowlisted plugin package
   (`main.js`, `styles.css`, `manifest.json`, and optional plugin `README.md`)
   and update the product manifest. It must preserve `data.json`, plugin
   consent, core-plugin state, Reader text, sources, illustrations, and
   workspace.
5. Inspect both Sync evidence planes. Use ordinary activity for Reader JSON,
   Markdown, and images. Use **Settings -> Sync -> Settings version history**
   for `.obsidian` configuration: inspect the remote `manifest.json`, copy the
   remote `main.js`, and compare its SHA-256 with the product manifest. A
   **Fully synced** label or matching version string alone does not prove that
   the new runtime won the conflict.
6. Quit Obsidian completely, relaunch the vault, and compare installed version
   and hashes with the source manifest. Closing a window is not a full quit. If
   the old runtime returns, inspect whether Sync downloaded stale remote bytes
   over the local build, wait until the watcher and every required configuration
   category are active, then repeat the watched narrow refresh. Recheck the
   remote runtime hash and perform another full quit/relaunch; do not declare a
   conflict won from the upload event alone.
7. On iOS, wait for the same plugin version and files before enabling or
   reloading the plugin. Verify the changed behavior, not merely the settings
   toggle.
8. Do not report deployment from source timestamps or passing tests. Require a
   generated product newer than the fix, strict closed-build validation, Sync
   transfer evidence, a true quit/relaunch, live validation, and direct
   inspection of the affected Reader behavior.

The live narrow refresh is the sole exception to the normal closed-vault rule.
It is allowed only when the source-owned command documents its write set,
preserves plugin data, and exists specifically to make an active Sync watcher
upload new versioned bytes. Never use a general build, recursive copy,
formatter, validator with writes, publisher, or archiver against an open vault.

Reference command shape:

```sh
uv run --locked --no-dev python \
  scripts/build-obsidian-mobile-vault.py --refresh-plugin
```

Pitfalls:

- replacing plugin files only while Obsidian is closed can let the remote copy
  silently restore an older runtime at the next launch;
- `manifest.json` version text without matching runtime hashes is insufficient;
- a disabled Back control can be logically present yet visually absent;
- raw DOM nodes in history become stale after rerendering; store stable Reader
  identities, offsets, and footnote locators and resolve them after restoration;
- pushing history while Back is restoring creates a two-state loop instead of
  continuation backtracking;
- screenshots from a fixture whose stylesheet or assets failed to load are not
  visual QA;
- changing plugin `data.json` during delivery can overwrite reader preferences;
- loading the full index on every file arrival recreates the mobile freeze the
  compact vault is meant to avoid;
- FirstPair publication, Obsidian Sync, iCloud, and local filesystem state are
  separate delivery planes.
