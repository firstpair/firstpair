# Publishing Emacs Editions Through the FirstPair Pipeline

## Status

Proposal. The builder, reader, verifier, and Cicero adoption are complete and
committed (`publishing/emacs/`, `firstpair-emacs`, Cicero `vault.build.json`).
Nothing is published yet: a validated bundle exists only under
`book/dist-emacs/` in the source repository. This document proposes how a
bundle becomes a public deliverable, and how the Cicero preview goes out first.

## What a reader receives

One ZIP per edition, named like the vault archives so every companion of a
book sorts together in iCloud, staging, and Blob:

```text
cicero-on-himself-preview-emacs (2.0.0-sol-40fff84e).zip
└── Cicero on Himself Emacs Preview/      ← the validated bundle directory, unchanged
    ├── init.el                            (load "…/init.el") then M-x firstpair-read
    ├── cicero-on-himself.info
    ├── cicero-on-himself-refs.info
    ├── dir
    ├── Guide.md  README.md                the complete layered first-use manual
    ├── lisp/                              firstpair-bundle, -lexicon, -reader
    ├── data/  lexicon/  evidence/  texi/
    └── FIRSTPAIR-EMACS-MANIFEST.json
```

The archive contains exactly the directory that `firstpair-emacs validate`
passed: no workspace state to strip, no plugin consent to inject, no
`.DS_Store`, no compiled Lisp. The manifest inside binds the bytes to the
source commit, product, and edition. Loading is two lines in the guide;
nothing is installed system-wide. `install-info` integration and a standalone
`firstpair-reader` package are deliberately later phases (below).

Two hosted surfaces accompany the ZIP, mirroring the vault:

| Surface | Route | Source |
| --- | --- | --- |
| Download | `/<slug>/emacs/` | Blob `books/<slug>/emacs/<sha16>-<zipName>` |
| Guide | `/read/<slug>/emacs-guide/` | the bundle's `Guide.md`, rendered by `render-vault-guide.mjs` |
| Handbook | `/emacs/` | `publishing/emacs/guides/master.md` (the guide already links here) |

## Publisher option

`library:publish` gains `--emacs`, parallel to `--vault`:

```text
--emacs                Deliver the Emacs bundle declared for the selected edition.
--emacs-dir <dir>      Explicit bundle directory (implies --emacs).
--emacs-guide <file>   Override the guide (default: the bundle's Guide.md).
```

Resolution order, all deterministic and fail-closed:

1. **Discover.** Read the source repository's `vault.build.json`
   `emacs.products.{preview|desktop}.output` for the selected edition
   (`preview` unless `--full`). Fall back to `book/dist-emacs/` name
   matching only when the config has no `emacs` block. A full bundle is never
   selected without `--full`, exactly as for vaults.
2. **Validate.** Run `publishing/scripts/firstpair-emacs validate --bundle
   <dir>` — the analogue of the source-owned `check-obsidian-vault.py` gate,
   but FirstPair-owned. It must pass before even a `--dry-run` plan resolves.
   Then cross-check the bundle manifest: `sourceCommit` must equal the source
   repository HEAD that `git_publish_preflight.py` verified, `edition` must
   match the selected edition, and `product` must be `preview` or `desktop`
   accordingly. A stale bundle built at an earlier commit is a stop condition,
   not a warning.
3. **Stage.** Archive the directory with the Python archiver already used for
   vaults (deterministic entries, root folder = bundle directory name, no
   Apple resource forks) as
   `book-uploads/staging/<slug>/<slug>-<edition>-emacs (<stamp>).zip`; copy
   `Guide.md` beside it as `<slug>-emacs-guide (<stamp>).md` and render it to
   `<slug>-emacs-guide (<stamp>).html`. Extract-and-compare `README.md` from
   the ZIP to the staged guide, as the vault path does.
4. **Record.** `book-uploads/book-package-sources.json` gains `emacs`,
   `emacsGuideMarkdown`, `emacsGuideHtml` for the slug.
5. **Upload.** `upload-book-package.mjs` learns two kinds: `emacs` (ZIP) and
   `emacs-guide` (HTML, Markdown required beside it). It writes catalog fields
   `emacs`, `emacsGuide` (`/read/<slug>/emacs-guide/`), and
   `emacsGuideSource` (the HTML Blob URL) into `public/catalog.json`.
6. **Serve.** `vercel.json` adds `emacs` to the deliverable route
   (`^/([A-Za-z0-9-]+)/(pdf|epub|vault|mobile-vault|emacs|cover)/?$`);
   `api/deliverable` resolves `format=emacs` from the catalog;
   `reader-map.mjs` and `deliverable-map.mjs` carry the guide source and the
   download; `check-public-catalog.mjs` validates the three new fields with the
   same rules as the vault guide (route form, `https://`, `.html`).
7. **Surface.** `public/<slug>/README.md` gains "Download the Emacs edition"
   and "Read the Emacs guide" lines through `readmeFor`/`readmeWithUpdatedLinks`;
   the Vue catalog card shows an **Emacs** button beside **Vault** when
   `book.emacs` is set.
8. **Deliver.** `copyCompanionsToIcloud` copies the ZIP and the Markdown guide
   to `~/icloud/books` beside the vault archives, with the same `cmp -s`
   verification.

Everything above is additive: a title without an `emacs` block, or a publish
without `--emacs`, behaves exactly as today.

### Site handbook

Add `scripts/build-emacs-handbook.mjs`, a copy of the Obsidian handbook
builder pointed at `publishing/emacs/guides/master.md`, producing
`public/emacs/index.html` and `src/generated/emacs-handbook.ts`, with the
required-heading check listing "Install Emacs", "Open the book", "References
open below the text", "The dictionary window", "Reading without the FirstPair
reader", and "Updating a FirstPair bundle". Route `^/emacs/?$` joins
`vercel.json`. `npm run build:emacs-handbook` runs beside
`build:obsidian-handbook`.

### Tests

- `publishing/tests/test-emacs-delivery.mjs`: build the fixture bundle from
  `test_firstpair_emacs.py`'s config, then exercise discovery from
  `vault.build.json`, the validate gate (a tampered `dir` file must stop the
  plan), archive layout (single root folder, `README.md == Guide.md`, no
  `.elc`/`.DS_Store`/`firstpair-check.el`), the edition mismatch stop, and the
  `--dry-run` plan JSON.
- `test-obsidian-handbook.mjs` gains an Emacs twin.
- `check:catalog` fixtures gain a book with `emacs*` fields.
- `npm run test:emacs-framework` already covers the builder and reader.

## Publishing the Cicero preview

Cicero's preview is the first public Emacs edition. The sequence, after the
publisher option lands:

1. On `master` (now `40fff84`, clean and pushed), rebuild both bundles so
   their manifests bind to the commit being published — the ones built today
   carry `406c6c5` and would be refused:

   ```sh
   rm -rf "book/dist-emacs/Cicero on Himself Emacs Preview"
   ~/src/firstpair/publishing/scripts/firstpair-emacs build vault.build.json --product preview
   ~/src/firstpair/publishing/scripts/firstpair-emacs validate \
     --bundle "book/dist-emacs/Cicero on Himself Emacs Preview"
   ```

2. Open it once by hand (`M-x load-file init.el`, `M-x firstpair-read`, one
   citation, one `C-c C-d`, `C-c C-g`, `q`) and record the check in
   `PROMPTS.md`/`AGENTS.md` as the vault reviews are recorded.
3. Dry run, with the vault flags Cicero already uses:

   ```sh
   cd ~/src/firstpair
   npm run library:publish -- /Users/alexy/src/cicero \
     --vault-dir "book/dist-obsidian/Cicero on Himself Preview Vault" \
     --vault-guide docs/OBSIDIAN-PREVIEW-VAULT.md \
     --emacs \
     --title "Cicero on Himself" \
     --description "The complete Proem of Cicero on Himself, with a companion bilingual source vault and an Emacs Info edition whose Latin quotations open their witnesses and their dictionary entries." \
     --tags "preview,history,Cicero" \
     --dry-run --no-build --no-smoke --no-deploy --no-icloud
   ```

4. Live run without the `--dry-run … --no-icloud` flags. The plan uploads the
   preview ZIP and guide, updates the catalog and route maps, copies the
   versioned files to iCloud, deploys, and checks the live catalog.
5. Update `FIRSTPAIR.md`'s deployment commands to include `--emacs`, and the
   catalog description above.

The complete bundle stays local. Publishing it requires `--full` and the
separate complete-book warning and confirmation, unchanged.

## Done alongside this proposal

- **Standalone reader package.** `firstpair-emacs package` assembles
  `firstpair-reader-<version>.tar` from `publishing/emacs/lisp/` with the
  handbook as its Info manual; `package-vc-install` with
  `:lisp-dir "publishing/emacs/lisp"` installs from the repository. Bundles
  keep shipping `lisp/`, appended to `load-path` so the package wins.
  Publishing the tar to the site (`/emacs/` handbook page plus a download)
  and a MELPA recipe are the remaining steps.
- **System Info directory.** Every bundle ships `install.sh`, and the reader
  provides `firstpair-reader-install-info`; both use `install-info` when
  present and Emacs's own `dir` updater otherwise.

## Later phases

- **Other titles.** Sail Rust Book proves the `code` profile (code excerpts
  as reference nodes with `C-c C-f` opening the delivered files); Lighthouse
  Republics reuses the `history` profile. Both need only an `emacs` block.
- **Complete edition.** When the full Cicero release is authorised, the same
  `--full --emacs` path publishes `cicero-on-himself-full-emacs (…).zip`.

## Decisions to confirm

1. ZIP, not tar.gz, so every companion shares one archiver, one iCloud
   convention, and one deliverable route family.
2. Route name `emacs` (not `info`): the deliverable is the Emacs bundle;
   plain Info readers are served by it too.
3. The Emacs guide gets its own route, `/read/<slug>/emacs-guide/`, rather
   than being folded into the vault guide; the two manuals address different
   readers.
4. The reader Lisp ships inside every bundle now; the standalone package is
   an addition, never a replacement.
