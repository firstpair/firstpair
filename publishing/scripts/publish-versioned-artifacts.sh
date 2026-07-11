#!/usr/bin/env bash
set -euo pipefail

dist_dir="${1:-docs/book/dist}"
publish_dir="${2:-$HOME/icloud/books}"
version_file="$dist_dir/VERSION.md"

if [[ ! -f "$version_file" ]]; then
  echo "missing VERSION.md: $version_file" >&2
  exit 1
fi
if [[ ! -d "$publish_dir" ]]; then
  echo "publish destination does not exist: $publish_dir" >&2
  exit 1
fi

value_for() {
  local key="$1"
  awk -F': ' -v key="$key" '$1 == key { print $2; exit }' "$version_file"
}

first_value_for() {
  local key
  local value
  for key in "$@"; do
    value="$(value_for "$key")"
    if [[ -n "$value" ]]; then
      printf '%s\n' "$value"
      return
    fi
  done
}

suffixes_for() {
  local kind="$1"
  awk -F': ' -v prefix="${kind}_file_" '
    index($1, prefix) == 1 {
      print substr($1, length(prefix) + 1)
    }
  ' "$version_file"
}

publish_pair() {
  local file_key="$1"
  local link_key="$2"
  local legacy_link_key="${3:-}"
  local stable
  local link
  stable="$(value_for "$file_key")"
  if [[ -n "$legacy_link_key" ]]; then
    link="$(first_value_for "$link_key" "$legacy_link_key")"
  else
    link="$(value_for "$link_key")"
  fi
  if [[ -z "$stable" && -z "$link" ]]; then
    return
  fi
  if [[ -z "$stable" || -z "$link" ]]; then
    echo "incomplete VERSION.md pair: $file_key / $link_key" >&2
    exit 1
  fi
  if [[ ! -f "$dist_dir/$stable" ]]; then
    echo "missing stable artifact: $dist_dir/$stable" >&2
    exit 1
  fi
  cp -L "$dist_dir/$stable" "$publish_dir/$link"
  if ! cmp -s "$dist_dir/$stable" "$publish_dir/$link"; then
    echo "published artifact does not match source: $publish_dir/$link" >&2
    exit 1
  fi
  echo "published: $publish_dir/$link"
}

publish_pair epub_file epub_link kindle_link
publish_pair pdf_file pdf_link

while IFS= read -r suffix; do
  [[ -n "$suffix" ]] || continue
  publish_pair "epub_file_$suffix" "epub_link_$suffix"
done < <(suffixes_for epub)

while IFS= read -r suffix; do
  [[ -n "$suffix" ]] || continue
  publish_pair "pdf_file_$suffix" "pdf_link_$suffix"
done < <(suffixes_for pdf)
