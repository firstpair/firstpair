## Using a triptych edition

A triptych edition aligns parallel witnesses: an original, a translation, and
an editorial or annotation layer. Each aligned row is one node in the
references manual, and a citation in the text opens the whole row so the
witnesses can be compared without leaving the page. Rows with a missing side
are shown as gaps rather than filled by guesswork.

An edition may carry several translations of one language — say four
English and five Russian renderings of the same poem. One translation per
language is shown at a time, the edition's default until you choose
another: `C-c C-v` rotates the column of the language at point (or the
first shown language) through its translations, and with a prefix argument
offers them by name; `C-c C-b` shows a second translation of that language
under the first, and repeated moves it on and finally hides it. Only the
translations that cover the current part are offered — a translator who
finished only the Inferno steps aside in the Purgatorio. Translations that
do not keep the original's line count are marked ≈ in the dictionary
window's header line, which names the translations on screen; their rows
are cut at the same fractions of the chapter and are approximate.
