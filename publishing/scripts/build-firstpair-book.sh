#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
book_root="${BOOK_ROOT:-proofs/kiffness-loop-lab}"
book_dir="$repo_root/$book_root"
build_dir="${BOOK_BUILD_DIR:-$book_dir/build}"
dist_dir="${BOOK_DIST_DIR:-$book_dir/dist}"
metadata="${BOOK_METADATA:-$book_dir/metadata.yaml}"
manuscript="${BOOK_MANUSCRIPT:-$book_dir/manuscript.md}"
cover="${BOOK_COVER:-$book_dir/cover.md}"
version_file="${BOOK_VERSION_FILE:-$book_dir/VERSION}"
epub_css="${BOOK_EPUB_CSS:-$book_dir/epub.css}"
utmac_dir="${UTMAC_DIR:-$repo_root/.tools/utmac}"
neatroff_root="${NEATROFF_ROOT:-$HOME/src/neatroff_make}"

mkdir -p "$build_dir" "$dist_dir"

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

metadata_value() {
  local key="$1"
  awk -F: -v key="$key" '
    $1 ~ "^[[:space:]]*" key "[[:space:]]*$" {
      value = $2
      sub(/^[[:space:]]*/, "", value)
      sub(/[[:space:]]*$/, "", value)
      gsub(/^["'\''"]|["'\''"]$/, "", value)
      print value
      exit
    }
  ' "$metadata"
}

neatroff_path() {
  printf '%s:%s:%s:%s:%s:%s:%s\n' \
    "$neatroff_root/neatroff" \
    "$neatroff_root/neatpost" \
    "$neatroff_root/neateqn" \
    "$neatroff_root/neatrefer" \
    "$neatroff_root/troff/pic" \
    "$neatroff_root/troff/tbl" \
    "$PATH"
}

has_neatroff() {
  [[ -x "$neatroff_root/neatroff/roff" && -x "$neatroff_root/neatpost/pdf" ]]
}

render_cover() {
  local kindle_name="$1"
  local output="$2"
  sed \
    -e "s/{{KINDLE_NAME}}/$kindle_name/g" \
    -e "s/{{TITLE}}/$book_title/g" \
    -e "s/{{SUBTITLE}}/$book_subtitle/g" \
    -e "s/{{AUTHOR}}/$book_author/g" \
    "$cover" > "$output"
}

build_typst() {
  local cover_md="$build_dir/cover.typst.md"
  local cover_pdf="$build_dir/cover.typst.pdf"
  local body_pdf="$build_dir/body.typst.pdf"

  render_cover "$kindle_name_typst" "$cover_md"
  pandoc "$cover_md" -o "$cover_pdf" --pdf-engine=typst
  pandoc "$manuscript" \
    -o "$body_pdf" \
    --pdf-engine=typst \
    --toc \
    --number-sections \
    --metadata-file "$metadata" \
    --metadata "date=$built_date"
  pdfunite "$cover_pdf" "$body_pdf" "$dist_dir/$typst_stem.pdf"

  pandoc "$cover_md" "$manuscript" \
    -o "$dist_dir/$typst_stem.epub" \
    --to=epub3 \
    --toc \
    --number-sections \
    --metadata-file "$metadata" \
    --metadata "date=$built_date" \
    --css "$epub_css" \
    --epub-title-page=false
}

write_ms_cover() {
  local output="$1"
  cat > "$output" <<EOF
.nr PO 0.9i
.nr LL 5.8i
.nr HM 0.9i
.nr FM 0.9i
.ds CH
.ds LH
.ds RH
.sp 2.6i
.TL
$book_title
.br
$book_subtitle
.AU
$book_author
.AI
First Pair Press
.bp
EOF
}

build_ms_sources() {
  local body_ms="$build_dir/body.ms"
  local body_stripped_ms="$build_dir/body.stripped.ms"
  local cover_ms="$build_dir/cover.ms"
  local full_ms="$build_dir/full.ms"

  pandoc "$manuscript" \
    --from=markdown+yaml_metadata_block+pipe_tables \
    --to=ms \
    --standalone \
    --toc \
    --number-sections \
    --metadata-file "$metadata" \
    -o "$body_ms"
  awk '
    $0 == ".TL" { skip = 1; next }
    skip && $0 ~ /^\.\\" 1 column/ { skip = 0; print; next }
    !skip { print }
  ' "$body_ms" > "$body_stripped_ms"
  write_ms_cover "$cover_ms"
  cat "$cover_ms" "$body_stripped_ms" > "$full_ms"
}

build_neatroff_ms() {
  local full_ms="$build_dir/full.ms"
  local log="$dist_dir/$neatroff_stem.log"
  if has_neatroff; then
    (
      export PATH
      PATH="$(neatroff_path)"
      roff -ms "$full_ms" | pdf > "$dist_dir/$neatroff_stem.pdf"
    ) 2>"$log"
  else
    printf 'Neatroff not found under %s\n' "$neatroff_root" > "$dist_dir/$neatroff_stem.skipped"
  fi
}

build_groff_ms() {
  groff -Tpdf -P-e -k -t -ms "$build_dir/full.ms" \
    > "$dist_dir/$groff_stem.pdf" \
    2>"$dist_dir/$groff_stem.log"
}

build_utmac() {
  local utmac_source="$build_dir/$base_stem.utmac.tr"
  local utmac_log="$dist_dir/$utmac_stem.log"
  "$repo_root/publishing/scripts/setup-utmac.sh" "$utmac_dir" >/dev/null
  "$repo_root/publishing/scripts/md-to-utmac.py" "$manuscript" "$utmac_source"
  cp "$utmac_source" "$dist_dir/$utmac_stem.tr"

  if has_neatroff; then
    if (
      export PATH
      PATH="$(neatroff_path)"
      roff -M"$utmac_dir" -mu-en -mus "$utmac_source" | pdf > "$dist_dir/$utmac_stem.pdf"
    ) 2>"$utmac_log"; then
      :
    else
      printf 'utmac/neatroff failed; see %s\n' "$utmac_log" >&2
      return 1
    fi
  else
    printf 'Neatroff not found under %s\n' "$neatroff_root" > "$utmac_log"
  fi
}

page_count() {
  local file="$1"
  if [[ -f "$file" ]] && command -v pdfinfo >/dev/null 2>&1; then
    pdfinfo "$file" 2>/dev/null | awk '/^Pages:/ { print $2; exit }'
  fi
}

make_versioned_links() {
  local stem
  for stem in "$typst_stem" "$neatroff_stem" "$groff_stem" "$utmac_stem"; do
    if [[ -f "$dist_dir/$stem.pdf" ]]; then
      rm -f "$dist_dir/$stem ($version_stamp).pdf"
      ln -s "$stem.pdf" "$dist_dir/$stem ($version_stamp).pdf"
    fi
  done
  if [[ -f "$dist_dir/$typst_stem.epub" ]]; then
    rm -f "$dist_dir/$typst_stem ($version_stamp).epub"
    ln -s "$typst_stem.epub" "$dist_dir/$typst_stem ($version_stamp).epub"
  fi
}

write_version_manifest() {
  local neatroff_status="missing"
  local utmac_status="missing"
  [[ -f "$dist_dir/$neatroff_stem.pdf" ]] && neatroff_status="built"
  [[ -f "$dist_dir/$utmac_stem.pdf" ]] && utmac_status="built"

  cat > "$dist_dir/VERSION.md" <<EOF
title: $book_title
subtitle: $book_subtitle
title_stem: $base_stem
version: $version
version_stamp: $version_stamp
source_commit: $source_hash
built_at: $built_at
toolchain: pandoc typst neatroff groff utmac
neatroff_root: $neatroff_root
utmac_dir: $utmac_dir
pdf_pages_typst: $(page_count "$dist_dir/$typst_stem.pdf")
pdf_pages_neatroff: $(page_count "$dist_dir/$neatroff_stem.pdf")
pdf_pages_groff: $(page_count "$dist_dir/$groff_stem.pdf")
pdf_pages_utmac: $(page_count "$dist_dir/$utmac_stem.pdf")
status_neatroff_ms: $neatroff_status
status_utmac_pdf: $utmac_status
kindle_name_typst: $typst_stem ($version_stamp)
epub_file_typst: $typst_stem.epub
pdf_file_typst: $typst_stem.pdf
epub_link_typst: $typst_stem ($version_stamp).epub
pdf_link_typst: $typst_stem ($version_stamp).pdf
pdf_file_neatroff: $neatroff_stem.pdf
pdf_link_neatroff: $neatroff_stem ($version_stamp).pdf
pdf_file_groff: $groff_stem.pdf
pdf_link_groff: $groff_stem ($version_stamp).pdf
pdf_file_utmac: $utmac_stem.pdf
pdf_link_utmac: $utmac_stem ($version_stamp).pdf
utmac_source: $utmac_stem.tr
utmac_log: $utmac_stem.log
EOF
}

for file in "$metadata" "$manuscript" "$cover" "$version_file" "$epub_css"; do
  if [[ ! -f "$file" ]]; then
    printf 'missing required book file: %s\n' "$file" >&2
    exit 2
  fi
done

require pandoc
require typst
require pdfunite
require groff
require python3
require git

book_title="$(metadata_value title)"
book_subtitle="$(metadata_value subtitle)"
book_author="$(metadata_value author)"
base_stem="${BOOK_STEM:-$(metadata_value title_stem)}"
version="$(tr -d '[:space:]' < "$version_file")"
source_hash="$(git -C "$repo_root" rev-parse --short=7 HEAD 2>/dev/null || printf 'draft')"
built_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
built_date="$(date -u '+%Y-%m-%d')"
version_stamp="${BOOK_VERSION_STAMP:-$version-$source_hash}"

if [[ -z "$book_title" || -z "$book_author" || -z "$base_stem" || -z "$version" ]]; then
  printf 'metadata.yaml must define title, author, and title_stem; VERSION must not be empty\n' >&2
  exit 2
fi

typst_stem="$base_stem-typst"
neatroff_stem="$base_stem-neatroff"
groff_stem="$base_stem-groff"
utmac_stem="$base_stem-utmac"
kindle_name_typst="$typst_stem ($version_stamp)"

build_typst
build_ms_sources
build_neatroff_ms
build_groff_ms
build_utmac
make_versioned_links
write_version_manifest

printf 'Built First Pair proof artifacts in %s\n' "$dist_dir"
