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

Translation inspection (reader 1.20): aligned editions add a top-level Emacs
**Translations** menu. Its first, live `Showing: …` item and the `=` key report
the effective primary and second translations on the current page without
mutating selection; coverage fallbacks and approximate-alignment marks must be
reflected. Keep Choose Primary, Next at Point, Toggle Second, Choose Second,
Choose Languages, and Cycle Languages in that same dedicated menu so
inspection and intentional changes remain visibly distinct. **2nd** and `b`
are strict show/hide toggles: a visible second
translation disappears in one action, irrespective of how many editions are
available. The graphical menu retains **Choose Second Translation...** for
deliberate selection among many alternatives.

Terminal translation control (reader 1.31): do not send an iSH or other TTY
tap through `tmm-menubar`, which opens a large text-menu/completions window.
Do not use a second overriding keymap: terminal menu rendering merges it with
the minor-mode map and exposes duplicate controls. Keep the native
**Translations** submenu graphical-only. In a terminal expose adjacent dynamic
**Tr-Eng** and **Tr-Rus** submenus. Each starts with **None**, then lists in
declared order every edition of that language that covers the current part.
Use radio marks for the effective selection. **None** hides only its language;
choosing an edition selects it as primary and restores that language without
changing the other language. Represent an explicit all-hidden choice
separately from the legacy nil meaning "show every declared language," and
persist it with the Reader state. The submenus must invoke their commands
directly, with no minibuffer and no `*Completions*` buffer. A TTY menu dismisses
its own message after invoking the command, so post the new language and
edition label, including `None`, from a one-shot `post-command-hook` after the
outer menu command finishes; it must remain in the echo area until another
command or message replaces it. Install a persistent header line immediately
below the menu bar that lists compact visible edition names in actual region
order, including second translations, and update it on every region refresh.
Keep `=` as the non-mutating status report. Terminal tests must prove ordered
English and Russian menu contents,
independent direct selection, one-language and all-language hiding, restoration,
one-action second-slot hiding with three or more editions, exact delayed
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
