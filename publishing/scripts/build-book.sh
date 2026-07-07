#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${REPO_ROOT:-.}" && pwd)"
book_root="${BOOK_ROOT:-docs/book}"
book_dir="$repo_root/$book_root"
dist_dir="${BOOK_DIST_DIR:-$book_dir/dist}"
build_dir="${BOOK_BUILD_DIR:-$book_dir/build}"
manuscript="${BOOK_MANUSCRIPT:-$book_dir/manuscript.md}"
metadata="${BOOK_METADATA:-$book_dir/metadata.yaml}"
cover="${BOOK_COVER:-$book_dir/cover.md}"
formats="${BOOK_FORMATS:-typst}"
publish_dir="${BOOK_PUBLISH_DIR:-}"
render_script="${BOOK_RENDER_SCRIPT:-$script_dir/render-mermaid.mjs}"

mkdir -p "$dist_dir" "$build_dir"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

export TMPDIR="$tmpdir"
export CALIBRE_CONFIG_DIRECTORY="${CALIBRE_CONFIG_DIRECTORY:-$tmpdir/calibre-config}"
mkdir -p "$CALIBRE_CONFIG_DIRECTORY"

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
  if [[ -f "$repo_root/package.json" ]]; then
    node -p "require('$repo_root/package.json').version"
    return
  fi
  if [[ -f "$book_dir/VERSION" ]]; then
    tr -d '[:space:]' < "$book_dir/VERSION"
    return
  fi
}

run_pandoc() {
  (
    cd "$tmpdir"
    pandoc "$@"
  )
}

extract_raw_block() {
  local format="$1"
  local source="$2"
  local output="$3"
  awk -v format="$format" '
    $0 == "```{=" format "}" { in_block = 1; next }
    in_block && /^```$/ { exit }
    in_block { print }
  ' "$source" > "$output"
}

ebook_convert() {
  if [[ -n "${EBOOK_CONVERT:-}" ]]; then
    "$EBOOK_CONVERT" "$@"
  elif command -v ebook-convert >/dev/null 2>&1; then
    ebook-convert "$@"
  elif [[ -x /Applications/calibre.app/Contents/MacOS/ebook-convert ]]; then
    /Applications/calibre.app/Contents/MacOS/ebook-convert "$@"
  else
    return 127
  fi
}

embed_pdf_fonts() {
  local pdf="$1"
  if command -v gs >/dev/null 2>&1; then
    local embedded="$tmpdir/$(basename "$pdf" .pdf)-embedded.pdf"
    if gs -q -dBATCH -dNOPAUSE -sDEVICE=pdfwrite \
      -dEmbedAllFonts=true -dSubsetFonts=true \
      -o "$embedded" -c '<</NeverEmbed []>> setdistillerparams' -f "$pdf"; then
      mv "$embedded" "$pdf"
    fi
  fi
}

if [[ ! -f "$manuscript" ]]; then
  echo "missing manuscript: $manuscript" >&2
  exit 2
fi
if [[ ! -f "$metadata" ]]; then
  echo "missing metadata: $metadata" >&2
  exit 2
fi
if [[ ! -f "$cover" ]]; then
  echo "missing cover: $cover" >&2
  exit 2
fi

version="$(detect_version)"
title_stem="${BOOK_STEM:-$(read_yaml_value title_stem "$metadata")}"
visible_title="${BOOK_VISIBLE_TITLE:-$(read_yaml_value title "$metadata")}"
if [[ -z "$version" || -z "$title_stem" || -z "$visible_title" ]]; then
  echo "could not read version, title_stem, or title" >&2
  exit 1
fi

githash="$(git -C "$repo_root" rev-parse --short=6 HEAD 2>/dev/null || echo nogit)"
version_stamp="${BOOK_VERSION_STAMP:-$version-$githash}"
pubdate="$(date -u +%F)"

diagram_dir="${BOOK_DIAGRAM_DIR:-$book_dir/diagrams}"
rendered_manuscript="$build_dir/manuscript.rendered.md"
blog_diagram_dir="${BOOK_BLOG_DIAGRAM_DIR:-}"
render_args=("$manuscript" "$rendered_manuscript" "$diagram_dir")
if [[ -n "$blog_diagram_dir" ]]; then
  render_args+=(--blog-dir "$blog_diagram_dir")
fi
if [[ -x "$render_script" || -f "$render_script" ]]; then
  node "$render_script" "${render_args[@]}"
else
  cp "$manuscript" "$rendered_manuscript"
fi
cp -R "$diagram_dir" "$build_dir/diagrams"

write_version_marker() {
  {
    printf 'version_stamp: %s\n' "$version_stamp"
    printf 'built_at: %s\n' "$pubdate"
    IFS=',' read -ra format_list <<< "$formats"
    if [[ "${#format_list[@]}" -eq 1 && "${format_list[0]}" == "typst" ]]; then
      local kindle_name="$title_stem ($version_stamp)"
      printf 'kindle_name: %s\n' "$kindle_name"
      printf 'epub_file: %s.epub\n' "$title_stem"
      printf 'pdf_file: %s.pdf\n' "$title_stem"
      printf 'epub_link: %s.epub\n' "$kindle_name"
      printf 'pdf_link: %s.pdf\n' "$kindle_name"
    else
      for format in "${format_list[@]}"; do
        local stem="$title_stem-$format"
        local kindle_name="$stem ($version_stamp)"
        printf 'kindle_name_%s: %s\n' "$format" "$kindle_name"
        printf 'epub_file_%s: %s.epub\n' "$format" "$stem"
        printf 'pdf_file_%s: %s.pdf\n' "$format" "$stem"
        printf 'epub_link_%s: %s.epub\n' "$format" "$kindle_name"
        printf 'pdf_link_%s: %s.pdf\n' "$format" "$kindle_name"
      done
    fi
  } > "$dist_dir/VERSION.md"
}

render_cover() {
  local kindle_name="$1"
  local output="$2"
  sed "s/{{KINDLE_NAME}}/$kindle_name/g" "$cover" > "$output"
}

build_typst_pdf() {
  local stem="$1"
  local kindle_name="$2"
  local cover_md="$tmpdir/$stem.cover.md"
  local cover_pdf="$tmpdir/$stem.cover.pdf"
  local body_pdf="$tmpdir/$stem.body.pdf"
  render_cover "$kindle_name" "$cover_md"
  run_pandoc "$cover_md" -o "$cover_pdf" --pdf-engine=typst
  run_pandoc "$rendered_manuscript" -o "$body_pdf" \
    --pdf-engine=typst \
    --resource-path "$build_dir" \
    --toc \
    --number-sections
  pdfunite "$cover_pdf" "$body_pdf" "$dist_dir/$stem.pdf"
}

build_troff_pdf() {
  local stem="$1"
  local kindle_name="$2"
  local cover_md="$tmpdir/$stem.cover.md"
  local cover_ms="$tmpdir/$stem.cover.ms"
  local cover_pdf="$tmpdir/$stem.cover.pdf"
  local body_ms="$tmpdir/$stem.body.ms"
  local body_pdf="$tmpdir/$stem.body.pdf"
  render_cover "$kindle_name" "$cover_md"
  extract_raw_block ms "$cover_md" "$cover_ms"
  groff -Tpdf -P-e -t -ms "$cover_ms" > "$cover_pdf"
  run_pandoc "$rendered_manuscript" -o "$body_ms" -t ms -s --toc --number-sections
  groff -Tpdf -P-e -t -ms "$body_ms" > "$body_pdf"
  pdfunite "$cover_pdf" "$body_pdf" "$dist_dir/$stem.pdf"
  embed_pdf_fonts "$dist_dir/$stem.pdf"
}

build_epub() {
  local stem="$1"
  local kindle_name="$2"
  local cover_md="$tmpdir/$stem.cover.md"
  local epub="$dist_dir/$stem.epub"
  render_cover "$kindle_name" "$cover_md"
  run_pandoc "$cover_md" "$rendered_manuscript" \
    -o "$epub" \
    --toc \
    --number-sections \
    --metadata-file "$metadata" \
    --metadata date="$pubdate" \
    --css "$book_dir/epub.css" \
    --resource-path "$build_dir" \
    --epub-title-page=false
  if [[ -x "$book_dir/fix_epub_layout.sh" ]]; then
    "$book_dir/fix_epub_layout.sh" "$epub" "$kindle_name" "$visible_title"
  fi
}

write_version_marker
find "$dist_dir" -maxdepth 1 -name "$title_stem (*).epub" -o -name "$title_stem (*).pdf" | xargs rm -f 2>/dev/null || true
IFS=',' read -ra format_list <<< "$formats"
for format in "${format_list[@]}"; do
  if [[ "${#format_list[@]}" -eq 1 && "$format" == "typst" ]]; then
    stem="$title_stem"
  else
    stem="$title_stem-$format"
  fi
  kindle_name="$stem ($version_stamp)"
  case "$format" in
    typst) build_typst_pdf "$stem" "$kindle_name" ;;
    troff) build_troff_pdf "$stem" "$kindle_name" ;;
    *) echo "unknown BOOK_FORMATS entry: $format" >&2; exit 2 ;;
  esac
  build_epub "$stem" "$kindle_name"
  rm -f "$dist_dir/$stem ("*").epub" "$dist_dir/$stem ("*").pdf"
  ln -s "$(basename "$dist_dir/$stem.epub")" "$dist_dir/$kindle_name.epub"
  ln -s "$(basename "$dist_dir/$stem.pdf")" "$dist_dir/$kindle_name.pdf"
  if [[ -x "$book_dir/check_epub_metadata.sh" ]]; then
    "$book_dir/check_epub_metadata.sh" "$dist_dir/$stem.epub" "$kindle_name" "$visible_title"
  fi
  if ebook_convert "$dist_dir/$stem.epub" "$dist_dir/$stem.mobi"; then
    :
  else
    echo "ebook-convert unavailable or failed; skipped $stem.mobi" >&2
  fi
done

if [[ -n "$publish_dir" ]]; then
  "$script_dir/publish-versioned-artifacts.sh" "$dist_dir" "$publish_dir"
fi

echo "Built artifacts in $dist_dir"
