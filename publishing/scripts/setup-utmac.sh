#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
utmac_dir="${1:-${UTMAC_DIR:-$repo_root/.tools/utmac}}"
utmac_url="${UTMAC_URL:-https://codeberg.org/pjfichet/utmac.git}"
neatroff_root="${NEATROFF_ROOT:-$HOME/src/neatroff_make}"
neatrefer_dir="${NEATREFER_DIR:-$neatroff_root/neatrefer}"

mkdir -p "$(dirname "$utmac_dir")"

if [[ ! -d "$utmac_dir/.git" ]]; then
  git clone "$utmac_url" "$utmac_dir"
fi

if [[ -f "$utmac_dir/makefile" ]]; then
  make -C "$utmac_dir" BINDIR="$neatrefer_dir" >/dev/null
fi

# groff does not expand neatroff's \n(.D in the same way. The symlink keeps
# groff text QA usable without changing the upstream macro files.
ln -sfn . "$utmac_dir/0"

printf '%s\n' "$utmac_dir"
