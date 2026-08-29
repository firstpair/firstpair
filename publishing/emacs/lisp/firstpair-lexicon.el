;;; firstpair-lexicon.el --- Offline dictionary window for FirstPair bundles  -*- lexical-binding: t; -*-

;; Copyright (C) 2026 First Pair Press
;; Author: First Pair Press
;; Version: 1.2
;; Package-Requires: ((emacs "27.1"))
;; Keywords: docs, i18n

;;; Commentary:

;; The dictionary side of a FirstPair bundle.  A bundle ships four flat tables
;; under lexicon/: the dictionary entries it needs, every inflected form the
;; delivered text actually contains, the stems of those entries, and the
;; language's inflection endings.  Looking a word up is therefore a hash
;; lookup, and a word the tables do not list is analysed from stems and
;; endings on the spot.  Nothing here contacts a server or shells out.

;;; Code:

(require 'cl-lib)
(require 'subr-x)
(require 'ucs-normalize)

(require 'firstpair-bundle)

(defgroup firstpair-lexicon nil
  "Offline dictionary lookup for FirstPair Emacs bundles."
  :group 'firstpair
  :prefix "firstpair-lexicon-")

(defface firstpair-lexicon-headword
  '((t :inherit bold))
  "Face for the dictionary form at the head of an entry.")

(defface firstpair-lexicon-analysis
  '((t :inherit font-lock-type-face))
  "Face for the grammatical analysis of the form under point.")

(defvar-local firstpair-lexicon-bundle nil
  "The bundle whose lexicon this buffer is showing.")

(defconst firstpair-lexicon-buffer "*FirstPair Lexicon*"
  "Name of the buffer holding dictionary entries.")

;;; Tables

(defun firstpair-lexicon--rows (file)
  "Return the rows of the tab-separated FILE, without its header line."
  (when (file-readable-p file)
    (with-temp-buffer
      (insert-file-contents file)
      (goto-char (point-min))
      (forward-line 1)
      (let (rows)
        (while (not (eobp))
          (push (split-string (buffer-substring-no-properties
                               (line-beginning-position) (line-end-position))
                              "\t")
                rows)
          (forward-line 1))
        (nreverse rows)))))

(defun firstpair-lexicon--entries (file)
  (let ((table (make-hash-table :test #'equal)))
    (dolist (row (firstpair-lexicon--rows file) table)
      (when (>= (length row) 6)
        (puthash (nth 0 row)
                 (list :id (nth 0 row) :headword (nth 1 row) :part (nth 2 row)
                       :code (nth 3 row) :frequency (nth 4 row) :senses (nth 5 row))
                 table)))))

(defun firstpair-lexicon--forms (file)
  (let ((table (make-hash-table :test #'equal)))
    (dolist (row (firstpair-lexicon--rows file) table)
      (when (>= (length row) 3)
        (puthash (nth 0 row)
                 (append (gethash (nth 0 row) table)
                         (list (list :entry (nth 1 row) :features (nth 2 row)
                                     :enclitic (or (nth 3 row) ""))))
                 table)))))

(defun firstpair-lexicon--stems (file)
  (let ((table (make-hash-table :test #'equal)))
    (dolist (row (firstpair-lexicon--rows file) table)
      (when (>= (length row) 3)
        (push (cons (nth 1 row) (string-to-number (nth 2 row)))
              (gethash (nth 0 row) table))))))

(defun firstpair-lexicon--endings (file)
  (let ((table (make-hash-table :test #'equal)))
    (dolist (row (firstpair-lexicon--rows file) table)
      (when (>= (length row) 6)
        (push (list :part (nth 1 row) :stem (string-to-number (nth 4 row))
                    :features (nth 5 row))
              (gethash (nth 0 row) table))))))

(defun firstpair-lexicon-table (bundle name)
  "Return table NAME of BUNDLE, reading it the first time it is needed."
  (firstpair-bundle-table
   bundle (concat "lexicon/" name)
   (pcase name
     ("entries.tsv" #'firstpair-lexicon--entries)
     ("forms.tsv" #'firstpair-lexicon--forms)
     ("stems.tsv" #'firstpair-lexicon--stems)
     ("endings.tsv" #'firstpair-lexicon--endings)
     (_ #'firstpair-lexicon--rows))))

;;; Analysis

(defconst firstpair-lexicon-enclitics '("que" "ne" "ve" "cum")
  "Suffixes that may be attached to a Latin word.")

(defun firstpair-lexicon-normalise (word)
  "Fold WORD to the shape the delivered tables are keyed on."
  (let* ((plain (ucs-normalize-NFD-string (or word "")))
         (letters (seq-filter (lambda (character)
                                (not (memq (get-char-code-property character 'general-category)
                                           '(Mn Mc Me))))
                              (append plain nil)))
         (folded (downcase (apply #'string letters))))
    (replace-regexp-in-string
     "[^[:alpha:]]" ""
     (replace-regexp-in-string "v" "u" (replace-regexp-in-string "j" "i" folded)))))

(defun firstpair-lexicon--fallback (bundle form)
  "Analyse FORM against the stems and endings BUNDLE ships."
  (let ((stems (firstpair-lexicon-table bundle "stems.tsv"))
        (endings (firstpair-lexicon-table bundle "endings.tsv"))
        (entries (firstpair-lexicon-table bundle "entries.tsv"))
        (found nil))
    (dotimes (split (1+ (length form)))
      (let* ((stem (substring form 0 (- (length form) split)))
             (ending (substring form (- (length form) split))))
        (dolist (candidate (gethash stem stems))
          (dolist (rule (gethash ending endings))
            (let ((entry (gethash (car candidate) entries)))
              (when (and entry
                         (= (cdr candidate) (plist-get rule :stem))
                         (or (equal (plist-get entry :part) (plist-get rule :part))
                             (and (equal (plist-get entry :part) "V")
                                  (member (plist-get rule :part) '("VPAR" "SUPINE")))))
                (cl-pushnew (list :entry (car candidate)
                                  :features (plist-get rule :features)
                                  :enclitic "")
                            found :test #'equal)))))))
    (nreverse found)))

(defun firstpair-lexicon-analyse (bundle word)
  "Return the readings of WORD offered by BUNDLE, best first."
  (let* ((form (firstpair-lexicon-normalise word))
         (forms (firstpair-lexicon-table bundle "forms.tsv"))
         (direct (and (> (length form) 0) (gethash form forms))))
    (or direct
        (seq-some (lambda (enclitic)
                    (and (> (length form) (1+ (length enclitic)))
                         (string-suffix-p enclitic form)
                         (let ((base (substring form 0 (- (length form) (length enclitic)))))
                           (mapcar (lambda (reading)
                                     (plist-put (copy-sequence reading) :enclitic enclitic))
                                   (gethash base forms)))))
                  firstpair-lexicon-enclitics)
        (firstpair-lexicon--fallback bundle form))))

(defun firstpair-lexicon-entry (bundle id)
  "Return the dictionary entry ID of BUNDLE."
  (gethash id (firstpair-lexicon-table bundle "entries.tsv")))

(defun firstpair-lexicon-gloss (bundle word)
  "Return a one-line gloss for WORD, suitable for the echo area."
  (let* ((readings (firstpair-lexicon-analyse bundle word))
         (first (car readings))
         (entry (and first (firstpair-lexicon-entry bundle (plist-get first :entry)))))
    (when entry
      (format "%s — %s: %s"
              (plist-get entry :headword)
              (plist-get first :features)
              (truncate-string-to-width (plist-get entry :senses) 90 nil nil "…")))))

;;; Presentation

(defvar firstpair-lexicon-mode-map
  (let ((map (make-sparse-keymap)))
    (define-key map (kbd "q") #'quit-window)
    (define-key map (kbd "n") #'forward-paragraph)
    (define-key map (kbd "p") #'backward-paragraph)
    map)
  "Keymap for `firstpair-lexicon-mode'.")

(define-derived-mode firstpair-lexicon-mode special-mode "Lexicon"
  "Major mode for the FirstPair dictionary window."
  (setq-local truncate-lines nil)
  (setq-local buffer-read-only t))

(defun firstpair-lexicon--insert (bundle word readings)
  "Render READINGS of WORD from BUNDLE into the current buffer."
  (insert (propertize word 'face 'firstpair-lexicon-headword) "\n")
  (if (null readings)
      (insert "\nNo entry in this edition's lexicon.\n")
    (let ((seen (make-hash-table :test #'equal)))
      (dolist (reading readings)
        (let* ((id (plist-get reading :entry))
               (entry (firstpair-lexicon-entry bundle id)))
          (when entry
            (unless (gethash id seen)
              (puthash id t seen)
              (insert "\n"
                      (propertize (plist-get entry :headword) 'face 'firstpair-lexicon-headword)
                      "  [" (plist-get entry :part) "]\n")
              (let ((start (point)))
                (insert "  " (plist-get entry :senses) "\n")
                (fill-region start (point))))
            (insert "  "
                    (propertize (plist-get reading :features) 'face 'firstpair-lexicon-analysis)
                    (if (string-empty-p (or (plist-get reading :enclitic) ""))
                        ""
                      (format " + enclitic -%s" (plist-get reading :enclitic)))
                    "\n"))))))
  (goto-char (point-min)))

(defun firstpair-lexicon-render (bundle word)
  "Show the entries for WORD from BUNDLE in the lexicon buffer.
Returns the buffer."
  (let ((buffer (get-buffer-create firstpair-lexicon-buffer))
        (readings (firstpair-lexicon-analyse bundle word)))
    (with-current-buffer buffer
      (firstpair-lexicon-mode)
      (setq firstpair-lexicon-bundle bundle)
      (let ((inhibit-read-only t))
        (erase-buffer)
        (firstpair-lexicon--insert bundle word readings)))
    buffer))

(provide 'firstpair-lexicon)
;;; firstpair-lexicon.el ends here
