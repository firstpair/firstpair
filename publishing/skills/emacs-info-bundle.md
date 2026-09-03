# Skill: Emacs Info Bundle

Use when building, verifying, or publishing a FirstPair Emacs bundle: a book
delivered as a GNU Info manual with a companion references manual, an offline
lexicon, and the Texinfo source of both. The bundle is a third reader product
beside the Obsidian vaults and the PDF/EPUB/HTML editions, projected from the
same canonical reader order and evidence declared in `vault.build.json`.

## Product Boundary

The source repository owns the manuscript, the reader order and part
grouping, the record maps (for example a reviewed bilingual quote map), rights
decisions, the lexicon include/exclude lists, and the book-specific guide
fragment. FirstPair owns the document model, the Info and Texinfo writers,
the reader (`publishing/emacs/lisp/`), the pinned lexicon corpora, the layered
guide, verification, and delivery.

Two manuals, two windows:

```text
Book manual  -> Top -> Contents / Part -> Chapter  (n, p, u, l, SPC)
                       citation "(see Label)" -> opens below, text does not move
References manual -> Section -> Record / Evidence / Glossary entry
                       "Quoted in" -> reopens the chapter above
Dictionary window -> C-c C-d on any underlined word
```

The untouched references **Top** node is an introduction, not active evidence.
The first dictionary lookup borrows that pane instead of adding a third
window; closing the dictionary restores it. If a citation has opened a real
reference node, preserve that source and add or borrow a separate dictionary
pane according to the frame's capacity.

## Build Workflow

1. Confirm the source repository, the exact edition and product, the output
   path under `book/dist-emacs/`, and the public boundary. A complete bundle
   does not authorise publishing a complete book over a preview.
2. Require a clean, committed source tree; the builder records `HEAD` and
   refuses a dirty worktree or an existing output directory.
3. Fetch or verify the pinned lexicon corpus once:
   `firstpair-emacs lexicon --language latin`. The build reads the cache; a
   digest mismatch is a stop condition, not something to re-pin casually.
4. Plan before building: `firstpair-emacs plan vault.build.json --product all`
   reports pages, records, evidence, and the source commit without writing.
5. Build one product at a time. Everything is written to a temporary sibling
   and moved into place only after the safety scan and ceilings pass.
6. Validate the bundle: `firstpair-emacs validate --bundle <dir>`. It must
   pass the inventory, structural Info, link, lexicon, `makeinfo`, and
   `emacs --batch` gates. Read `unmatchedAnchors` in the manifest: each is a
   quotation alias the text no longer contains verbatim, to be fixed in the
   record map or accepted with a reason.
7. Open the bundle interactively once per release: `M-x load-file init.el`,
   `M-x firstpair-read`, follow one citation, press `C-c C-d` on a Latin
   word, `C-c C-g` for the glossary, `C-c C-l` to relayout, `q`.
8. Inspect `data/marked.tsv` for English words marked as Latin (proper names,
   italicised English) and add them to `emacs.lexicon.exclude`; add short
   Latin words the text needs to `include`.
9. Keep the guide canonical: the composed `Guide.md` is generated; edit
   `publishing/emacs/guides/` or the title's `guide.bookSpecific` fragment,
   never the bundle.

## Aligned and Multilingual Editions

A triptych (source plus aligned translations) uses the same aligned chapter
files as the Obsidian Reader as its reader page sources, declares
`lexicon.sourceId`, and lists its `lexicon.translations`; the reader hides
unselected translations and looks any source word up. Build the vault first
so the chapter files exist, then the bundle. The dictionaries of both
products come from `firstpair_emacs.dictionaries.project` over the same
analyser and sources, so the two readers agree word for word. Read the
coverage report the title writes; extend the title's reviewed supplement for
frequent gaps rather than lowering the analyser's standards. A source-language
corpus a title cannot redistribute (a translation still under rights review)
keeps the bundle local: no `--emacs` publication.

## Validation Gate

Fail closed on:

- a dirty worktree or a `sourceCommit` that is not `HEAD`;
- node names with commas, colons, parentheses, or periods;
- any pointer, menu entry, or cross-reference that does not resolve inside
  the bundle;
- marked words the reader cannot locate in `emacs --batch`;
- `makeinfo` rejecting either Texinfo source;
- lexicon table digest drift or an unpinned corpus;
- restricted evidence bytes, symlinks, `.elc`, Git metadata, or `.DS_Store`;
- manifest inventory drift.

## Delivery

Deliver the bundle directory as a versioned ZIP beside the other editions.
Emacs bundles are read locally; do not describe a ZIP as validated until
`firstpair-emacs validate` has passed on the extracted directory that will be
archived. Old bundles remain published until the new one passes validation
and the interactive check.

Pitfalls:

- do not run `makeinfo` to produce the delivered `.info`; the builder writes
  it so marked-word positions stay exact;
- do not let a citation replace the author's words; the quoted text stays and
  the citation follows it in parentheses;
- do not hand-edit generated Info, data, or lexicon tables;
- do not ship `firstpair-check.el` or compiled Lisp inside a bundle;
- do not mark English words as Latin merely because Whitaker's dictionary
  happens to contain a homograph; use `exclude`.

The loader may use an installed `firstpair-reader` only when its package
version is at least the version copied into the bundle. A stale global package
must not shadow corrected bundle code. After changing Reader behavior, build
and install the matching package, restart Emacs, and verify the actual library
path and package version before testing the title. Exercise compact glosses on
short, case-sensitive function words as well as ordinary content words; reject
cross-entry gloss borrowing and show inflection or restoration explicitly as
`surface → headword`.

Gloss tables ship as `lexicon/glosses/<letter>.tsv` shards (first letter of the key, `_` otherwise), each listed in `LEXICON.json` `files`; the reader loads one shard per lookup, so a first `C-c C-d` on a phone under iSH no longer parses tens of megabytes. Older bundles with a single `glosses.tsv` still read.

Touch layer (reader 1.9): `firstpair-reader-touch` adds header-line button bars (book and dictionary), single-key bindings (d t v b , . r ?), `mouse-1` = look up word or follow link, `mouse-3` = next translation, and enables `xterm-mouse-mode` on terminals. Keep every command reachable by a single key on phones.

Touch gesture ownership (reader 1.34): a finger can cross a terminal cell
between touch-down and touch-up, making Emacs report `drag-mouse-1` instead of
`mouse-1`. Bind both events to every mode-line and header-line button action,
and to the book's word/link handler. Button-local maps must also consume
`down-mouse-1`, `double-mouse-1`, and `triple-mouse-1`: otherwise Emacs's
standard mode-line map can begin resizing a pane on press or maximize it when
the reader retries with a second tap. Run the command once on click or drag
release and suppress terminal `help-echo`; a pointer-motion prelude must not
leave labels or binding help in the echo area. Give separators, alignment
spacers, and trailing node text an inert local map too, so a near miss cannot
fall back to stock mode-line resize or mouse-help behavior. Because a TTY can
retain the `mode-line` area while losing the rendered string's local map, bind
area-qualified click, drag, press, and multiple-click fallbacks in both Reader
and Lexicon buffer maps. Resolve a command only from the touched string's
`firstpair-reader-command` property; ignore every other cell. Set
`mode-line-default-help-echo` buffer-locally to nil in both panes so inherited
"mouse-1 selects" help cannot replace the echo area. In particular,
**Next** advances
and refreshes Dict, while **Dict** lends the idle References Top pane to the
lexicon instead of adding a third window. Test press ownership, double-click
suppression, actual release dispatch, and idle-pane replacement.

Dictionary navigation (reader 1.29): keep Close, Lang, and conditional
More/Less at the left of the lowest bar. Right-align the word controls as
`◀w · Next ▶`; use the same wide Next label and lookup command as the book bar.
Tests must inspect the mode-line alignment display property as well as button
order so generated text alone cannot conceal a lost right edge.

Direct source-word lookup (reader 1.28): a primary click or tap on any word
inside an aligned source-language region passes that surface form directly to
the lexicon and refreshes the existing Dict pane without selecting it or
opening `read-string`. Do not limit touch lookup to pre-marked overlays. Keep
the poem Info buffer and the lexicon buffer explicitly read-only, disable text
conversion in both, and consume primary clicks in the Dict pane. Tests must
prove that an unmarked source word updates the dictionary with no prompt,
preserves poem focus, and leaves both buffers read-only.
Current lookup underline (reader 1.35): keep a separate high-priority overlay
on the source word represented in Dict. Move it after direct word taps and
Next/Previous lookup commands from either bar; clear it when Dict closes or the
reader changes nodes. The overlay must not join the general mark/region overlay
list, because translation refreshes rebuild that list. Use underline plus
weight so a terminal distinguishes the current word from other marked words.

Compact dictionary (reader 1.18): the first body row is the authoritative
source-lexicon headword, or several genuinely ambiguous source headwords on
that same row. Derive it from the analysed source entries, never a translated
gloss headword; deduplicate with the bundle's source normalisation and fall
back to the queried source form when analysis fails. Then show at most two
distinct senses per selected language, one logical and visual row each
(`truncate-lines` is on). There are no language headings, translated
headwords, part-of-speech, grammar, blank, or spacer rows. `m` and a More/Less
button in the existing dictionary mode line disclose all senses without
hiding or adding the source row; expanded senses may wrap. Refreshing the same
word preserves the choice, while every new lookup starts compact. The compact
pane fits its actual body (one headword plus up to two rows per selected
language); `firstpair-reader-lexicon-height` is the expanded maximum. Keep
this row and window budget in future dictionary presentation changes.

Phone word navigation (reader 1.17): the first two controls on the book mode
line are **Next ▶** and **◀w**, in that order. Next is intentionally wider and
gets the easiest left-edge touch target. Preserve that order and target size.

Aligned-source Return (reader 1.18): `RET` and `<return>` in a reader node with
source-language regions perform Next ▶, advancing to and looking up the next
source word with the current dictionary-language selection. In menu/guide
nodes, the references manual, and on actual Info links, Return keeps ordinary
redirected Info-follow behavior. Fit/reset the lexicon pane after every such
lookup so its source headword is visible at the top.

Translation inspection (Reader 1.42): aligned editions
add a top-level Emacs **Translations** menu. Its first, live `Showing: …` item
and the `=` key report every edition on the current page, in display order,
without mutating selection; coverage fallbacks and approximate-alignment marks
must be reflected. Keep Show or Hide, Next at Point, This Language First,
Choose Languages, and Cycle Languages in that same dedicated menu so
inspection and intentional changes remain visibly distinct. Each language
keeps an *ordered list* of shown editions; there is no fixed second slot.
**2nd**/`b` adds every available pair in
`firstpair-reader-favorite-translations` without replacing current editions,
and `B` keeps only those favorites in their languages. Keep favorites in a
`defcustom` so standard Emacs Customize can inspect or edit them.

Terminal translation control (reader 1.31): do not send an iSH or other TTY
tap through `tmm-menubar`, which opens a large text-menu/completions window.
Do not use a second overriding keymap: terminal menu rendering merges it with
the minor-mode map and exposes duplicate controls. Keep the native
**Translations** submenu graphical-only. In a terminal expose adjacent dynamic
**Tr-Eng** and **Tr-Rus** submenus. Each starts with **None**, then lists in
declared order every edition of that language that covers the current part.
Use a radio mark on **None** and checkboxes on the editions: an unchecked
edition is shown in addition to those already on screen, a checked one is
hidden, and hiding the last hides the language. **None** hides only its
language; choosing an edition of a hidden language restores that language
without changing the other one. Represent an explicit all-hidden choice
separately from the legacy nil meaning "show every declared language," and
persist it with the Reader state. The submenus must invoke their commands
directly, with no minibuffer and no `*Completions*` buffer. A TTY menu dismisses
its own message after invoking the command, so post the new language and
edition label, including `None`, from a one-shot `post-command-hook` after the
outer menu command finishes; it must remain in the echo area until another
command or message replaces it. Install a persistent header row immediately below the menu bar that lists
compact visible edition names grouped by language in actual region order, and
update it on every region refresh. The row is also the ordering control: an
edition's name hides it, **◀** moves it one step earlier in its language, and
the language tag brings that block first, physically reordering each unit's
translation blocks in the buffer without moving the source lines.
Keep `=` as the non-mutating status report. Terminal tests must prove ordered
English and Russian menu contents,
independent direct selection, one-language and all-language hiding, restoration,
checkbox toggling with three or more editions, in-language reordering,
language block order, exact delayed
feedback, menu order, no overriding map, unchanged window count, and no
`*Completions*` buffer.

Terminal menu dispatch (reader 1.31 and 1Unix): every dynamic submenu item
binds to a stable named interactive command, not an anonymous lexical closure.
Test both the submenu content and that every selectable binding is a command
symbol. This is Reader-side hardening, not a substitute for correct terminal
mouse coordinates. If choosing an item below the first one still invokes the
first item, test a stock Emacs menu immediately: **File → Quit** must not invoke
**Find File**. Failure there identifies the terminal host, not the Reader.
Do not repair that host failure by rewriting WebKit compatibility mouse-event
coordinates: on iPhone those events can still arrive at the focused element
or bypass the rewriting listener. While VT mouse reporting is active, 1Unix
must prevent the compatibility sequence, convert the active `UITouch`
directly into one hterm press/drag/release sequence, and use the touch's
viewport coordinates for hterm's own cell calculation. Install compatibility
event suppression on the hterm iframe document in capture phase, not merely
on its screen element: hterm itself listens on its document and cursor, and an
iOS event targeted there can otherwise bypass the screen guard. Test the
signed web bundle by aiming at a non-first row and column, asserting the exact
encoded VT cell, then injecting bogus `(0,0)` compatibility events at the
document and asserting that no extra report appears. Phone acceptance must
select a non-first item in both the stock File menu and each Reader translation
menu.

Terminal menu pointer state (1Unix build 817): a correct press/release cell is
not sufficient for an Emacs TTY popup. `xterm-mouse-mode` enables DECSET 1003,
and Emacs updates the menu's active row only after a `mouse-movement` command.
The hterm 1.91 bundled by 1Unix ignores mode 1003, while a touchscreen has no
hover event to provide that movement independently. Treat 1003 as pressed
movement tracking on touch devices and emit a movement at the touch-down cell
immediately before the button press. Diagnose this exact failure by observing
that **File -> Quit** opens **Find File** despite press and release logs naming
the Quit cell. Signed-device acceptance must show **File -> Quit** exiting and
non-first **Tr-Eng** and **Tr-Rus** entries changing their own translations
with the software keyboard still hidden.

Atomic terminal taps and scrolling (Reader 1.43; 1Unix builds 818 and 824): Emacs dispatches
a mode-line mouse command only after terminal release. In DECSET 1003 only,
hold a touch pending until it either ends or accumulates deliberate vertical
movement. A tap reports movement, press, and release together at its touch-down
cell; a drag reports natural-direction terminal wheel steps at that cell so
Emacs scrolls the window where the gesture began without clicking its text.
Use three quarters of the current text-line height as the scroll step and tap
tolerance. Preserve ordinary press/drag/release behavior for other terminal
mouse modes. Verify that one touch on **Next** advances exactly once, and that
dragging the poem scrolls only that pane without looking up a word, following a
link, resizing a pane, opening Messages, showing the keyboard, or moving the
Dictionary. Rerun the stock File and translation-menu checks because they share
the 1003 path. Do not depend on Emacs's optional global `mwheel-scroll` setup:
bind `mouse-4` and `mouse-5` explicitly in Reader and Lexicon body maps and in
their header-line, mode-line, button, and gap maps. Each wheel command must
scroll one line in the event's window and then restore the previously selected
window; reaching a buffer boundary is a silent no-op.

Native Reader-bar visibility (1Unix build 825): provide a separate persistent
**Show Dante Reader Bar** setting, on by default and independent of keyboard
visibility. Turning it off must hide the native strip and return its height to
the terminal immediately; turning it on restores the strip without restarting
Emacs or changing the ordinary keyboard accessory row.

Terminal font geometry (1Unix build 815): bundled webfonts load
asynchronously. After setting the selected family and size, wait on the hterm
document's `FontFaceSet`, resynchronize hterm's font family and size, redraw,
resynchronize the cursor, and notify native code to refresh floating-cursor
sensitivity. Disable kerning and standard/contextual ligatures in terminal row
CSS because visible text, the hterm cursor, and mouse targeting must share one
fixed cell grid. In the signed-bundle test, require the selected face to report
loaded and compare a rendered repeated-character run against `count *
characterSize.width`; reject accumulating horizontal drift.

Terminal first paint (1Unix build 816): do not bootstrap by painting terminal
text and cursor transparent while output begins. Hide the terminal host until
the first native style update has loaded the selected face, then reapply font,
size, foreground, background, and cursor color as one settled state, redraw,
and reveal on the following paint cycle. Log and require the resolved font and
opaque foreground/background colors on the physical device. Repeated cold
launches must remain equally crisp and legible.

Bundle launcher: every generated Emacs bundle carries the executable named by
`emacs.launcher` (`firstpair.sh` by default; Dante uses `dante.sh`). The public
Dante launcher is served at `/emacs/dante.sh`; do not retain the developmental
`/emacs/update-reader.sh` alias. Fetch the small
`firstpair-reader.tar.sha256` release record before the package: if its declared
version is already installed, skip the tar download and launch immediately.
Otherwise verify the downloaded tar against that SHA-256 and its declared
package name and version, install before deleting, retain the newest version,
remove only older Reader descriptors, and `exec emacs -nw` with
`firstpair-read` pointed explicitly at the discovered or supplied bundle.
Treat the network as optional at launch: a failed release-record check or tar
download must report the fallback and immediately open through the bundle's
`init.el`, which selects a sufficiently new installed Reader or its bundled
copy. Keep malformed release records and failed integrity checks fatal. Test
the offline path with a failing `curl` and assert that terminal Emacs still
receives the canonical bundle and loader paths.
Discovery must support the launcher inside a bundle and `/root/books/dante.sh`
beside `/root/books/Dante-Emacs`. Keep URL, release-URL, bundle, Emacs-command,
and no-restart environment overrides for testing; never force-kill a Reader
with potentially unsaved buffers.

Startup and lookup cost on a phone: the bundle loads nothing large at registration — `data/regions.tsv` is grouped by node with `data/regions.index.json` byte offsets (a node's regions are read with `insert-file-contents BEG END` on first use), `lexicon/forms/<letter>.tsv` and `lexicon/glosses/<letter>.tsv` are read per lookup. Keep every table either small or indexed; the chooser loads every bundle under `firstpair-reader-bundle-directories`, so stale copies there cost startup time.
