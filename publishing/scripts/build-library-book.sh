#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if command -v brew >/dev/null 2>&1; then
  toolchain_path=""
  for formula in ghostscript groff node pandoc poppler typst uv; do
    formula_bin="$(brew --prefix "$formula")/bin"
    toolchain_path="${toolchain_path:+$toolchain_path:}$formula_bin"
  done
  export PATH="$toolchain_path:$PATH"
fi

exec node "$script_dir/build-library-book.mjs" "$@"
