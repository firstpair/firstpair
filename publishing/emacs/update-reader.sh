#!/bin/sh
# Update the installed FirstPair Reader, remove older Reader package versions,
# then replace this shell with a fresh interactive Emacs reading this bundle.
set -eu

reader_url=${FIRSTPAIR_READER_URL:-https://firstpair.org/emacs/firstpair-reader.tar}
emacs_command=${FIRSTPAIR_EMACS:-emacs}
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)

for command in curl "$emacs_command" mktemp; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "update-reader.sh: required command not found: $command" >&2
    exit 1
  fi
done

# Never replace package files underneath a live Emacs. Unsaved buffers belong
# to the reader, not to this updater.
if command -v pgrep >/dev/null 2>&1 &&
   { pgrep -x emacs >/dev/null 2>&1 || pgrep -x Emacs >/dev/null 2>&1; }; then
  echo "update-reader.sh: quit the existing Emacs completely, then run this again." >&2
  exit 1
fi

temporary=$(mktemp -d "${TMPDIR:-/tmp}/firstpair-reader.XXXXXX")
cleanup() {
  if [ -n "${temporary:-}" ] && [ -d "$temporary" ]; then
    rm -rf -- "$temporary"
  fi
}
trap cleanup 0 1 2 15

archive=$temporary/firstpair-reader.tar
echo "Downloading FirstPair Reader..."
curl -fL --retry 3 --retry-delay 2 -o "$archive" "$reader_url"

echo "Installing the new Reader and removing older Reader versions..."
FIRSTPAIR_READER_TAR=$archive "$emacs_command" --batch -Q --eval '
(progn
  (require (quote cl-lib))
  (require (quote package))
  (package-initialize)
  (let* ((archive (expand-file-name (getenv "FIRSTPAIR_READER_TAR")))
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
                          (error-message-string problem)))))
          (princ (format "FirstPair Reader %s is installed.\n"
                         (package-version-join (package-desc-version keep))))))))))
'

cleanup
trap - 0 1 2 15

if [ "${FIRSTPAIR_READER_NO_RESTART:-0}" = 1 ]; then
  exit 0
fi

echo "Opening this bundle in a fresh terminal Emacs..."
FIRSTPAIR_BUNDLE=$here exec "$emacs_command" -nw --eval '
(progn
  (require (quote package))
  (package-initialize)
  (require (quote firstpair-reader))
  (firstpair-read (file-name-as-directory
                   (expand-file-name (getenv "FIRSTPAIR_BUNDLE")))))
'
