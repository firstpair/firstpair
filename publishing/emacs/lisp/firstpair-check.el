;;; firstpair-check.el --- Batch verification of a FirstPair bundle  -*- lexical-binding: t; -*-

;; Copyright (C) 2026 First Pair Press

;;; Commentary:

;; Loaded by `firstpair-emacs validate' after a bundle's init.el.  It opens
;; every node of both manuals with the reader active, checks that every marked
;; word can be located, follows every recorded cross-reference, exercises the
;; lexicon, and prints one JSON line.  It is not shipped inside bundles.

;;; Code:

(require 'cl-lib)
(require 'json)
(require 'firstpair-reader)

(defun firstpair-check--bundle (root)
  "Return the registered bundle rooted at ROOT."
  (or (cdr (assoc (directory-file-name (expand-file-name root)) firstpair-bundles))
      (error "Bundle not registered: %s" root)))

(defun firstpair-check--visit (name nodename)
  "Select the qualified NODENAME in the check buffer NAME and return the buffer."
  (let ((buffer (get-buffer-create (format "*check %s*" name))))
    (with-current-buffer buffer
      (unless (derived-mode-p 'Info-mode) (Info-mode))
      (let ((firstpair-reader--redirecting nil))
        (Info-goto-node nodename)))
    buffer))

(defun firstpair-check (root nodes-file)
  "Verify the bundle at ROOT by visiting every node listed in NODES-FILE."
  (let* ((bundle (firstpair-check--bundle root))
         (nodes (firstpair-bundle--read-json nodes-file))
         (visited 0) (expected-marks 0) (located-marks 0)
         (missing nil) (unresolved nil) (references 0) (lexicon-failures nil) (lexicon-tested 0))
    (dolist (manual nodes)
      (let ((stem (symbol-name (car manual))))
        (dolist (node (cdr manual))
          (with-current-buffer (firstpair-check--visit stem (format "(%s)%s" stem node))
            (unless firstpair-reader-mode
              (error "Reader mode is not active in %s node %s" stem node))
            (cl-incf visited)
            (let ((expected (length (firstpair-bundle-marked-words bundle stem node)))
                  (found (length (firstpair-reader--marked-overlays))))
              (cl-incf expected-marks expected)
              (cl-incf located-marks found)
              (unless (= expected found)
                (push (format "%s:%s expected %d located %d" stem node expected found) missing)))))))
    (let ((table (firstpair-bundle--read-json
                  (expand-file-name "data/references.json" (firstpair-bundle-root bundle)))))
      (dolist (side table)
        (let ((own (if (eq (car side) 'reader)
                       (firstpair-bundle-reader bundle)
                     (firstpair-bundle-reference bundle))))
          (dolist (entry (cdr side))
            (dolist (reference (cdr entry))
              (cl-incf references)
              (let* ((manual (alist-get 'manual reference))
                     (target (format "(%s)%s" (if (or (null manual) (string-empty-p manual)) own manual)
                                     (alist-get 'node reference))))
                (condition-case nil
                    (firstpair-check--visit "resolve" target)
                  (error (push target unresolved)))))))))
    (let ((forms (firstpair-lexicon-table bundle "forms.tsv")))
      (when (hash-table-p forms)
        (catch 'done
          (maphash (lambda (form _readings)
                     (when (>= lexicon-tested 25) (throw 'done nil))
                     (cl-incf lexicon-tested)
                     (unless (firstpair-lexicon-analyse bundle form)
                       (push form lexicon-failures))
                     (let ((rendered (firstpair-lexicon-render bundle form)))
                       (when (zerop (buffer-size rendered))
                         (push (concat "render:" form) lexicon-failures))))
                   forms))))
    (princ (json-encode
            `((visited . ,visited)
              (expectedMarks . ,expected-marks)
              (locatedMarks . ,located-marks)
              (missingMarks . ,(vconcat (nreverse missing)))
              (references . ,references)
              (unresolved . ,(vconcat (nreverse unresolved)))
              (lexiconTested . ,lexicon-tested)
              (lexiconFailures . ,(vconcat (nreverse lexicon-failures))))))
    (terpri)))

(provide 'firstpair-check)
;;; firstpair-check.el ends here
