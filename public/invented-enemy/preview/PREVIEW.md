# The Invented Enemy Public Preview

This public package is a preview, not the complete book. It shows the cover, the
title/front matter, the full twenty-chapter table of contents, and Chapter 1
("What Is Russophobia?") of *The Invented Enemy: Russophobia and the Anti-Slavic
Imagination in the West and East* (draft edition v1.3).

## Preview Limit

| Item | Value |
| --- | --- |
| Full main body words | 81,325 |
| Preview body words | 2,128 |
| Preview percentage | 2.62% |
| Cut boundary | After Chapter 1, before Chapter 2 |
| Reason for boundary | Chapter 1 is a self-contained statement of the book's method; the preview stays well under the 10% ceiling |
| Build date | 2026-07-10 |

The EPUB keeps the complete table of contents visible. Chapters 2–20, the
interlude, Appendices A–C, and the bibliography are represented by link-valid
titled placeholders so the contents remain navigable without exposing the
complete text.

## Edition

| Edition | Purpose | PDF | EPUB | Reader | Chapters | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Main preview | Draft edition v1.3 opening-chapter preview. | [PDF](https://fl6nu3o2c1oqqnum.public.blob.vercel-storage.com/books/invented-enemy/pdf/8ce1358bbad92323-invented-enemy-preview.pdf) | [EPUB](https://fl6nu3o2c1oqqnum.public.blob.vercel-storage.com/books/invented-enemy/epub/68dbcebfaa30b9d1-invented-enemy-preview.epub) | [Read](/read/invented-enemy/) | [Chapter reader](/read/invented-enemy/chapters/) | Built with pandoc 3.9 (EPUB, chunked HTML) and the Typst 0.14 PDF engine from the same preview manuscript. |

The book has one reading edition. No South/East/West or Rosetta comparison
outputs exist for this title.

## Version And Method

The underlying book is draft edition v1.3 (2026-07-10): twenty chapters and an
interlude in thirteen parts, three appendices, a twelve-family trope ontology,
six adversarially verified research dossiers, a two-tier bibliography, and a
verbatim prompt log. Factual claims that passed a three-vote adversarial
verification pass are asserted with citations; details outside verified coverage
carry visible inline `[verify]` tags — honest flags of unverified detail, not
citations.

## Artifacts

| Artifact | Format | Size | SHA-256 |
| --- | --- | ---: | --- |
| [PDF preview](https://fl6nu3o2c1oqqnum.public.blob.vercel-storage.com/books/invented-enemy/pdf/8ce1358bbad92323-invented-enemy-preview.pdf) | PDF (11 pages) | 231,504 bytes | `8ce1358bbad9232386bc05531ab04071c558c8081749f01bee54e599bb485ab3` |
| [EPUB preview](https://fl6nu3o2c1oqqnum.public.blob.vercel-storage.com/books/invented-enemy/epub/68dbcebfaa30b9d1-invented-enemy-preview.epub) | EPUB | 225,172 bytes | `68dbcebfaa30b9d1fcceb9f826d6e6ba615da0328cfeac5d125ade72dc5d42d7` |
| `/read/invented-enemy/` | Hosted HTML reader | 544,399 bytes | `593c5b569f6dbef84834d13b989bb8df82a32e5306f3e8b59ecea0f6006afa9e` |
| `/read/invented-enemy/chapters/` | Hosted chapter reader | 85 files | `64193be858fafba39e196597b06570933dcc1f0ae5bb55fbe72c60364bf8c366` (package digest) |
| `assets/invented-enemy-cover.png` | PNG | 371,974 bytes | `57ecb0a807ca2cd954e4361a5cdb2e956356575ab48df229763b45b5aa09db0c` |

## Validation

- `pdfinfo` on the preview PDF: valid, 11 pages, Typst 0.14.2 producer.
- `unzip -t` on the preview EPUB: no errors in the archive.
- Preview body word count 2,128 = 2.62% of the full body word count 81,325 (≤ 10%).
- Blob upload manifest recorded all four units (PDF, EPUB, single HTML, 85-file
  chapter package) with the hashes above.

## Package State

Rebuilt and re-uploaded on 2026-07-10 for draft edition v1.3 (title restored to
*The Invented Enemy*). The source repository remains the authority for the
manuscript, metadata, version manifest, and builds; this package carries only
the public preview.
