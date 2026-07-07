#!/usr/bin/env python3
"""Build a .textpack (zipped TextBundle) from a Markdown blog post.

The pack imports cleanly into Ulysses and into Obsidian via Omnighost's
"Import textpack" command. Omnighost reads Ghost publishing metadata from
info.json under the "omnighost" key.

Layout produced:

    <name>.textbundle/
      text.markdown
      info.json
      assets/<image>.png

Usage:

    textpack.py <post.md | post-dir> [options]

    --name NAME       bundle name (default: post dir name, or the .md stem)
    --blog DOMAIN     Ghost blog domain for Omnighost import (default: querygraph.ai)
    --slug SLUG       Ghost post slug (default: the bundle name)
    --tags a,b,c      Ghost tags
    --excerpt TEXT    Ghost excerpt
    --out FILE        output path (default: <post-dir>/dist/<name>.textpack)
    --no-reflow       keep the post's hard-wrapped lines as-is
    --render          re-render stale diagrams/*.mmd to PNG with mmdc first
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

INFO_TYPE = "net.daringfireball.markdown"
IMG_RE = re.compile(
    r"!\[([^\]]*)\]\(\s*(?!https?:|data:)([^)\s]+?\.(?:png|jpe?g|gif|webp|svg))\s*\)",
    re.I,
)
STRUCT_RE = re.compile(r"^(#|>|\||!\[|\s*[-*+] |\s*\d+\. |(---|\*\*\*|___)\s*$)")


def reflow(markdown: str) -> str:
    """Collapse prose paragraphs to one soft-wrapping line."""
    out: list[str] = []
    para: list[str] = []
    in_code = False

    def flush() -> None:
        if para:
            out.append(" ".join(para))
            para.clear()

    for line in markdown.split("\n"):
        stripped = line.strip()
        if stripped.startswith("```"):
            flush()
            out.append(line)
            in_code = not in_code
            continue
        if in_code:
            out.append(line)
            continue
        if stripped == "":
            flush()
            out.append("")
            continue
        if STRUCT_RE.match(stripped):
            flush()
            out.append(line)
        else:
            para.append(stripped)
    flush()
    return "\n".join(out).rstrip("\n") + "\n"


def render_diagrams(post_dir: str) -> None:
    """Render stale diagrams/*.mmd to PNG with mmdc, white background, 2x."""
    diagram_dir = os.path.join(post_dir, "diagrams")
    if not os.path.isdir(diagram_dir):
        return
    if shutil.which("mmdc") is None:
        sys.exit("--render requested but mmdc (@mermaid-js/mermaid-cli) is not on PATH")
    for name in sorted(os.listdir(diagram_dir)):
        if not name.endswith(".mmd"):
            continue
        src = os.path.join(diagram_dir, name)
        png = src[:-4] + ".png"
        if os.path.exists(png) and os.path.getmtime(png) >= os.path.getmtime(src):
            continue
        print(f"rendering {name}")
        subprocess.run(["mmdc", "-i", src, "-o", png, "-b", "white", "-s", "2"], check=True)


def build(
    post_path: str,
    name: str,
    blog: str,
    slug: str,
    tags: list[str],
    excerpt: str,
    out: str,
    do_reflow: bool,
) -> str:
    post_dir = os.path.dirname(post_path)
    with open(post_path, encoding="utf-8") as handle:
        text = handle.read()

    if re.search(r"^```mermaid", text, re.M):
        print(
            "WARNING: post contains fenced mermaid blocks; neither Ulysses nor Ghost "
            "renders them. Render to PNG and reference the images instead.",
            file=sys.stderr,
        )

    if do_reflow:
        text = reflow(text)

    images: dict[str, str] = {}
    missing: list[str] = []

    def to_asset(match: re.Match[str]) -> str:
        alt, rel = match.group(1), match.group(2)
        src = os.path.normpath(os.path.join(post_dir, rel))
        base = os.path.basename(rel)
        if not os.path.isfile(src):
            missing.append(rel)
            return match.group(0)
        if base in images and images[base] != src:
            sys.exit(f"image basename collision in bundle: {base}")
        images[base] = src
        return f"![{alt}](assets/{base})"

    text = IMG_RE.sub(to_asset, text)
    if missing:
        sys.exit("missing image file(s): " + ", ".join(missing))

    info: dict[str, object] = {"version": 2, "type": INFO_TYPE, "transient": False}
    omnighost: dict[str, object] = {"blog": blog, "slug": slug}
    if tags:
        omnighost["tags"] = tags
    if excerpt:
        omnighost["excerpt"] = excerpt
    info["omnighost"] = omnighost

    with tempfile.TemporaryDirectory() as scratch:
        bundle = os.path.join(scratch, f"{name}.textbundle")
        os.makedirs(os.path.join(bundle, "assets"), exist_ok=True)
        with open(os.path.join(bundle, "text.markdown"), "w", encoding="utf-8") as handle:
            handle.write(text)
        with open(os.path.join(bundle, "info.json"), "w", encoding="utf-8") as handle:
            json.dump(info, handle, indent=2)
        for base, src in images.items():
            shutil.copy(src, os.path.join(bundle, "assets", base))

        os.makedirs(os.path.dirname(out), exist_ok=True)
        if os.path.exists(out):
            os.remove(out)
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
            for root, _, files in os.walk(bundle):
                for filename in sorted(files):
                    path = os.path.join(root, filename)
                    archive.write(path, os.path.relpath(path, scratch))

    with zipfile.ZipFile(out) as archive:
        bad = [entry for entry in archive.namelist() if not entry.startswith(f"{name}.textbundle/")]
        if bad:
            sys.exit(f"zip layout wrong, entries outside {name}.textbundle/: {bad}")

    return out


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("post", help="post .md file, or a directory containing post.md")
    parser.add_argument("--name")
    parser.add_argument("--blog", default="querygraph.ai")
    parser.add_argument("--slug")
    parser.add_argument("--tags", default="")
    parser.add_argument("--excerpt", default="")
    parser.add_argument("--out")
    parser.add_argument("--no-reflow", action="store_true")
    parser.add_argument("--render", action="store_true")
    args = parser.parse_args()

    post = args.post
    if os.path.isdir(post):
        post_dir = post.rstrip("/")
        post = os.path.join(post_dir, "post.md")
        default_name = os.path.basename(post_dir)
    else:
        post_dir = os.path.dirname(post) or "."
        stem = os.path.splitext(os.path.basename(post))[0]
        default_name = stem if stem != "post" else os.path.basename(os.path.abspath(post_dir))
    if not os.path.isfile(post):
        sys.exit(f"post not found: {post}")

    name = args.name or default_name
    slug = args.slug or name
    tags = [tag.strip() for tag in args.tags.split(",") if tag.strip()]
    out = args.out or os.path.join(post_dir, "dist", f"{name}.textpack")

    if args.render:
        render_diagrams(post_dir)

    built = build(post, name, args.blog, slug, tags, args.excerpt, out, not args.no_reflow)
    print(f"built {built} ({os.path.getsize(built):,} bytes)")


if __name__ == "__main__":
    main()
