# QueryGraph-Family Publishing Workflows

This document was imported from `/Users/alexy/src/querygraph` into FirstPair.
FirstPair is now the canonical local home for the reusable scripts and workflow
cards; QueryGraph remains the original template source and a useful snapshot.

It is intentionally specific: the goal is to expose the differences between
repos so future work can migrate them deliberately instead of flattening useful
local conventions.

## Executive Comparison

| Repo | Primary output | Source layout | Formatter path | Diagram strategy | Delivery target | Centralization status |
|---|---|---|---|---|---|---|
| `typesec` | Book PDF/EPUB/MOBI, blog textpacks | `docs/book/`, `docs/blog/<post>/` | Pandoc + Typst PDF; Pandoc EPUB | Book uses inline Mermaid Lua render; blogs use committed PNGs | `~/icloud/books`; blog textpacks increasingly go to `~/icloud/blogs` | Original template for title/version/EPUB discipline |
| `lakecat` | Book PDF/EPUB/MOBI | `docs/book/` | Pandoc + Typst PDF; Pandoc EPUB | Extracts fenced Mermaid to persistent `.mmd` + `.png` | `~/icloud/books` when available | Best current model for persistent book diagrams |
| `querygraph/qg-rust` | Book PDF/EPUB/MOBI plus blog diagram assets | `qg-rust/docs/book/`, `docs/blog/assets/querygraph/` | Pandoc to Typst body, direct `typst compile`; Pandoc EPUB | Renders book diagrams and mirrors them to blog assets | `~/icloud/books` and archive repo byte-match | Best current model for book/blog shared diagrams |
| `omnighost` | Dual formatter book outputs; textpack tooling | `docs/book/`, `scripts/textpack.py` | Typst and troff/ms PDFs; Pandoc EPUB | Book diagrams rendered before build | `~/icloud/books`; textpack import into Omnighost | Best current model for Typst/troff comparison and importable textpacks |
| `slavapost` | Newsletter/blog drafts | `articles/`, `edited/`, `publish-ready/` | Manual Ulysses/Ghost publishing | Uses local `file://` images for Ulysses resolution | Ulysses to Ghost | Operational publishing knowledge, not a book pipeline |
| `books/chiefscientist-books` | Archive refresh and delivery | per-book archive folders | Reuses source repo artifacts | No source diagram generation | `~/icloud/books` | Best model for exact `VERSION.md` delivery checks |

## Central Reference Files

| File | Purpose | Replaces or generalizes |
|---|---|---|
| `~/src/firstpair/publishing/PUBLISH.md` | Stack-wide runbook for books, blogs, diagrams, EPUB repair, Neatroff, and iCloud delivery | Repo-local `docs/book/PUBLISH.md` conventions |
| `~/src/firstpair/publishing/scripts/build-book.sh` | Configurable Typst/troff book build | TypeSec/LakeCat/QueryGraph/OmniGhost `docs/book/build.sh` variants |
| `~/src/firstpair/publishing/scripts/render-mermaid.mjs` | Persistent Mermaid `.mmd` + `.png` renderer | LakeCat and QueryGraph diagram renderers |
| `~/src/firstpair/publishing/scripts/textpack.py` | Ulysses/Omnighost `.textpack` builder | TypeSec and OmniGhost `scripts/textpack.py` |
| `~/src/firstpair/publishing/scripts/publish-versioned-artifacts.sh` | Book artifact copy to `~/icloud/books` | Ad hoc repo-local copy steps |
| `~/src/firstpair/publishing/scripts/publish-versioned-blog.sh` | Blog textpack build + versioned copy to `~/icloud/blogs` | Emerging centralized blog delivery workflow |
| `~/src/firstpair/publishing/scripts/check-version-marker.sh` | `VERSION.md` stable/versioned artifact check | Repeated manual `readlink`, `cmp`, and filename checks |

## Book Layout Differences

| Repo | Book root | Manuscript filename | Build scratch | Dist root | Version marker |
|---|---|---|---|---|---|
| `typesec` | `docs/book/` | `typesec.md` | `mktemp` only | `docs/book/dist/` | `docs/book/dist/VERSION.md` |
| `lakecat` | `docs/book/` | `lakecat.md` | `mktemp`, Pandoc runs inside scratch | `docs/book/dist/` or `LAKECAT_BOOK_DIST_DIR` | `docs/book/dist/VERSION.md` |
| `querygraph/qg-rust` | `qg-rust/docs/book/` | `manuscript.md` | tracked `build/` plus `mktemp` | `qg-rust/docs/book/dist/` | `qg-rust/docs/book/dist/VERSION.md` |
| `omnighost` | `docs/book/` | `omnighost.md` | `mktemp` | `docs/book/dist/` | `docs/book/dist/VERSION.md` |

The central workflow defaults to `docs/book/manuscript.md`, but every important
path is configurable:

```sh
BOOK_ROOT=docs/book \
BOOK_MANUSCRIPT=docs/book/lakecat.md \
BOOK_FORMATS=typst \
~/src/firstpair/publishing/scripts/build-book.sh
```

## Version and Naming Differences

| Repo | Version source | Stable stem | Versioned name | Hash included? | Notes |
|---|---|---|---|---|---|
| `typesec` | `[workspace.package].version` in `Cargo.toml` | `typesec` | `typesec (<version>-<hash>).epub` in current script | Yes in current script | Older docs sometimes describe `typesec (<version>)`; newer artifacts use traceable hash stamps |
| `lakecat` | `[workspace.package].version` in `Cargo.toml` | `lakecat` | `lakecat (<version>-<hash>).epub` | Yes | Also creates versioned PDF links |
| `querygraph/qg-rust` | `[package].version` in `qg-rust/Cargo.toml` | `querygraph` | `querygraph (<version>-<hash>).epub` | Yes | Mirrors diagrams to blog assets |
| `omnighost` | root `package.json` | `obsidian-typst`, `obsidian-troff` | `<stem> (<version>-<hash>).epub` | Yes | Keeps catalog title at `<stem> (<version>)` but delivery link includes hash |
| Blog textpacks | Cargo/package/override | `<slug>` | `<slug> (<version>-<hash>).textpack` | Yes | Delivery target is `~/icloud/blogs` |

The central convention is:

```yaml
version_stamp: <version>-<short-git-hash>
built_at: YYYY-MM-DD
epub_file: <stem>.epub
pdf_file: <stem>.pdf
epub_link: <stem> (<version>-<short-git-hash>).epub
pdf_link: <stem> (<version>-<short-git-hash>).pdf
```

For compatibility, the helper scripts also accept older `kindle_link` fields.

## Formatter Differences

| Repo | PDF cover | PDF body | EPUB | MOBI | Distinctive concern |
|---|---|---|---|---|---|
| `typesec` | Pandoc Markdown cover through Typst | Pandoc Markdown through Typst | Pandoc EPUB, then `fix_epub_layout.sh` | Calibre app bundle | Clean visible title; versioned Kindle metadata |
| `lakecat` | Pandoc Markdown cover through Typst | Pandoc Markdown through Typst | Pandoc EPUB, then `fix_epub_layout.sh` | Calibre app bundle | Scratch isolation and artifact contract script |
| `querygraph/qg-rust` | Pandoc Markdown cover through Typst | Pandoc to Typst, inject outline, direct `typst compile` | Pandoc EPUB, then `fix_epub_layout.sh` | PATH or Calibre app bundle | Blog diagram mirroring and first-diagram font-scale normalization |
| `omnighost` | Raw Typst block and raw ms block | Typst path plus troff/ms path | Pandoc EPUB for both stems | Optional PATH Calibre | Troff font embedding and dual formatter artifacts |

Key excerpt, dual formatter naming from `omnighost/docs/book/build.sh`:

```sh
base_stem="$title_stem"
case "$base_stem" in
  *-typst) base_stem="${base_stem%-typst}" ;;
  *-troff) base_stem="${base_stem%-troff}" ;;
esac
typst_stem="$base_stem-typst"
troff_stem="$base_stem-troff"
```

Centralized equivalent:

```sh
BOOK_FORMATS=typst,troff ~/src/firstpair/publishing/scripts/build-book.sh
```

## Diagram Differences

| Repo | Source representation | Rendered output | Book inclusion | Blog inclusion | Central lesson |
|---|---|---|---|---|---|
| `typesec` | Inline fenced Mermaid in manuscript | Temporary PNGs via Lua filter | Build-time only | Blog posts require committed PNGs | Good for simple book builds, weaker for reusable assets |
| `lakecat` | Inline fenced Mermaid in manuscript | Persistent `docs/book/diagrams/diagram-NN.{mmd,png}` | Rendered manuscript references `diagrams/*.png` | Not mirrored by default | Strong book reproducibility |
| `querygraph/qg-rust` | Inline fenced Mermaid in manuscript | Persistent book diagrams and copied blog diagrams | Rendered manuscript references `diagrams/*.png` | `docs/blog/assets/querygraph/diagrams/` | Strongest book/blog asset bridge |
| `omnighost` | Diagram files and rendered PNGs | Persistent `docs/book/diagrams/` | Manuscript references PNGs | Textpacks bundle PNGs | Strong delivery compatibility |
| Blog posts | `diagrams/*.mmd` next to `post.md` | `diagrams/*.png` | Not applicable | Bundled into `.textpack/assets/` | Final posts should not ship raw Mermaid |

Key excerpt, persistent Mermaid replacement pattern:

```js
const rendered = source.replace(/```mermaid\n([\s\S]*?)\n```/g, (_m, body) => {
  const stem = `diagram-${String(++index).padStart(2, "0")}`;
  writeFileSync(path.join(diagramDir, `${stem}.mmd`), `${body.trim()}\n`);
  renderMermaid(...);
  return `![Diagram ${index}](diagrams/${stem}.png)`;
});
```

Central script:

```sh
node ~/src/firstpair/publishing/scripts/render-mermaid.mjs \
  docs/book/manuscript.md \
  docs/book/build/manuscript.rendered.md \
  docs/book/diagrams \
  --blog-dir docs/blog/assets/querygraph/diagrams
```

## EPUB Repair and Validation Differences

| Repo | Repair script | Validator | Visible title check | Versioned alias check | CSS/code checks |
|---|---|---|---|---|---|
| `typesec` | `docs/book/fix_epub_layout.sh` | `check_epub_metadata.sh` | Yes | Yes | Yes |
| `lakecat` | `docs/book/fix_epub_layout.sh` | `check_epub_metadata.sh` | Hard-coded LakeCat in current checks | Yes | Yes |
| `querygraph/qg-rust` | `fix_epub_layout.sh` | `check_epub_metadata.sh` | Expected visible title argument | Yes | Yes |
| `omnighost` | `fix_epub_layout.sh` | `check_epub_metadata.sh` | Versioned formatter titles | Yes | Yes |

Common repair duties:

```sh
# cover first, nav second and non-linear
<spine toc="ncx">
  <itemref idref="ch001_xhtml" />
  <itemref idref="nav" linear="no" />

# OPF catalog title set to delivery-facing name
<dc:title>typesec (0.12.0-a1b2c3)</dc:title>
<meta refines="#epub-title-1" property="file-as">typesec (0.12.0-a1b2c3)</meta>
```

Common validation blockers:

| Blocker | Why it matters |
|---|---|
| `UNTITLED` or `Unknown` metadata | Kindle/Ghost/Ulysses surfaces display junk titles |
| generated `title_page.xhtml` | Pandoc created an extra blank title page |
| nav before cover in spine | Reader opens on navigation instead of cover |
| cover wrapper heading | Pandoc leaked a body heading into custom cover |
| flexbox in EPUB cover | Fragile in Kindle renderers |
| missing compact code CSS | Pandoc source spans create large vertical gaps |

## Blog and Textpack Differences

| Repo | Blog source | Bundle script | Bundle contents | Delivery | Publication path |
|---|---|---|---|---|---|
| `typesec` | `docs/blog/<name>/post.md` | `scripts/textpack.py` | Markdown, `info.json`, local images | Emerging `~/icloud/blogs` | Omnighost import or Ulysses |
| `omnighost` | Any post file or post directory | `scripts/textpack.py` | Same as TypeSec, with Omnighost metadata | Import into Obsidian vault | Omnighost sync to Ghost |
| `slavapost` | `edited/`, `publish-ready/` | None | Plain Markdown with local images | Manual | Ulysses publishes to Ghost |
| Central workflow | `docs/blog/<slug>/post.md` | `publishing/scripts/textpack.py` plus `publish-versioned-blog.sh` | Versioned `.textpack` | `~/icloud/blogs` | Omnighost import or Ulysses |

Textpack zip layout:

```text
<slug>.textbundle/
  text.markdown
  info.json
  assets/<image>.png
```

Key excerpt, image rewrite from source paths to bundled assets:

```python
def to_asset(match):
    alt, rel = match.group(1), match.group(2)
    src = os.path.normpath(os.path.join(post_dir, rel))
    base = os.path.basename(rel)
    images[base] = src
    return f"![{alt}](assets/{base})"
```

Central blog delivery command:

```sh
BLOG_DOMAIN=querygraph.ai \
BLOG_TAGS=querygraph,release \
~/src/firstpair/publishing/scripts/publish-versioned-blog.sh docs/blog/<slug>
```

The builder versions the source post and referenced local assets first, embeds
the resulting Git commit and a portable payload SHA-256 for Omnighost import,
then computes the delivery filename stamp from the post-build repository state.

It writes:

```yaml
blog_name: <slug>
blog_domain: querygraph.ai
slug: <slug>
version_stamp: <version>-<hash>
built_at: YYYY-MM-DD
textpack_file: <slug>.textpack
textpack_link: <slug> (<version>-<hash>).textpack
```

and copies:

```text
~/icloud/blogs/<slug> (<version>-<hash>).textpack
```

## Delivery Differences

| Target | Artifact type | Source of truth | Copy rule | Verification |
|---|---|---|---|---|
| `~/icloud/books` | EPUB/PDF | `docs/book/dist/VERSION.md` | Copy stable artifact bytes to versioned destination name | `cmp -s`, `stat`, optional checksum |
| `~/icloud/blogs` | `.textpack` | `docs/blog/<slug>/dist/VERSION.md` | Copy stable `.textpack` bytes to versioned destination name | `cmp -s`, `stat` |
| Archive repos | PDF/EPUB/MOBI | Source repo dist plus archive runbook | Byte-match source and archive copies | `cmp`, `stat`, `pdftotext`, `zipgrep` |
| Ghost | Published post | Omnighost/Ulysses state | Import/sync from textpack or Ulysses draft | Ghost editor/public URL checks |

Important machine-specific rule: avoid starting with broad listings of iCloud
directories. Exact file probes are more reliable:

```sh
cmp -s "docs/book/dist/$epub_file" "$HOME/icloud/books/$epub_link"
cmp -s "docs/blog/$slug/dist/$slug.textpack" "$HOME/icloud/blogs/$textpack_link"
```

## Migration Plan

| Step | Action | Notes |
|---|---|---|
| 1 | Keep repo-local `docs/book/build.sh` entrypoints | They can call central scripts with repo-specific env vars |
| 2 | Normalize `VERSION.md` fields | Prefer `epub_link`/`pdf_link` and accept `kindle_link` during transition |
| 3 | Move book diagrams toward persistent `.mmd` + `.png` | Especially repos still using temporary Mermaid filters |
| 4 | Add `docs/blog/<slug>/dist/VERSION.md` for posts | Mirrors book delivery discipline |
| 5 | Deliver textpacks to `~/icloud/blogs` | The pack is the portable Ulysses/Omnighost handoff |
| 6 | Keep validators local where titles are repo-specific | Central scripts should call repo-local validators rather than over-generalize metadata rules |

## Open Differences To Preserve

Not every difference should disappear.

| Difference | Preserve? | Reason |
|---|---|---|
| QueryGraph mirrors diagrams to blog assets | Yes | The book and blog share explanatory figures |
| OmniGhost builds troff and Typst PDFs | Yes | It is explicitly comparing formatter outputs |
| SlavaPost uses Ulysses/Ghost manual review | Yes | Editorial workflow includes author/date/manual draft checks |
| Repo-local EPUB validators | Yes for now | Visible-title and creator rules differ by book |
| Version hash in delivery filename | Yes | It makes artifacts traceable to a source commit |
| Clean visible titles | Yes | Reader-facing title should not become release metadata clutter |

## Current Reference Commands

Book, single formatter:

```sh
REPO_ROOT=/path/to/repo \
BOOK_ROOT=docs/book \
BOOK_MANUSCRIPT=docs/book/manuscript.md \
~/src/firstpair/publishing/scripts/build-book.sh
```

Book, Typst and troff:

```sh
REPO_ROOT=/path/to/repo \
BOOK_ROOT=docs/book \
BOOK_MANUSCRIPT=docs/book/omnighost.md \
BOOK_FORMATS=typst,troff \
~/src/firstpair/publishing/scripts/build-book.sh
```

Book delivery:

```sh
~/src/firstpair/publishing/scripts/publish-versioned-artifacts.sh \
  /path/to/repo/docs/book/dist "$HOME/icloud/books"
```

Blog textpack delivery:

```sh
REPO_ROOT=/path/to/repo \
BLOG_DOMAIN=querygraph.ai \
~/src/firstpair/publishing/scripts/publish-versioned-blog.sh \
  docs/blog/<slug> "$HOME/icloud/blogs"
```

Contract check:

```sh
~/src/firstpair/publishing/scripts/check-version-marker.sh \
  /path/to/repo/docs/book/dist
```
