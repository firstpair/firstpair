# FirstPair Agent Guidance

FirstPair is the shared publishing and public-delivery repository. Preserve
book-specific source repositories as the authority for manuscripts, metadata,
versions, and built artifacts; FirstPair owns the public catalog, preview
pages, and object-storage delivery URLs.

## Rules For Every Participating Repository

These rules apply to FirstPair itself and to every source repository that
publishes through it. Repo-local `AGENTS.md` files should add only local
constraints and short pointers back here; they must not weaken or bypass these
shared rules.

- Verify the real repository root before editing, building, publishing, or
  reporting status. Do not confuse archival checkouts, generated package
  directories, sibling repos, or dependency trees with the active source repo.
- Preserve source ownership. Manuscripts, blog posts, textpacks, covers, vault
  builders, source metadata, version manifests, and project-specific README
  files belong in the owning source repo unless the user explicitly grants an
  exception. FirstPair may hold catalog/readme surfaces, route maps, upload
  manifests, deployment metadata, and First Pair house content.
- Keep the detailed deployment contract in the source repo's `FIRSTPAIR.md`
  whenever that repo participates in the library. Local `AGENTS.md` files should
  point to `FIRSTPAIR.md` and `~/src/firstpair` instead of duplicating the full
  publishing workflow.
- Before regenerating, editing, validating with write-capable tools, zipping, or
  otherwise programmatically touching any Obsidian vault directory, first run a
  read-only main-process check (`pgrep -x Obsidian` on macOS, or the platform
  equivalent). If no Obsidian process is running, the closed-vault gate is
  satisfied; proceed without asking the user to type or confirm `closed`. If
  Obsidian is running, ask the user to quit it fully, then repeat the process
  check before touching the vault. A text confirmation does not override a
  positive process check. If process state cannot be determined reliably, fail
  closed and request explicit confirmation. Do not mutate an open vault;
  Obsidian can rewrite workspace, plugin, and index files in the background and
  race generated output.
- Regenerate derived editions from source, then run the source-owned validators
  and FirstPair checks before staging, uploading, or publishing. A failed
  validator is a stop condition, not something to route around.
- Use stable FirstPair deliverable routes in reader-facing prose:
  `/<book-stem>/pdf/`, `/<book-stem>/epub/`, and, when present,
  `/<book-stem>/vault/` and `/<book-stem>/emacs/`. Raw Vercel Blob URLs belong in `public/catalog.json`,
  `book-uploads/blob-manifest.json`, and generated route maps, not in blog
  posts, public README text, or long-lived external links.
- Treat Vercel deployments, Blob uploads, iCloud delivery, and full-edition
  releases as outward-facing actions. Use dry-runs when the target is unclear,
  and require explicit user confirmation before replacing a public preview with
  a full book.
- Preserve unrelated user or generated worktree changes. Stage, commit, and push
  only the files that belong to the requested change.
- Start blog writing and book-publication work only from repositories whose
  worktrees are clean and whose current commits are present at their configured
  upstreams. After editing a post and its assets, commit and push them before
  building or stamping its textpack. Before any non-dry-run book publication,
  both the owning source repository and FirstPair must pass the same gate.
  `publishing/scripts/git_publish_preflight.py` is the canonical check. Do not
  weaken this rule to "the relevant files are clean," accept an ahead local
  branch, or substitute a hash-only artifact.

## Content Ownership

Do not deposit project-owned editorial content in FirstPair unless the user
explicitly names an exception. Announcements, blog posts, textpacks, pitch
packets, manuscript excerpts, and their assets belong in the specific project
or book source repository that owns the work. FirstPair may hold First Pair
house content, public catalog/readme surfaces, upload manifests, reader route
maps, and generated deployment metadata needed to publish or host those sources.

## Git-Versioned Blog Textpacks

The current Omnighost textpack format is `omnighost-textpack-v1`. A conforming
pack records both a portable payload SHA-256 and the full pushed source commit
in `info.json` under `omnighost.provenance`. An untouched imported note inherits
that commit through publication; its next sync can report `Unchanged` without
rotating the version. Hash-only packs are not publishable.

The clean-and-pushed sequence is mandatory:

1. Work from the owning project's real repository, not from FirstPair or an
   archive checkout. Before writing or updating the post, finish and push any
   existing work so the complete repository is clean and at its configured
   upstream.
2. Edit the canonical Markdown post and every local image or asset that will
   enter the pack. Then commit and push those exact finished source changes.
   Obtain the needed commit/push authorization when it is not already explicit.
3. Run `publishing/scripts/git_publish_preflight.py` or let the builder run it.
   The check fails closed for untracked, modified, or staged files; unfinished
   Git operations; detached local HEADs; missing upstreams; ahead, behind, or
   diverged branches; and a remote branch whose commit is not exactly HEAD.
4. Only after that gate passes, stamp the pack and version marker from the
   owning repository. For the standard `docs/blog/<slug>/post.md` layout:

```sh
cd /absolute/path/to/project
REPO_ROOT="$PWD" \
BLOG_DOMAIN=example.com \
BLOG_TAGS=tag-one,tag-two \
BLOG_EXCERPT="Short summary" \
~/src/firstpair/publishing/scripts/stamp-versioned-blog.sh \
  docs/blog/<slug>
```

This writes the stable textpack, its source-hash versioned link, and
`dist/VERSION.md`. Verify them, then commit and push all three. Only from that
new clean and pushed handoff may the delivery wrapper copy the pack to iCloud:

```sh
cd /absolute/path/to/project
REPO_ROOT="$PWD" \
BLOG_DOMAIN=example.com \
~/src/firstpair/publishing/scripts/publish-versioned-blog.sh \
  docs/blog/<slug> "$HOME/icloud/blogs"
```

The stamping command invokes `~/src/firstpair/publishing/scripts/textpack.py`, which
verifies the clean remote state, requires every bundled input to match the
pushed HEAD, and writes the archive atomically. Provenance uses the newest
commit in that pushed history which changed any bundled input and whose tree
matches all bundled inputs. This keeps the source identity stable across a
later pack-only commit. ZIP entry ordering, timestamps, and modes are
deterministic, so an unchanged clean rebuild is byte-identical. The builder
never commits or pushes. The delivery wrapper does not rebuild or alter the
handoff: it independently requires the repository to be clean and pushed,
requires the pack, marker, and versioned link to be tracked at HEAD, validates
the embedded source commit, and only then copies the versioned pack. Delivery
to iCloud or a public service still requires the appropriate authorization.

After building, verify the source commit, provenance block, archive, and
repository state:

```sh
git show --stat --oneline HEAD
unzip -p docs/blog/<slug>/dist/<slug>.textpack '*/info.json'
unzip -t docs/blog/<slug>/dist/<slug>.textpack
git status --short
```

When delivery was authorized, also compare the stable pack with the delivered
versioned copy:

```sh
cmp -s docs/blog/<slug>/dist/<slug>.textpack \
  "$HOME/icloud/blogs/<versioned-textpack-name>.textpack"
```

Confirm that the provenance schema is `omnighost-textpack-v1`, `payloadSha256`
and a full `gitCommit` are present, that the embedded commit equals the pushed
source-changing revision used for the build, and that the generated outputs are
then committed and pushed without unrelated changes. Rebuilding after that
pack-only commit must preserve both `gitCommit` and the complete archive bytes.

## Public Book Delivery

Public books have one lightweight metadata directory under `public/`. Use the
book's stable stem for the directory name:

```text
public/<book-stem>/
```

For LakeCat, the destination is:

```text
public/lakecat/
```

The public library catalog lives at:

```text
public/catalog.json
```

Every public-facing book or preview listed on the site must be represented in
that catalog. Do not hardcode library entries in the Vue app when they can live
in the catalog.

Heavy book payloads do not live in deployable `public/`. Upload PDF, EPUB,
single-file HTML, and chapter HTML packages to Vercel Blob one title at a time.
Expose PDF and EPUB as download URLs. Expose HTML only through hosted reader
routes on `firstpair.org`:

```text
/read/<book-stem>/
/read/<book-stem>/chapters/
/read/<book-stem>/guide/
```

Record both the hosted reader routes and the backing Blob source URLs in
`public/catalog.json`:

```text
public/catalog.json
public/<book-stem>/README.md
book-uploads/book-package-sources.json
book-uploads/blob-manifest.json
```

`book-uploads/book-package-sources.json` maps each catalog slug to the local
artifact package to upload. `book-uploads/blob-manifest.json` records uploaded
hashes and Blob URLs so unchanged files and chapter packages are skipped.
`book-uploads/staging/` is ignored and may hold local operational copies, but
must not be deployed or committed as book payload.

The general delivery command is:

```sh
npm run library:publish -- /absolute/path/to/book-or-dist --slug <book-stem>
```

Before a non-dry-run invocation, commit and push all work in both the book's
owning source repository and FirstPair. The publisher runs the canonical Git
preflight against both repositories before it stages, uploads, copies, or
changes catalog metadata. A dirty repository, missing upstream, local/remote
commit mismatch, or local detached HEAD is a stop condition. `--dry-run` remains
available for resolving a plan before that gate because it does not publish or
write. In the GitHub Actions path, the full-history `actions/checkout` inputs
are treated as exact remote checkouts and are checked against fetched `origin`
branches. After local publication changes FirstPair-owned metadata, commit and
push that scoped result before starting another publication.

For remote publishing without a trusted local press workstation, use the
manually dispatched GitHub Actions workflow **Publish Library Book** in this
repository. Supply the source repository as `owner/name`, the exact branch,
tag, or commit as `ref`, and set `full` only after the mandatory full-edition
confirmation below. The workflow checks out the already-built source package,
runs `library:publish` with `--no-deploy`, uploads heavy artifacts using the
encrypted repository secret `BLOB_READ_WRITE_TOKEN`, validates and builds the
catalog, and commits only FirstPair-owned publication metadata to `main`. The
existing Vercel Git integration deploys that commit.

The workflow publishes only artifacts the source repository has already built
and committed. It invokes FirstPair's publisher directly and never executes
source-owned build hooks while holding the Blob credential; the build performed
by the publisher is the FirstPair catalog/site build. Keep
`BLOB_READ_WRITE_TOKEN` solely in GitHub Actions secrets; never print it, place
it in workflow inputs, commit it, or copy it into source metadata. The
workflow's `contents: write` permission exists only so its final metadata commit
can reach this repository's `main` branch. Before pushing, the workflow rebases
its generated metadata commit onto the current `main`; this makes a rerun safe
when an earlier attempt or another completed publication advanced the branch.

The command accepts a dist directory or a book/repository directory containing a
known dist layout, refreshes `book-uploads/staging/<book-stem>/`, updates the
upload source map and catalog entry, uploads that single book package, syncs the
reader map, writes `public/<book-stem>/README.md`, copies versioned PDF/EPUB
files to `~/icloud/books`, runs the catalog/build/smoke checks, deploys to
Vercel production, and verifies that the live `firstpair.org` catalog points at
the new Blob URLs. Use `--dry-run` before first-time packages, `--stage-only`
when only the ignored staging package and source map should be prepared, and
`--no-deploy` when the package should be uploaded without changing the live
site.

### Preview → full publishing (the `--full` gate)

A book may split its build output into two publish-complete directories,
`dist-preview/` and `dist-full/`, each carrying a `VERSION.md` with
`edition: preview` or `edition: full`. Without `--full`, `library:publish`
selects the **preview** edition; `--full` selects the **full** edition.

Publishing the **full** edition over a book whose catalog entry is currently a
**preview** REQUIRES `--full`. The script refuses without it, because that
publish replaces the public preview listing and pushes the complete text to the
library and to `~/icloud/books`.

**Warning — mandatory for agents:** pushing the full book is a hard-to-reverse,
outward-facing action. If there is any chance a publish run would push the full
version — the target resolves to `dist-full`, `--full` is (or would need to be)
passed, or the book is currently listed as a preview — STOP, warn the user in
plain terms that this will make the **complete book** public and overwrite the
preview, and ask for explicit confirmation first. Never add `--full` on the
user's behalf to get past the gate. When unsure which edition a run would
publish, do a `--dry-run` and show the resolved `distDir`/`edition` before doing
anything live.

Hosted HTML readers must include a visible link back to the First Pair library.
Implement that navigation in the FirstPair reader proxy, not by rewriting and
reuploading every generated HTML artifact. The link should point to `/`, render
on single-file, chapter, and rendered vault-guide HTML pages, and stay hidden
in print output.

When `--vault` includes a Markdown guide, preserve that source as a versioned
regular file in staging and `~/icloud/books`, embed the same bytes as
`README.md` at the vault archive root, and render a self-contained HTML
derivative with Pandoc for Blob upload. Store `/read/<book-stem>/guide/` in the
catalog's `vaultGuide` field and the backing HTML Blob URL in
`vaultGuideSource`; do not expose the raw Markdown Blob as the reader link.

Vault archives never carry a `workspace.json` or `workspace-mobile.json` from
any source folder, nor the generated vault's `.obsidian/workspaces.json` saved
layouts; those files are volatile user state. This exclusion applies at every
depth and to the entire subtree below any path component named `workspace.json`
or `workspace-mobile.json`. A directory-shaped alias and every one of its
descendants are therefore private and cannot collide with the regular workspace
files injected into the ZIP. A source-owned vault may instead provide the exact
helper `.obsidian/workspace-first-open.json`. Its complete deterministic schema
is:

```json
{
  "main": {
    "id": "0531043c990df55e",
    "type": "split",
    "children": [
      {
        "id": "9999cbdea50fbe72",
        "type": "tabs",
        "children": [
          {
            "id": "fb59b2571954a561",
            "type": "leaf",
            "state": {
              "type": "markdown",
              "state": {
                "file": "Home.md",
                "mode": "preview",
                "source": false
              },
              "icon": "lucide-file",
              "title": "Home"
            }
          }
        ]
      }
    ],
    "direction": "vertical"
  },
  "left": {
    "id": "fbb039bb5e18d3b2",
    "type": "split",
    "children": [
      {
        "id": "f52d68d4d1bea7f2",
        "type": "tabs",
        "children": [
          {
            "id": "a900cdd0c196c7e8",
            "type": "leaf",
            "state": {
              "type": "file-explorer",
              "state": {
                "sortOrder": "alphabetical",
                "autoReveal": false
              },
              "icon": "lucide-folder-closed",
              "title": "Files"
            }
          },
          {
            "id": "cea44760eccde1a3",
            "type": "leaf",
            "state": {
              "type": "search",
              "state": {
                "query": "",
                "matchingCase": false,
                "explainSearch": false,
                "collapseAll": false,
                "extraContext": false,
                "sortOrder": "alphabetical"
              },
              "icon": "lucide-search",
              "title": "Search"
            }
          },
          {
            "id": "630f9c4a9ac0b16b",
            "type": "leaf",
            "state": {
              "type": "bookmarks",
              "state": {},
              "icon": "lucide-bookmark",
              "title": "Bookmarks"
            }
          }
        ]
      }
    ],
    "direction": "horizontal",
    "width": 300
  },
  "right": {
    "id": "1b7c9dc5a4742406",
    "type": "split",
    "children": [
      {
        "id": "7da908430128da70",
        "type": "tabs",
        "children": [
          {
            "id": "40b875ecfdd371ed",
            "type": "leaf",
            "state": {
              "type": "outline",
              "state": {
                "file": "Home.md",
                "followCursor": false,
                "showSearch": false,
                "searchQuery": ""
              },
              "icon": "lucide-list",
              "title": "Outline of Home"
            }
          }
        ]
      }
    ],
    "direction": "horizontal",
    "width": 300,
    "collapsed": true
  },
  "active": "fb59b2571954a561",
  "lastOpenFiles": [
    "Home.md"
  ]
}
```

Serialize it with Python `json.dumps(payload, indent=2) + "\n"`: the canonical
UTF-8 result is 2,751 bytes with SHA-256
`a651c5e6434ee35446e0fd51a064063b3169c1f7b4e49b1b3213e8d933483fb6`.
The schema opens root `Home.md` in reading view, places Files before Search and
Bookmarks so File Explorer is selected, and supplies a collapsed Home outline.
The source vault must explicitly enable those core plugins.

The archiver requires both this exact value and its canonical bytes, requires a
regular root `Home.md`, omits the helper, and injects the helper bytes unchanged
as both `.obsidian/workspace.json` and `.obsidian/workspace-mobile.json`. The
two aliases must therefore be byte-identical while every source or nested
personal workspace remains excluded. Current mobile Obsidian uses the same
Home leaf while constructing its own mobile drawers from the side panes.
Seedless vaults ship no workspace state, and this convention does not enable an
optional community plugin. Once extracted, Obsidian may update the reader's
workspace normally; no later pane state is published back. Keep the source
guide's manual instruction to open `Home.md` as the fallback when Obsidian
ignores the initial workspace.

For complete desktop evidence editions, follow
`publishing/skills/obsidian-full-vault.md`. Keep the chapter-scale Reader and
fine-grained audit graph as separate routes, enforce rights-safe attachment
policy, preserve explicit bilingual gaps, bind generated notes and derivatives
to source identity, ship the optional plugin disabled by default, and require
the source-owned validator before FirstPair transforms or archives the vault.
Do not connect the full evidence vault to a phone; derive the mobile product
directly from canonical source instead.

Before regenerating, editing, validating with write-capable tools, zipping, or
otherwise programmatically touching an Obsidian vault directory, run the
read-only main-process gate first (`pgrep -x Obsidian` on macOS, or the platform
equivalent). No matching process satisfies the gate without a user message; do
not ask the user to type or confirm `closed`. If Obsidian is running, ask the
user to quit it fully and repeat the check before continuing. If the process
state is indeterminate, fail closed and request explicit confirmation. Obsidian
may keep workspace, plugin, and index files open or rewrite them in the
background; writing the vault while it is open can race those writes and poison
the generated edition. Once the gate passes, regenerate the vault from source,
then validate it before staging or publishing.

For compact device editions, follow
`publishing/skills/obsidian-mobile-vault.md`. Treat the mobile vault as a
separate, source-derived Reader product with its own local vault, Sync remote,
manifest, file and byte ceilings, exact cited sources, compact illustrations,
and static Markdown fallback. The source repository owns its builder,
validator, Reader sequence, quote map, and plugin bundle.

For Reader runtime changes, follow
`publishing/skills/obsidian-reader-plugin-delivery.md`. The sole open-vault
write exception is a source-owned plugin-only refresh command whose documented
write set is limited to an allowlisted plugin package and product manifest,
preserves `data.json` and vault state, and exists so an active Obsidian Sync
watcher can upload new versioned bytes. General builds, recursive copies,
formatting, staging, zipping, and publication still require the vault to be
closed. Verify the upload in Sync activity, then fully quit and relaunch
Obsidian and compare the installed plugin version and hashes with the source
manifest.

The shared Reader contract is one rail, bottom by default and movable to top,
ordered **Previous | Up | Back | Top | TOC | Next**. Previous and Next own the
wide outside tracks on phones; the middle controls remain compact and
touch-sized. Back restores bounded internal Reader continuation after an
ordinary footnote, Top, TOC, Up, Previous, or Next jump; it never exits to a
non-Reader note. Capture stable Reader identities, scroll offsets, and exact
footnote locators before each jump, then pop without recording while Back
restores. Use Obsidian's fixed-size `rotate-ccw` icon even when disabled. Top
targets the true page start, including cover-first and plate-first pages. The
canonical cover, reviewed bilingual quote rails, exact inline source links, and
complete static Markdown fallback are required deliverables. Ordinary
footnotes scroll, focus, and visibly mark their local targets inside the
ItemView's own scroll pane. The plugin should ignore unrelated file-open events
and must not subscribe to create or modify events in order to rebuild its
indexes. Strip renderer-only Pandoc heading attributes such as `{.unnumbered}`
and `{.unnumbered .unlisted}` from derived Reader notes and embedded
Reader-index Markdown while preserving the canonical manuscript and ordinary
prose braces. Phone-width visual QA is valid only when the fixture serves the
real plugin stylesheet and every asset without 404s.

Bilingual witness metadata is structured provenance, not display-ready prose.
When composing edition descriptions, do not append an editor or translator
credit already embedded in the title. Source-owned tests and validators must
reject repeated semicolon segments and repeated role-plus-contributor credits
across canonical passage rows, plugin JSON, full notes, and compact mobile
notes. Normalize contributor identity separately from display text, including
punctuation, spacing, and trailing `et al.` variants. After a repair, rebuild
every retained generated vault, scan the actual Markdown and JSON payloads, and
inspect the affected source note after Obsidian reports **Fully synced**.

When a book project discovers a reusable improvement to full-vault structure,
mobile derivation, Reader interaction, first-open behavior, source navigation,
or Sync delivery, update the corresponding `publishing/skills/obsidian-*.md`
card in the same work tranche. Keep title-specific counts and paths labeled as
examples; keep the reusable contract here instead of letting it live only in a
single source repository or chat history.

For Emacs Info editions, follow `publishing/skills/emacs-info-bundle.md`.
The bundle is a third reader product projected from the same `vault.build.json`
reader order and evidence as the vaults, plus the title's `emacs` block: a
book manual, a references manual that opens below the text, an offline
lexicon, and the Texinfo source of both. FirstPair owns the Info and Texinfo
writers, the reader under `publishing/emacs/lisp/`, the pinned lexicon
corpora, and `firstpair-emacs validate`; the source repository owns the
record maps, part grouping, lexicon include/exclude lists, and the
book-specific guide fragment. Never produce the delivered `.info` with
`makeinfo`; the builder writes it so marked-word positions stay exact. A bundle
is validated only when the inventory, structural Info, link, lexicon,
`makeinfo`, and `emacs --batch` gates all pass.

Before resolving even a dry-run vault plan, look for the source repository's
`scripts/check-obsidian-vault.py`. If present, `library:publish` must run it
against the resolved vault and fail closed before staging or ZIP creation. A
repository with both `pyproject.toml` and `uv.lock` is validated through its
locked uv project; an executable or readable standalone validator is invoked
directly or with `python3`. Repositories without a source-owned validator keep
the structural `Home.md` plus `_data/units.jsonl` compatibility check.

Create or update `public/<book-stem>/README.md`. The README should briefly
overview the book, link the stable PDF and EPUB deliverable routes, link the
hosted single-file and chapter readers, and point back to the original source
repository that owns the manuscript, metadata, version manifest, and builds.

Deliver the same PDF and EPUB to `~/icloud/books` as regular files carrying
their versioned names. Do not create iCloud symlinks: the reading-library files
must remain self-contained if moved or synchronized.

Verify every delivery by exact path and URL:

```sh
npm run books:upload -- <book-stem>
npm run check:catalog
npm run prod:build
npm run smoke:site
cmp -s /absolute/source/book.pdf "$HOME/icloud/books/<versioned-name>.pdf"
cmp -s /absolute/source/book.epub "$HOME/icloud/books/<versioned-name>.epub"
```

For unchanged payloads, `npm run books:upload -- <book-stem>` should report
`skipped: true` for existing file units and `uploadedFileCount: 0` for skipped
chapter packages.

## Public Preview Delivery

Public previews live inside the same title directory as the finished book would
use, under a `preview/` package:

```text
public/<book-stem>/preview/
```

Each preview package keeps its landing page, README, and manifest in `public/`;
preview artifacts are Blob-backed and linked from the page, docs, and catalog:

```text
public/<book-stem>/preview/index.html
public/<book-stem>/preview/README.md
public/<book-stem>/preview/PREVIEW.md
```

Do not create a separate `public/books/` namespace. Do not keep duplicate public
artifact copies in old preview locations. The source book repository remains
the authority for manuscript text, metadata, versions, and build logic; FirstPair
receives only the public package.

After adding or moving a public package, update `public/catalog.json`, run the
site build, and check every catalog PDF, EPUB, hosted HTML reader, hosted
chapter reader, and preview landing page.

## Deployment Cadence

Binary book artifacts are heavyweight public deliverables. Do not redeploy the
entire binary library just to ship app-shell, catalog-text, or documentation
changes.

When adding or refreshing public book artifacts, upload one book package at a
time:

```sh
npm run books:upload -- <book-stem>
```

Finish and verify that book's live routes before starting another book upload.
If a later change only touches Vue/CSS/docs/catalog text, do not intentionally
re-upload unchanged PDF or EPUB files. Prefer a deployment path that reuses the
already-live book artifacts, or wait until the next single-book artifact
delivery if the hosting surface cannot update code without resending binaries.

## Repository Hygiene

The worktree may contain unrelated application or preview changes. Preserve
them. Stage or commit only the public-book delivery and guidance files when the
user asks for a commit.
