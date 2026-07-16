#!/usr/bin/env bash
set -euo pipefail

post="${1:-}"
publish_dir="${2:-$HOME/icloud/blogs}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "$post" ]]; then
  echo "usage: $0 <docs/blog/name | post.md> [publish-dir]" >&2
  exit 2
fi
if [[ ! -d "$publish_dir" ]]; then
  echo "publish destination does not exist: $publish_dir" >&2
  exit 1
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

# textpack.py may have just committed the post and its referenced assets. Derive
# the delivery filename only afterward so it carries the same repository state.
githash="$(git -C "$repo_root" rev-parse --short=6 HEAD 2>/dev/null || echo nogit)"
version_stamp="${BLOG_VERSION_STAMP:-$version-$githash}"
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

cp -L "$stable" "$publish_dir/$name ($version_stamp).textpack"
cmp -s "$stable" "$publish_dir/$name ($version_stamp).textpack"
echo "published: $publish_dir/$name ($version_stamp).textpack"
