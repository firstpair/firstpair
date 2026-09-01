;;; firstpair-lexicon.el --- Offline dictionary window for FirstPair bundles  -*- lexical-binding: t; -*-

;; Copyright (C) 2026 First Pair Press
;; Author: First Pair Press
;; Version: 1.20
;; Package-Requires: ((emacs "27.1"))
;; Keywords: docs, i18n

;;; Commentary:

;; The dictionary side of a FirstPair bundle.  A bundle ships four flat tables
;; under lexicon/: the dictionary entries it needs, every inflected form the
;; delivered text actually contains, the stems of those entries, and the
;; language's inflection endings.  Looking a word up is therefore a hash
;; lookup, and a word the tables do not list is analysed from stems and
;; endings on the spot.  A fifth table, glosses/<letter>.tsv, carries translations of
;; forms and entries into the target languages the edition declares; the
;; reader chooses one language or all of them.  Nothing here contacts a
;; server or shells out.

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

(defvar-local firstpair-lexicon-word nil
  "The word this buffer is showing.")

(declare-function firstpair-reader-translations-label "firstpair-reader" (bundle))

(defvar firstpair-lexicon-languages nil
  "Identifiers of the translation languages to show, or nil for all of them.
Change it with `firstpair-lexicon-cycle-languages'.")

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

(defun firstpair-lexicon--glosses (file)
  "Read glosses.tsv into a hash keyed by \"language\\0kind\\0key\"."
  (let ((table (make-hash-table :test #'equal)))
    (dolist (row (firstpair-lexicon--rows file) table)
      (when (>= (length row) 6)
        (let ((key (concat (nth 0 row) "\0" (nth 2 row) "\0" (nth 1 row))))
          (puthash key
                   (append (gethash key table)
                           (list (list :headword (nth 3 row) :part (nth 4 row)
                                       :definitions (split-string (nth 5 row) " | " t)
                                       :source (or (nth 6 row) ""))))
                   table))))))

(defun firstpair-lexicon-table (bundle name)
  "Return table NAME of BUNDLE, reading it the first time it is needed."
  (firstpair-bundle-table
   bundle (concat "lexicon/" name)
   (pcase name
     ("entries.tsv" #'firstpair-lexicon--entries)
     ("forms.tsv" #'firstpair-lexicon--forms)
     ((pred (lambda (n) (string-prefix-p "forms/" n))) #'firstpair-lexicon--forms)
     ("stems.tsv" #'firstpair-lexicon--stems)
     ("endings.tsv" #'firstpair-lexicon--endings)
     ("glosses.tsv" #'firstpair-lexicon--glosses)
     ((pred (lambda (n) (string-prefix-p "glosses/" n))) #'firstpair-lexicon--glosses)
     (_ #'firstpair-lexicon--rows))))

(defun firstpair-lexicon--gloss-shard (key)
  "The gloss shard KEY lives in: its first letter, lowercased, or \"_\"."
  (let ((first (and (> (length key) 0) (downcase (substring key 0 1)))))
    (if (and first (string-match-p "[[:alpha:]]" first)) first "_")))

(defun firstpair-lexicon--gloss-table (bundle key)
  "The gloss table holding KEY.
The key's shard, or the single table of an older bundle."
  (let* ((root (firstpair-bundle-root bundle))
         (shard (concat "glosses/" (firstpair-lexicon--gloss-shard key) ".tsv")))
    (cond ((file-readable-p (expand-file-name (concat "lexicon/" shard) root))
           (firstpair-lexicon-table bundle shard))
          ((file-readable-p (expand-file-name "lexicon/glosses.tsv" root))
           (firstpair-lexicon-table bundle "glosses.tsv"))
          (t (make-hash-table :test #'equal)))))

(defun firstpair-lexicon--forms-table (bundle form)
  "The forms table holding FORM.
Its first-letter shard, or the single table of an older bundle."
  (let* ((root (firstpair-bundle-root bundle))
         (shard (concat "forms/" (firstpair-lexicon--gloss-shard form) ".tsv")))
    (cond ((file-readable-p (expand-file-name (concat "lexicon/" shard) root))
           (firstpair-lexicon-table bundle shard))
          ((file-readable-p (expand-file-name "lexicon/forms.tsv" root))
           (firstpair-lexicon-table bundle "forms.tsv"))
          (t (make-hash-table :test #'equal)))))

(defun firstpair-lexicon-forms-tables (bundle)
  "Every forms table of BUNDLE, loaded: the shards, or the single table."
  (let* ((root (firstpair-bundle-root bundle))
         (directory (expand-file-name "lexicon/forms" root)))
    (if (file-directory-p directory)
        (mapcar (lambda (file) (firstpair-lexicon-table bundle (concat "forms/" file)))
                (directory-files directory nil "\\.tsv\\'"))
      (list (firstpair-lexicon-table bundle "forms.tsv")))))

(defun firstpair-lexicon-gloss-tables (bundle)
  "Every gloss table of BUNDLE, loaded: the shards, or the single table."
  (let* ((root (firstpair-bundle-root bundle))
         (directory (expand-file-name "lexicon/glosses" root)))
    (if (file-directory-p directory)
        (mapcar (lambda (file) (firstpair-lexicon-table bundle (concat "glosses/" file)))
                (directory-files directory nil "\\.tsv\\'"))
      (list (firstpair-lexicon-table bundle "glosses.tsv")))))

;;; Languages

(defun firstpair-lexicon-translations (bundle)
  "Return the translation languages BUNDLE declares: alists with id and label."
  (let ((declared (alist-get 'translations (firstpair-bundle-lexicon bundle))))
    (or declared
        (list (list (cons 'id (or (alist-get 'glossLanguage (firstpair-bundle-lexicon bundle)) "en"))
                    (cons 'label "English"))))))

(defun firstpair-lexicon-selected (bundle)
  "Return the translations of BUNDLE currently selected, at least one."
  (let* ((declared (firstpair-lexicon-translations bundle))
         (chosen (seq-filter (lambda (item) (member (alist-get 'id item) firstpair-lexicon-languages))
                             declared)))
    (or chosen declared)))

(defun firstpair-lexicon-languages-label (bundle)
  "Describe the selected translation languages of BUNDLE."
  (mapconcat (lambda (item) (alist-get 'label item)) (firstpair-lexicon-selected bundle) " + "))

(defun firstpair-lexicon-cycle-languages (bundle)
  "Select the next translation choice for BUNDLE: each language alone, then all.
Returns the description of the new choice."
  (let* ((declared (mapcar (lambda (item) (alist-get 'id item)) (firstpair-lexicon-translations bundle)))
         (choices (append (mapcar #'list declared) (and (cdr declared) (list declared))))
         (current (mapcar (lambda (item) (alist-get 'id item)) (firstpair-lexicon-selected bundle)))
         (position (seq-position choices current #'equal))
         (next (nth (mod (1+ (or position -1)) (length choices)) choices)))
    (setq firstpair-lexicon-languages next)
    (firstpair-lexicon-languages-label bundle)))

(defun firstpair-lexicon-choose-languages (bundle)
  "Ask which translation languages of BUNDLE to show."
  (let* ((declared (firstpair-lexicon-translations bundle))
         (labels (mapcar (lambda (item) (alist-get 'label item)) declared))
         (chosen (completing-read-multiple "Translations (comma-separated): " labels nil t)))
    (setq firstpair-lexicon-languages
          (mapcar (lambda (item) (alist-get 'id item))
                  (seq-filter (lambda (item) (member (alist-get 'label item) chosen)) declared)))
    (firstpair-lexicon-languages-label bundle)))

(defun firstpair-lexicon-glosses (bundle language kind key)
  "Return the glosses of KEY (a form or an entry id, per KIND) in LANGUAGE."
  (gethash (concat language "\0" kind "\0" key)
           (firstpair-lexicon--gloss-table bundle key)))

(defconst firstpair-lexicon-part-names
  '(("n" . "noun") ("v" . "verb") ("adj" . "adjective")
    ("adv" . "adverb") ("prep" . "preposition")
    ("conj" . "conjunction") ("pron" . "pronoun")
    ("pn" . "proper noun") ("name" . "proper noun")
    ("intj" . "interjection") ("num" . "numeral")
    ("det" . "determiner"))
  "Short and long part-of-speech names used by bundled dictionaries.")

(defun firstpair-lexicon--part-name (part)
  "Return the comparable long name of PART."
  (let ((value (downcase (string-trim (or part "")))))
    (or (cdr (assoc value firstpair-lexicon-part-names)) value)))

(defun firstpair-lexicon--gloss-rank (bundle entry gloss)
  "Rank GLOSS for source-language ENTRY in BUNDLE, best first."
  (let* ((headword (or (plist-get gloss :headword) ""))
         (written (mapcar #'string-trim (split-string (or (plist-get entry :headword) "") "," t)))
         (exact (member headword written))
         (same-part (equal (firstpair-lexicon--part-name (plist-get gloss :part))
                           (firstpair-lexicon--part-name (plist-get entry :part))))
         (same-word (seq-some
                     (lambda (word)
                       (equal (firstpair-lexicon-normalise headword bundle)
                              (firstpair-lexicon-normalise word bundle)))
                     written)))
    (+ (if exact 0 4) (if same-part 0 2) (if same-word 0 1))))

(defun firstpair-lexicon--compatible-gloss-p (bundle entry gloss)
  "Return non-nil when GLOSS can describe source-language ENTRY in BUNDLE."
  (let* ((headword (or (plist-get gloss :headword) ""))
         (part (firstpair-lexicon--part-name (plist-get gloss :part)))
         (source (or (plist-get gloss :source) ""))
         (written (mapcar #'string-trim (split-string (or (plist-get entry :headword) "") "," t)))
         (same-word (seq-some
                     (lambda (word)
                       (equal (firstpair-lexicon-normalise headword bundle)
                              (firstpair-lexicon-normalise word bundle)))
                     written))
         (same-part (equal part (firstpair-lexicon--part-name (plist-get entry :part)))))
    (or (and same-word (or (string-empty-p part) same-part))
        (string-prefix-p "via " source))))

(defun firstpair-lexicon--rank-glosses (bundle entry glosses)
  "Return GLOSSES ordered by their fit to source-language ENTRY."
  (cl-stable-sort
   (seq-filter (lambda (gloss) (firstpair-lexicon--compatible-gloss-p bundle entry gloss))
               (copy-sequence glosses))
   (lambda (left right)
     (< (firstpair-lexicon--gloss-rank bundle entry left)
        (firstpair-lexicon--gloss-rank bundle entry right)))))

(defun firstpair-lexicon-definitions (bundle language word readings)
  "Return the definitions of WORD in LANGUAGE, given its READINGS.
Each result is a plist with :headword, :part, :definitions, and :source.
The lexicon's own senses answer for its gloss language; other languages
come from the glosses table, by exact form first and then by entry."
  (let* ((form (firstpair-lexicon-normalise word bundle))
         (own (equal language (or (alist-get 'glossLanguage (firstpair-bundle-lexicon bundle)) "en")))
         (found nil))
    (when own
      (let ((seen (make-hash-table :test #'equal)))
        (dolist (reading readings)
          (let* ((id (plist-get reading :entry))
                 (entry (firstpair-lexicon-entry bundle id)))
            (when (and entry (not (gethash id seen)))
              (puthash id t seen)
              (push (list :headword (plist-get entry :headword)
                          :part (plist-get entry :part)
                          :definitions (split-string (plist-get entry :senses) ";" t " ")
                          :source "")
                    found))))))
    (dolist (reading readings)
      (let ((entry (firstpair-lexicon-entry bundle (plist-get reading :entry))))
        (dolist (gloss (firstpair-lexicon--rank-glosses
                        bundle entry
                        (firstpair-lexicon-glosses bundle language "entry" (plist-get reading :entry))))
          (push gloss found))))
    (let ((entry (and readings (firstpair-lexicon-entry bundle (plist-get (car readings) :entry)))))
      (dolist (gloss (if entry
                         (firstpair-lexicon--rank-glosses
                          bundle entry (firstpair-lexicon-glosses bundle language "form" form))
                       (firstpair-lexicon-glosses bundle language "form" form)))
        (push gloss found)))
    (let ((unique nil))
      (dolist (item (nreverse found))
        (unless (seq-find (lambda (other)
                            (and (equal (plist-get other :headword) (plist-get item :headword))
                                 (equal (plist-get other :definitions) (plist-get item :definitions))))
                          unique)
          (push item unique)))
      (nreverse unique))))

;;; Analysis

(defconst firstpair-lexicon-latin-spec
  '((lowercase . t) (combining . "strip") (replace . (("j" "i") ("v" "u"))) (strip . "’'"))
  "The folding rule of bundles built before rules shipped as data: Latin.")

(defvar firstpair-lexicon--spec-bundle nil
  "The bundle whose folding rule `firstpair-lexicon-normalise' applies.")

(defun firstpair-lexicon-spec (&optional bundle)
  "Return the folding rule of BUNDLE, an alist shipped in data/bundle.json."
  (let ((declared (and bundle (alist-get 'normalise (firstpair-bundle-lexicon bundle)))))
    (or declared firstpair-lexicon-latin-spec)))

(defun firstpair-lexicon-enclitics (&optional bundle)
  "Return the enclitic suffixes of BUNDLE's language."
  (let ((declared (and bundle (alist-get 'enclitics (firstpair-bundle-lexicon bundle)))))
    (or declared '("que" "ne" "ve" "cum"))))

(defconst firstpair-lexicon-diaereses
  '((?ï . ?i) (?ü . ?u) (?ë . ?e) (?ö . ?o) (?ä . ?a))
  "Diaeresis letters folded when a rule keeps other accents.")

(defun firstpair-lexicon-normalise (word &optional bundle)
  "Fold WORD to the shape the delivered tables are keyed on.
The rule is BUNDLE's, or the rule of `firstpair-lexicon--spec-bundle', or
Latin's: lower case, combining marks stripped or kept, replacements applied."
  (let* ((spec (firstpair-lexicon-spec (or bundle firstpair-lexicon--spec-bundle)))
         (combining (or (alist-get 'combining spec) "strip"))
         (text (or word ""))
         (text (if (equal combining "strip")
                   (let ((plain (ucs-normalize-NFD-string text)))
                     (apply #'string
                            (seq-filter (lambda (character)
                                          (not (memq (get-char-code-property character 'general-category)
                                                     '(Mn Mc Me))))
                                        (append plain nil))))
                 (ucs-normalize-NFC-string text)))
         (text (if (equal combining "diaeresis")
                   (apply #'string (mapcar (lambda (character)
                                             (or (alist-get character firstpair-lexicon-diaereses) character))
                                           (append text nil)))
                 text))
         (text (if (alist-get 'lowercase spec) (downcase text) text))
         (text (string-trim text (format "[%s]+" (or (alist-get 'strip spec) "’'"))
                            (format "[%s]+" (or (alist-get 'strip spec) "’'")))))
    (dolist (pair (alist-get 'replace spec))
      (setq text (replace-regexp-in-string (regexp-quote (car pair)) (cadr pair) text t t)))
    (replace-regexp-in-string "[^[:alpha:]’']" "" text)))

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
  (let* ((form (firstpair-lexicon-normalise word bundle))
         (direct (and (> (length form) 0) (gethash form (firstpair-lexicon--forms-table bundle form)))))
    (or direct
        (seq-some (lambda (enclitic)
                    (and (> (length form) (1+ (length enclitic)))
                         (string-suffix-p enclitic form)
                         (let ((base (substring form 0 (- (length form) (length enclitic)))))
                           (mapcar (lambda (reading)
                                     (plist-put (copy-sequence reading) :enclitic enclitic))
                                   (gethash base (firstpair-lexicon--forms-table bundle base))))))
                  (firstpair-lexicon-enclitics bundle))
        (firstpair-lexicon--fallback bundle form))))

(defun firstpair-lexicon-entry (bundle id)
  "Return the dictionary entry ID of BUNDLE."
  (gethash id (firstpair-lexicon-table bundle "entries.tsv")))

(defun firstpair-lexicon-gloss (bundle word)
  "Return a one-line gloss for WORD in the selected languages, for the echo area."
  (let* ((readings (firstpair-lexicon-analyse bundle word))
         (first (car readings))
         (entry (and first (firstpair-lexicon-entry bundle (plist-get first :entry)))))
    (when entry
      (let ((pieces nil)
            (surface (string-trim (or word "")))
            (headword (plist-get entry :headword)))
        (dolist (language (firstpair-lexicon-selected bundle))
          (let ((definitions (firstpair-lexicon-definitions bundle (alist-get 'id language) word (list first))))
            (when definitions
              (push (mapconcat #'identity (seq-take (plist-get (car definitions) :definitions) 3) "; ")
                    pieces))))
        (format "%s — %s: %s"
                (if (equal (firstpair-lexicon-normalise surface bundle)
                           (firstpair-lexicon-normalise headword bundle))
                    (if (string-empty-p surface) headword surface)
                  (format "%s → %s" surface headword))
                (if (equal (plist-get first :features) "lemma")
                    (plist-get entry :part)
                  (plist-get first :features))
                (truncate-string-to-width
                 (if pieces
                     (mapconcat #'identity (nreverse pieces) " · ")
                   (format "no %s entry" (firstpair-lexicon-languages-label bundle)))
                 110 nil nil "…"))))))

;;; Presentation

(defvar-local firstpair-lexicon-expanded nil
  "Non-nil when the dictionary buffer shows every available sense.")

(defvar-local firstpair-lexicon-has-more nil
  "Non-nil when the dictionary entry has senses hidden by compact view.")

(defvar firstpair-lexicon-mode-map
  (let ((map (make-sparse-keymap)))
    (define-key map (kbd "q") #'quit-window)
    (define-key map (kbd "n") #'forward-paragraph)
    (define-key map (kbd "p") #'backward-paragraph)
    (define-key map (kbd "t") #'firstpair-lexicon-next-languages)
    (define-key map (kbd "T") #'firstpair-lexicon-select-languages)
    (define-key map (kbd "m") #'firstpair-lexicon-toggle-details)
    map)
  "Keymap for `firstpair-lexicon-mode'.")

(define-derived-mode firstpair-lexicon-mode special-mode "Lexicon"
  "Major mode for the FirstPair dictionary window."
  (setq-local truncate-lines t)
  (setq-local word-wrap nil)
  (setq-local buffer-read-only t))

(defun firstpair-lexicon--sense-lines (definitions)
  "Return the distinct sense lines in DEFINITIONS, preserving their order."
  (let (seen senses)
    (dolist (item definitions (nreverse senses))
      (dolist (definition (plist-get item :definitions))
        (let ((sense (string-trim definition)))
          (unless (or (string-empty-p sense) (member sense seen))
            (push sense seen)
            (push sense senses)))))))

(defun firstpair-lexicon--source-headwords (bundle word readings)
  "Return the distinct source-language headwords for WORD and READINGS.
Headwords come only from BUNDLE's source lexicon.  When analysis has no
usable entry, return WORD itself so the dictionary keeps its source identity."
  (let (seen headwords)
    (dolist (reading readings)
      (let* ((entry (firstpair-lexicon-entry bundle (plist-get reading :entry)))
             (headword (string-trim (or (and entry (plist-get entry :headword)) "")))
             (key (and (not (string-empty-p headword))
                       (firstpair-lexicon-normalise headword bundle))))
        (when (and key (not (member key seen)))
          (push key seen)
          (push headword headwords))))
    (or (nreverse headwords)
        (list (let ((surface (string-trim (or word ""))))
                (if (string-empty-p surface) "?" surface))))))

(defun firstpair-lexicon--insert-source-headword (bundle word readings)
  "Insert one source-language headword row for WORD and READINGS from BUNDLE."
  (insert (propertize (mapconcat #'identity
                                 (firstpair-lexicon--source-headwords bundle word readings)
                                 " · ")
                      'face 'firstpair-lexicon-headword)
          "\n"))

(defun firstpair-lexicon--insert-definitions (bundle word readings)
  "Insert compact sense lines for WORD from BUNDLE in each selected language.
Return non-nil when at least one sense was inserted."
  (setq firstpair-lexicon-has-more nil)
  (let (inserted)
    (dolist (language (firstpair-lexicon-selected bundle))
      (let* ((definitions (firstpair-lexicon-definitions
                           bundle (alist-get 'id language) word readings))
             (senses (firstpair-lexicon--sense-lines definitions)))
        (when (> (length senses) 2)
          (setq firstpair-lexicon-has-more t))
        (dolist (sense (if firstpair-lexicon-expanded senses (seq-take senses 2)))
          (setq inserted t)
          (insert sense "\n"))))
    inserted))

(defun firstpair-lexicon--insert (bundle word readings)
  "Render READINGS of WORD from BUNDLE into the current buffer."
  (firstpair-lexicon--insert-source-headword bundle word readings)
  (unless (firstpair-lexicon--insert-definitions bundle word readings)
    (insert "No entry in the selected dictionaries.\n"))
  (goto-char (point-min)))

(defun firstpair-lexicon-render (bundle word)
  "Show the entries for WORD from BUNDLE in the lexicon buffer.
Returns the buffer."
  (let ((buffer (get-buffer-create firstpair-lexicon-buffer))
        (readings (firstpair-lexicon-analyse bundle word)))
    (with-current-buffer buffer
      (let ((same-entry (and (eq firstpair-lexicon-bundle bundle)
                             (equal firstpair-lexicon-word word))))
        (unless (derived-mode-p 'firstpair-lexicon-mode)
          (firstpair-lexicon-mode))
        (unless same-entry
          (setq firstpair-lexicon-expanded nil)))
      (setq firstpair-lexicon-bundle bundle
            firstpair-lexicon-word word)
      (setq header-line-format nil
            truncate-lines (not firstpair-lexicon-expanded)
            word-wrap firstpair-lexicon-expanded)
      (let ((inhibit-read-only t))
        (erase-buffer)
        (firstpair-lexicon--insert bundle word readings))
      (when (and (bound-and-true-p firstpair-reader-touch)
                 (fboundp 'firstpair-reader--dictionary-bar))
        (setq mode-line-format (firstpair-reader--dictionary-bar)))
      (force-mode-line-update t)
      (when (fboundp 'firstpair-reader--fit-lexicon-window)
        (firstpair-reader--fit-lexicon-window)))
    buffer))

(defun firstpair-lexicon-refresh ()
  "Render the lexicon buffer's word again, after a language change."
  (let ((buffer (get-buffer firstpair-lexicon-buffer)))
    (when (buffer-live-p buffer)
      (with-current-buffer buffer
        (when (and firstpair-lexicon-bundle firstpair-lexicon-word)
          (firstpair-lexicon-render firstpair-lexicon-bundle firstpair-lexicon-word))))))

(defun firstpair-lexicon-next-languages ()
  "Cycle the dictionary window through one language at a time, then all."
  (interactive)
  (let ((bundle (or firstpair-lexicon-bundle
                    (user-error "No dictionary is showing"))))
    (message "Translations: %s" (firstpair-lexicon-cycle-languages bundle))
    (firstpair-lexicon-refresh)
    (when (fboundp 'firstpair-reader-refresh-regions) (firstpair-reader-refresh-regions))))

(defun firstpair-lexicon-select-languages ()
  "Choose which translation languages the dictionary window shows."
  (interactive)
  (let ((bundle (or firstpair-lexicon-bundle
                    (user-error "No dictionary is showing"))))
    (message "Translations: %s" (firstpair-lexicon-choose-languages bundle))
    (firstpair-lexicon-refresh)
    (when (fboundp 'firstpair-reader-refresh-regions) (firstpair-reader-refresh-regions))))

(defun firstpair-lexicon-toggle-details ()
  "Toggle between two sense lines per language and every available sense."
  (interactive)
  (unless (and firstpair-lexicon-bundle firstpair-lexicon-word)
    (user-error "No dictionary is showing"))
  (unless (or firstpair-lexicon-expanded firstpair-lexicon-has-more)
    (user-error "This entry has no additional senses"))
  (setq firstpair-lexicon-expanded (not firstpair-lexicon-expanded))
  (firstpair-lexicon-render firstpair-lexicon-bundle firstpair-lexicon-word))

(provide 'firstpair-lexicon)
;;; firstpair-lexicon.el ends here
