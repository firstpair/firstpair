#!/usr/bin/env bash
set -euo pipefail

dist_dir="${1:-docs/book/dist}"
version_file="$dist_dir/VERSION.md"

if [[ ! -f "$version_file" ]]; then
  echo "missing VERSION.md: $version_file" >&2
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

check_pair() {
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
  if [[ ! -e "$dist_dir/$link" ]]; then
    echo "missing versioned artifact: $dist_dir/$link" >&2
    exit 1
  fi
  if [[ -L "$dist_dir/$link" ]]; then
    local target
    target="$(readlink "$dist_dir/$link")"
    if [[ "$target" != "$stable" ]]; then
      echo "bad symlink target for $link: $target, expected $stable" >&2
      exit 1
    fi
  elif ! cmp -s "$dist_dir/$stable" "$dist_dir/$link"; then
    echo "versioned artifact differs from stable artifact: $link" >&2
    exit 1
  fi
}

check_pair epub_file epub_link kindle_link
check_pair pdf_file pdf_link

while IFS= read -r suffix; do
  [[ -n "$suffix" ]] || continue
  check_pair "epub_file_$suffix" "epub_link_$suffix"
done < <(suffixes_for epub)

while IFS= read -r suffix; do
  [[ -n "$suffix" ]] || continue
  check_pair "pdf_file_$suffix" "pdf_link_$suffix"
done < <(suffixes_for pdf)

echo "VERSION.md artifact contract passed: $version_file"
