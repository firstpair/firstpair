#!/usr/bin/env bash
set -euo pipefail

firstpair_root="$(cd "$(dirname "$0")/../.." && pwd)"
neatroff_root="${NEATROFF_ROOT:-$HOME/src/neatroff_make}"
neatroff_repo="${NEATROFF_MAKE_REPO:-https://github.com/aligrudi/neatroff_make.git}"
local_bin="${LOCAL_BIN:-$HOME/.local/bin}"
local_share="${LOCAL_SHARE:-$HOME/.local/share/firstpair}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '%s is required to build Neatroff.\n' "$1" >&2
    exit 1
  fi
}

link_cmd() {
  local name="$1"
  local target="$2"
  if [[ ! -x "$target" ]]; then
    printf 'expected executable is missing: %s\n' "$target" >&2
    exit 1
  fi
  ln -sfn "$target" "$local_bin/$name"
}

need git
need make
need cc

mkdir -p "$(dirname "$neatroff_root")" "$local_bin" "$local_share"

if [[ ! -d "$neatroff_root/.git" ]]; then
  rm -rf "$neatroff_root"
  git clone "$neatroff_repo" "$neatroff_root"
fi

if [[ ! -d "$neatroff_root/neatroff" ]]; then
  make -C "$neatroff_root" init
fi
make -C "$neatroff_root" neat

for exe in \
  "$neatroff_root/neatroff/roff" \
  "$neatroff_root/neatpost/pdf" \
  "$neatroff_root/neatpost/post" \
  "$neatroff_root/neateqn/eqn" \
  "$neatroff_root/neatrefer/refer" \
  "$neatroff_root/troff/pic/pic" \
  "$neatroff_root/troff/tbl/tbl" \
  "$neatroff_root/soin/soin"; do
  if [[ ! -x "$exe" ]]; then
    printf 'expected Neatroff executable is missing: %s\n' "$exe" >&2
    exit 1
  fi
done

link_cmd neatroff "$neatroff_root/neatroff/roff"
link_cmd neatpdf "$neatroff_root/neatpost/pdf"
link_cmd neatpost "$neatroff_root/neatpost/post"
link_cmd neateqn "$neatroff_root/neateqn/eqn"
link_cmd neatrefer "$neatroff_root/neatrefer/refer"
link_cmd neatpic "$neatroff_root/troff/pic/pic"
link_cmd neattbl "$neatroff_root/troff/tbl/tbl"
link_cmd neatsoin "$neatroff_root/soin/soin"

cat > "$local_share/neatroff.env" <<EOF
FIRSTPAIR_ROOT=$firstpair_root
NEATROFF_ROOT=$neatroff_root
PATH=$neatroff_root/neatroff:$neatroff_root/neatpost:$neatroff_root/neateqn:$neatroff_root/neatrefer:$neatroff_root/troff/pic:$neatroff_root/troff/tbl:$neatroff_root/soin:\$PATH
EOF

printf 'Neatroff root: %s\n' "$neatroff_root"
printf 'Neatroff wrappers: %s\n' "$local_bin"
printf 'Neatroff env: %s\n' "$local_share/neatroff.env"
