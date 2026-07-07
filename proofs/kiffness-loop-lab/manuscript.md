---
title: First Pair Loop Lab
subtitle: A Kiffness-derived proof book for human-AI publishing
author: Alexy Khrabrov and Codex
---

# Start Here

This proof book is small on purpose.

The source idea comes from the Kiffness controller-manual workflow: teach a
musician how to turn a compact MIDI controller into an actual practice loop.
The publishing idea comes from First Pair Press: make the book itself a visible
collaboration between a human and an AI.

The human brings intention:

- this should feel practical, not ceremonial;
- the reader should know what to do with their hands;
- the source should remain readable years from now;
- the pipeline should explain itself.

The AI brings friction removal:

- convert source into renderer formats;
- check that artifacts were produced;
- preserve exact warnings;
- keep the workflow legible for the next collaborator.

That is the first pair.

# The Rig

The musical rig is deliberately modest:

- an Akai MPK mini or similar small controller;
- GarageBand or Ableton Live;
- one drum sound;
- one bass sound;
- one chord sound;
- one lead or sample sound.

The publishing rig is equally modest:

- Markdown for the human source;
- Pandoc for structured conversion;
- Typst for the modern PDF;
- EPUB for readers;
- Neatroff for the Bell Labs lineage;
- utmac for a richer macro vocabulary.

Neither rig tries to impress by size. The point is repeatability.

# A First Loop

Set the tempo to something slow enough to hear your mistakes. Ninety-two beats
per minute is a good beginner speed.

Make four tracks.

1. Drums.
2. Bass.
3. Chords.
4. Lead or sample.

Record one bar of drums first. Use the pads if the controller has pads. Use the
keyboard if it does not. The pattern can be simple: kick on one and three,
snare on two and four, closed hat on every eighth note.

Now record one bar of bass. Use only the root and fifth. If the song is in A
minor, that means A and E. Do not chase cleverness. Make the loop stable.

Add two-note chords. A minor can be A and C. F can be F and A. C can be C and E.
G can be G and B. Two notes are enough to teach the hand what harmony feels
like.

Finally add a lead sound or a sample. Give it space. One short answer every two
bars is better than a flood of notes.

# What The Controller Teaches

A small controller is useful because it refuses to let you hide.

The keys teach pitch. The pads teach rhythm. The knobs teach motion. The octave
buttons teach range. The transport buttons teach the difference between
recording and performing.

The beginner mistake is to map everything at once. The better workflow is to
assign one job at a time:

- keys play notes;
- pads play drums or launch clips;
- knobs shape one filter and one reverb;
- transport starts, stops, and records;
- the computer screen confirms what happened.

When the mapping is boring, the practice becomes musical.

# What The Publishing Pipeline Teaches

The book pipeline follows the same rule.

Markdown is the keyboard: direct, plain, and expressive.

Pandoc is the hub: it hears the source and sends it to different instruments.

Typst is the polished software instrument: fast, modern, and capable of elegant
pages.

Neatroff is the classic instrument: terse, programmable, and close to the Bell
Labs tradition.

utmac is the macro layer: it gives troff a more book-like vocabulary, with
headings, metadata, summaries, links, notes, and typography decisions living in
plain text.

The result is not one perfect renderer. The result is a system where renderers
can disagree without threatening the source.

# How A Human And AI Should Work

The human should write what matters.

The AI should make the workshop easier to use.

A good AI collaborator can draft a table of contents, convert a chapter into
utmac, notice a missing artifact, or explain why a PDF has warning output. A
bad AI collaborator hides uncertainty and produces a polished artifact whose
source nobody can inspect.

First Pair Press chooses the first kind.

For every build, leave evidence:

- the Markdown source;
- the generated `.ms` source;
- the generated `.tr` source;
- the Typst PDF;
- the Neatroff PDF;
- the EPUB;
- the `VERSION.md` manifest;
- the warning log when an engine complains.

That evidence is not bureaucracy. It is trust.

# The Practice Page

Use this page as a rehearsal.

Read the source. Build the book. Open the PDF. Open the EPUB. Inspect the utmac
source. Read the log. Then change one sentence and build again.

If the sentence changes everywhere, the pipeline works.

If the source remains clear, the human can keep writing.

If the generated files explain what happened, the AI can keep helping.

That is the whole proof.
