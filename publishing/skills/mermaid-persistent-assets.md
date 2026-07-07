# Skill: Mermaid Persistent Assets

Use when book or blog sources contain Mermaid diagrams.

1. Keep Mermaid source in `.mmd` files under `docs/book/diagrams/` or the
   relevant blog `diagrams/` directory.
2. Render committed PNGs next to the `.mmd` files.
3. Rewrite generated manuscript input to reference the PNG files.
4. Reuse the same PNGs for blogs, textpacks, Ghost, and troff output.
5. Never rely on raw Mermaid blocks for mobile, Ghost, or final troff/PDF
   delivery.

Reference renderer:

```sh
node ~/src/firstpair/publishing/scripts/render-mermaid.mjs \
  docs/book/manuscript.md \
  docs/book/build/manuscript.rendered.md \
  docs/book/diagrams
```
