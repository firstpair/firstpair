# The First Pair Bell Labs Manifesto

## We Believe Books Are Software

Books are among humanity's oldest technologies.

Software is among its newest.

Both are systems for encoding ideas.

Software has spent decades learning how to evolve. Books have largely
learned how to imitate magazines. We believe books deserve better.

A book should not be a static artifact. It should be a living system
whose history, sources, reasoning, and construction are as inspectable
as a great piece of software.

------------------------------------------------------------------------

# Bell Labs Was Never About Telephones

People remember Bell Labs for the transistor, Unix, information theory,
C, and laser physics.

The deeper lesson is that Bell Labs built tools that amplified human
thought.

Unix was not merely an operating system. It was an operating philosophy.

-   Write programs that do one thing well.
-   Connect them together.
-   Keep interfaces simple.
-   Prefer text over opaque formats.
-   Trust composition over monoliths.

Publishing deserves the same philosophy.

------------------------------------------------------------------------

# The Book Is Semantic Source

The manuscript is not the final product.

It is semantic source.

Publishing is compilation.

Typography is only one backend among many.

The author's job is to express meaning. The toolchain's job is to render
that meaning beautifully.

Source should be:

-   plain text
-   readable without proprietary software
-   version controlled
-   semantically rich
-   durable for decades

Presentation should always be derived.

------------------------------------------------------------------------

# AI Is Another Unix Filter

Artificial intelligence should not replace thinking.

It should replace friction.

Like every good Unix tool, AI performs one task in a larger pipeline.

It can:

-   discover references
-   verify quotations
-   propose diagrams
-   generate indexes
-   check consistency
-   compare editions
-   summarize research
-   expose uncertainty

Judgment remains human.

AI is an assistant, never an authority.

------------------------------------------------------------------------

# Every Book Should Be Reproducible

Books should build like software.

Given the same manuscript, references, assets, and toolchain, the same
book should emerge.

No hidden formatting.

No invisible edits.

No proprietary magic.

Publishing should become reproducible research.

------------------------------------------------------------------------

# Plain Text Is Civilization's Longest-Lived File Format

Stone.

Clay.

Paper.

ASCII.

Unicode.

Plain text survives revolutions in technology.

We choose formats that our grandchildren can still read.

------------------------------------------------------------------------

# Many Renderers, One Source

A manuscript should outlive its rendering engine.

Today's beautiful formatter may someday disappear.

Meaning must not.

From one semantic source we should be able to produce:

-   Typst
-   troff
-   HTML
-   EPUB
-   PDF
-   print
-   presentations
-   future formats not yet invented

Renderers compete.

Source endures.

------------------------------------------------------------------------

# Pandoc Is Our Linker

Compilers transformed software engineering.

Pandoc can play a similar role in publishing.

It links semantic source to multiple rendering engines without coupling
authors to any single implementation.

The publishing pipeline becomes:

Semantic Source

↓

AI Enrichment

↓

Reference Resolution

↓

Diagram Generation

↓

Pandoc

↓

Typst • troff • HTML • EPUB • Print

The intermediate representation matters more than any single renderer.

------------------------------------------------------------------------

# Troff and Typst

Troff represents the Bell Labs tradition.

Typst represents a modern reimagining of programmable typography.

Neither is the destination.

Both are excellent backends.

First Pair Press is committed to ideas, not tools.

We choose the renderer that best serves the reader.

------------------------------------------------------------------------

# Diagrams Are Programs

Whenever possible, diagrams should be generated from source.

Relationships become graphs.

Timelines become events.

Maps become geometry.

Figures become executable knowledge.

------------------------------------------------------------------------

# References Are First-Class Citizens

Every important claim deserves provenance.

Citations should explain not only where information came from, but why
it matters.

Knowledge should be inspectable.

------------------------------------------------------------------------

# We Publish Reasoning

The internet optimizes for conclusions.

We optimize for reasoning.

Readers should understand not only what we believe, but how we arrived
there.

Good books teach methods of thought.

------------------------------------------------------------------------

# AI-Native Does Not Mean AI-Written

AI-native publishing means embracing computational thinking throughout
research, editing, verification, accessibility, translation, indexing,
and production.

Human authors remain responsible for ideas.

Machines amplify craftsmanship.

------------------------------------------------------------------------

# Small Tools, Loose Coupling

One tool researches.

One verifies.

One generates diagrams.

One builds indexes.

One renders Typst.

One renders troff.

One generates EPUB.

Each tool should be replaceable.

The pipeline is more important than any component.

------------------------------------------------------------------------

# Books Should Age Gracefully

Every edition should preserve its history.

Every correction should be visible.

Every revision should be traceable.

Knowledge evolves.

Books should evolve with it.

------------------------------------------------------------------------

# The Library Is a Knowledge Graph

Books should not live in isolation.

Ideas, people, places, events, and concepts should connect across the
catalog.

A publishing house should become an evolving graph of knowledge.

------------------------------------------------------------------------

# First Pair

The name "First Pair" has two meanings.

The first pair of programmers.

The first pair of collaborators.

Human and machine.

Neither replaces the other.

Together they build something neither could create alone.

------------------------------------------------------------------------

# The Bell Labs of Books

Our ambition is larger than publishing books.

We seek to build the Bell Labs of books.

A place where writers, researchers, designers, programmers, historians,
and intelligent machines create better tools for thinking.

Books are not the final product.

They are the visible proof that the system works.

------------------------------------------------------------------------

# Our Principles

We choose plain text over proprietary formats.

We choose semantic structure over visual markup.

We choose reproducible builds over manual layout.

We choose composable pipelines over monolithic software.

We choose open standards over lock-in.

We choose transparency over mystique.

We choose reasoning over rhetoric.

We choose collaboration over automation.

We choose enduring ideas over fashionable tools.

We are committed not to troff.

Not to Typst.

Not to Pandoc.

We are committed to a philosophy:

Ideas should outlive their implementations.

Tools should remain replaceable.

Knowledge should remain permanent.

That is the Bell Labs way.

That is the First Pair way.

------------------------------------------------------------------------

# The Proof Must Build

A manifesto is not enough.

First Pair Press must prove its ideas in working books.

The first proof lives in this repository as `proofs/kiffness-loop-lab`.
It takes a small music-manual idea and builds it as a reproducible
human-AI publishing artifact:

- plain Markdown source
- AI collaboration notes
- Pandoc conversion
- Typst PDF
- EPUB
- Neatroff PDF
- groff fallback PDF
- utmac troff source and PDF
- a `VERSION.md` artifact manifest

The proof is deliberately modest. It is small enough to inspect and real
enough to break.

That is where trust begins.
