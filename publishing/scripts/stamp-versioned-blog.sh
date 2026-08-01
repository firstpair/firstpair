#!/usr/bin/env bash
set -euo pipefail

post="${1:-}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "$post" ]]; then
  echo "usage: $0 <docs/blog/name | post.md>" >&2
  exit 2
fi

repo_root="$(cd "${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}" && pwd)"
if [[ "$post" != /* ]]; then
  post="$repo_root/$post"
fi
if [[ -d "$post" ]]; then
  post_dir="${post%/}"
  post_file="$post_dir/post.md"
  name="$(basename "$post_dir")"
else
  post_file="$post"
  post_dir="$(dirname "$post_file")"
  stem="$(basename "$post_file" .md)"
  if [[ "$stem" == "post" ]]; then
    name="$(basename "$post_dir")"
  else
    name="$stem"
  fi
fi
if [[ ! -f "$post_file" ]]; then
  echo "post not found: $post_file" >&2
  exit 2
fi

version="${BLOG_VERSION:-}"
if [[ -z "$version" && -f "$repo_root/Cargo.toml" ]]; then
  version="$(
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
  )"
fi
if [[ -z "$version" && -f "$repo_root/package.json" ]]; then
  version="$(node -p "require('$repo_root/package.json').version")"
fi
if [[ -z "$version" ]]; then
  version="0.0.0"
fi

dist_dir="$post_dir/dist"
stable="$dist_dir/$name.textpack"
textpack_args=(
  "$script_dir/textpack.py"
  "$post_file"
  --name "$name"
  --blog "${BLOG_DOMAIN:-querygraph.ai}"
  --slug "${BLOG_SLUG:-$name}"
  --out "$stable"
)
if [[ -n "${BLOG_TAGS:-}" ]]; then
  textpack_args+=(--tags "$BLOG_TAGS")
fi
if [[ -n "${BLOG_EXCERPT:-}" ]]; then
  textpack_args+=(--excerpt "$BLOG_EXCERPT")
fi
if [[ -n "${BLOG_RENDER:-}" ]]; then
  textpack_args+=(--render)
fi
python3 "${textpack_args[@]}"

source_commit="$(
  python3 - "$stable" <<'PY'
import json
import re
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1]) as archive:
    info_names = [name for name in archive.namelist() if name.endswith(".textbundle/info.json")]
    if len(info_names) != 1:
        raise SystemExit("textpack must contain exactly one info.json")
    info = json.loads(archive.read(info_names[0]))
commit = info.get("omnighost", {}).get("provenance", {}).get("gitCommit", "")
if not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", commit):
    raise SystemExit("textpack provenance has no valid full gitCommit")
print(commit)
PY
)"
githash="${source_commit:0:6}"
version_stamp="${BLOG_VERSION_STAMP:-$version-$githash}"
if [[ "$version_stamp" != *-"$githash" ]]; then
  echo "BLOG_VERSION_STAMP must end in the embedded source hash: $githash" >&2
  exit 1
fi
versioned="$dist_dir/$name ($version_stamp).textpack"
marker="$dist_dir/VERSION.md"

rm -f "$post_dir/dist/$name ("*").textpack"
ln -s "$(basename "$stable")" "$versioned"

{
  printf 'blog_name: %s\n' "$name"
  printf 'blog_domain: %s\n' "${BLOG_DOMAIN:-querygraph.ai}"
  printf 'slug: %s\n' "${BLOG_SLUG:-$name}"
  printf 'version_stamp: %s\n' "$version_stamp"
  printf 'built_at: %s\n' "$(date -u +%F)"
  printf 'textpack_file: %s.textpack\n' "$name"
  printf 'textpack_link: %s (%s).textpack\n' "$name" "$version_stamp"
} > "$marker"

echo "stamped: $stable"
echo "handoff: commit and push $stable, $marker, and $versioned before delivery"
