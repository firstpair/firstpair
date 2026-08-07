## Using a code-book vault

A code vault joins prose to a verified source snapshot. Excerpts and examples
link to files, symbols, or reviewed source ranges under `Evidence/` or the
book’s documented `Code/` compatibility path. Prefer the Reader link attached
to an excerpt: it records the intended repository revision and target identity.

The desktop product may contain the complete approved codebase. Search by
symbol, crate, package, test, or filename. Read nearby tests and module
boundaries rather than treating a printed excerpt as the entire implementation.
Generated build output, credentials, caches, `.git`, and private configuration
are intentionally excluded.

Mobile and preview products contain referenced code closure rather than the
whole repository. A file absent there may still exist in the desktop vault or
the public source repository. The guide’s build identity records the exact
revision used by the book.

When experimenting, copy code into a separate working checkout. Editing the
vault snapshot does not update the source repository and should not be confused
with a tested patch.
