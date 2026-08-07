[← First Pair library](https://firstpair.org/)

# The FirstPair Guide to Reading Books in Obsidian

An Obsidian vault is a folder of ordinary Markdown notes, images, indexes, and
optional local plugins. FirstPair uses the format because a book can remain a
linear reading experience while also becoming a navigable body of evidence:
chapters connect to code, quotations connect to sources, and parallel editions
can be compared without hiding their provenance.

You own the downloaded files. The book remains readable without an account,
without a network connection, and without enabling any community plugin.

## Install Obsidian

1. Visit [obsidian.md/download](https://obsidian.md/download) and install the
   application for macOS, Windows, Linux, iOS, or Android.
2. Launch Obsidian. Creating an Obsidian account is optional for local reading.
   An account is needed only for paid services such as Obsidian Sync or Publish.
3. Download the vault ZIP from the book’s FirstPair page.
4. Extract the ZIP completely. Do not open or edit files while they are still
   inside the archive.
5. In Obsidian choose **Open folder as vault**, select the extracted outer
   folder containing `Home.md`, and approve opening it as a vault.

Keep the ZIP until you have verified the vault. It is a clean recovery copy.

## Your first five minutes

The vault should open at `Home.md`. If it does not, select `Home.md` in the Files
pane. Choose **Open the Reader** to begin the book in canonical order. If the
optional Reader plugin is disabled, the static Reader notes provide the same
text with ordinary Previous, Up, Top, TOC, and Next links.

Obsidian has four useful regions:

- the **Files** pane lists the notes and evidence included in the vault;
- the central pane displays the current note or Reader view;
- the **Outline** shows headings in the current note;
- backlinks, Search, and Graph reveal relationships among notes.

You cannot damage the published source by exploring. Links, Search, and Graph
only change what you are viewing. Editing a note changes your extracted copy,
not the FirstPair edition or anyone else’s vault.

## Notes, links, and the graph

Every `.md` file is readable Markdown. Links written as `[[Note title]]` point
to another note in the vault. A link such as `[[Source#Passage]]` points to a
heading or reviewed block inside a note. Standard web links open an external
site and may require a network connection.

Open **Backlinks** to see which chapters, claims, or excerpts refer to the
current note. Open **Local graph** to see its immediate neighborhood. The full
Graph is useful for orientation, but it is not the intended way to read the
book: the Reader is the human route, while the graph is an audit and discovery
route.

Use Search for names, phrases, symbols, source locators, or filenames. Quoted
search terms find an exact phrase. Obsidian search can also restrict paths, for
example `path:Sources` or `path:Code`.

## The FirstPair Reader

FirstPair vaults include a continuous Reader and a complete static Markdown
fallback. The standard Reader navigation rail is:

**Previous | Up | Back | Top | TOC | Next**

- **Previous** and **Next** follow canonical book order.
- **Up** leaves the current page for the Reader’s containing part or Home.
- **Back** restores the previous position inside the Reader, including the
  position before a footnote, source jump, Top, TOC, Previous, or Next action.
- **Top** returns to the true beginning of the page, including a leading plate
  or cover.
- **TOC** opens the Reader contents.

Back is Reader-local history. It does not behave like a browser Back button and
will not send you into unrelated notes you happened to open earlier.

## Optional local plugins

The distributed vault is useful with Obsidian’s core features alone. FirstPair
may include an inspectable local Reader plugin under `.obsidian/plugins/`, but
community plugins are disabled on first open. This is deliberate consent, not
an error.

To enable it:

1. Open **Settings → Community plugins**.
2. Read and accept Obsidian’s restricted-mode explanation if you are
   comfortable enabling local code.
3. Confirm that the plugin is named **FirstPair Reader** or the title’s
   documented compatibility plugin.
4. Enable it, then use the book icon or **Open Reader** command.

FirstPair’s standard plugin is offline, collects no telemetry, and reads only
the local Reader and evidence indexes. The static Reader remains the recovery
path if a plugin is disabled or incompatible with a future Obsidian release.

## Reading evidence safely

Evidence links should take you to a local, identified target: a code file or
range, historical passage, anthology entry, image, claim record, or aligned
triptych row. Exact links are curated during publication. A missing target is a
book defect worth reporting; it should not be repaired by silently searching
the web and assuming the closest result is equivalent.

External source links identify public repositories, archives, DOI records, or
institutional pages. A vault may describe restricted research material without
including its bytes. This preserves bibliographic and audit identity without
claiming redistribution rights FirstPair does not possess.

## Make personal notes without fighting updates

Treat generated Reader, source, code, and `_data` files as edition material.
Put your own durable notes in a clearly named folder such as `My Notes/`. Link
to published notes from there instead of inserting annotations directly into
generated machine indexes.

A simple personal note might contain:

```markdown
# Questions about chapter 4

- Revisit [[Reader/004 - Chapter title]].
- Compare with [[Sources/Primary source#Relevant passage]].
```

Tags, bookmarks, highlights, Canvas files, and ordinary Markdown notes remain
local to your copy unless you deliberately sync or share them.

## Desktop, mobile, and preview vaults

FirstPair may publish three products from the same canonical book:

- a **desktop vault** with the complete permitted evidence or source tree;
- a **mobile vault** with the full Reader and the exact closure of cited,
  compact evidence needed on a phone or tablet;
- a **preview vault** containing only the disclosed preview Reader and its
  evidence closure. The preview is responsive and is the same package on
  desktop and mobile.

These are separate products, not folders to merge. Do not connect desktop and
mobile vaults to the same Obsidian Sync remote. Their file sets and size limits
are intentionally different.

## Sync and backup

Local reading needs no sync service. To use Obsidian Sync, create a distinct
remote for the specific vault product. On every device enable the categories
required by the guide: Markdown, images, other file types, vault configuration,
the active community-plugin list, and installed community plugins. A “Fully
synced” badge covers only categories enabled on that device.

Back up personal notes separately. Obsidian Sync is synchronization, not a
substitute for a versioned backup. The original downloaded ZIP is a recovery
copy of the published edition but does not contain annotations created later.

## Updating a FirstPair vault

Do not extract a new edition over an open vault. Quit Obsidian completely and
keep the old folder until the new one opens correctly. The safest update is:

1. Download and verify the new versioned ZIP.
2. Quit Obsidian on every device that can write the local folder.
3. Extract the new edition beside the old one.
4. Open it as a separate vault and verify `Home.md`, the Reader, evidence links,
   images, and plugin version.
5. Copy only your clearly separated personal notes or use a reviewed migration
   tool supplied for that title.
6. Retain the old vault until the replacement has survived a full restart and,
   when applicable, a complete Sync cycle.

Never copy `.obsidian/workspace.json`, caches, search indexes, or generated
`_data` from an old release into a new one.

## Troubleshooting

If the vault opens as a single file, return to Obsidian’s vault switcher and
choose **Open folder as vault**. Select the folder containing `Home.md`.

If the Reader plugin is absent, use the static Reader links first. Then confirm
that the plugin directory exists, community plugins have been consciously
enabled, and the vault has finished syncing all file types.

If images are missing on mobile, enable image synchronization on both devices.
If Reader indexes or plugin files are missing, enable **Sync all other types**
and plugin/configuration synchronization on both devices, restart, and wait for
indexing to settle.

If a quotation, code excerpt, or triptych link opens the wrong place, record the
book version, page, visible link label, and destination. Do not edit the
generated target index as a permanent repair; report the mapping so the next
edition can be reproducibly corrected.

## Publishing with Omnighost

Reading a FirstPair vault and publishing from Obsidian are separate activities.
If you want to develop and publish essays from an Obsidian editorial workflow,
read [*Omnighost for First Pair Press*](https://firstpair.org/read/omnighost/).
It covers the FirstPair Obsidian-to-Ghost workflow, portable textpacks, images,
mobile use, provenance, and multi-blog delivery.

## A durable mental model

The Reader is the book. Files and Search are the library. Backlinks and Graph
are the map. Evidence targets are the audit trail. Your personal notes are your
work, and should live in a clearly separate place. With those boundaries, an
Obsidian vault remains approachable for a first-time reader while retaining the
depth needed by programmers, historians, editors, and reviewers.
