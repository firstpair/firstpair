# Skill: Obsidian Full Evidence Vault

Use when building or publishing a complete desktop Obsidian companion vault for
a First Pair book. A full vault is a readable edition and an inspectable
evidence archive. It is not the phone product and should not be made smaller by
silently dropping research, provenance, rights, or source relationships.

## Product Boundary

The source repository owns the vault builder, validator, Reader sequence,
source catalog, rights policy, quote map, derivatives, plugin bundle, guide, and
manifest. FirstPair owns package transformation, archive verification, Blob
delivery, catalog routes, and the rendered public guide.

A complete vault should expose two deliberately separate routes:

```text
Reader -> ordered chapter-scale pages -> Previous / Up / Back / Top / TOC / Next

Audit graph -> edition -> part -> chapter -> sense unit
                                      -> claim -> source -> permitted attachment
                                                         -> derivative recipe
                                                         -> public URL
```

The Reader is the default human route. The fine-grained graph is an audit route,
not the reading interface. Back is internal Reader continuation history: it
restores the preceding footnote, Top, TOC, Up, Previous, or Next position rather
than leaving the Reader for a previously open note.

## Build Workflow

1. Confirm the real source repository, exact edition, source commit, generated
   vault path, and public boundary. A complete evidence vault does not authorize
   publication of a complete book over a preview; retain the publisher's
   explicit full-edition gate.
2. Require a clean, committed source tree when Git blobs, source lines, or
   commit identity enter the vault manifest. Read LFS-managed bytes from the
   verified worktree and reject unresolved pointer text.
3. Run a read-only main-process check first (`pgrep -x Obsidian` on macOS, or
   the platform equivalent). If no Obsidian process is running, treat the
   closed-vault gate as satisfied and do not ask the user to type or confirm
   `closed`. If Obsidian is running, ask the user to quit it fully and repeat
   the check before replacing content, resetting workspace state, validating
   with write-capable tools, zipping, staging, or publishing. If process state
   cannot be determined reliably, fail closed and request explicit
   confirmation.
4. Build an outer vault root with a regular `Home.md`. Make **Open the Reader**
   the first and most prominent route. Keep the book, guide, Reader, audit
   edition, source, visual, research, and machine-data layers discoverable from
   ordinary Markdown.
5. Generate a complete, bounded Reader from canonical manuscript order. Keep
   its ItemView data and static Markdown pages equivalent. Restore the canonical
   cover before the opening page and keep the audit graph out of the prose view.
6. Give every audit object a stable local address. Record source file, line
   span, Git blob or content hash, object kind, containing structure, and exact
   source Markdown where the project promises paragraph-scale provenance.
7. Join claims, sources, downloads, derivatives, visuals, dossiers, and fact
   sheets by canonical IDs. Validate every join and preserve the distinction
   among established fact, inference, dispute, later tradition, and literary
   invention when the source project records it.
8. Bundle bytes only when the source ledger records redistribution authority.
   For restricted research copies, publish metadata, stable public URL or DOI,
   archival identity, hashes when lawful, mapped claims, and derivative recipes
   without copying the restricted file.
9. Store identical permitted attachments once and link every owning source.
   Reject symlinks, unknown bytes, unverified hashes, private preferences,
   caches, nested Git metadata, and unresolved LFS pointers.
10. Publish reader-sized visual derivatives with rights, creator, title, date,
    institution, source URL, master hash, derivative hash, dimensions, caption,
    alt text, placement, and commercial-use caveats. Do not ship the master
    image archive merely because the desktop vault can hold it.
11. Align bilingual sources only at defensible canonical boundaries. Preserve
    witness edition, translator or editor, rights, locators, hashes, contributing
    divisions, and cardinality. Keep one-sided or incompatible source families
    in an explicit gap ledger; never turn adjacency into a translation claim.
12. Generate quotation links only from reviewed aliases. Standalone quotations
    should retain exact local source links in static Markdown; the plugin may
    expand the clickable target to the colored rail and citation marker.
13. Bundle the optional Reader plugin as an inspectable local package, but ship
    it disabled by default. The complete book, source notes, and quotation links
    must remain usable with core Obsidian alone and without network access.
14. Emit machine-readable ledgers plus a vault manifest that binds edition,
    version, source commit, ordered Reader pages, source and claim counts,
    attachment and visual hashes, bilingual indexes, guide, cover, workspace
    seed, plugin version, and plugin runtime hashes.
15. Keep one canonical Markdown vault guide in the source repository. Embed the
    same guide bytes inside the vault, use them as archive-root `README.md`, and
    let FirstPair render the hosted guide. Do not maintain three drifting guide
    copies.

## First-Open Setup

Create a deterministic `.obsidian/workspace-first-open.json` owned by source.
It should open root `Home.md` in reading view, place File Explorer before Search
and Bookmarks on desktop, and keep a collapsed Home outline at right. Enable
those core plugins explicitly.

Local rebuilds may preserve `.obsidian/workspace.json` and
`.obsidian/workspace-mobile.json` as volatile reader state. A documented
`--reset-workspace` mode may replace only those aliases from the deterministic
seed while the vault is closed. Never inventory or publish a reader's later pane
state as source provenance.

For the public ZIP, FirstPair excludes every volatile workspace file and saved
layout at every depth, omits the helper, and injects its verified bytes as both
root workspace aliases. The archive must contain a manual `Home.md` fallback in
case an Obsidian version ignores the seed.

## Validation Gate

The source-owned validator should fail closed on:

- missing root, Reader, guide, audit, index, or manifest notes;
- Reader order drift, broken boundaries, missing static navigation, missing
  cover, or disagreement between ItemView data and Markdown;
- Back history that records outside notes, stores stale DOM nodes, pushes while
  restoring, or fails to restore exact footnote and scroll continuation;
- missing or malformed source, claim, attachment, derivative, visual,
  bilingual, gap, quote, or research joins;
- unreviewed quote targets, missing anchors, or fuzzy links presented as exact;
- restricted bytes, unresolved LFS pointers, symlinks, private preferences,
  unlisted files, hash drift, or path traversal;
- plugin package drift, enabled-by-default community consent, or a Reader that
  requires a network request;
- incorrect first-open workspace bytes or a missing regular `Home.md`; and
- guide, cover, edition, source commit, or manifest identity drift.

The FirstPair publisher runs that validator before even a vault dry run. It
then verifies the deliberate workspace and guide transformations, the archive
hash, uploaded Blob bytes, catalog routes, and versioned delivery copies.

## Sync Boundary

Do not connect a full evidence vault to a phone. Thousands of small notes can
make mobile Sync and indexing continuously react to arriving files. A complete
desktop Sync remote may be created only when the user explicitly requests it,
using standard managed encryption unless the user requests another supported
mode. Completion means the local vault is connected and Obsidian shows an
active or completed transfer state. Build a separate mobile product and remote with
[`obsidian-mobile-vault.md`](obsidian-mobile-vault.md).

For the shared Reader and first-open contract, continue with
[`obsidian-reader-plugin-delivery.md`](obsidian-reader-plugin-delivery.md).

Pitfalls:

- do not present an evidence graph as the normal way to read the book;
- do not confuse public source completeness with permission to redistribute
  every private research copy;
- do not hand-edit generated vault notes or a second copy of the guide;
- do not publish local workspace history or preferences;
- do not describe a generated ZIP as validated until both the source validator
  and FirstPair archive checks pass;
- do not treat a repository build, public upload, iCloud copy, and Obsidian Sync
  as the same delivery state.
