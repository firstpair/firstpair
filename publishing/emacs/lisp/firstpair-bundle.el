;;; firstpair-bundle.el --- Load a FirstPair Emacs bundle  -*- lexical-binding: t; -*-

;; Copyright (C) 2026 First Pair Press
;; Author: First Pair Press
;; Version: 1.1
;; Package-Requires: ((emacs "28.1"))
;; Keywords: docs, hypermedia

;;; Commentary:

;; A FirstPair Emacs bundle is a directory holding an Info manual for a book,
;; a second Info manual for its references, the tables that connect the two,
;; and an offline lexicon.  This file is the loader: it reads a bundle's index
;; files, registers its Info directory, and answers questions about nodes,
;; references, and marked words.  It has no dependencies beyond Emacs itself
;; and never touches the network.

;;; Code:

(require 'cl-lib)
(require 'info)
(require 'json)
(require 'subr-x)

(defconst firstpair-bundle-schema "firstpair-emacs-bundle-v1"
  "The bundle description this reader understands.")

(cl-defstruct (firstpair-bundle (:constructor firstpair-bundle--create)
                                (:copier nil))
  root title slug product edition reader reference
  pages records marked lexicon tables)

(defvar firstpair-bundles nil
  "Alist of (ROOT . BUNDLE) for every registered bundle.")

(defun firstpair-bundle--read-json (file)
  "Parse FILE as JSON, returning alists keyed by symbols and plain lists."
  (with-temp-buffer
    (insert-file-contents file)
    (goto-char (point-min))
    (if (fboundp 'json-parse-buffer)
        (json-parse-buffer :object-type 'alist :array-type 'list :null-object nil
                           :false-object nil)
      (let ((json-object-type 'alist) (json-array-type 'list)
            (json-null nil) (json-false nil))
        (json-read)))))

(defun firstpair-bundle--field (row key)
  "Return KEY from alist ROW as a string, or nil."
  (let ((value (alist-get key row)))
    (cond ((stringp value) value)
          ((numberp value) (number-to-string value))
          (t value))))

(defun firstpair-bundle--marked (file)
  "Read the marked-word table FILE into a hash keyed by \"manual\\0node\"."
  (let ((table (make-hash-table :test #'equal)))
    (when (file-readable-p file)
      (with-temp-buffer
        (insert-file-contents file)
        (goto-char (point-min))
        (forward-line 1)
        (while (not (eobp))
          (let ((fields (split-string (buffer-substring-no-properties
                                       (line-beginning-position) (line-end-position))
                                      "\t")))
            (when (= (length fields) 7)
              (let ((key (concat (nth 0 fields) "\0" (nth 1 fields))))
                (puthash key
                         (cons (list :line (string-to-number (nth 2 fields))
                                     :column (string-to-number (nth 3 fields))
                                     :length (string-to-number (nth 4 fields))
                                     :form (nth 5 fields)
                                     :entries (split-string (nth 6 fields) "," t))
                               (gethash key table))
                         table))))
          (forward-line 1))))
    table))

;;;###autoload
(defun firstpair-bundle-load (root)
  "Load the bundle rooted at ROOT and return it.
Signals an error when ROOT is not a bundle this reader understands."
  (let* ((root (file-name-as-directory (expand-file-name root)))
         (index (expand-file-name "data/bundle.json" root)))
    (unless (file-readable-p index)
      (error "Not a FirstPair Emacs bundle: %s" root))
    (let ((payload (firstpair-bundle--read-json index)))
      (unless (equal (alist-get 'schema payload) firstpair-bundle-schema)
        (error "Unsupported bundle schema in %s" index))
      (firstpair-bundle--create
       :root root
       :title (alist-get 'title payload)
       :slug (alist-get 'slug payload)
       :product (alist-get 'product payload)
       :edition (alist-get 'edition payload)
       :reader (alist-get 'readerManual payload)
       :reference (alist-get 'referenceManual payload)
       :lexicon (alist-get 'lexicon payload)
       :pages (firstpair-bundle--read-json (expand-file-name "data/reader.json" root))
       :records (firstpair-bundle--read-json (expand-file-name "data/records.json" root))
       :marked (firstpair-bundle--marked (expand-file-name "data/marked.tsv" root))
       :tables (make-hash-table :test #'equal)))))

;;;###autoload
(defun firstpair-bundle-register (root)
  "Register the bundle at ROOT and make its Info manuals findable."
  (let* ((bundle (firstpair-bundle-load root))
         (directory (directory-file-name (firstpair-bundle-root bundle))))
    ;; Let Info collect its default directories first; setting
    ;; `Info-directory-list' before that would hide every other manual.
    (info-initialize)
    (add-to-list 'Info-directory-list directory)
    (when (boundp 'Info-additional-directory-list)
      (add-to-list 'Info-additional-directory-list directory))
    (setf (alist-get directory firstpair-bundles nil nil #'equal) bundle)
    bundle))

(defun firstpair-bundle-for-manual (manual)
  "Return the registered bundle owning MANUAL, a manual stem, or nil."
  (seq-some (lambda (entry)
              (let ((bundle (cdr entry)))
                (and (member manual (list (firstpair-bundle-reader bundle)
                                          (firstpair-bundle-reference bundle)))
                     bundle)))
            firstpair-bundles))

(defun firstpair-bundle-current ()
  "Return the bundle owning the Info manual in the current buffer, or nil."
  (when (and (derived-mode-p 'Info-mode) Info-current-file)
    (firstpair-bundle-for-manual
     (file-name-base (directory-file-name Info-current-file)))))

(defun firstpair-bundle-manual ()
  "Return the manual stem of the current Info buffer."
  (and Info-current-file (file-name-base (directory-file-name Info-current-file))))

(defun firstpair-bundle-marked-words (bundle manual node)
  "Return the marked words recorded for NODE of MANUAL in BUNDLE."
  (gethash (concat manual "\0" node) (firstpair-bundle-marked bundle)))

(defun firstpair-bundle-records-for-node (bundle node)
  "Return the records of BUNDLE quoted in NODE."
  (seq-filter (lambda (record)
                (member node (alist-get 'quotedIn record)))
              (firstpair-bundle-records bundle)))

(defun firstpair-bundle-record (bundle id)
  "Return the record of BUNDLE identified by ID."
  (seq-find (lambda (record) (equal (alist-get 'id record) id))
            (firstpair-bundle-records bundle)))

(defun firstpair-bundle-page (bundle node)
  "Return the reader page of BUNDLE whose node is NODE."
  (seq-find (lambda (page) (equal (alist-get 'node page) node))
            (firstpair-bundle-pages bundle)))

(defun firstpair-bundle-table (bundle name reader)
  "Return the parsed table NAME of BUNDLE, reading it with READER once."
  (or (gethash name (firstpair-bundle-tables bundle))
      (puthash name
               (funcall reader (expand-file-name name (firstpair-bundle-root bundle)))
               (firstpair-bundle-tables bundle))))

(provide 'firstpair-bundle)
;;; firstpair-bundle.el ends here
