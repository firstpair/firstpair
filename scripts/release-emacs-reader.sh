#!/bin/sh
# Rebuild the stable public Reader tar and its versioned SHA-256 sidecar.
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
temporary=$(mktemp -d "${TMPDIR:-/tmp}/firstpair-reader-release.XXXXXX")
cleanup() {
  rm -rf -- "$temporary"
}
trap cleanup 0 1 2 15

"$root/publishing/scripts/firstpair-emacs" package --output "$temporary" >/dev/null
set -- "$temporary"/firstpair-reader-*.tar
[ "$#" -eq 1 ] && [ -f "$1" ] || {
  echo "release-emacs-reader.sh: package build did not produce exactly one Reader tar" >&2
  exit 1
}

archive=$1
filename=${archive##*/}
version=${filename#firstpair-reader-}
version=${version%.tar}
destination=$root/public/emacs/firstpair-reader.tar
sidecar=$destination.sha256

cp -- "$archive" "$destination"
if command -v sha256sum >/dev/null 2>&1; then
  digest=$(sha256sum "$destination" | awk '{ print $1 }')
elif command -v shasum >/dev/null 2>&1; then
  digest=$(shasum -a 256 "$destination" | awk '{ print $1 }')
else
  echo "release-emacs-reader.sh: sha256sum or shasum is required" >&2
  exit 1
fi
printf '# version %s\n%s  firstpair-reader.tar\n' "$version" "$digest" > "$sidecar"

printf 'FirstPair Reader %s\nSHA-256 %s\n%s\n' "$version" "$digest" "$destination"
