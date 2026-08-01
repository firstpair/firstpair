#!/usr/bin/env python3
"""Build a .textpack (zipped TextBundle) from a Markdown blog post.

The pack imports cleanly into Ulysses AND into Obsidian via the Omnighost
plugin's "Import textpack" command, which reads Ghost publishing metadata
from the bundle's info.json (the "omnighost" key below).

Layout produced:

    <name>.textbundle/
      text.markdown        # the post, prose reflowed to one line per paragraph
      info.json            # TextBundle v2 + Omnighost publishing/source metadata
      assets/<image>.png   # every local image the post references

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

The source post is never modified: reflow and the diagrams/->assets/ rewrite
apply only to the bundled copy. Before packaging, the owning repository must be
clean and its HEAD must match the configured remote upstream. The pack records
that pushed commit and a validated payload SHA-256. Mermaid sources live in
<post-dir>/diagrams/ (one .mmd per diagram, PNG committed next to it).
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

from git_publish_preflight import (
    GitPublishPreflightError,
    require_clean_pushed_repo,
)

INFO_TYPE = "net.daringfireball.markdown"
PROVENANCE_SCHEMA = "omnighost-textpack-v1"
# Local image refs the bundler collects: ![alt](diagrams/x.png), ![alt](assets/x.png),
# or any bare relative path without a scheme.
IMG_RE = re.compile(r"!\[([^\]]*)\]\(\s*(?!https?:|data:)([^)\s]+?\.(?:png|jpe?g|gif|webp|svg))\s*\)", re.I)
STRUCT_RE = re.compile(r"^(#|>|\||!\[|\s*[-*+] |\s*\d+\. |(---|\*\*\*|___)\s*$)")


def git_run(repo: str, *args: str) -> subprocess.CompletedProcess[str]:
    command = ["git", "-C", repo, *args]
    environment = dict(os.environ)
    environment["GIT_TERMINAL_PROMPT"] = "0"
    try:
        return subprocess.run(
            command,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=60,
            env=environment,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return subprocess.CompletedProcess(command, 124, "", str(error))


def file_digest(path: str) -> bytes:
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).digest()


def read_bytes(path: str) -> bytes:
    with open(path, "rb") as handle:
        return handle.read()


def source_paths_for_textpack(post_path: str) -> list[str]:
    post_path = os.path.realpath(post_path)
    post_dir = os.path.dirname(post_path)
    with open(post_path, encoding="utf-8") as handle:
        text = handle.read()
    paths = {post_path}
    images: dict[str, str] = {}
    missing: list[str] = []
    for match in IMG_RE.finditer(text):
        image = os.path.realpath(os.path.normpath(os.path.join(post_dir, match.group(2))))
        if not os.path.isfile(image):
            missing.append(match.group(2))
            continue
        basename = os.path.basename(image)
        if basename in images and images[basename] != image:
            sys.exit(
                f"image basename collision in bundle: {basename} "
                f"({images[basename]} vs {image}) — rename one of them"
            )
        images[basename] = image
        paths.add(image)
    if missing:
        sys.exit("missing image file(s): " + ", ".join(missing))
    return sorted(paths)


def require_git_version(paths: list[str]) -> str:
    """Require pushed inputs and return their stable source-changing commit."""
    before = {path: file_digest(path) for path in paths}
    try:
        state = require_clean_pushed_repo(os.path.dirname(paths[0]))
    except GitPublishPreflightError as error:
        sys.exit(f"Git publish preflight failed: {error}")

    relative: list[str] = []
    for path in paths:
        rel = os.path.relpath(os.path.realpath(path), state.root).replace(os.sep, "/")
        if rel == ".." or rel.startswith("../") or os.path.isabs(rel):
            sys.exit("Git publish preflight failed: a bundled input is outside the repository")
        relative.append(rel)

    history = git_run(
        state.root,
        "log",
        "--full-history",
        "--topo-order",
        "--format=%H",
        "--",
        *relative,
    )
    if history.returncode != 0:
        sys.exit("Git publish preflight failed: could not inspect bundled-input history")
    candidates = list(dict.fromkeys(history.stdout.splitlines()))
    source_commit = next(
        (
            candidate.lower()
            for candidate in candidates
            if re.fullmatch(r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})", candidate)
            and git_commit_matches_sources(candidate, paths)
        ),
        None,
    )
    if not source_commit:
        sys.exit(
            "Git publish preflight failed: every post and referenced asset must be "
            "tracked together in a pushed source revision matching the current files"
        )
    if any(file_digest(path) != before[path] for path in paths):
        sys.exit("Git publish preflight failed: a bundled input changed during verification")
    return source_commit


def git_commit_matches_sources(commit: str, paths: list[str]) -> bool:
    repository = git_run(os.path.dirname(paths[0]), "rev-parse", "--show-toplevel")
    if repository.returncode != 0:
        return False
    repo = os.path.realpath(repository.stdout.strip())
    for path in paths:
        rel = os.path.relpath(os.path.realpath(path), repo).replace(os.sep, "/")
        if rel == ".." or rel.startswith("../") or os.path.isabs(rel):
            return False
        committed = git_run(repo, "rev-parse", "--verify", f"{commit}:{rel}")
        current = git_run(repo, "hash-object", f"--path={rel}", "--", path)
        if committed.returncode != 0 or current.returncode != 0:
            return False
        if committed.stdout.strip() != current.stdout.strip():
            return False
    return True


def reflow(markdown: str) -> str:
    """Collapse each prose paragraph to one soft-wrapping line.

    Code fences, headings, lists, tables, blockquotes, images, and rules pass
    through untouched; only consecutive plain-prose lines are joined.
    """
    out, para, in_code = [], [], False

    def flush():
        if para:
            out.append(" ".join(para))
            para.clear()

    for ln in markdown.split("\n"):
        s = ln.strip()
        if s.startswith("```"):
            flush()
            out.append(ln)
            in_code = not in_code
            continue
        if in_code:
            out.append(ln)
            continue
        if s == "":
            flush()
            out.append("")
            continue
        if STRUCT_RE.match(s):
            flush()
            out.append(ln)
        else:
            para.append(s)
    flush()
    return "\n".join(out).rstrip("\n") + "\n"


def write_deterministic_zip_entry(
    archive: zipfile.ZipFile,
    name: str,
    data: bytes,
) -> None:
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = (0o100644 & 0xFFFF) << 16
    archive.writestr(info, data)


def render_diagrams(post_dir: str) -> None:
    """Render stale diagrams/*.mmd to PNG with mmdc (white bg, 2x)."""
    ddir = os.path.join(post_dir, "diagrams")
    if not os.path.isdir(ddir):
        return
    if shutil.which("mmdc") is None:
        sys.exit("--render requested but mmdc (@mermaid-js/mermaid-cli) is not on PATH")
    for mmd in sorted(os.listdir(ddir)):
        if not mmd.endswith(".mmd"):
            continue
        src = os.path.join(ddir, mmd)
        png = src[:-4] + ".png"
        if os.path.exists(png) and os.path.getmtime(png) >= os.path.getmtime(src):
            continue
        print(f"rendering {mmd}")
        subprocess.run(["mmdc", "-i", src, "-o", png, "-b", "white", "-s", "2"], check=True)


def build(post_path: str, name: str, blog: str, slug: str, tags: list[str],
          excerpt: str, out: str, do_reflow: bool,
          source_git_commit: str) -> tuple[str, str]:
    post_dir = os.path.dirname(post_path)
    source_post_bytes = read_bytes(post_path)
    text = source_post_bytes.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")

    if re.search(r"^```mermaid", text, re.M):
        print("WARNING: post contains fenced mermaid blocks; neither Ulysses nor Ghost "
              "renders them. Render to PNG (see diagrams/ + --render) and reference "
              "the images instead.", file=sys.stderr)

    if do_reflow:
        text = reflow(text)

    # Collect referenced local images and rewrite each ref to assets/<basename>.
    images: dict[str, str] = {}  # basename -> absolute source path
    missing: list[str] = []

    def to_asset(m: re.Match) -> str:
        alt, rel = m.group(1), m.group(2)
        src = os.path.normpath(os.path.join(post_dir, rel))
        base = os.path.basename(rel)
        if not os.path.isfile(src):
            missing.append(rel)
            return m.group(0)
        if base in images and images[base] != src:
            sys.exit(f"image basename collision in bundle: {base} "
                     f"({images[base]} vs {src}) — rename one of them")
        images[base] = src
        return f"![{alt}](assets/{base})"

    text = IMG_RE.sub(to_asset, text)
    if missing:
        sys.exit("missing image file(s): " + ", ".join(missing))

    asset_data = {
        base: read_bytes(src)
        for base, src in sorted(images.items())
    }
    captured_sources = {
        os.path.realpath(post_path): source_post_bytes,
        **{
            os.path.realpath(images[base]): data
            for base, data in asset_data.items()
        },
    }
    source_paths = sorted(captured_sources)
    captured_sources_still_current = all(
        file_digest(path) == hashlib.sha256(data).digest()
        for path, data in captured_sources.items()
    )
    if (
        not git_commit_matches_sources(source_git_commit, source_paths)
        or not captured_sources_still_current
    ):
        sys.exit("Git publish preflight failed: source changed after verification")
    asset_manifest = [
        {"name": base, "sha256": hashlib.sha256(data).hexdigest()}
        for base, data in asset_data.items()
    ]

    info = {"version": 2, "type": INFO_TYPE, "transient": False}
    omnighost = {"blog": blog, "slug": slug}
    if tags:
        omnighost["tags"] = tags
    if excerpt:
        omnighost["excerpt"] = excerpt
    markdown_bytes = text.encode("utf-8")
    source_payload = {
        "schema": PROVENANCE_SCHEMA,
        "markdownSha256": hashlib.sha256(markdown_bytes).hexdigest(),
        "assets": asset_manifest,
        "publishing": dict(omnighost),
        "gitCommit": source_git_commit,
    }
    payload_json = json.dumps(
        source_payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    omnighost["provenance"] = {
        "schema": PROVENANCE_SCHEMA,
        "payloadSha256": hashlib.sha256(payload_json).hexdigest(),
    }
    omnighost["provenance"]["gitCommit"] = source_git_commit
    info["omnighost"] = omnighost

    output_dir = os.path.dirname(os.path.abspath(out))
    os.makedirs(output_dir, exist_ok=True)
    descriptor, temporary_out = tempfile.mkstemp(
        prefix=f".{os.path.basename(out)}.",
        suffix=".tmp",
        dir=output_dir,
    )
    os.close(descriptor)
    try:
        bundle_root = f"{name}.textbundle"
        info_bytes = json.dumps(info, indent=2).encode("utf-8")
        with zipfile.ZipFile(temporary_out, "w") as archive:
            write_deterministic_zip_entry(
                archive,
                f"{bundle_root}/text.markdown",
                markdown_bytes,
            )
            write_deterministic_zip_entry(
                archive,
                f"{bundle_root}/info.json",
                info_bytes,
            )
            for base, data in sorted(asset_data.items()):
                write_deterministic_zip_entry(
                    archive,
                    f"{bundle_root}/assets/{base}",
                    data,
                )

        # The zip's top-level entry must be <name>.textbundle/ for Ulysses.
        with zipfile.ZipFile(temporary_out) as z:
            bad = [entry for entry in z.namelist() if not entry.startswith(f"{name}.textbundle/")]
            if bad:
                sys.exit(f"zip layout wrong, entries outside {name}.textbundle/: {bad}")
            if z.testzip() is not None:
                sys.exit("zip verification failed")
        os.replace(temporary_out, out)
    finally:
        if os.path.exists(temporary_out):
            os.remove(temporary_out)

    return out, source_git_commit


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("post", help="post .md file, or a directory containing post.md")
    ap.add_argument("--name")
    ap.add_argument("--blog", default="querygraph.ai")
    ap.add_argument("--slug")
    ap.add_argument("--tags", default="")
    ap.add_argument("--excerpt", default="")
    ap.add_argument("--out")
    ap.add_argument("--no-reflow", action="store_true")
    ap.add_argument("--render", action="store_true")
    args = ap.parse_args()

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
    tags = [t.strip() for t in args.tags.split(",") if t.strip()]
    out = args.out or os.path.join(post_dir, "dist", f"{name}.textpack")

    if args.render:
        render_diagrams(post_dir)

    source_paths = source_paths_for_textpack(post)
    source_git_commit = require_git_version(source_paths)
    built, embedded_git_commit = build(
        post,
        name,
        args.blog,
        slug,
        tags,
        args.excerpt,
        out,
        not args.no_reflow,
        source_git_commit,
    )
    size = os.path.getsize(built)
    print(f"built {built} ({size:,} bytes)")
    if embedded_git_commit:
        print(f"source git {embedded_git_commit}")


if __name__ == "__main__":
    main()
