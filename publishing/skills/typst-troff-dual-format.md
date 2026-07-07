# Skill: Typst/Troff Dual Format

Use when a book must produce both Typst and troff PDF variants.

1. Derive stable stems from `title_stem`: `<stem>-typst` and `<stem>-troff`.
2. Build the Typst PDF from the Typst cover plus a Pandoc/Typst body.
3. Build the troff PDF from an ms cover block plus a Pandoc-generated ms body.
4. If the book is illustrated, post-process Pandoc's commented `\" .IMAGE`
   lines into `.PDFPIC` calls and wrap JPEG/PNG assets as one-page PDFs when
   gropdf needs PDF inputs.
5. Run groff with `-Tpdf -P-e -t -ms`; add `-U` when `.PDFPIC` external-image
   inclusion requires unsafe mode.
6. If Ghostscript is present, re-embed fonts after groff output.
7. Generate EPUB/MOBI for both stems when the reading surface should compare
   the formatter variants.
8. Record both variants in `dist/VERSION.md`.

Reference command:

```sh
REPO_ROOT=/path/to/repo \
BOOK_ROOT=docs/book \
BOOK_FORMATS=typst,troff \
~/src/firstpair/publishing/scripts/build-book.sh
```
