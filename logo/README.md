# First Pair Press Marks

This directory owns First Pair Press house-brand source assets and reusable
publisher treatments. Book repositories may consume these marks while keeping
their title-specific cover compositions in the source repository that owns the
book.

- `first-pair-press-logo.svg` and `.png` are the dark horizontal library mark.
- `first-pair-press-logo-capsule.svg` and `.png` are the light capsule variant.
- `firstpair-catdog-logo.jpeg` is the source seal used to derive the reusable
  publisher mask and tinted treatments.
- `make-publisher-mask.py` regenerates `firstpair-publisher-mask.png` and
  `firstpair-publisher-bronze.png`; see `FIRSTPAIR-PUBLISHER-MASK.md` for the
  exact workflow.

Keep reusable First Pair branding here rather than in an individual book's
source repository.
