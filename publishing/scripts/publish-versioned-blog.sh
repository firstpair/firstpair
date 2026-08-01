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

python3 "$script_dir/git_publish_preflight.py" "$repo_root"

dist_dir="$post_dir/dist"
stable="$dist_dir/$name.textpack"
marker="$dist_dir/VERSION.md"
if [[ ! -f "$stable" || ! -f "$marker" ]]; then
  echo "stamped textpack handoff is incomplete; run stamp-versioned-blog.sh, commit, and push first" >&2
  exit 1
fi

marker_value() {
  awk -F ': ' -v key="$1" '$1 == key { sub(/^[^:]*:[[:space:]]*/, ""); print; exit }' "$marker"
}

textpack_file="$(marker_value textpack_file)"
textpack_link="$(marker_value textpack_link)"
version_stamp="$(marker_value version_stamp)"
if [[ "$textpack_file" != "$name.textpack" ]]; then
  echo "VERSION.md textpack_file does not name the stable pack: $textpack_file" >&2
  exit 1
fi
if [[ -z "$version_stamp" || "$textpack_link" != "$name ($version_stamp).textpack" ]]; then
  echo "VERSION.md has an invalid versioned textpack link" >&2
  exit 1
fi
versioned="$dist_dir/$textpack_link"
if [[ ! -L "$versioned" || "$(readlink "$versioned")" != "$(basename "$stable")" ]]; then
  echo "versioned textpack link is missing or does not target $(basename "$stable")" >&2
  exit 1
fi

for artifact in "$stable" "$marker" "$versioned"; do
  relative="${artifact#"$repo_root"/}"
  if [[ "$relative" == "$artifact" ]] || ! git -C "$repo_root" ls-files --error-unmatch -- "$relative" >/dev/null 2>&1; then
    echo "stamped handoff is not committed at HEAD: $artifact" >&2
    exit 1
  fi
done

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
if ! git -C "$repo_root" merge-base --is-ancestor "$source_commit" HEAD; then
  echo "embedded source commit is not in the pushed handoff history: $source_commit" >&2
  exit 1
fi
if [[ "$version_stamp" != *-"${source_commit:0:6}" ]]; then
  echo "VERSION.md version stamp does not end in the embedded source hash" >&2
  exit 1
fi

unzip -t "$stable" >/dev/null
destination="$publish_dir/$textpack_link"
cp -L "$stable" "$destination"
cmp -s "$stable" "$destination"
echo "published: $destination"
