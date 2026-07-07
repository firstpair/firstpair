#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
source_file="${FP_SOURCE:-$repo_root/fp.tr}"
dist_dir="${FP_DIST_DIR:-$repo_root/dist}"
utmac_dir="${UTMAC_DIR:-$repo_root/.tools/utmac}"
neatroff_root="${NEATROFF_ROOT:-$HOME/src/neatroff_make}"
setup_neatroff="$repo_root/publishing/scripts/setup-neatroff.sh"
stem="${FP_STEM:-fp}"
version="${FP_VERSION:-0.1.0}"

mkdir -p "$dist_dir"

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

ensure_neatroff_font_aliases() {
  local devutf="$neatroff_root/devutf"
  [[ -d "$devutf" ]] || return 0

  local pair src dst
  for pair in \
    "LibertinusSerif-Regular:NimbusRoman-Regular" \
    "LibertinusSerif-Italic:NimbusRoman-Italic" \
    "LibertinusSerif-Semibold:NimbusRoman-Bold" \
    "LibertinusSerif-SemiboldItalic:NimbusRoman-BoldItalic" \
    "LibertinusMono-Regular:NimbusMonoPS-Regular"; do
    dst="${pair%%:*}"
    src="${pair##*:}"
    if [[ ! -e "$devutf/$dst" && -e "$devutf/$src" ]]; then
      ln -s "$src" "$devutf/$dst"
    fi
  done
}

page_count() {
  local file="$1"
  if [[ -f "$file" ]] && command -v pdfinfo >/dev/null 2>&1; then
    pdfinfo "$file" 2>/dev/null | awk '/^Pages:/ { print $2; exit }'
  fi
}

if [[ ! -f "$source_file" ]]; then
  printf 'missing First Pair source: %s\n' "$source_file" >&2
  exit 2
fi

"$repo_root/publishing/scripts/setup-utmac.sh" "$utmac_dir" >/dev/null
if ! has_neatroff && [[ -x "$setup_neatroff" ]]; then
  NEATROFF_ROOT="$neatroff_root" "$setup_neatroff" >/dev/null
fi
if ! has_neatroff; then
  printf 'Neatroff not found under %s\n' "$neatroff_root" >&2
  exit 1
fi

source_hash="$(git -C "$repo_root" rev-parse --short=7 HEAD 2>/dev/null || printf 'draft')"
version_stamp="${FP_VERSION_STAMP:-$version-$source_hash}"
built_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
source_base="$(basename "$source_file")"
source_dir="$(cd "$(dirname "$source_file")" && pwd)"
output_pdf="$dist_dir/$stem.pdf"
output_log="$dist_dir/$stem.log"

ensure_neatroff_font_aliases
cp "$source_file" "$dist_dir/$stem.tr"
(
  export PATH
  PATH="$(neatroff_path)"
  cd "$source_dir"
  roff -M"$utmac_dir" -mu-en -mus -m"$repo_root/publishing/tmac/fp.tmac" "$source_base" |
    pdf > "$output_pdf"
) 2>"$output_log"

find "$dist_dir" -maxdepth 1 -type l -name "$stem (*).pdf" -delete
ln -s "$stem.pdf" "$dist_dir/$stem ($version_stamp).pdf"

cat > "$dist_dir/VERSION.md" <<EOF
title: First Pair Press Founding Documents
subtitle: The manifesto and the Bell Labs publishing workflow
title_stem: $stem
version: $version
version_stamp: $version_stamp
source_commit: $source_hash
built_at: $built_at
toolchain: firstpair-troff neatroff utmac
neatroff_root: $neatroff_root
utmac_dir: $utmac_dir
pdf_pages: $(page_count "$output_pdf")
status_firstpair_troff: built
pdf_file: $stem.pdf
pdf_link: $stem ($version_stamp).pdf
source_file: $stem.tr
log_file: $stem.log
EOF

printf 'Built founding documents in %s\n' "$dist_dir"
