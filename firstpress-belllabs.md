# First Pair Bell Labs

## The Bell Labs Publishing Philosophy

The original Bell Labs publishing pipeline wasn't "troff" so much as a
philosophy:

> Write plain text. Everything else is a program.

Every stage was a filter.

``` text
text
  |
  +-- refer   (bibliography)
  |
  +-- pic     (diagrams)
  |
  +-- tbl     (tables)
  |
  +-- eqn     (math)
  |
  +-- troff
  |
  +-- postscript
  |
  PDF
```

The beauty is that every stage is optional.

## A Bell Labs Book

``` troff
.TL
Lighthouse Republics

.AU
Alexy Khrabrov

.AI
First Pair Press

.AB
A short history of the United States and Venice together,
and their eternal afterlife.
.AE

.SH
The Republic

Venice was never merely a city.

It was an operating system.

Its abstractions outlived its hardware.

.PP

America inherited many of them.

.IP \(bu
Federalism

.IP \(bu
Commerce

.IP \(bu
Constitutional abstraction

.PP

These ideas are older than nations.
```

No XML. No YAML. No Markdown. No HTML. Just text.

## Figures

Instead of drawing SVGs, write programs.

``` pic
box "Republic"

arrow

box "Empire"

arrow

box "Nation"

arrow

box "Cloud"
```

Produces:

``` text
+---------+
|Republic |
+---------+
      |
      V
+--------+
|Empire  |
+--------+
      |
      V
+--------+
|Nation  |
+--------+
      |
      V
+-------+
|Cloud  |
+-------+
```

`pic` is programmable:

``` pic
define lighthouse {
    circle radius .08
    line up .3
    box invis ht .2 wid .2
}

lighthouse

move right 1

lighthouse

arrow
```

## Tables

``` troff
.TS
center box;

l l l.

Republic   Founded   Fate
Venice     697       Endured
USA         1776     Ongoing
.TE
```

## Equations

``` troff
.EQ

Liberty ~= Order + Commerce

.EN
```

or

``` troff
.EQ

sum from i=1 to n x sub i

.EN
```

## References

``` troff
.[
VeniceHistory
.]
```

Then:

``` sh
refer references.bib
```

Automatic numbering.

## Version Control

Everything is plain text.

``` diff
-America inherited Rome.
+America inherited Venice.
```

instead of:

``` text
Binary file changed.
```

## Build System

``` make
book.pdf: book.ms refs
    refer refs |
    pic |
    tbl |
    eqn |
    troff -ms |
    ps2pdf > book.pdf
```

## Why UNIX People Loved This

Each tool does one thing well:

-   `eqn` --- equations
-   `tbl` --- tables
-   `pic` --- drawings
-   `troff` --- layout

No component knows anything about another.

## Bell Labs Heritage

The original *The C Programming Language* and many editions of *The UNIX
Programming Environment* were produced with `ms` macros.

Brian Kernighan famously preferred writing text over manipulating
formatting.

The markup disappears while you're writing.

## A Vision for First Pair Press

Rather than merely reviving troff, modernize the Bell Labs pipeline
around AI.

``` text
Markdown / Troff hybrid
        │
        ▼
AI semantic pass
        │
        ▼
refer
        │
        ▼
pic (AI-generated diagrams)
        │
        ▼
tbl
        │
        ▼
eqn
        │
        ▼
troff
        │
        ▼
PDF
        │
        ├── EPUB
        ├── HTML
        └── Print
```

The AI enriches the document with references, diagrams, indexes,
glossary entries, and consistency checks before handing a semantically
rich document to a deterministic typesetting engine.

## First Pair Macros

``` troff
.FP.TITLE "Lighthouse Republics"

.FP.AUTHOR "Alexy Khrabrov"

.FP.EPIGRAPH
The sea remembers every republic.
.FP.END

.FP.CHAPTER "The Lagoon"

The lagoon was Venice's first compiler.

.FP.QUOTE
Cities survive by changing their abstractions.
.FP.END

.FP.SIDEBAR "Why Lagoons Matter"
The lagoon acted as both moat and marketplace...
.FP.END

.FP.AI "Research Notes"
Summarize recent scholarship on Venetian naval logistics.
.FP.END
```

The `.FP.AI` blocks exist only in source. During the build they are
resolved into finished prose or omitted entirely, leaving the published
book free of AI scaffolding while preserving the Bell Labs ideal of
simple, readable source.

## Core Idea

The combination of classic troff composability with AI-aware semantic
macros could become the defining publishing system for First Pair Press:
AI-native books built on timeless UNIX principles.

## The Concrete First Pair Workflow

The proof workflow now lives in this repo rather than only in this
manifesto:

``` text
publishing/PUBLISH.md
publishing/scripts/build-firstpair-book.sh
publishing/scripts/md-to-utmac.py
publishing/scripts/setup-utmac.sh
proofs/kiffness-loop-lab/
```

It uses the current local book practice from QueryGraph and usavenice:

- Pandoc links semantic Markdown to every renderer.
- Typst builds the modern reader PDF and EPUB.
- Pandoc `ms` builds the classic troff source.
- Neatroff, from `~/src/neatroff_make`, builds the Bell Labs PDF.
- groff remains a compatibility fallback because the usavenice shipping
  pipeline already proves it at book scale.
- utmac adds a richer macro vocabulary for metadata, headings, notes,
  summaries, and book-like troff source.

The proof book is intentionally small: `proofs/kiffness-loop-lab`.
It is derived from the Kiffness controller-manual workflow, but its
main purpose is not music instruction. Its purpose is to prove that a
human-readable source can produce several deterministic book artifacts
while leaving enough evidence for the next human or AI collaborator to
understand what happened.

## What Builds Today

Run:

``` sh
proofs/kiffness-loop-lab/build.sh
```

The build emits:

``` text
firstpair-loop-lab-typst.pdf
firstpair-loop-lab-typst.epub
firstpair-loop-lab-neatroff.pdf
firstpair-loop-lab-groff.pdf
firstpair-loop-lab-utmac.pdf
firstpair-loop-lab-utmac.tr
VERSION.md
```

The utmac path is real, not merely a notation experiment. The setup
script fetches the current utmac upstream into `.tools/utmac`, runs its
makefile so generated macros such as `u-idx.tmac` and `u-ref.tmac`
exist, and then runs the Markdown-derived `.tr` source through
Neatroff.

## Human-AI Source Discipline

The AI should not be hidden in the result.

It should be visible in the workshop:

- `AI.md` says how future agents should reason about the proof.
- `manuscript.md` remains readable by a person.
- generated `.ms` and `.tr` files remain inspectable.
- `VERSION.md` records artifact names and page counts.
- renderer warnings are preserved as logs.

The published book should be clean. The build room should be honest.

That is the actual First Pair: the human sets intent, the AI removes
friction, and the text remains durable enough for either one to return.
