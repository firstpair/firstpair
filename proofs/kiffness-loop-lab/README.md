# First Pair Loop Lab

This is the First Pair Press proof book. It takes the small Kiffness controller
manual idea and rebuilds it through a Bell Labs-style workflow:

- Markdown as semantic source;
- Pandoc as linker;
- Typst for the modern PDF and EPUB path;
- Pandoc `ms` plus Neatroff for the classic path;
- utmac source generated from the same Markdown for the macro experiment;
- groff retained as a compatibility fallback, matching the usavenice shipping
  pipeline.

Build it from the repo root or from this directory:

```sh
./proofs/kiffness-loop-lab/build.sh
```

Outputs land in `dist/`. The most important files are:

```text
firstpair-loop-lab-typst.pdf
firstpair-loop-lab-typst.epub
firstpair-loop-lab-neatroff.pdf
firstpair-loop-lab-groff.pdf
firstpair-loop-lab-utmac.pdf
firstpair-loop-lab-utmac.tr
VERSION.md
```

The utmac PDF may contain warnings until Libertinus is added to the local
Neatroff font set. The generated `.tr` source and `.log` stay next to the PDF so
the issue is visible and reproducible.
