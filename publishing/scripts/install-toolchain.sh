#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
publishing_dir="$(cd "$script_dir/.." && pwd)"
firstpair_root="$(cd "$publishing_dir/.." && pwd)"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required to install the publishing toolchain" >&2
  exit 1
fi

brew bundle --file "$publishing_dir/Brewfile"
npm ci --prefix "$firstpair_root"

for formula in asdf ghostscript groff node pandoc poppler typst uv; do
  brew pin "$formula" >/dev/null
done

"$script_dir/setup-neatroff.sh"
"$script_dir/setup-utmac.sh"
"$script_dir/verify-toolchain.mjs"

echo "Publishing toolchain installed and pinned"
