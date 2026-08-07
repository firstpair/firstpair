# FirstPair Reader

The standard Reader is data-driven by `_data/reader.json`, `_data/targets.json`,
and `VAULT-MANIFEST.json`. It makes no network requests and does not modify the
vault. The complete static Markdown Reader remains usable when the plugin is
disabled.

The navigation rail is ordered Previous, Up, Back, Top, TOC, Next. Back stores
Reader-local continuation only; it never navigates to an unrelated note.
