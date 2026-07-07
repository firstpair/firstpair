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

The `.textpack` is the handoff unit for Ulysses and Omnighost. It carries
Markdown, bundled images, and Ghost routing metadata in `info.json`.
