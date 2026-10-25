# FirstPair Reader

The offline reader for every FirstPair vault. It makes no network requests,
and it writes nothing to the vault unless you switch on its editing tools.
With the plugin disabled, the vault's Markdown notes remain a complete book.

## What it reads

The Reader finds the vault's indexes on its own, at the root and in each
top-level folder (one book per folder; paths in an index are vault-relative
and include the folder): `_data/reader.json` (schema
`firstpair-reader.v2`), an aligned edition's `_data/parallel-reader.json`, a
1.x page list, a Cicero-style `reader.json`, a `Reader/reader-index.json`, a
mobile edition library, or a code book (`_data/fragments.json` beside a
`Chapters/` folder). See `contract.js`; `FEATURES.md` maps every feature of the
readers this one replaced.

## Reading

- **Rail** — Previous · Up · Back · Top · TOC · Next (plus Previous word and
  Next word when the vault has dictionaries), at the top by default (Obsidian's
  own bottom bar covers a bottom rail) or, by setting, at the bottom.
  Controls are icons; their names are tooltips and accessible labels.
  Previous and Next show their destinations' titles small under the icon. Up climbs page → part →
  contents → library; TOC shows the contents with your page marked; Back
  returns to exactly where you were, including the footnote you came from;
  Top can be undone with Back. Every control is also a command.
- **Static notes open the Reader** at the same place: the launcher, contents,
  part, and page notes.
- **Shelf** — a vault with several books (the root index and each top-level
  folder holding its own `_data/reader.json` or other index) opens on a shelf
  listing them with their title, `author`, `subtitle`, and language pair. Tap a
  book to resume it; Up from its contents, or **Open the shelf**, returns.
  Each book keeps its own page, Back history, languages, and interface
  language (its `ui_lang`); a book's notes and links open that book, and the
  vault's own Home opens the book read last. One book: no shelf.
- **Libraries** list editions by family; pages are cut from the Part notes.
- **Footnotes, headings, and book links** stay inside the Reader. Source
  passages open in place or, with the setting, in a new tab. A quotation that
  links one reviewed source passage becomes a rail: tap the whole block.
- **Find the source of the selected quote** (command) matches a quotation
  against the vault's reviewed quote index.
- **Code books** show fragment cards; Show code lists the numbered lines,
  Open file opens the code note with those lines marked.

## Languages and dictionaries

Aligned editions put the source text first. Switch translations on and off,
rotate a language's translations from its header, or add a second column of
the same language. Layout follows the screen (Auto), or stays in Columns or
Stacked. On a phone, Columns become tabs: tap one or swipe the text, and the
chosen language opens first on every page.

An edition may make its source optional (`sourceLanguage.optional`, hidden by
default with `defaultVisible: false`): it then reads as the translation
alone, and the source's toggle adds it as a study column. Units that carry
`words` (`[text, reading, gloss]` per word) show them interlinear when the
edition declares `interlinear`: one button cycles Text, + Reading (pinyin
above each word), and + Gloss (the word's meaning below it). Units may carry a
`kind` (`heading`, `quote`, `footnote`, `cover`) for their styling.

Glosses can come in several languages. `words[i][2]` is in the edition's
primary gloss language, `interlinear.glossLang` (else the first
translation's); a unit may add `glosses: {"<lang>": [...]}`, one string per
word, for others. The glosses follow the translations on screen: the first
shown column's language, else the next shown one this unit has, else
`words[i][2]`; with only the source shown, the book's `ui_lang`. On a phone
the translation tab chosen last leads. When a page offers more than one gloss
language, a picker beside the word-layer button (and the command **Next gloss
language**) fixes one for the book; **Auto** follows the columns again.

Tap a source word, or step through words with the double chevrons, for its
dictionary entries in every shown language. Multilingual source tables get one
language bar per note; at least one language stays on.

## Editing tools (optional)

Settings → **Editing tools** adds a **Sentence & words** toggle to each page.
It puts a **Words** button beside every paragraph, list item, and heading;
pick words (tap or drag on a phone, checkboxes on a Mac) and attach a note:
typed, recorded with **🎙 Voice**, or both. Noted spans are coloured, up to
three may overlap (overlapping ones in different colours, shared words
striped; voice notes in their own green/pink/yellow palette), and tapping a
coloured word reopens its note. This is the same
editor module FirstPair Triptych uses (`shared/span-editor.js`), so the two
behave alike. A recording is saved and verified
under `Preferences/voice/` before anything refers to it; transcription (local
`mlx_whisper` on a Mac, or an OpenAI-compatible service) follows and never
replaces it. Notes go to the shared `Preferences/triptych-decisions.json` with
its `.sha256` check and `EDITING-INSTRUCTIONS.md` digest, the same files
FirstPair Triptych uses. A note whose text has changed is listed below the
page, never moved onto other words.

## For builders

Author `main-source.js` and its modules, then bundle the single release file:

```sh
python3 publishing/scripts/bundle-obsidian-plugin.py publishing/vault/plugin/firstpair-reader
```

The bundle embeds the shared modules (`../shared/*.js`, including the span
editor, and FirstPair Triptych's `review-state.js`), and `styles-source.css`
is expanded with `../shared/span-editor.css` into `styles.css`. Vaults install `manifest.json`, `main.js`,
`styles.css`, and this README, disabled by default.
