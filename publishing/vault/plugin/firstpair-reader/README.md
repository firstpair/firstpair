# FirstPair Reader

The standard Reader is data-driven by `_data/reader.json`, `_data/targets.json`,
and `VAULT-MANIFEST.json`. It makes no network requests and does not modify the
vault. The complete static Markdown Reader remains usable when the plugin is
disabled.

The navigation rail is ordered Previous page, Previous word, Up, Back, Top,
TOC, Next word, Next page. The page controls own the outside edges; the nested
double-chevron controls step through source words on the current page and open
the dictionary. Back stores Reader-local continuation only; it never navigates
to an unrelated note.

Aligned editions use one non-wrapping top bar. English and Russian are labelled
`Eng` and `Рус`; each translation picker shows only the translator's compact
name while its full edition title remains in the tooltip and accessibility
label. The `Auto` layout control stays on the same line. Dictionary results
follow the enabled-language order without visible language headings; each
section retains its language and accessible label in the document structure.
