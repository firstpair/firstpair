# Skill: Book Artifact Rebuild

Use when regenerating PDF/EPUB/MOBI artifacts or fixing packaging output in a
QueryGraph-family repo.

1. Confirm the repo root and book root.
2. Read the repo-local `docs/book/PUBLISH.md`, `build.sh`, `metadata.yaml`,
   `fix_epub_layout.sh`, and `check_epub_metadata.sh`.
3. Run the native build first.
4. If `ebook-convert` is missing, use
   `/Applications/calibre.app/Contents/MacOS/ebook-convert`.
5. Verify stable artifacts, versioned links, `VERSION.md`, EPUB metadata, and
   PDF cover/body page behavior.
6. Keep staging scoped to intended book files.

Pitfalls:

- do not patch generated outputs when the source renderer is wrong;
- do not infer filenames when `dist/VERSION.md` exists;
- do not treat ignored versioned symlinks as missing build output.
- For a native Typst research paper, preserve the reviewed PDF with a renderer
  hook. Check semantic EPUB and HTML conversions against the source's MathML,
  tables, images, overlines, and anchors; a generic HTML conversion can silently
  replace mathematics. Keep any corrective exporter and validators source-owned.
- Separate shelf artwork from the reading editions when requested. Exclude
  delivery manifests containing output hashes from EPUB input fingerprints to
  avoid a self-referential build identity. Validate publication dates as ISO dates,
  independently of human-readable edition labels.
