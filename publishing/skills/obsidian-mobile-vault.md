# Skill: Obsidian Mobile Vault

Use when deriving a compact Obsidian vault for phone and tablet reading from a
larger book, research vault, or source archive.

The mobile vault is a separate reader product, not a partial copy of the
archival vault. Its source repository owns the builder, validator, Reader
sequence, citation map, plugin bundle, and product manifest.

It should be rebuilt directly from the canonical manuscript and reviewed
source maps, not by pruning the generated full vault. This avoids carrying
desktop workspace state, archival files, and audit-only links into the phone
package.

The shared FirstPair framework models mobile as a product projection over the
same canonical Reader and evidence targets used by desktop. Preview is a single
responsive desktop/mobile product with its own disclosure closure; do not fork
separate phone and desktop preview builders. See
`publishing/VAULT-CONSTRUCTION.md`.

1. Confirm the source repository, generated mobile-vault path, local Obsidian
   vault path, and dedicated Obsidian Sync remote. Never attach the compact
   vault to the complete vault's remote.
2. Run a read-only main-process check first (`pgrep -x Obsidian` on macOS, or
   the platform equivalent). If no Obsidian process is running, treat the
   closed-vault gate as satisfied and do not ask the user to type or confirm
   `closed`. If Obsidian is running, ask the user to quit it fully and repeat
   the check before writing the generated or local mobile vault. If process
   state cannot be determined reliably, fail closed and request explicit
   confirmation.
3. Derive the payload from canonical source. Include the complete continuous
   Reader sequence, the exact bilingual passages reached by its quotations,
   the canonical cover, compact derivatives of every selected Reader image, a
   root `Home.md`, and a complete static Markdown fallback.
4. Exclude archival masters, research graphs, uncited source witnesses,
   generated caches, personal workspaces, and desktop-only evidence unless the
   mobile reading contract explicitly requires them.
5. Give illustrations deterministic mobile derivatives, normally WebP with a
   fixed maximum dimension. Record source identity, output hash, dimensions,
   encoder version, byte count, and placement in the product manifest. A
   1200-pixel maximum dimension and a total package below 10 MiB are proven
   starting points, not universal limits.
6. Enforce explicit file-count and byte ceilings in the source-owned validator.
   Also verify every Reader target, quotation link, bilingual anchor, image,
   plugin file, and startup note.
7. Preserve the local vault root and `.obsidian` directory when refreshing an
   existing product. Preserve core-plugin state, community-plugin consent, and
   plugin `data.json` unless the product contract deliberately changes them.
8. Ship the Reader plugin files but keep community plugins disabled through the
   first Sync. Enable the plugin only after Markdown, images, configuration,
   and plugin files have reached the device.
9. Configure Obsidian Sync per device for images, other file types, vault
   configuration, the active community-plugin list, and installed community
   plugins. JSON Reader and quote indexes require **Sync all other types**;
   WebP plates require **Sync images**. A count that matches the Markdown-only
   payload is not evidence that Sync has stalled; inspect both selective-sync
   and configuration-sync settings before rebuilding.
   A **Fully synced** badge is scoped to the categories enabled on that device.
   Recheck all required switches after restart on both the upload and download
   devices; one correctly configured device does not compensate for the other.
10. Open only `Home.md` on first Sync. The plugin must not subscribe to vault
    create or modify events, and its file-open handler should return before
    loading Reader data unless the opened note belongs to the Reader surface.
11. Render exactly one plugin navigation rail, at the bottom by default, with a
    setting that moves the same rail to the top. The visible order is
    **Previous | Up | Back | Top | TOC | Next**. Keep Previous and Next in the
    flexible outside tracks; keep the four middle controls compact and
    touch-sized.
12. On phones, show destination titles for Previous and Next on one ellipsized
    line, put Next at the far right, hide page-progress text, and contain wide
    tables and images inside the reading column. Do not create page-level
    horizontal overflow.
13. Make Back restore the prior position inside the Reader after ordinary
    footnote, Top, TOC, Up, Previous, and Next jumps. Keep a bounded history of
    Reader state and scroll offsets, including the exact footnote reference
    when applicable. Push immediately before each jump; pop without recording
    during Back restoration. Store stable locators rather than rendered DOM
    nodes, resolve them after any rerender, and clear stale history when a new
    Reader session begins. Use Obsidian's fixed-size `rotate-ccw` Lucide icon and
    keep it recognizable while disabled. Static Markdown omits Back because it
    has no runtime navigation history.
14. Point Top at the true beginning of the Reader page, including pages that
    begin with a cover or plate, rather than only at the first heading.
15. Validate at phone width: all six controls, 44-pixel touch targets, visible
    enabled and disabled states, readable titles, contained tables and images,
    touch-sized source citations, clickable quote rails, independent Reader
    scrolling, and no viewport overflow. Test a reviewed bilingual marker and
    an ordinary footnote separately: the first opens the aligned source, while
    the second scrolls to, focuses, and visibly marks its local note target.
    Back must restore the exact marker and prior Top, TOC, Up, Previous, and
    Next positions without adding a seventh control. Serve the fixture from its
    plugin root and require the linked stylesheet and every visual asset to load
    successfully before accepting screenshots or pixel checks.
16. Keep two explicit validation modes. The default closed-build gate requires
    deterministic first-open workspace aliases and exact aggregate package
    bytes. A separate live mode may tolerate only Obsidian's rewrites of
    volatile workspace aliases and their aggregate-byte effect; it must retain
    exact Reader, source, plugin, illustration, link, count, size-limit, and
    individual-hash checks.

## Anthology Links On Mobile

When canonical book Markdown uses Pandoc identifiers such as
`### A3. Title {#anthology-a03}`, translate them during mobile derivation:

1. Remove every renderer-only `{#anthology-...}` attribute from the generated
   anthology note; Obsidian displays it as prose and cannot route to it as an
   anchor.
2. Build a canonical-ID-to-visible-heading map from the anthology source, then
   emit Reader citations as ordinary Obsidian heading links, for example
   `[[Source Anthology#A3. Title|Anthology A3]]`. Never point a mobile link at
   the Pandoc identifier.
3. Validate both sides: the generated anthology contains no Pandoc anthology
   attributes, and representative A-series citations resolve to the expected
   visible heading. A link that merely opens the anthology's top is broken.
4. Keep the anthology as one static, readable note; its reader-facing text
   cites titles, editions, and public references, never local source paths.

The product manifest should bind at least the edition, Reader page count,
bilingual passage count, illustration count, plugin version, plugin hashes,
cover hash, Reader and quote-index hashes, illustration-index hash, total file
count, and total bytes. The source-owned validator is the release gate;
FirstPair must not infer mobile completeness from a ZIP listing.

## Safe Initial Sync

1. Disconnect or remove the old full vault from the phone. Deleting a local
   device vault is not permission to delete its remote or Mac source folder.
2. Open the generated mobile folder as a new local vault on the Mac. Create a
   dedicated remote with a distinct name and standard managed encryption unless
   the user requests another supported mode. Never connect it to the full-vault
   remote.
3. Before the first Mac transfer, enable **Sync images**, **Sync all other
   types**, **Active community plugin list**, and **Installed community plugin
   list**. Restart Obsidian when the device-specific Sync settings require it,
   reopen the same vault, confirm those four switches remain enabled, resume,
   and wait for **Fully synced**.
4. On iOS, connect a fresh local vault to the mobile remote. Set the same four
   options before starting, then force-quit and reopen when required. Wait for
   transfer and indexing to settle on `Home.md`.
5. Enable the Reader plugin only after the phone is responsive and current.
   Verify the actual Reader, cover, six controls, illustrations, and bilingual
   targets instead of relying on the enabled toggle.
6. Fully quit and relaunch Obsidian, reopen the same mobile vault, rerun the live
   validator, and inspect the changed behavior. A source test, build message, or
   **Fully synced** badge alone is not deployment evidence.
7. Verify the remote configuration plane through **Settings version history**.
   Inspect the remote plugin manifest and runtime, then compare the copied
   `main.js` hash with the product manifest. Configuration files may not appear
   in the ordinary activity log even when their remote revisions exist.
8. If restart downloads an older remote runtime over the local package, let the
   watcher and required configuration categories settle, rerun only the narrow
   watched plugin refresh, and verify the remote hash again. The conflict is not
   resolved until the refreshed bytes survive a full quit/relaunch.

The source build never creates, deletes, connects, or modifies a remote. It may
preserve Sync configuration in an already connected local vault, but remote
creation and connection are separate explicit user actions.

Reference shape:

```text
mobile-vault/
  Home.md
  README.md
  Reader/
  Sources/Bilingual/
  Illustrations/ (selected plates and cover)
  .obsidian/plugins/<reader-plugin>/
  MOBILE-VAULT.json
```

Pitfalls:

- do not trim chapters or citations merely to meet a size target;
- do not publish archival image masters to a phone vault;
- do not confuse Obsidian Sync with iCloud filesystem synchronization;
- do not enable a community plugin before its runtime and configuration have
  finished syncing;
- do not preserve Reader history as DOM nodes or push a new entry while Back is
  restoring an old one;
- do not accept mobile screenshots from an unstyled fixture with asset 404s;
- do not use a file count alone as a transfer-health signal.

Validated Cicero profile: 24 Reader pages, 33 cited bilingual passages, 33
1200-pixel WebP plates plus the cover, fewer than 110 files, and less than
10 MiB. Preserve the method, not those title-specific counts: every book should
declare and validate its own exact subset and ceilings.

For updates to an already connected Reader plugin, continue with
[`obsidian-reader-plugin-delivery.md`](obsidian-reader-plugin-delivery.md).
