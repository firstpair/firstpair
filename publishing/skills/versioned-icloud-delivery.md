# Skill: Versioned iCloud Delivery

Use when copying or verifying versioned EPUB/PDF artifacts in `~/icloud/books`.

1. Read `docs/book/dist/VERSION.md`.
2. Resolve the stable source from `epub_file` / `pdf_file`.
3. Resolve the destination names from `epub_link` / `pdf_link`, or formatter
   suffixed variants.
4. Use exact probes:

```sh
cmp -s "docs/book/dist/<stable>" "$HOME/icloud/books/<versioned>"
stat "$HOME/icloud/books/<versioned>"
```

5. Copy stable bytes to the versioned destination, dereferencing symlinks.
6. Re-run `cmp -s` after copying.

Avoid listing `~/icloud/books`; exact file probes are more reliable on this
machine.

Reference command:

```sh
~/src/firstpair/publishing/scripts/publish-versioned-artifacts.sh \
  /path/to/repo/docs/book/dist "$HOME/icloud/books"
```
