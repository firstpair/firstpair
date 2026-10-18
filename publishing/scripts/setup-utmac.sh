#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
utmac_dir="${1:-${UTMAC_DIR:-$repo_root/.tools/utmac}}"
toolchain_lock="$repo_root/publishing/toolchain.lock.json"
utmac_url="${UTMAC_URL:-$(node -e 'const l=require(process.argv[1]); process.stdout.write(l.utmac.repository)' "$toolchain_lock")}"
utmac_commit="${UTMAC_COMMIT:-$(node -e 'const l=require(process.argv[1]); process.stdout.write(l.utmac.commit)' "$toolchain_lock")}"
neatroff_root="${NEATROFF_ROOT:-$HOME/src/neatroff_make}"
neatrefer_dir="${NEATREFER_DIR:-$neatroff_root/neatrefer}"

mkdir -p "$(dirname "$utmac_dir")"

if [[ ! -d "$utmac_dir/.git" ]]; then
  git clone "$utmac_url" "$utmac_dir"
fi

# FIRSTPAIR_TOOLCHAIN_LATEST=1 follows upstream's default branch; the
# installer records the commit in toolchain.lock.json.
if [[ "${FIRSTPAIR_TOOLCHAIN_LATEST:-}" == 1 ]]; then
  utmac_commit="$(git -C "$utmac_dir" ls-remote origin HEAD | cut -f1)"
fi

current="$(git -C "$utmac_dir" rev-parse HEAD 2>/dev/null || true)"
if [[ "$current" != "$utmac_commit" ]]; then
  if [[ -n "$(git -C "$utmac_dir" status --porcelain)" ]]; then
    printf 'utmac is dirty and cannot be moved from %s to pinned commit %s\n' \
      "${current:-unknown}" "$utmac_commit" >&2
    exit 1
  fi
  git -C "$utmac_dir" fetch origin "$utmac_commit"
  git -C "$utmac_dir" checkout --detach "$utmac_commit"
fi

if [[ -f "$utmac_dir/makefile" ]]; then
  make -C "$utmac_dir" BINDIR="$neatrefer_dir" >/dev/null
fi

# groff does not expand neatroff's \n(.D in the same way. The symlink keeps
# groff text QA usable without changing the upstream macro files.
ln -sfn . "$utmac_dir/0"

printf '%s\n' "$utmac_dir"
