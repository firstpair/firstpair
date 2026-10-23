# FirstPair Review

A desktop review app for a book's whole history: every edition loaded as
data, compared on demand, with decisions saved in the same ledger the
Obsidian plugins use. Vue 3 and Vite, deployable to Vercel as a static site.

| View | What it shows |
|---|---|
| **Releases** | Every edition by family; each release with a bar of what it did to its parent (rewritten, added, cut, split, merged). Pick two to four editions of one language to compare. |
| **Release** | One release against its parent: counts by kind, Part by Part, and the changed passages. |
| **Compare** | Two to four editions Part by Part, aligned through their lineages. Two editions: the pair diff, filterable by kind of change. Three or four: the set diff with the history lens. Prefer a version per row; attach notes to words. ← / → turn Parts. |
| **Passage** | One passage through every release that has it, each version diffed against the previous one. |
| **Rules** | For any two editions of one language across the whole book: words changed per Part by kind, and recurring one-word substitutions with Accept / Reject. |
| **English ↔ Russian** | Structural pairing of an English and a Russian edition (never a translation claim), with each row's length drift and extra paragraphs. |
| **Decisions** | Where decisions are saved, and the `EDITING-INSTRUCTIONS.md` digest they make. |

Back and Forward (top left, or Alt ← / Alt →) retrace every move; the URL
holds the current place, so any view can be bookmarked.

## Data

The app reads one folder in the `firstpair.review.v1` format, written by the
book's exporter (Lighthouse Republics: `scripts/export-review-app.py`):

- `manifest.json`: editions (id, family, language, version, commit, Parts
  with their files), the English-Russian pairs, lemma tables, function
  words, and a `content_id` over everything;
- `graph.json`: the paragraph table (`units`, `unit_edition`, `unit_part`),
  release `transitions`, alignment `events`
  (`[transition, kind, from[], to[], similarity]`), and `lineages`;
- `editions/<edition>/<part>.json`: `[[unit, kind, text, chapter], ...]`,
  loaded only when a view needs that Part;
- `crosslang/<left>--<right>.json`: aligned pages and Part titles;
- `lemmas/<lang>.json`: word to lemma, so the diff tells an inflection from
  a new word.

Diffs are computed in the browser by `src/lib/engine.js`, a port of
`publishing/vault/edition_diffs.py` that marks exactly the same ranges
(`npm test` checks the two against each other); whole-book scans run in a
worker.

## Shared modules

The decisions ledger and digest (`firstpair-triptych/review-state.js`,
`shared/ledger-store.js`), the word picker and span colours
(`shared/span-editor.js`), diff classes and lenses (`shared/diff-view.js`),
the rules and heat-map renderers, and the Back/Forward history
(`shared/nav-history.js`) are the files the Obsidian plugins bundle. A Vite
plugin (`vite/plugins.js`) loads them as ES modules unchanged, so an
improvement there reaches the app and every vault.

## Run locally

```sh
npm install
REVIEW_DATA=/path/to/book/dist-review/data \
REVIEW_DECISIONS=/path/to/book/review \
npm run dev            # http://127.0.0.1:5190
```

In Lighthouse Republics, `scripts/review-app.sh` exports (when needed) and
starts the app. During development the Vite server saves decisions under
`REVIEW_DECISIONS/Preferences/` through `/api/fs`, which cannot leave that
folder.

## Deploying to Vercel (later)

`vercel.json` builds the static app into `dist/`. Deployed, decisions are
saved into a folder you pick in Chrome, Edge, or Arc (File System Access
API); Safari cannot save into a folder.

The book's data is copied into a build only when asked:
`REVIEW_DATA=… REVIEW_INCLUDE_DATA=1 npm run build`. That puts every
edition's full text on the site, which is publishing it. Do it only with
the author's explicit go-ahead, behind Vercel's deployment protection.
