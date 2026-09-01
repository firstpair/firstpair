#!/bin/sh
# Keep the FirstPair Reader current, then open this launcher’s book bundle.
set -eu

program=${0##*/}
reader_url=${FIRSTPAIR_READER_URL:-https://firstpair.org/emacs/firstpair-reader.tar}
release_url=${FIRSTPAIR_READER_RELEASE_URL:-${reader_url}.sha256}
emacs_command=${FIRSTPAIR_EMACS:-emacs}
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)

fail() {
  echo "$program: $*" >&2
  exit 1
}

for command in curl "$emacs_command" mktemp awk; do
  command -v "$command" >/dev/null 2>&1 || fail "required command not found: $command"
done

if [ "$#" -gt 1 ]; then
  fail "usage: $program [BOOK-BUNDLE]"
fi

if [ -n "${FIRSTPAIR_BUNDLE:-}" ]; then
  bundle=$FIRSTPAIR_BUNDLE
elif [ "$#" -eq 1 ]; then
  bundle=$1
elif [ -f "$here/data/bundle.json" ]; then
  bundle=$here
elif [ -f "$here/Dante-Emacs/data/bundle.json" ]; then
  bundle=$here/Dante-Emacs
else
  bundle=
  bundle_count=0
  for index in "$here"/*/data/bundle.json; do
    [ -f "$index" ] || continue
    bundle=${index%/data/bundle.json}
    bundle_count=$((bundle_count + 1))
  done
  if [ "$bundle_count" -ne 1 ]; then
    fail "cannot find one FirstPair Emacs bundle beside $program; pass its directory explicitly"
  fi
fi

bundle=$(CDPATH='' cd -- "$bundle" 2>/dev/null && pwd) || fail "bundle directory not found: $bundle"
[ -f "$bundle/data/bundle.json" ] || fail "not a FirstPair Emacs bundle: $bundle"

# Never replace package files underneath a live Emacs. Unsaved buffers belong
# to the reader, not to this launcher.
if command -v pgrep >/dev/null 2>&1 &&
   { pgrep -x emacs >/dev/null 2>&1 || pgrep -x Emacs >/dev/null 2>&1; }; then
  fail "quit the existing Emacs completely, then run this again"
fi

temporary=$(mktemp -d "${TMPDIR:-/tmp}/firstpair-reader.XXXXXX")
cleanup() {
  if [ -n "${temporary:-}" ] && [ -d "$temporary" ]; then
    rm -rf -- "$temporary"
  fi
}
trap cleanup 0 1 2 15

installed_version=$("$emacs_command" --batch -Q --eval '
(progn
  (require (quote cl-lib))
  (require (quote package))
  (package-initialize)
  (let ((descriptors (cdr (assq (quote firstpair-reader) package-alist))))
    (when descriptors
      (let ((current
             (car (sort (copy-sequence descriptors)
                        (lambda (left right)
                          (version-list-< (package-desc-version right)
                                          (package-desc-version left)))))))
        (princ (package-version-join (package-desc-version current)))))))
')

launch() {
  cleanup
  trap - 0 1 2 15
  if [ "${FIRSTPAIR_READER_NO_RESTART:-0}" = 1 ]; then
    exit 0
  fi
  echo "Opening the FirstPair book in a fresh terminal Emacs..."
  FIRSTPAIR_BUNDLE=$bundle FIRSTPAIR_BUNDLE_INIT=$bundle/init.el \
    exec "$emacs_command" -nw --eval '
(progn
  (load (expand-file-name (getenv "FIRSTPAIR_BUNDLE_INIT")) nil nil)
  (firstpair-read (file-name-as-directory
                   (expand-file-name (getenv "FIRSTPAIR_BUNDLE")))))
'
}

release=$temporary/firstpair-reader.tar.sha256
echo "Checking the current FirstPair Reader release..."
if ! curl -fL --retry 3 --retry-delay 2 -o "$release" "$release_url"; then
  echo "Reader update check is unavailable; opening the local book." >&2
  launch
fi

remote_version=$(awk '$1 == "#" && $2 == "version" { print $3; exit }' "$release")
remote_sha256=$(awk '$1 !~ /^#/ && NF >= 2 { print $1; exit }' "$release")
case "$remote_version" in
  ''|*[!0-9A-Za-z.+-]*) fail "invalid Reader version in $release_url" ;;
esac
case "$remote_sha256" in
  *[!0-9a-fA-F]*|'') fail "invalid SHA-256 in $release_url" ;;
esac
[ "${#remote_sha256}" -eq 64 ] || fail "invalid SHA-256 length in $release_url"

if [ "$installed_version" = "$remote_version" ]; then
  echo "FirstPair Reader $remote_version is already installed; skipping the package download."
  launch
fi

archive=$temporary/firstpair-reader.tar
echo "Downloading FirstPair Reader $remote_version..."
if ! curl -fL --retry 3 --retry-delay 2 -o "$archive" "$reader_url"; then
  echo "Reader download is unavailable; opening the local book." >&2
  launch
fi

if command -v sha256sum >/dev/null 2>&1; then
  actual_sha256=$(sha256sum "$archive" | awk '{ print $1 }')
elif command -v shasum >/dev/null 2>&1; then
  actual_sha256=$(shasum -a 256 "$archive" | awk '{ print $1 }')
else
  fail "sha256sum or shasum is required to verify the Reader package"
fi
[ "$actual_sha256" = "$remote_sha256" ] || fail "Reader package SHA-256 does not match $release_url"

echo "Installing Reader $remote_version and removing older Reader versions..."
FIRSTPAIR_READER_TAR=$archive FIRSTPAIR_READER_VERSION=$remote_version "$emacs_command" --batch -Q --eval '
(progn
  (require (quote cl-lib))
  (require (quote package))
  (package-initialize)
  (let* ((archive (expand-file-name (getenv "FIRSTPAIR_READER_TAR")))
         (expected-version (version-to-list (getenv "FIRSTPAIR_READER_VERSION")))
         (buffer (find-file-noselect archive))
         (target
          (unwind-protect
              (with-current-buffer buffer
                (unless (derived-mode-p (quote tar-mode)) (tar-mode))
                (package-tar-file-info))
            (when (buffer-live-p buffer) (kill-buffer buffer)))))
    (unless (eq (package-desc-name target) (quote firstpair-reader))
      (error "Downloaded package is %s, not firstpair-reader"
             (package-desc-name target)))
    (unless (version-list-= (package-desc-version target) expected-version)
      (error "Downloaded Reader %s does not match release record %s"
             (package-version-join (package-desc-version target))
             (package-version-join expected-version)))
    (cl-labels
        ((newest (descriptors)
           (car (sort (copy-sequence descriptors)
                      (lambda (left right)
                        (version-list-< (package-desc-version right)
                                        (package-desc-version left)))))))
      (let* ((target-version (package-desc-version target))
             (installed (cdr (assq (quote firstpair-reader) package-alist)))
             (current (newest installed)))
        (when (and current
                   (version-list-< target-version (package-desc-version current)))
          (error "Downloaded Reader %s is older than installed Reader %s"
                 (package-version-join target-version)
                 (package-version-join (package-desc-version current))))
        (unless (and current
                     (version-list-= target-version (package-desc-version current)))
          (package-install-file archive))
        (let* ((descriptors (cdr (assq (quote firstpair-reader) package-alist)))
               (keep (newest descriptors)))
          (unless (and keep
                       (version-list-= target-version (package-desc-version keep)))
            (error "Reader %s was not installed" (package-version-join target-version)))
          (dolist (descriptor descriptors)
            (unless (eq descriptor keep)
              (condition-case problem
                  (package-delete descriptor t t)
                (error
                 (message "Warning: could not remove Reader %s: %s"
                          (package-version-join (package-desc-version descriptor))
                          (error-message-string problem))))))
          (princ (format "FirstPair Reader %s is installed.\n"
                         (package-version-join (package-desc-version keep)))))))))
'

launch
