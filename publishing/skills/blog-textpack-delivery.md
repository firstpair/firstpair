# Skill: Blog Textpack Delivery

Use when creating or delivering QueryGraph-family blog posts.

1. Keep the canonical post at `docs/blog/<slug>/post.md`.
2. Keep diagrams under `docs/blog/<slug>/diagrams/` as `.mmd` plus rendered
   `.png` files.
3. Build a `.textpack` in `docs/blog/<slug>/dist/`.
4. Keep only the zipped `.textpack`, not the unzipped `.textbundle/`.
5. Record the stable and versioned pack names in
   `docs/blog/<slug>/dist/VERSION.md`.
6. Copy the versioned `.textpack` to `~/icloud/blogs` and verify with `cmp`.

Reference command:

```sh
REPO_ROOT=/path/to/repo \
~/src/firstpair/publishing/scripts/publish-versioned-blog.sh docs/blog/<slug>
```

The builder Git-versions the source Markdown and referenced local assets before
packaging, then embeds that commit and a portable payload SHA-256 in the pack.
An untouched Omnighost import inherits the source commit; after publication,
its next sync is a no-op. Git failures fall back to hash-only provenance, and
the delivery script derives its filename stamp after the builder has committed.

The `.textpack` is the handoff unit for Ulysses and Omnighost. It carries
Markdown, bundled images, and Ghost routing metadata in `info.json`.
