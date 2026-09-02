[← First Pair library](https://firstpair.org/)

# The FirstPair Guide to Reading Books in Emacs

A FirstPair Emacs bundle is a folder holding a book as a GNU Info manual, a
second manual of the sources and records the book points at, the tables that
connect the two, an offline dictionary, and the Texinfo source of both
manuals. FirstPair uses the format because Info is the oldest hypertext still
in daily use: it reads on any machine that runs Emacs, it needs no network, no
account, and no browser, and it keeps a reader's place with nothing more than
the keyboard.

You own the downloaded files. The book remains readable with the standalone
`info` program, with Emacs alone, or after re-rendering the Texinfo source
into HTML, PDF, or plain text. Nothing in the bundle contacts a server.

## Install Emacs

1. Install GNU Emacs 27.1 or newer. On macOS, `brew install --cask emacs` or
   the build at [emacsformacosx.com](https://emacsformacosx.com/); on Windows,
   the release from [gnu.org/software/emacs](https://www.gnu.org/software/emacs/);
   on Linux, your distribution's `emacs` package.
2. Download the bundle ZIP from the book's FirstPair page.
3. Extract the ZIP completely. Do not open files while they are still inside
   the archive.
4. Note the extracted folder's location. It contains `init.el`, `Guide.md`,
   two `.info` files, and the `lisp/`, `data/`, `lexicon/`, and `texi/`
   folders.

Keep the ZIP until you have verified the bundle. It is a clean recovery copy.

## Open the book

Start Emacs, then load the bundle's loader once:

```text
M-x load-file RET /path/to/the/bundle/init.el RET
```

`M-x` is `Alt+x` (or `Esc` then `x`), and `RET` is the Return key. Then:

```text
M-x firstpair-read RET
```

The frame divides into two windows. The book opens in the upper window at its
Top node with the contents menu. The lower window shows the Top node of the
references manual. The first dictionary lookup replaces that introductory
references pane, keeping the book and dictionary visible without a third
window. **Close** restores the references introduction. Once a citation has
opened an actual source below, the dictionary preserves it and uses a third
window when the frame has room.

To make the bundle available every time Emacs starts, add one line to your
Emacs configuration file (`~/.emacs.d/init.el` or `~/.config/emacs/init.el`):

```elisp
(load "/path/to/the/bundle/init.el")
```

## Install the reader once, for every FirstPair book

Each bundle carries its own copy of the reader, so the step above is all a
single book needs. If you read several FirstPair books, install the reader as
an Emacs package instead and let it find your bundles:

```elisp
;; From a downloaded firstpair-reader-<version>.tar:
M-x package-install-file RET /path/to/firstpair-reader.tar RET

;; Or straight from the FirstPair repository (Emacs 29 or newer):
(package-vc-install '(firstpair-reader
                      :url "https://github.com/firstpair/firstpair"
                      :lisp-dir "publishing/emacs/lisp"))
```

Then tell it where your bundles live and open one:

```elisp
(setq firstpair-reader-bundle-directories '("~/Books/FirstPair"))
M-x firstpair-read RET
```

`firstpair-read` registers every bundle found in those folders and offers a
choice when there is more than one. A bundle's `init.el` still works and uses
the installed reader when it is at least as new as the bundled copy; otherwise
the book uses its own reader. Restart Emacs after upgrading the package so an
older version already loaded in memory cannot linger. The package also installs
this handbook as an Info manual:
`C-h i m FirstPair Reader RET`.

## Your first five minutes

Everything is ordinary Info. The keys you need:

| Key | Action |
| --- | --- |
| `SPC` / `DEL` | scroll forward / back, continuing into the next node |
| `n` / `p` | next / previous node at the same level |
| `u` | up to the containing part or the Top node |
| `RET` | follow the item or reference under the cursor; in an aligned poem, advance to and look up the next source word |
| `l` | back to where you were before the last jump |
| `t` | the Top node of the current manual |
| `m` | pick a menu item by name |
| `g` | go to a node by name |
| `s` | search the whole manual |
| `q` | leave Info; `M-x firstpair-read` returns |
| `C-h m` | list every key that works here |

`C-h m` means hold Control, press `h`, release, press `m`. Use the mouse if
you prefer: menu items and references are clickable.

Reading order runs through the Top node's menu: the contents, then each part,
then the guide you are reading now, then the colophon. `SPC` at the end of a
chapter continues into the next one, so a book can be read start to finish
with one key.

You cannot damage the edition by exploring. Info never writes to its files.

## References open below the text

A cited passage in the book is followed by a citation in parentheses, shown
as "(see Letters to Atticus 1.17.6)". Press `RET` on it, or click it, and the
record opens in the lower window: the original text, the translation, its
witness and translator, its rights, and a **Quoted in** list pointing back to
every chapter that uses it. The upper window does not move.

The lower window is a complete Info manual of its own. `n`, `p`, `u`, and `s`
work there; `RET` on a **Quoted in** entry brings that chapter back into the
upper window. `C-c C-o` moves the cursor between the windows; `C-x o` also
works.

Two keys reach references without hunting for the citation:

| Key | Action |
| --- | --- |
| `C-c C-r` | choose among the references quoted in the current chapter |
| `C-c C-f` | open the file delivered for the reference shown below |

`C-c C-f` matters for evidence that is a file rather than text: an image, a
transcription, a data table. It opens inside Emacs, in the lower window, and
`q` returns to the reference.

## The dictionary window

Words the bundle's lexicon can explain are underlined. Hover the mouse over
one to see a one-line gloss. In an aligned poem, click or tap any word of the
original to update the Dict pane immediately; the poem keeps focus and no
keyboard-input prompt opens. Both the poem and Dict panes are read-only. You
can also use the keys:

| Key | Action |
| --- | --- |
| `C-c C-d` | look up the word under the cursor |
| `C-c C-n` / `C-c C-p` | move to the next / previous underlined word |
| `C-c C-g` | open the glossary of every explained word in this edition |
| `RET` (aligned poem) | move to the next source-language word and open its entry |

The entry is deliberately small enough for a phone. Its first row is the
source lexicon's headword — Italian in a Dante edition — in bold. Genuine
ambiguities share that one row. After it come at most two senses for each
selected language, one per unwrapped row. It spends no rows on language
headings, translated headwords, parts of speech, grammatical analysis, or
blank separators. **More** on the dictionary bar (or `m`) reveals every
remaining sense; **Less** restores the compact view. A new word starts compact
again. Lookup reads tables from the bundle's `lexicon/` folder, with no network
and no external program. `C-c C-d` also works on words that are not underlined,
and reports honestly when the selected dictionaries have no entry.

An edition may answer in more than one language — say English and Russian
for a Latin book. Their scripts distinguish the sense rows without headings.
`C-c C-t` in the book (or `t` in the dictionary window) cycles through each
language alone and then all of them together; `C-u C-c C-t` (or `T`) lets you
pick by name. The choice sticks for every lookup, for the one-line glosses,
and for the mouse hover.

Set `firstpair-reader-highlight` to `nil` in your configuration to turn the
underlines off while keeping every key.

## Aligned editions

Some editions align an original with its translations unit by unit — a
tercet of Dante with its English and Russian, say. Each unit shows the
original first and then the translations you have on; `C-c C-t` cycles the
choice exactly as it does for the dictionary, hiding the other translation in
place so the original never moves. Every word of the original can be looked
up with `C-c C-d`. `RET` walks forward through the original one word at a time
and opens each entry with the current dictionary languages. The compact
headword and sense rows leave the original and translations as the visible
context for how that form is being used. `RET` on an Info link still follows
it.

The top Emacs bar has a separate **Translations** menu. Its first line says
exactly which editions are currently visible, including a second translation
and the `≈` mark for an approximate alignment. Reading or clicking that
**Showing** line, or pressing `=`, changes nothing. The rest of the menu offers
**Choose Translation**, **Next Translation at Point**, **Toggle Second Translation**,
**Choose Second Translation**, **Choose Languages**, and **Cycle Languages**.

In a text terminal such as Emacs under 1Unix or iSH, the top bar has two compact
language menus instead of the graphical drop-down. **Tr-Eng** opens the English
editions and **Tr-Rus** opens the Russian editions. Each list begins with
**None**, which hides that language, followed by every edition that covers the
current part in book order. The current choice is marked. Choosing an edition
switches directly to it and also restores the language when it was hidden;
English and Russian remain independent. Neither menu invokes a minibuffer,
Emacs's large text-mode menu, or a `*Completions*` window.

If every list choice runs its first item, check the ordinary **File** menu:
**Quit** must quit rather than opening **Find File**. The latter behavior means
the terminal host is reporting the wrong touched row; it is not a translation
selection problem. Use a 1Unix build with touch-coordinate correction before
testing the Reader menus again.

A persistent line immediately below the top bar lists the visible edition
names in the same order in which their text appears. It updates after either
language menu, **Lang**, and **2nd**. Press `=` for the compact, non-mutating
translation report. After a menu choice, the chosen edition name, or `None`,
remains in the bottom message line until another command or message replaces
it. The existing **Lang** button cycles visible languages. **Tr** still moves
to the next edition under the cursor, and **2nd** (or `b`) remains a strict
show/hide toggle, so one action always returns from two editions to one even
when the bundle carries many alternatives.

## Rearranging windows

`C-c C-l` restores the standard layout: book above, with the references or
dictionary below; an active cited source may keep a third dictionary pane. The
customisation variables
`firstpair-reader-references-height` (a fraction of the frame) and
`firstpair-reader-lexicon-height` (the expanded dictionary's maximum number of
lines) adjust the proportions. A compact dictionary pane automatically shrinks
to its headword plus the available two-per-language sense rows. You may also
drag the divider between windows.

## Reading without the FirstPair reader

The manuals do not depend on the reader. In plain Emacs:

```text
C-u C-h i /path/to/the/bundle/<book>.info RET
```

or, in a terminal:

```sh
info -f /path/to/the/bundle/<book>.info
```

Citations still work; they open in the same window, and `l` returns. The
manual name appears after the label, as Info shows any reference to another
manual. The dictionary keys are not available without the reader.

## Add the manuals to Info's directory

`M-x firstpair-read` never touches your system. If you would rather find the
book under `C-h i` or the `info` command beside the Emacs and GNU manuals,
install its two manuals into an Info directory:

```sh
./install.sh                      # into ~/.local/share/info
./install.sh /usr/local/share/info
./install.sh --remove             # take them out again
```

or, inside Emacs, `M-x firstpair-reader-install-info` (and
`firstpair-reader-uninstall-info`). Both copy the `.info` files and update the
directory's `dir` menu, using GNU `install-info` when it is present and
Emacs itself otherwise. Then add the directory to Emacs:

```elisp
(add-to-list 'Info-directory-list "~/.local/share/info")
```

or to your shell, `export INFOPATH="$HOME/.local/share/info:"`, and the book
appears under **Books** in the Info directory. Reading it that way is plain
Info: the FirstPair keys need the reader loaded as above.

## Re-rendering the edition

The `texi/` folder holds the Texinfo source of both manuals, generated from
the same document model as the Info files. With GNU Texinfo installed:

```sh
makeinfo --html --no-split texi/<book>.texi
makeinfo --plaintext texi/<book>.texi > <book>.txt
texi2pdf texi/<book>.texi
```

The output is the same book in another form. Cross-references between the two
manuals remain references to the companion manual.

## Make personal notes without fighting updates

Treat the `.info`, `data/`, `lexicon/`, and `texi/` files as edition
material. Emacs bookmarks (`C-x r m` inside a node, `C-x r b` to return)
record your place without touching the bundle. Keep durable notes in a
separate file of your own; Org mode links of the form
`[[info:<book>#Node Name]]` point back into the book.

## Updating a FirstPair bundle

To update the shared Reader and immediately reopen the current book, quit
Emacs completely and run this from the extracted bundle directory:

```sh
./firstpair.sh
```

Older bundles can acquire the same bundle-relative command once:

```sh
curl -fLO https://firstpair.org/emacs/firstpair.sh
chmod +x firstpair.sh
./firstpair.sh
```

The script first downloads the small SHA-256 release record. When its Reader
version is already installed, it skips the package download and immediately
opens the book. Otherwise it downloads the current package over HTTPS,
verifies its SHA-256 and package identity, installs it in a clean batch Emacs,
and only then removes older Reader package versions. It refuses to modify
packages while an Emacs process is running. If the update check or package
download is unavailable, it reports that briefly and opens the local book with
the installed Reader or the Reader carried inside the bundle. Finally it
replaces the shell with a fresh interactive terminal Emacs and calls
`firstpair-read` with the bundle directory. It recognises a bundle containing
the script, one `Dante-Emacs` beside it, or one unambiguous child bundle; a path
argument overrides discovery.

This updates the Reader application, not the book's texts, alignments, or
dictionaries. Download a new bundle ZIP when those edition files change.

1. Download and verify the new versioned ZIP.
2. Extract it beside the old folder, not over it.
3. Change the path in your configuration, or load the new `init.el`, and
   restart Emacs so the old bundle is forgotten.
4. Open the new edition and confirm the Top node, a citation, and a
   dictionary lookup.
5. Retain the old folder until the replacement has survived a full restart.

Bookmarks and Org links are tied to node names, which stay stable between
editions unless a chapter is retitled.

## Troubleshooting

If `M-x firstpair-read` reports that no bundle is registered, the loader has
not run: `M-x load-file` the bundle's `init.el`.

If Info reports that it cannot find the manual, the bundle folder was moved
after `init.el` was loaded. Load `init.el` again from its new place.

If references open in the upper window and replace the text, the reader is
inactive in that buffer: press `q` and start again with `M-x firstpair-read`.

If words are not underlined, check that `firstpair-reader-highlight` is
non-nil and that the `data/marked.tsv` and `lexicon/` files extracted
completely.

If a citation opens the wrong record, note the book version, the chapter, the
visible citation, and the destination, and report it. Do not edit the Info
files as a permanent repair; the next edition is regenerated from source.

## A durable mental model

The upper window is the book. The lower window is the library: every source
and record the book stands on, one node each. The dictionary window is the
desk reference. `l` is your thread back through the labyrinth. Bookmarks and
your own notes are your work, and live outside the bundle. With those
boundaries an Emacs bundle remains approachable for a first-time reader while
holding the depth a scholar or a programmer expects.

## Getting the reader package

The standalone reader is at `https://firstpair.org/emacs/firstpair-reader.tar`
(always the current release). Fetch it and install it once:

```sh
curl -fL -o firstpair-reader.tar https://firstpair.org/emacs/firstpair-reader.tar
```

then `M-x package-install-file RET firstpair-reader.tar RET`.

## Picking up where you left off

`M-x firstpair-read` returns to the node and the line where you stopped in
that bundle, with the same languages, translations, and second translations
on screen. The reader saves this on every page turn, whenever Emacs has
been idle for a few seconds, and when Emacs exits, in
`firstpair-reader-state-file` (`~/.emacs.d/firstpair-reader-state.el` by
default — plain Lisp, one entry per bundle). Set `firstpair-reader-resume`
to nil to always open at the top.

## Reading by touch and single keys

On a phone (Emacs under iSH) or anywhere you would rather not type chords,
the reader offers the same commands as taps and single letters. One button
bar sits on the book's mode line, just above the references — **Next ▶ · ◀w ·
Dict · Lang · Tr · 2nd · ▲ · ▼ · ◀c · c▶** (next and previous word, looked up;
dictionary; languages; next translation at point; show/hide second translation; page up and
down; previous and next chapter) — and the dictionary window has its own:
**Close · Lang · More/Less** at the left, with **◀w · Next ▶** against the
right edge (More appears only when additional senses exist). The word controls
step through the source text and open each word's entry. Both **Next ▶**
controls are deliberately wider targets. Tapping a marked word looks it up; tapping a
link follows it; a long press (right click) rotates the translation under
it. In the book, `d` opens the dictionary, `t` chooses languages, `v` the
next translation at point, `b` toggles a second one, `,` and `.` step between dictionary
words, `j` and `k` step to the next or previous word *and open it*, `n` and
`p` turn cantos, and `RET` repeatedly advances through the Italian or other
source text with the current dictionary languages; in the dictionary, `m`
toggles More/Less. Space and
backspace page, `=` reports the translations now showing without changing
them, `?` shows this list, and `q` quits. Terminals get mouse reporting switched on automatically
(`xterm-mouse-mode`); if taps still do nothing, the terminal app is not
forwarding them and the single keys remain. `firstpair-reader-touch` turns
the layer off.
