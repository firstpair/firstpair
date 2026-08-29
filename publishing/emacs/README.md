# FirstPair Emacs Builder

This directory contains the shared Emacs delivery toolchain: a book becomes a
GNU Info manual, its sources and records become a second manual that opens
below the text, and an offline lexicon explains the original-language words.
Book repositories own manuscripts, record maps, rights decisions, and
title-specific notes. FirstPair owns the document model, the Info and Texinfo
writers, the reader, the lexicon pipeline, and verification.

The builder reads the same `vault.build.json` the Obsidian vault builder
reads, through `firstpair_vault`, and adds the `emacs` block. The two axes
are:

- profile: `code`, `history`, or `triptych` (shared with the vault);
- product: `desktop` (complete) or `preview`.

```sh
publishing/scripts/firstpair-emacs lexicon --language latin
publishing/scripts/firstpair-emacs plan vault.build.json --product all
publishing/scripts/firstpair-emacs build vault.build.json --product preview
publishing/scripts/firstpair-emacs validate --bundle '/path/to/bundle'
publishing/scripts/firstpair-emacs guide vault.build.json --product desktop --output build/guide.md
publishing/scripts/firstpair-emacs package            # dist/firstpair-reader-<version>.tar
```

Building requires a clean, committed source worktree and refuses to replace an
existing bundle. The delivered layout and its guarantees are in
[`EMACS-DELIVERY.md`](EMACS-DELIVERY.md).

## The `emacs` block

```json
"emacs": {
  "direntry": { "category": "Books", "name": "cicero-on-himself", "description": "..." },
  "subtitle": "How I Outlived Rome",
  "author": "Alexy Khrabrov",
  "parts": [ { "title": "Part I: ...", "description": "..." } ],
  "lexicon": {
    "language": "latin", "mode": "projected", "minimumLength": 3, "exclude": [], "include": [],
    "translations": [
      { "id": "en", "label": "English" },
      { "id": "ru", "label": "Русский", "glossary": "ruwiktionary",
        "dictionary": "book/vault-data/dictionaries/la-ru.json",
        "supplement": "sources/dictionaries/russian-supplement.json" }
    ]
  },
  "records": [
    {
      "id": "bilingual-passages",
      "source": "book/bilingual-quote-map.jsonl",
      "identifier": "id",
      "label": "{work_title} {citation}",
      "section": "Bilingual Passages",
      "kind": "bilingual-passage",
      "rights": "redistributable",
      "referencedBy": "book_sources",
      "referenceMatch": "source",
      "merge": [ { "source": "book/bilingual-russian-map.jsonl", "identifier": "id" } ],
      "anchors": ["aliases", "latin", "english"],
      "blocks": [
        { "field": "latin", "label": "Latin", "style": "quotation", "language": "latin" },
        { "field": "english", "label": "English", "style": "quotation" },
        { "field": "translator", "label": "Translator", "style": "field" }
      ]
    }
  ],
  "products": {
    "desktop": { "output": "book/dist-emacs/Title Emacs", "edition": "full" },
    "preview": { "output": "book/dist-emacs/Title Emacs Preview", "edition": "preview" }
  }
}
```

Reader pages may carry a `part` naming one of `emacs.parts`; consecutive pages
with the same part become one part node.

- `records` are JSON or JSON Lines files of records, one node each. `label`
  is a template over the record's fields. `referencedBy` names the field that
  lists the reader pages quoting the record, matched by page `source` path
  (`referenceMatch: "source"`) or page `id`. `anchors` name fields whose exact
  text, when found in a quoting page, receives a citation link. Block
  `style` is `paragraph`, `quotation`, `field`, or `verbatim`; a `language`
  marks the block's words for the dictionary.
- `lexicon.mode` is `projected`, `complete`, or `none`. `exclude` lists forms
  never to mark; `include` lists short or common forms to mark anyway;
  `minimumLength` filters undeclared words. `lexicon.translations` declares
  the languages the dictionary window answers in (see `EMACS-DELIVERY.md`);
  `records[].merge` joins rows from further files by identifier.
- Evidence targets and collections from the shared core become nodes in the
  Evidence section and files under `evidence/`, subject to their rights.

## Layered guides

Every bundle embeds one complete first-use manual as `Guide.md` and
`README.md`, and again as the reader manual's guide node. It is composed from
`guides/master.md`, one product module, one profile module, and the title's
`guide.bookSpecific` fragment, exactly as vault guides are.

## Tests

```sh
npm run test:emacs-framework
```
