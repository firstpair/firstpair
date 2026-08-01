# Skill: Blog Textpack Delivery

Use when creating or delivering QueryGraph-family blog posts.

1. Begin with the owning repository clean and exactly at its configured remote
   upstream. Do not start writing on top of uncommitted or unpushed work.
2. Keep the canonical post at `docs/blog/<slug>/post.md`.
3. Keep diagrams under `docs/blog/<slug>/diagrams/` as `.mmd` plus rendered
   `.png` files.
4. Commit and push the finished post and every referenced asset, then run
   `publishing/scripts/git_publish_preflight.py` (the builder also enforces it).
5. Run `stamp-versioned-blog.sh` to build the `.textpack`, versioned link, and
   `VERSION.md` in `docs/blog/<slug>/dist/`.
6. Keep only the zipped `.textpack`, not the unzipped `.textbundle/`.
7. Record the stable and versioned pack names in
   `docs/blog/<slug>/dist/VERSION.md`.
8. Commit and push the generated textpack, version marker, and versioned link,
   restoring a clean repository.
9. Only then run `publish-versioned-blog.sh` to copy the already-committed pack
   to `~/icloud/blogs`, and verify with `cmp`.

Reference command:

```sh
REPO_ROOT=/path/to/repo \
~/src/firstpair/publishing/scripts/stamp-versioned-blog.sh docs/blog/<slug>

git add docs/blog/<slug>/dist
git commit -m "Stamp <slug> blog textpack"
git push

REPO_ROOT=/path/to/repo \
~/src/firstpair/publishing/scripts/publish-versioned-blog.sh docs/blog/<slug>
```

The builder requires the source Markdown and referenced local assets to match
the clean, pushed HEAD before packaging. It embeds the newest pushed commit
that changed any bundled input and whose tree matches every bundled input,
plus a portable payload SHA-256. Deterministic ZIP metadata makes an unchanged
rebuild byte-identical after a pack-only commit. The builder does not commit or
push and it does not fall back to hash-only provenance. An untouched Omnighost
import inherits the source commit; after publication, its next sync is a no-op.
The stamping script derives its filename from the embedded source commit. The
delivery script accepts only a tracked handoff in a clean, pushed repository;
it never rebuilds the pack.

The `.textpack` is the handoff unit for Ulysses and Omnighost. It carries
Markdown, bundled images, and Ghost routing metadata in `info.json`.
