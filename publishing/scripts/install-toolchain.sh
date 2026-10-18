#!/usr/bin/env bash
# Install or update the publishing toolchain to the latest releases, then
# record what is installed in toolchain.lock.json. Policy: always build with
# the latest version of every tool; the lock is the record of the versions a
# build used, refreshed by this script, not a pin that holds tools back.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
publishing_dir="$(cd "$script_dir/.." && pwd)"
firstpair_root="$(cd "$publishing_dir/.." && pwd)"
formulae=(ghostscript groff node pandoc poppler typst uv)

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required to install the publishing toolchain" >&2
  exit 1
fi

# Earlier installs pinned these formulae; latest-version policy unpins them.
for formula in "${formulae[@]}"; do
  brew unpin "$formula" >/dev/null 2>&1 || true
done

brew update
# --no-upgrade: bundle only installs what is missing. Formulae are upgraded
# explicitly below; calibre is a large DMG cask that is installed once and
# upgraded only by a person, so scripts never upgrade it.
brew bundle --no-upgrade --file "$publishing_dir/Brewfile"
brew upgrade "${formulae[@]}" || true

npm install --prefix "$firstpair_root" --save-dev --save-exact @mermaid-js/mermaid-cli@latest
npm ci --prefix "$firstpair_root"

# Python is managed by uv alone (no asdf): keep the newest stable CPython.
uv python install --upgrade "$(uv python list --only-downloads --output-format json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s).filter(p=>p.implementation==="cpython"&&p.variant==="default"&&!p.version_parts.pre&&/^\d+\.\d+\.\d+$/.test(p.version)).map(p=>p.version).sort((a,b)=>{const x=a.split(".").map(Number),y=b.split(".").map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return y[i]-x[i];return 0});process.stdout.write(v[0].split(".").slice(0,2).join("."))})')"

FIRSTPAIR_TOOLCHAIN_LATEST=1 "$script_dir/setup-neatroff.sh"
FIRSTPAIR_TOOLCHAIN_LATEST=1 "$script_dir/setup-utmac.sh"
"$script_dir/update-toolchain-lock.mjs"
"$script_dir/verify-toolchain.mjs"

echo "Publishing toolchain updated to the latest releases and recorded in toolchain.lock.json"
