# FirstPair Reader 2 — feature matrix

Reader 2 replaces the book readers that grew up beside FirstPair: the
standard `firstpair-reader` 1.7, Cicero's Bilingual Source Navigator 1.3, the
Lighthouse Mobile Reader 1.3.1 (its reading half), the reader side of the
Invented Translation Triptych 2.3.2, `rgbdns-reader` 0.2, and
`sail-code-fragments` 0.1. It takes the reading interface of FirstPair
Triptych 3.1 too. Editorial comparison (whole-pane preference, Good/Bad/Edit,
divergence review, comparison sets) stays in FirstPair Triptych; the Reader's
only editorial feature is the optional span note (text and voice), off by
default.

Legend: **=** kept as it was · **+** kept and improved · **new** first appears
here · **—** deliberately left out (with the reason).

## Navigation

| Feature | From | Reader 2 |
| --- | --- | --- |
| Rail Previous · Up · Back · Forward · Top · TOC · Next | all | **+** one rail, Forward added; Previous/Next word added when the vault has dictionaries (1.7) |
| Rail at the top or the bottom | Cicero | **+** setting for every vault; top by default since 2.4.1, because Obsidian's bottom bar hides a bottom rail; 2.4.2 moves a bottom rail that older versions saved without a choice, takes the iPhone status-bar inset on the top rail, never squeezes the bars, and keeps the page end clear of Obsidian's floating toolbar |
| Previous/Next show the destination title | Cicero, Invented, Triptych, mobile | **+** compact under the icon, ellipsized; aria-label stays the action |
| Icons only, no words naming controls | — | **new** 2.4.1: the rail, layout and word-layer buttons carry their names only as accessible labels and tooltips |
| Up climbs page → part → contents → library | Cicero, Invented, mobile | **+** 1.7's Up/TOC opened `Home.md` and could replace the Reader; both now stay inside |
| TOC shows the contents with the current page marked | Cicero, Invented, mobile | **+** `aria-current`, current part marked too |
| Back: bounded, plain-data history with scroll | all | **+** 100 entries (1.7: 64, Cicero/Invented: 50); restores horizontal track scroll (mobile) and refocuses the exact footnote reference (Cicero) |
| Forward | — | **new** retraces what Back undid; a new step clears it, as in a browser (`shared/nav-history.js`, shared with FirstPair Triptych) |
| Top records history only when scrolled; reduced motion | Cicero, Invented, mobile | **=** |
| History cleared on an external launch | Cicero, Invented, mobile | **+** 1.7 pushed onto the old stack |
| Progress line (page n of N · part) | Cicero, Invented, mobile | **=** `role=status` |
| Commands for every control | Cicero, Invented, mobile | **+** previous, next, back, up, top, contents |
| ← / → turn pages on a hardware keyboard | — | **new** shared with FirstPair Triptych (`shared/page-keys.js`); only in the active Reader, never in text fields, menus, dialogs, or with modifiers |
| Static fallback notes open the Reader at their place (note takeover) | Cicero, Invented, mobile | **+** launcher, contents, part, and page notes of any index format |
| `obsidian://firstpair-reader?page=`; `firstpair:reader` / `firstpair:page:` links as buttons | 1.7 | **=** |
| `firstpair:target:` evidence links | 1.7 | **+** a folder target now explains itself instead of failing silently |
| Resume page, scroll, languages, columns, open word | 1.7 | **+** also mode, part, and edition; since 2.5.0 kept per book (`books.<root folder>` in `data.json`), 2.4.x state migrated onto its book |
| Error view with Retry, never blank | 1.7 | **+** listeners no longer pile up on Retry |
| Stale Backlinks/Outgoing-links leaves removed | Invented, Triptych | **+** only when their core plugin is off |

## Books and formats

| Feature | From | Reader 2 |
| --- | --- | --- |
| Strict, validated index (contiguous order, part partition, unique ids, safe paths) | Cicero, Invented | **+** applied to every format; 1.7 validated nothing |
| Index formats | each its own | **new** one contract reads v2, `parallel-reader.json`, 1.x page arrays, Cicero schema 1, `firstpair.reader.v1`, the mobile library, and code books |
| Shelf: several books in one vault | — | **new** 2.5.0: the root index and every top-level folder with its own index are books; with two or more, a shelf lists them (title, `author`, `subtitle`, language pair) and Up from a book's contents returns to it. Each book has its own place, Back history, languages, and interface language (`ui_lang`); notes and `firstpair:` links open the book whose folder holds them; the vault's own Home and **Open the Reader** open the book read last, else the shelf; command **Open the shelf** |
| Library of editions grouped by family | mobile | **+** families come from the data (mobile hard-coded Main/South/East/West) |
| One prose copy: pages cut from Part notes by markers | mobile | **=** `marker` in v2; `lmr-page` markers in the mobile library |
| Inline page Markdown | Cicero | **=** |
| Cover on the start page | Cicero, Invented | **+** from the index (`cover`) |
| Sources and anthology from the library | mobile | **=** opened in the Reader's note mode with Back |
| Same-view routing for footnotes, headings, book notes | mobile, Cicero | **+** capture-phase binding (mobile delegation is unreliable); new-tab option for sources |
| Reviewed source rails (a quotation's block opens its exact `note#^block`) | Cicero | **+** any book: a blockquote with exactly one block-reference link |
| Quote-to-source finder (inverted index, aliases, certainty rule, filterable picker) | Cicero | **+** any languages via `texts`; Latin folding wherever `la` text appears; index path from the vault |
| Metric chips | Triptych | **new** for reading: `firstpair.triptych-metrics.v1`, keyed by page |

## Aligned editions and dictionaries

| Feature | From | Reader 2 |
| --- | --- | --- |
| Source column first, translations keyed by id, coverage per part, ≈ approximate alignment | 1.7 | **=** |
| Several translations per language: rotate, second column, remembered choice | 1.7 | **=** |
| Auto / Columns / Stacked layouts following width and orientation | 1.7 | **=** |
| Columns on a phone | 1.7 (per-row snap), Triptych, mobile | **+** language tabs that follow taps and swipes; the chosen language opens first on every page |
| Language toggles never reach zero | Cicero | **+** for multilingual source tables: one bar per note (Cicero added one per passage) |
| Optional source column: the translation read alone, the source a toggle | — | **new** `sourceLanguage.optional`; the last shown column cannot be switched off |
| Interlinear word layers (reading above, gloss below) | — | **new** unit `words`, cycled Text / + Reading / + Gloss, remembered with the page |
| Glosses in several languages | — | **new** 2.6.0: `words[i][2]` in `interlinear.glossLang`, other languages in the unit's `glosses.<lang>`; the gloss follows the first shown translation (the last translation tab on a phone), falls back per unit, and with the source alone uses `ui_lang`; a picker and the command **Next gloss language** fix one per book, Auto restores |
| Prefix-sharded dictionaries, longest-prefix lookup, sync warnings | 1.7 | **=** |
| Dictionary on plain Markdown pages | Cicero | **+** words are split inside text nodes, so links and emphasis survive (Cicero replaced the cell) |
| Grammar shown with each entry | 1.7 | **=** (Cicero stored it and never showed it) |
| Merge of repeated senses | 1.7 | **+** only exact repeats; a prefix is another sense (can / canal) |
| Language-aware word normalization | 1.7 (Italian only) | **+** the source language's locale; elided forms (m’) tried as written, then bare |
| Dictionary cache | 1.7 (unbounded) | **+** bounded LRU of eight files |
| Drawer: reserved column, side panel, resizable bottom band, keep open | 1.7 | **=** |
| Drawer closes on Escape and returns focus | Cicero (missing), 1.7 | **+** focus goes back to the word |

## Code books

| Feature | From | Reader 2 |
| --- | --- | --- |
| Fragment cards from code blocks with a `fragments.json` ledger | rgbdns, Sail | **+** `firstpair-fragment`, `rgbdns-fragment`, `sail-fragment` |
| Jump to the code | rgbdns, Sail (broken: targets missing in code notes) | **+** the card shows the numbered lines inline; Open file opens the code note in the Reader with the lines banded |
| Chapter navigation, reading status | rgbdns | **+** the standard rail and progress line |

## Optional editing (off by default)

| Feature | From | Reader 2 |
| --- | --- | --- |
| Select words, attach a text note | Triptych | **=** the same shared editor (`shared/span-editor.js`): per-paragraph word picker, tap/drag on touch with no checkboxes, quote selectors re-anchor on the exact text; notes whose text changed are listed, never misplaced |
| Coloured spans, up to three overlapping, striped shared words, tap to reopen | Triptych 3.2 | **=** the same shared editor |
| Voice notes: verified recording, then transcription (local mlx-whisper or API) | Triptych | **=** the same shared module (`shared/voice-core.js`) and dialog |
| Shared ledger with `.sha256` sidecar and digest | Triptych, mobile (sidecar missing) | **=** the same shared store (`shared/ledger-store.js`) |

## Deliberately left out

| Feature | From | Why |
| --- | --- | --- |
| Whole-pane preference, Good/Bad/Edit, correction variants, sentence preferences | Triptych, mobile, Invented | editorial comparison; FirstPair Triptych |
| Divergence rail (bars, score, feature vector), equality banner, РУ heuristic | Triptych, Invented, mobile | comparison scoring; FirstPair Triptych |
| Comparison sets (triptych slices) | mobile, Invented | FirstPair Triptych |
| Review composer and copy export | Invented, Triptych | FirstPair Triptych |
