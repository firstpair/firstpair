#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${REPO_ROOT:-.}" && pwd)"
book_root="${BOOK_ROOT:-docs/book}"
book_dir="$repo_root/$book_root"
dist_dir="${BOOK_DIST_DIR:-$book_dir/dist}"
build_dir="${BOOK_BUILD_DIR:-$book_dir/build}"
metadata="${BOOK_METADATA:-$book_dir/metadata.yaml}"
cover="${BOOK_HTML_COVER:-${BOOK_COVER_RENDERED:-$book_dir/cover.md}}"
manuscript="${BOOK_HTML_MANUSCRIPT:-${BOOK_RENDERED_MANUSCRIPT:-$book_dir/manuscript.md}}"
css="${BOOK_HTML_CSS:-${BOOK_CSS:-$book_dir/epub.css}}"
resource_path="${BOOK_HTML_RESOURCE_PATH:-$build_dir:$book_dir:$repo_root}"
reader="${BOOK_HTML_READER:-markdown+smart}"

mkdir -p "$dist_dir" "$build_dir"

read_yaml_value() {
  local key="$1"
  local file="$2"
  awk -F: -v key="$key" '
    $1 ~ "^[[:space:]]*" key "[[:space:]]*$" {
      value = $2
      sub(/^[[:space:]]*/, "", value)
      sub(/[[:space:]]*$/, "", value)
      gsub(/^["'\''"]|["'\''"]$/, "", value)
      print value
      exit
    }
  ' "$file"
}

detect_version() {
  if [[ -n "${BOOK_VERSION:-}" ]]; then
    printf '%s\n' "$BOOK_VERSION"
    return
  fi
  if [[ -f "$repo_root/Cargo.toml" ]]; then
    awk '
      /^\[workspace\.package\]/ { in_workspace_package = 1; next }
      /^\[package\]/ { in_package = 1; next }
      /^\[/ { in_workspace_package = 0; in_package = 0 }
      (in_workspace_package || in_package) && /^version[[:space:]]*=/ {
        gsub(/"/, "", $3)
        print $3
        exit
      }
    ' "$repo_root/Cargo.toml"
    return
  fi
  if [[ -f "$book_dir/VERSION" ]]; then
    tr -d '[:space:]' < "$book_dir/VERSION"
    return
  fi
}

if [[ ! -f "$metadata" ]]; then
  echo "missing metadata: $metadata" >&2
  exit 2
fi
if [[ ! -f "$manuscript" ]]; then
  echo "missing manuscript: $manuscript" >&2
  exit 2
fi

title_stem="${BOOK_STEM:-$(read_yaml_value title_stem "$metadata")}"
visible_title="${BOOK_VISIBLE_TITLE:-$(read_yaml_value title "$metadata")}"
version="$(detect_version)"
git_hash="$(git -C "$repo_root" rev-parse --short HEAD 2>/dev/null || echo nogit)"
pubdate="${BOOK_PUBDATE:-$(date -u +%F)}"

if [[ -z "$title_stem" || -z "$visible_title" ]]; then
  echo "could not read title_stem or title from $metadata" >&2
  exit 1
fi
if [[ -z "$version" ]]; then
  version="0.0.0"
fi

version_stamp="${BOOK_VERSION_STAMP:-$version-$git_hash}"
html_file="$dist_dir/$title_stem.html"
html_link="$dist_dir/$title_stem ($version_stamp).html"
html_chapters_dir="$dist_dir/$title_stem-chapters"
html_chapters_link="$dist_dir/$title_stem ($version_stamp)-chapters"
html_title="${BOOK_HTML_TITLE:-$visible_title}"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

sources=()
if [[ -f "$cover" ]]; then
  # Raw PDF-only typst/ms blocks do not belong in the browser edition.
  sed '/^```{=typst}$/,/^```$/d; /^```{=ms}$/,/^```$/d' "$cover" > "$tmpdir/cover.html.md"
  sources+=("$tmpdir/cover.html.md")
fi
sources+=("$manuscript")

pandoc_args=(
  --from "$reader"
  --standalone
  --embed-resources
  --toc
  --toc-depth="${BOOK_HTML_TOC_DEPTH:-2}"
  --number-sections
  --metadata-file "$metadata"
  --metadata "title=$html_title"
  --metadata "date=$pubdate"
  --resource-path "$resource_path"
  --output "$html_file"
)

if [[ -f "$css" ]]; then
  pandoc_args+=(--css "$css")
fi
if [[ -n "${BOOK_HTML_LUA_FILTER:-}" ]]; then
  pandoc_args+=(--lua-filter "$BOOK_HTML_LUA_FILTER")
fi

pandoc "${sources[@]}" "${pandoc_args[@]}"
perl -pi -e 's/[ \t]+$//' "$html_file"

find "$dist_dir" -maxdepth 1 -name "$title_stem (*).html" -exec rm -f {} +
ln -s "$(basename "$html_file")" "$html_link"

if [[ "${BOOK_HTML_SPLIT:-1}" != "0" ]]; then
  chunk_work="$tmpdir/chunk-work"
  chunk_zip="$tmpdir/$title_stem-chapters.zip"
  chunk_css="$chunk_work/book.css"
  mkdir -p "$chunk_work"

  chunk_args=(
    --from "$reader"
    --to chunkedhtml
    --standalone
    --toc
    --toc-depth="${BOOK_HTML_TOC_DEPTH:-2}"
    --number-sections
    --metadata-file "$metadata"
    --metadata "title=$html_title"
    --metadata "date=$pubdate"
    --resource-path "$resource_path"
    --split-level="${BOOK_HTML_SPLIT_LEVEL:-1}"
    --chunk-template="${BOOK_HTML_CHUNK_TEMPLATE:-chapter-%n.html}"
    --embed-resources
    --output "$chunk_zip"
  )

  if [[ -f "$css" ]]; then
    cp "$css" "$chunk_css"
    chunk_args+=(--css book.css)
  fi
  if [[ -n "${BOOK_HTML_LUA_FILTER:-}" ]]; then
    chunk_args+=(--lua-filter "$BOOK_HTML_LUA_FILTER")
  fi

  (
    cd "$chunk_work"
    pandoc "${sources[@]}" "${chunk_args[@]}"
  )

  rm -rf "$html_chapters_dir"
  mkdir -p "$html_chapters_dir"
  unzip -q "$chunk_zip" -d "$html_chapters_dir"
  if [[ -f "$chunk_css" ]]; then
    cp "$chunk_css" "$html_chapters_dir/book.css"
  fi
  python_bin="$("$script_dir/ensure-python-env.sh" "$script_dir/../python")"
  "$python_bin" - "$html_chapters_dir" <<'PY'
from __future__ import annotations

import hashlib
import html
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

chapter_dir = Path(sys.argv[1])
asset_dir = chapter_dir / "assets"
attr_re = re.compile(r'\b(src|href)="([^"]+)"')


def local_path(url: str) -> Path | None:
    parsed = urlparse(html.unescape(url))
    if parsed.scheme not in {"", "file"}:
        return None
    if parsed.scheme == "file":
        path = Path(unquote(parsed.path))
    else:
        if not parsed.path.startswith("/"):
            return None
        path = Path(unquote(parsed.path))
    if path.is_file():
        return path
    return None


def asset_bytes(path: Path) -> bytes:
    data = path.read_bytes()
    if path.suffix.lower() in {".css", ".csv", ".js", ".json", ".svg", ".txt", ".xml"}:
        text = data.decode("utf-8")
        data = re.sub(r"[ \t]+(?=\r?$)", "", text, flags=re.MULTILINE).encode("utf-8")
    return data


def asset_name(path: Path, data: bytes) -> str:
    digest = hashlib.sha256(data).hexdigest()[:12]
    return f"{digest}-{path.name}"


def rewrite(match: re.Match[str]) -> str:
    attr, url = match.groups()
    path = local_path(url)
    if path is None:
        return match.group(0)
    asset_dir.mkdir(exist_ok=True)
    data = asset_bytes(path)
    name = asset_name(path, data)
    target = asset_dir / name
    if not target.exists():
        target.write_bytes(data)
    return f'{attr}="assets/{name}"'


for html_file in chapter_dir.glob("*.html"):
    text = html_file.read_text(encoding="utf-8")
    rewritten = attr_re.sub(rewrite, text)
    if rewritten != text:
        html_file.write_text(rewritten, encoding="utf-8")
PY
  find "$html_chapters_dir" -type f \
    \( -name '*.html' -o -name '*.css' -o -name '*.csv' -o -name '*.js' \
       -o -name '*.json' -o -name '*.svg' -o -name '*.txt' -o -name '*.xml' \) \
    -exec perl -pi -e 's/[ \t]+$//' {} +
  find "$dist_dir" -maxdepth 1 -name "$title_stem (*)-chapters" -exec rm -rf {} +
  ln -s "$(basename "$html_chapters_dir")" "$html_chapters_link"
fi

if [[ -f "$dist_dir/VERSION.md" ]]; then
  tmp_marker="$tmpdir/VERSION.md"
  awk '
    !/^html_file:/ &&
    !/^html_link:/ &&
    !/^html_chapters_dir:/ &&
    !/^html_chapters_link:/ &&
    !/^html_title:/ { print }
  ' "$dist_dir/VERSION.md" > "$tmp_marker"
  {
    cat "$tmp_marker"
    printf 'html_file: %s.html\n' "$title_stem"
    printf 'html_link: %s.html\n' "$title_stem ($version_stamp)"
    if [[ "${BOOK_HTML_SPLIT:-1}" != "0" ]]; then
      printf 'html_chapters_dir: %s-chapters\n' "$title_stem"
      printf 'html_chapters_link: %s\n' "$title_stem ($version_stamp)-chapters"
    fi
    printf 'html_title: %s\n' "$html_title"
  } > "$dist_dir/VERSION.md"
fi

echo "Built HTML:"
echo "  $html_file"
echo "  $html_link -> $(basename "$html_file")"
if [[ "${BOOK_HTML_SPLIT:-1}" != "0" ]]; then
  echo "  $html_chapters_dir/"
  echo "  $html_chapters_link -> $(basename "$html_chapters_dir")"
fi
