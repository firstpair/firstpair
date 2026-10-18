#!/usr/bin/env bash
set -euo pipefail

firstpair_root="$(cd "$(dirname "$0")/../.." && pwd)"
neatroff_root="${NEATROFF_ROOT:-$HOME/src/neatroff_make}"
toolchain_lock="$firstpair_root/publishing/toolchain.lock.json"
neatroff_repo="${NEATROFF_MAKE_REPO:-$(node -e 'const l=require(process.argv[1]); process.stdout.write(l.neatroff.root.repository)' "$toolchain_lock")}"
neatroff_commit="${NEATROFF_MAKE_COMMIT:-$(node -e 'const l=require(process.argv[1]); process.stdout.write(l.neatroff.root.commit)' "$toolchain_lock")}"
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

locked_component_commit() {
  node -e '
    const lock = require(process.argv[1])
    const value = lock.neatroff.components[process.argv[2]]
    if (!value) process.exit(2)
    process.stdout.write(value)
  ' "$toolchain_lock" "$1"
}

# FIRSTPAIR_TOOLCHAIN_LATEST=1 (set by install-toolchain.sh) follows each
# upstream's default branch instead of the recorded commit; the installer then
# records the result in toolchain.lock.json.
upstream_head() {
  git -C "$1" ls-remote origin HEAD | cut -f1
}

checkout_locked_commit() {
  local repo_dir="$1"
  local commit="$2"
  local label="$3"
  local current
  if [[ "${FIRSTPAIR_TOOLCHAIN_LATEST:-}" == 1 ]]; then
    commit="$(upstream_head "$repo_dir")"
  fi

  current="$(git -C "$repo_dir" rev-parse HEAD 2>/dev/null || true)"
  if [[ "$current" == "$commit" ]]; then
    return
  fi

  if [[ -n "$(git -C "$repo_dir" status --porcelain)" ]]; then
    printf '%s is dirty and cannot be moved from %s to commit %s\n' \
      "$label" "${current:-unknown}" "$commit" >&2
    exit 1
  fi

  git -C "$repo_dir" fetch origin "$commit"
  git -C "$repo_dir" checkout --detach "$commit"
}

need git
need make
need cc

mkdir -p "$(dirname "$neatroff_root")" "$local_bin" "$local_share"

if [[ ! -d "$neatroff_root/.git" ]]; then
  if [[ -e "$neatroff_root" && -n "$(find "$neatroff_root" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    printf 'refusing to replace non-Git Neatroff directory: %s\n' "$neatroff_root" >&2
    exit 1
  fi
  rm -rf "$neatroff_root"
  git clone "$neatroff_repo" "$neatroff_root"
fi

checkout_locked_commit "$neatroff_root" "$neatroff_commit" "neatroff_make"

if [[ ! -d "$neatroff_root/neatroff" ]]; then
  make -C "$neatroff_root" init
fi

# `make init` downloads fonts after cloning; an interrupted init (for example
# without wget) leaves the clones but no fonts, so fetch them separately.
if ! compgen -G "$neatroff_root/fonts/*.afm" >/dev/null; then
  (cd "$neatroff_root/fonts" && sh ./fonts.sh)
fi

for component in neatroff neatpost neatmkfn neateqn neatrefer troff; do
  component_dir="$neatroff_root/$component"
  if [[ ! -d "$component_dir/.git" ]]; then
    printf 'missing Neatroff component checkout: %s\n' "$component_dir" >&2
    exit 1
  fi
  checkout_locked_commit \
    "$component_dir" \
    "$(locked_component_commit "$component")" \
    "neatroff/$component"
done

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
