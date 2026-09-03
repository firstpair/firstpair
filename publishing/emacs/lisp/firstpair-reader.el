;;; firstpair-reader.el --- Read a FirstPair book in Emacs Info  -*- lexical-binding: t; -*-

;; Copyright (C) 2026 First Pair Press
;; Author: First Pair Press
;; Version: 1.39
;; Package-Requires: ((emacs "27.1"))
;; Keywords: docs, hypermedia

;;; Commentary:

;; The reading side of a FirstPair Emacs bundle.  A bundle is two Info
;; manuals: the book, and the references the book points at.  This mode keeps
;; them in separate windows -- the book above and its references below -- so
;; following a citation never moves the reading position.  The dictionary
;; reuses an idle references pane or opens below an active source.  It also
;; underlines the words the bundle's offline lexicon can explain and looks them
;; up with a single key.
;;
;; Load a bundle's init.el, then M-x firstpair-read.  Everything else is
;; ordinary Info: n, p, u and l move, SPC scrolls, and RET follows links.  In
;; an aligned book's poem window, RET instead advances to and looks up the
;; next source-language word.

;;; Code:

(require 'cl-lib)
(require 'easymenu)
(require 'info)
(require 'seq)
(require 'subr-x)
(require 'thingatpt)
(require 'view)

(require 'firstpair-bundle)
(require 'firstpair-lexicon)

(defgroup firstpair nil
  "Reading FirstPair books in Emacs."
  :group 'docs
  :prefix "firstpair-")

(defcustom firstpair-reader-references-height 0.35
  "Fraction of the reader window given to the references window."
  :type 'number)

(defcustom firstpair-reader-lexicon-height 10
  "Maximum height in lines of the dictionary window.
Compact entries shrink to their headword and available sense rows."
  :type 'integer)

(defcustom firstpair-reader-highlight t
  "Non-nil underlines the words the dictionary window can explain."
  :type 'boolean)

(defcustom firstpair-reader-significant-stopwords
  '("a" "ad" "al" "alla" "alle" "allo" "ai" "agli"
    "da" "dal" "dalla" "dalle" "dallo" "dai" "dagli"
    "di" "del" "della" "delle" "dello" "dei" "degli"
    "in" "nel" "nella" "nelle" "nello" "nei" "negli"
    "con" "su" "sul" "sulla" "sulle" "sullo" "sui" "sugli"
    "per" "tra" "fra" "e" "ed" "o" "od" "ma" "che" "se"
    "il" "lo" "la" "i" "gli" "le" "un" "uno" "una"
    "mi" "ti" "si" "ci" "vi" "ne" "io" "tu" "egli" "ella" "noi" "voi"
    "essere" "esser" "sono" "sei" "è" "siamo" "siete" "era" "eri" "erano"
    "fui" "fosti" "fu" "fur" "furono" "sia" "siano" "fosse" "fossero"
    "sarà" "saranno" "sarei" "sarebbe" "avere" "aver" "ho" "hai" "ha"
    "hanno" "aveva" "avevano" "ebbe" "ebbero" "abbia" "abbiano")
  "Lowercase source words skipped by significant-word movement.
This defaults to frequent Italian function words, pronouns, and common forms
of essere and avere.  A bundle or reader may customize it for another source
language."
  :type '(repeat string))

(defcustom firstpair-reader-bundle-directories nil
  "Directories `firstpair-reader-discover' searches for bundles.
Each entry is either a bundle directory or a directory whose immediate
subdirectories are bundles."
  :type '(repeat directory))

(defcustom firstpair-reader-touch t
  "Drive the reader by taps and single keys: a button bar in the header line,
mouse reporting in terminals, and one-letter commands in the book."
  :type 'boolean)

(defcustom firstpair-reader-resume t
  "Reopen a bundle where it was left: node, point, languages, translations."
  :type 'boolean)

(defcustom firstpair-reader-state-file (locate-user-emacs-file "firstpair-reader-state.el")
  "File remembering, per bundle, where reading stopped and what was shown."
  :type 'file)

(defcustom firstpair-reader-info-directory "~/.local/share/info"
  "Info directory that `firstpair-reader-install-info' installs manuals into."
  :type 'directory)

(defface firstpair-reader-marked
  '((t :underline t))
  "Face for words the dictionary window can explain.")

(defface firstpair-reader-current-word
  '((t :inherit firstpair-reader-marked :underline t :weight bold))
  "Face for the source word currently displayed in the dictionary.")

(defconst firstpair-reader-buffer "*FirstPair Reader*"
  "Name of the Info buffer showing the book.")

(defconst firstpair-reader-references-buffer "*FirstPair References*"
  "Name of the Info buffer showing the references.")

(defvar-local firstpair-reader--overlays nil
  "Overlays this mode placed in the current node.")

(defvar-local firstpair-reader--current-word-overlay nil
  "Overlay underlining the word currently displayed in Dict.")

(defvar firstpair-reader--redirecting nil
  "Non-nil while a reference may be redirected to another window.")

(defvar firstpair-reader-mode)

;;; Windows

(defun firstpair-reader--window (role)
  "Return the live window on the selected frame playing ROLE, or nil."
  (seq-find (lambda (window) (eq (window-parameter window 'firstpair-role) role))
            (window-list nil 'no-minibuffer)))

(defun firstpair-reader--role (&optional buffer)
  "Return the role BUFFER plays: `reader', `references', or nil."
  (with-current-buffer (or buffer (current-buffer))
    (let ((bundle (firstpair-bundle-current)))
      (when bundle
        (let ((manual (firstpair-bundle-manual)))
          (cond ((equal manual (firstpair-bundle-reader bundle)) 'reader)
                ((equal manual (firstpair-bundle-reference bundle)) 'references)))))))

(defun firstpair-reader--claim (window role)
  "Record that WINDOW plays ROLE and return it."
  (set-window-parameter window 'firstpair-role role)
  window)

(defun firstpair-reader--split (anchor lines)
  "Split ANCHOR to make a window of LINES below it, or return nil."
  (condition-case nil
      (split-window anchor (- (max lines window-min-height)) 'below)
    (error nil)))

(defun firstpair-reader--borrow-window (window role)
  "Temporarily assign WINDOW to ROLE, remembering what it displayed."
  (set-window-parameter window 'firstpair-borrowed-role
                        (window-parameter window 'firstpair-role))
  (set-window-parameter window 'firstpair-borrowed-buffer (window-buffer window))
  (set-window-parameter window 'firstpair-borrowed-start (window-start window))
  (set-window-parameter window 'firstpair-borrowed-point (window-point window))
  (set-window-parameter window 'firstpair-borrowed-hscroll (window-hscroll window))
  (firstpair-reader--claim window role))

(defun firstpair-reader--restore-borrowed-window (window)
  "Restore WINDOW after `firstpair-reader--borrow-window'.
Return non-nil when WINDOW had a saved role."
  (let ((role (window-parameter window 'firstpair-borrowed-role)))
    (when role
      (let* ((saved (window-parameter window 'firstpair-borrowed-buffer))
             (buffer (if (buffer-live-p saved)
                         saved
                       (get-buffer-create firstpair-reader-references-buffer)))
             (start (window-parameter window 'firstpair-borrowed-start))
             (point (window-parameter window 'firstpair-borrowed-point))
             (hscroll (window-parameter window 'firstpair-borrowed-hscroll)))
        (set-window-buffer window buffer)
        (firstpair-reader--claim window role)
        (with-current-buffer buffer
          (set-window-point window (min (or point (point-min)) (point-max)))
          (set-window-start window (min (or start (point-min)) (point-max)) t))
        (set-window-hscroll window (or hscroll 0))
        (dolist (parameter '(firstpair-borrowed-role firstpair-borrowed-buffer
                             firstpair-borrowed-start firstpair-borrowed-point
                             firstpair-borrowed-hscroll))
          (set-window-parameter window parameter nil)))
      t)))

(defun firstpair-reader--references-at-top-p (window)
  "Return non-nil when WINDOW shows the references manual's idle Top node."
  (and (window-live-p window)
       (eq (window-parameter window 'firstpair-role) 'references)
       (with-current-buffer (window-buffer window)
         (and (derived-mode-p 'Info-mode)
              (equal Info-current-node "Top")))))

(defun firstpair-reader--ensure-window (role)
  "Return a window for ROLE, creating it below the reader when needed."
  (or (firstpair-reader--window role)
      (pcase role
        ('reader (firstpair-reader--claim (selected-window) 'reader))
        ('references
         (let* ((anchor (or (firstpair-reader--window 'reader) (selected-window)))
                (window (firstpair-reader--split
                         anchor
                         (round (* (window-height anchor) firstpair-reader-references-height))))
                (borrowed (seq-find
                           (lambda (candidate)
                             (eq (window-parameter candidate 'firstpair-borrowed-role)
                                 'references))
                           (window-list nil 'no-minibuffer))))
           (cond (window (firstpair-reader--claim window 'references))
                 (borrowed
                  (firstpair-reader--restore-borrowed-window borrowed)
                  borrowed)
                 (t (user-error "Frame is too small for the references window")))))
        ('lexicon
         (let* ((references (firstpair-reader--window 'references))
                (reader (firstpair-reader--window 'reader))
                (replace-references (firstpair-reader--references-at-top-p references))
                ;; Start at the smallest ordinary window, then fit the rendered
                ;; headword and senses.  Requesting the expanded maximum here
                ;; can make an otherwise viable phone split fail.
                (window (and (not replace-references)
                             (or (and references
                                      (firstpair-reader--split references window-min-height))
                                 (and reader
                                      (firstpair-reader--split reader window-min-height))))))
           (cond (replace-references
                  (firstpair-reader--borrow-window references 'lexicon))
                 (window (firstpair-reader--claim window 'lexicon))
                 ;; On the smallest frames, lend the references pane to the
                 ;; dictionary and restore it when Close is tapped.
                 (references (firstpair-reader--borrow-window references 'lexicon))
                 (t (user-error "Frame is too small for the dictionary window"))))))))

(defun firstpair-reader--fit-lexicon-window (&optional window)
  "Fit the dictionary WINDOW to its body, up to its configured maximum.
When WINDOW is nil, use the window currently playing the lexicon role."
  (let ((target (or window (firstpair-reader--window 'lexicon))))
    (when (and (window-live-p target)
               (eq (window-parameter target 'firstpair-role) 'lexicon))
      (condition-case nil
          (progn
            (with-current-buffer (window-buffer target)
              (set-window-point target (point-min))
              (set-window-start target (point-min) t))
            (fit-window-to-buffer target
                                  (max firstpair-reader-lexicon-height window-safe-min-height)
                                  window-safe-min-height))
        (error nil)))))

(defun firstpair-reader--show (buffer role &optional select)
  "Display BUFFER in the ROLE window and return that window.
Select the window when SELECT is non-nil."
  (let ((window (firstpair-reader--ensure-window role)))
    (unless (eq (window-buffer window) buffer)
      (set-window-buffer window buffer))
    (when (eq role 'lexicon)
      (firstpair-reader--fit-lexicon-window window))
    (when select (select-window window))
    window))

;;; Info buffers

(defun firstpair-reader--info-buffer (role)
  "Return the Info buffer for ROLE, creating it if needed."
  (get-buffer-create (if (eq role 'references)
                         firstpair-reader-references-buffer
                       firstpair-reader-buffer)))

(defun firstpair-reader--goto (role nodename)
  "Show NODENAME in the ROLE window's Info buffer and return that window."
  (let* ((buffer (firstpair-reader--info-buffer role))
         (window (firstpair-reader--show buffer role)))
    (with-selected-window window
      (with-current-buffer buffer
        (let ((firstpair-reader--redirecting nil))
          (unless (derived-mode-p 'Info-mode) (Info-mode))
          (Info-goto-node nodename))))
    window))

(defun firstpair-reader--parse-target (nodename)
  "Return (MANUAL . NODE) when NODENAME is written as \"(manual)node\"."
  (when (string-match "\\`(\\([^)]+\\))\\(.*\\)\\'" nodename)
    (cons (file-name-base (match-string 1 nodename)) (match-string 2 nodename))))

(defun firstpair-reader--node (bundle manual node)
  "Return an Info node name for NODE of MANUAL addressed by its file in BUNDLE.
Addressing the file rather than the manual name keeps two editions of one
book apart when both are registered."
  (format "(%s)%s" (firstpair-bundle-info-file bundle manual) node))

(defun firstpair-reader--target-bundle (manual)
  "Return the bundle a reference to MANUAL means: the current one when it owns it."
  (let ((current (firstpair-bundle-current)))
    (if (and current
             (member manual (list (firstpair-bundle-reader current)
                                  (firstpair-bundle-reference current))))
        current
      (firstpair-bundle-for-manual manual))))

(defun firstpair-reader--redirect (nodename)
  "Return (ROLE . NODENAME) when NODENAME should open in another window, else nil.
The returned NODENAME addresses the manual by file inside its bundle."
  (let* ((target (firstpair-reader--parse-target nodename))
         (bundle (and target (firstpair-reader--target-bundle (car target)))))
    (when bundle
      (let ((role (if (equal (car target) (firstpair-bundle-reference bundle))
                      'references
                    'reader)))
        (unless (eq role (firstpair-reader--role))
          (cons role (firstpair-reader--node bundle (car target) (cdr target))))))))

(defun firstpair-reader--goto-node-advice (original nodename &rest arguments)
  "Open NODENAME in the window its manual belongs to while a reader command runs.
ORIGINAL is `Info-goto-node'; ARGUMENTS are passed through to it."
  (let ((redirect (and firstpair-reader--redirecting
                       (firstpair-reader--redirect nodename))))
    (if redirect
        (firstpair-reader--goto (car redirect) (cdr redirect))
      (apply original nodename arguments))))

;;; Marked words

(defun firstpair-reader--unmark ()
  "Remove every overlay this mode placed in the current buffer."
  (mapc #'delete-overlay firstpair-reader--overlays)
  (setq firstpair-reader--overlays nil))

(defun firstpair-reader--locate (entry)
  "Return (START . END) of the marked word ENTRY in the current node, or nil.
The builder records the line and column of every marked word; when Info's
rendering has moved the text, the word is found again on the same line."
  (save-excursion
    (goto-char (point-min))
    (when (zerop (forward-line (1- (plist-get entry :line))))
      (let* ((start (+ (point) (plist-get entry :column)))
             (end (+ start (plist-get entry :length)))
             (form (plist-get entry :form))
             (bundle (firstpair-bundle-current))
             (limit (line-end-position)))
        (if (and (<= end limit)
                 (equal (firstpair-lexicon-normalise (buffer-substring-no-properties start end) bundle)
                        form))
            (cons start end)
          (let (found)
            (while (and (not found) (re-search-forward "[[:alpha:]]+" limit t))
              (when (equal (firstpair-lexicon-normalise (match-string-no-properties 0) bundle) form)
                (setq found (cons (match-beginning 0) (match-end 0)))))
            found))))))

(defun firstpair-reader--help-echo (_window overlay _position)
  "Return the gloss for the marked word under OVERLAY."
  (or (firstpair-lexicon-gloss (overlay-get overlay 'firstpair-bundle)
                               (buffer-substring-no-properties
                                (overlay-start overlay) (overlay-end overlay)))
      "No dictionary entry"))

(defun firstpair-reader--mark (bundle)
  "Underline the words of the current node that BUNDLE's lexicon explains."
  (firstpair-reader--unmark)
  (when firstpair-reader-highlight
    (dolist (entry (firstpair-bundle-marked-words bundle (firstpair-bundle-manual) Info-current-node))
      (let ((region (firstpair-reader--locate entry)))
        (when region
          (let ((overlay (make-overlay (car region) (cdr region))))
            (overlay-put overlay 'firstpair-marked entry)
            (overlay-put overlay 'firstpair-bundle bundle)
            (overlay-put overlay 'face 'firstpair-reader-marked)
            (overlay-put overlay 'help-echo #'firstpair-reader--help-echo)
            (overlay-put overlay 'evaporate t)
            (push overlay firstpair-reader--overlays)))))
    (setq firstpair-reader--overlays
          (sort firstpair-reader--overlays
                (lambda (a b) (< (overlay-start a) (overlay-start b)))))))

(defface firstpair-reader-emphasis
  '((t :inherit italic))
  "Face for text the manual marks with underscores, Info's emphasis.")

(defun firstpair-reader--fontify-emphasis ()
  "Show Info's _emphasis_ as italics, hiding the underscores.
Older Emacs did this itself; current Info leaves the underscores in place."
  (save-excursion
    (goto-char (point-min))
    (while (re-search-forward "\\(?:^\\|[[:space:](\"“‘]\\)\\(_\\)\\([^_[:space:]][^_]\\{0,200\\}?[^_[:space:]]\\|[^_[:space:]]\\)\\(_\\)\\(?:$\\|[[:space:][:punct:]]\\)" nil t)
      (let ((open (match-beginning 1)) (close (match-beginning 3))
            (start (match-beginning 2)) (end (match-end 2)))
        (unless (string-match-p "\n[ \t]*\n" (buffer-substring-no-properties start end))
          (dolist (bounds (list (cons open (1+ open)) (cons close (1+ close))))
            (let ((overlay (make-overlay (car bounds) (cdr bounds))))
              (overlay-put overlay 'invisible t)
              (overlay-put overlay 'evaporate t)
              (push overlay firstpair-reader--overlays)))
          (let ((overlay (make-overlay start end)))
            (overlay-put overlay 'face 'firstpair-reader-emphasis)
            (overlay-put overlay 'evaporate t)
            (push overlay firstpair-reader--overlays)))
        (goto-char (max (point) (1+ close)))))))

(defun firstpair-reader--tidy-references (bundle)
  "Hide the manual name Info leaves visible in references to BUNDLE's manuals."
  (save-excursion
    (goto-char (point-min))
    (let ((manuals (list (firstpair-bundle-reader bundle) (firstpair-bundle-reference bundle))))
      (while (re-search-forward "\\*note[ \t\n]+[^:*]+:[ \t\n]*\\((\\([^)]+\\))\\)" nil t)
        (when (member (match-string-no-properties 2) manuals)
          (let ((overlay (make-overlay (match-beginning 1) (match-end 1))))
            (overlay-put overlay 'invisible t)
            (overlay-put overlay 'evaporate t)
            (push overlay firstpair-reader--overlays)))))))

(defvar firstpair-reader-translation-selections nil
  "Alist of language id to the ordered list of translation ids it shows.
A language without an entry shows its default translation.")

(defvar firstpair-reader-language-order nil
  "Translation language ids in the order their blocks appear on screen.
Languages not listed follow, in the edition's declared order.")

(defun firstpair-reader--page-part (bundle)
  "Return the part (cantica, chapter group) of the current node, or nil."
  (let ((page (firstpair-bundle-page bundle Info-current-node)))
    (and page (alist-get 'part page))))

(defun firstpair-reader--covers-p (translation part)
  "Non-nil when TRANSLATION covers PART (or declares no coverage)."
  (let ((coverage (alist-get 'coverage translation)))
    (or (null coverage) (null part) (seq-contains-p (append coverage nil) part #'equal))))

(defun firstpair-reader--candidates (bundle lang &optional exclude)
  "The translations of LANG that cover the current page, EXCLUDE apart."
  (let ((part (firstpair-reader--page-part bundle)))
    (seq-filter (lambda (item)
                  (and (not (equal (alist-get 'id item) exclude))
                       (firstpair-reader--covers-p item part)))
                (firstpair-bundle-translations-of bundle lang))))

(defun firstpair-reader--ordered-languages (bundle)
  "Return BUNDLE's selected translation languages in display order."
  (let ((selected (firstpair-lexicon-selected bundle)))
    (append
     (delq nil (mapcar (lambda (lang)
                         (seq-find (lambda (item) (equal (alist-get 'id item) lang))
                                   selected))
                       firstpair-reader-language-order))
     (seq-remove (lambda (item)
                   (member (alist-get 'id item) firstpair-reader-language-order))
                 selected))))

(defun firstpair-reader--effective-translations (bundle lang)
  "Return the ordered translation ids LANG shows on the current page.
Selected ids that do not cover this part are skipped; when none remain,
the language's default (or first) covering edition fills in, so a page
never goes blank."
  (let* ((items (firstpair-reader--candidates bundle lang))
         (ids (mapcar (lambda (item) (alist-get 'id item)) items))
         (chosen (alist-get lang firstpair-reader-translation-selections nil nil #'equal))
         (effective (seq-filter (lambda (id) (member id ids)) chosen)))
    (or effective
        (let ((pick (or (seq-find (lambda (item) (eq (alist-get 'default item) t)) items)
                        (car items))))
          (and pick (list (alist-get 'id pick)))))))

(defun firstpair-reader-translation-for (bundle lang &optional exclude)
  "Return the first translation id shown for LANG in BUNDLE, EXCLUDE apart."
  (car (remove exclude (firstpair-reader--effective-translations bundle lang))))

(defun firstpair-reader--shown-translations (bundle)
  "Return the translation ids on screen, languages and editions in display order."
  (apply #'append
         (mapcar (lambda (language)
                   (firstpair-reader--effective-translations bundle (alist-get 'id language)))
                 (firstpair-reader--ordered-languages bundle))))

;;; Regions: cached per node, and reordered bodily in the buffer

(defvar-local firstpair-reader--subfile-generation 0
  "Bumped whenever Info re-reads this buffer's file, invalidating regions.")

(defvar-local firstpair-reader--node-regions nil
  "Alist of node name to (GENERATION . REGIONS) with buffer-true line numbers.")

(defun firstpair-reader--note-file-read (&rest _arguments)
  "Record that Info replaced the buffer text with freshly read pristine bytes."
  (setq firstpair-reader--subfile-generation (1+ firstpair-reader--subfile-generation))
  (setq firstpair-reader--node-regions nil))

(defun firstpair-reader--regions (bundle)
  "Return the current node's region rows, with reorder-corrected lines.
The rows are cached copies whose :start and :end follow the buffer as
`firstpair-reader--order-regions' moves translation blocks."
  (let ((cached (assoc Info-current-node firstpair-reader--node-regions)))
    (if (and cached (equal (cadr cached) firstpair-reader--subfile-generation))
        (cddr cached)
      (let ((regions (mapcar #'copy-sequence
                             (firstpair-bundle-regions-for-node
                              bundle (firstpair-bundle-manual) Info-current-node))))
        (setq firstpair-reader--node-regions
              (cons (cons Info-current-node
                          (cons firstpair-reader--subfile-generation regions))
                    (assoc-delete-all Info-current-node firstpair-reader--node-regions)))
        regions))))

(defun firstpair-reader--region-lines (region)
  "Return REGION's buffer text as a list of its lines."
  (save-excursion
    (goto-char (point-min))
    (forward-line (1- (plist-get region :start)))
    (let (lines)
      (dotimes (_ (1+ (- (plist-get region :end) (plist-get region :start))))
        (push (buffer-substring (point) (line-end-position)) lines)
        (forward-line 1))
      (nreverse lines))))

(defun firstpair-reader--contiguous-blocks-p (blocks)
  "Non-nil when BLOCKS follow one another separated by single blank lines."
  (let ((ok t) previous)
    (dolist (region blocks ok)
      (when (and previous
                 (/= (plist-get region :start) (+ (plist-get previous :end) 2)))
        (setq ok nil))
      (setq previous region))))

(defun firstpair-reader--desired-block-order (bundle blocks)
  "Sort a unit's translation BLOCKS by language block and edition order."
  (let* ((languages (mapcar (lambda (item) (alist-get 'id item))
                            (firstpair-reader--ordered-languages bundle)))
         (rank (lambda (region)
                 (let* ((id (plist-get region :language))
                        (item (firstpair-bundle-translation bundle id))
                        (lang (and item (alist-get 'lang item)))
                        (block (or (and lang (seq-position languages lang))
                                   (length languages)))
                        (ids (and lang (firstpair-reader--effective-translations bundle lang)))
                        (slot (or (seq-position ids id) (length ids))))
                   (list block slot (plist-get region :start))))))
    (sort (copy-sequence blocks)
          (lambda (a b)
            (let ((ra (funcall rank a)) (rb (funcall rank b)))
              (or (< (nth 0 ra) (nth 0 rb))
                  (and (= (nth 0 ra) (nth 0 rb))
                       (or (< (nth 1 ra) (nth 1 rb))
                           (and (= (nth 1 ra) (nth 1 rb))
                                (< (nth 2 ra) (nth 2 rb)))))))))))

(defun firstpair-reader--order-regions (bundle)
  "Rearrange each unit's translation blocks into the chosen display order.
Blocks move bodily within their unit — the source lines never move, so
the lexicon's marked positions stay exact.  The rows returned by
`firstpair-reader--regions' are updated in place.  A unit whose blocks
are not separated by single blank lines is left untouched."
  (when (and (firstpair-bundle-translations bundle)
             (equal (firstpair-bundle-manual) (firstpair-bundle-reader bundle)))
    (let ((units (make-hash-table :test #'equal))
          (order nil))
      (dolist (region (firstpair-reader--regions bundle))
        (unless (plist-get region :source)
          (let ((unit (plist-get region :unit)))
            (unless (gethash unit units) (push unit order))
            (push region (gethash unit units)))))
      (let ((inhibit-read-only t))
        (dolist (unit (nreverse order))
          (let* ((blocks (sort (gethash unit units)
                               (lambda (a b)
                                 (< (plist-get a :start) (plist-get b :start)))))
                 (desired (firstpair-reader--desired-block-order bundle blocks)))
            (when (and (cdr blocks)
                       (not (equal blocks desired))
                       (firstpair-reader--contiguous-blocks-p blocks))
              (let ((texts (mapcar (lambda (region)
                                     (cons region (firstpair-reader--region-lines region)))
                                   desired))
                    (line (plist-get (car blocks) :start)))
                (save-excursion
                  (goto-char (point-min))
                  (forward-line (1- line))
                  (let ((start (point)))
                    (goto-char (point-min))
                    (forward-line (plist-get (car (last blocks)) :end))
                    (delete-region start (point))
                    (goto-char start)
                    (insert (mapconcat (lambda (pair)
                                         (mapconcat #'identity (cdr pair) "\n"))
                                       texts "\n\n")
                            "\n")))
                (dolist (pair texts)
                  (let ((region (car pair))
                        (size (length (cdr pair))))
                    (plist-put region :start line)
                    (plist-put region :end (+ line size -1))
                    (setq line (+ line size 1))))))))))))

(defun firstpair-reader--header-command (action lang id)
  "Return a stable named command for header-row ACTION on LANG and ID."
  (let ((command (intern (format "firstpair-reader-header-%s-%s-%s"
                                 action lang (or id "none")))))
    (fset command
          `(lambda ()
             ,(format "Header row control: %s %s %s." action lang (or id ""))
             (interactive)
             (cond ((eq ',action 'first) (firstpair-reader-language-first ,lang))
                   ((eq ',action 'earlier)
                    (firstpair-reader-move-translation-earlier ,lang ,id))
                   (t (firstpair-reader-toggle-language-translation ,lang ,id)))))
    command))

(defun firstpair-reader--translation-header-line ()
  "The active editions, grouped by language — the row that controls them.
Tap a language tag to show its block first, ◀ to move an edition one
step earlier within its language, and an edition's name to hide it."
  (let ((bundle (firstpair-bundle-current)))
    (when (and bundle (firstpair-bundle-translations bundle))
      (let ((segments nil) (any nil))
        (dolist (language (firstpair-reader--ordered-languages bundle))
          (let* ((lang (alist-get 'id language))
                 (ids (firstpair-reader--effective-translations bundle lang)))
            (when ids
              (setq segments
                    (append segments
                            (list (if any " | " " ")
                                  (firstpair-reader--button
                                   (upcase lang)
                                   (firstpair-reader--header-command 'first lang nil)
                                   "Show this language's block first"))))
              (setq any t)
              (let ((first t))
                (dolist (id ids)
                  (setq segments
                        (append segments
                                (list " ")
                                (unless first
                                  (list (firstpair-reader--button
                                         "◀"
                                         (firstpair-reader--header-command 'earlier lang id)
                                         "Move this edition one step earlier")))
                                (list (firstpair-reader--button
                                       (firstpair-reader--translation-short-title bundle id)
                                       (firstpair-reader--header-command 'hide lang id)
                                       "Hide this edition"))))
                  (setq first nil))))))
        (if any (cons "" (append segments (list " "))) " None ")))))

(defun firstpair-reader--apply-regions (bundle)
  "Hide the translation regions of the current node that are not shown.
A region shows when its translation is among the ids selected for a
visible language (see `firstpair-reader--effective-translations').
Bundles without a translation table select by language id, the
dictionary's choice."
  (let ((chosen (if (firstpair-bundle-translations bundle)
                    (firstpair-reader--shown-translations bundle)
                  (mapcar (lambda (item) (alist-get 'id item)) (firstpair-lexicon-selected bundle)))))
    (dolist (region (firstpair-reader--regions bundle))
      (unless (or (plist-get region :source) (member (plist-get region :language) chosen))
        (save-excursion
          (goto-char (point-min))
          (when (zerop (forward-line (1- (plist-get region :start))))
            (let ((start (point)))
              (forward-line (1+ (- (plist-get region :end) (plist-get region :start))))
              ;; Swallow the blank line that separates this region from the next.
              (when (and (not (eobp)) (looking-at-p "^$")) (forward-line 1))
              (let ((overlay (make-overlay start (point))))
                (overlay-put overlay 'invisible t)
                (overlay-put overlay 'firstpair-region region)
                (overlay-put overlay 'evaporate t)
                (push overlay firstpair-reader--overlays)))))))))

(defun firstpair-reader-refresh-regions ()
  "Apply the translation selection and order to every open reader buffer."
  (dolist (buffer (buffer-list))
    (with-current-buffer buffer
      (when (and firstpair-reader-mode (firstpair-bundle-current))
        (let ((bundle (firstpair-bundle-current)))
          (firstpair-reader--order-regions bundle)
          (firstpair-reader--mark bundle)
          (firstpair-reader--fontify-emphasis)
          (when Info-hide-note-references
            (firstpair-reader--tidy-references bundle))
          (firstpair-reader--apply-regions bundle)
          (force-mode-line-update t))))))

(defun firstpair-reader--marked-overlays ()
  "Return the overlays that mark dictionary words, in buffer order."
  (seq-filter (lambda (overlay) (overlay-get overlay 'firstpair-marked))
              firstpair-reader--overlays))

(defun firstpair-reader--overlay-at (position)
  "Return the marked-word overlay covering POSITION, or nil."
  (seq-find (lambda (overlay)
              (and (<= (overlay-start overlay) position) (< position (overlay-end overlay))))
            (firstpair-reader--marked-overlays)))

(defun firstpair-reader--clear-current-word ()
  "Remove the current dictionary-word underline from this reader buffer."
  (when (overlayp firstpair-reader--current-word-overlay)
    (delete-overlay firstpair-reader--current-word-overlay))
  (setq firstpair-reader--current-word-overlay nil))

(defun firstpair-reader--underline-current-word (bundle word)
  "Underline WORD at the reader point for BUNDLE."
  (let ((window (firstpair-reader--window 'reader)))
    (when (window-live-p window)
      (with-current-buffer (window-buffer window)
        (firstpair-reader--clear-current-word)
        (save-excursion
          (goto-char (window-point window))
          (let* ((marked (firstpair-reader--overlay-at (point)))
                 (bounds (if marked
                             (cons (overlay-start marked) (overlay-end marked))
                           (bounds-of-thing-at-point 'word))))
            (when (and bounds
                       (equal (firstpair-lexicon-normalise
                               (buffer-substring-no-properties
                                (car bounds) (cdr bounds))
                               bundle)
                              (firstpair-lexicon-normalise word bundle)))
              (setq firstpair-reader--current-word-overlay
                    (make-overlay (car bounds) (cdr bounds) (current-buffer)))
              (overlay-put firstpair-reader--current-word-overlay
                           'face 'firstpair-reader-current-word)
              (overlay-put firstpair-reader--current-word-overlay 'priority 1000)
              (overlay-put firstpair-reader--current-word-overlay 'evaporate t))))))))

(defun firstpair-reader--after-select ()
  "Enable the reader in Info buffers that belong to a registered bundle."
  (let ((bundle (firstpair-bundle-current)))
    (cond (bundle
           (unless firstpair-reader-mode (firstpair-reader-mode 1))
           (when (equal (firstpair-bundle-manual)
                        (firstpair-bundle-reader bundle))
             (firstpair-reader--clear-current-word))
           (firstpair-reader--order-regions bundle)
           (firstpair-reader--mark bundle)
           (firstpair-reader--fontify-emphasis)
           (when Info-hide-note-references
             (firstpair-reader--tidy-references bundle))
           (firstpair-reader--apply-regions bundle)
           (firstpair-reader--install-translation-header bundle)
           (firstpair-reader--apply-touch bundle)
           (ignore-errors (firstpair-reader-save-state)))
          (firstpair-reader-mode
           (firstpair-reader-mode -1)))))

;;; Resuming

(defvar firstpair-reader--setting-up nil
  "Non-nil while `firstpair-read' opens a bundle: node changes then are not saved.")

(defvar firstpair-reader--states nil
  "Saved reading states by bundle root, from `firstpair-reader-state-file'.")

(defun firstpair-reader--load-states ()
  "Read `firstpair-reader-state-file' once."
  (unless firstpair-reader--states
    (setq firstpair-reader--states
          (or (and (file-readable-p firstpair-reader-state-file)
                   (with-temp-buffer
                     (insert-file-contents firstpair-reader-state-file)
                     (condition-case nil (read (current-buffer)) (error nil))))
              (list 'firstpair-reader-states))))
  firstpair-reader--states)

(defun firstpair-reader--state-of (bundle)
  "The saved state of BUNDLE, or nil."
  (cdr (assoc (firstpair-reader--state-key bundle)
              (cdr (firstpair-reader--load-states)))))

(defun firstpair-reader--state-key (bundle)
  "The key BUNDLE is remembered under: its true directory, symlinks resolved."
  (directory-file-name (file-truename (firstpair-bundle-root bundle))))

(defun firstpair-reader-save-state ()
  "Remember where reading stopped in the current bundle, and what was shown."
  (interactive)
  (let ((bundle (firstpair-bundle-current)))
    (when (and firstpair-reader-resume bundle firstpair-reader-mode (not firstpair-reader--setting-up)
               (equal (firstpair-bundle-manual) (firstpair-bundle-reader bundle))
               Info-current-node)
      (let* ((key (firstpair-reader--state-key bundle))
             (state (list :node Info-current-node :point (point)
                          :languages firstpair-lexicon-languages
                          :selections firstpair-reader-translation-selections
                          :language-order firstpair-reader-language-order
                          :saved (format-time-string "%FT%T%z")))
             (states (firstpair-reader--load-states)))
        (setf (alist-get key (cdr states) nil nil #'equal) state)
        (with-temp-file firstpair-reader-state-file
          (insert ";; FirstPair Reader: where each bundle was left. Generated; edit freely.\n")
          (pp states (current-buffer)))))))

(defun firstpair-reader--resume (bundle)
  "Return to the saved place in BUNDLE, if any; non-nil when it did."
  (let ((state (and firstpair-reader-resume (firstpair-reader--state-of bundle))))
    (when state
      (when (plist-get state :languages) (setq firstpair-lexicon-languages (plist-get state :languages)))
      (setq firstpair-reader-translation-selections
            (or (plist-get state :selections)
                (let (selections)
                  (dolist (pair (plist-get state :choices) (nreverse selections))
                    (push (cons (car pair)
                                (delq nil
                                      (list (cdr pair)
                                            (alist-get (car pair) (plist-get state :seconds)
                                                       nil nil #'equal))))
                          selections))))
            firstpair-reader-language-order (plist-get state :language-order))
      (condition-case nil
          (progn
            (firstpair-reader--goto 'reader (firstpair-reader--node bundle (firstpair-bundle-reader bundle) (plist-get state :node)))
            (with-selected-window (firstpair-reader--ensure-window 'reader)
              (goto-char (min (max (or (plist-get state :point) 1) (point-min)) (point-max)))
              (firstpair-reader-refresh-regions)))
        (error nil))
      t)))

(defvar firstpair-reader--save-timer nil)

(defun firstpair-reader--arm-save ()
  "Save the reading state when Emacs has been idle a few seconds."
  (unless firstpair-reader--save-timer
    (setq firstpair-reader--save-timer
          (run-with-idle-timer 5 t (lambda () (ignore-errors (firstpair-reader-save-state)))))))

(add-hook 'kill-emacs-hook (lambda () (ignore-errors (firstpair-reader-save-state))))

;;; Commands

(defun firstpair-reader--bundle ()
  "Return the bundle of the current buffer or signal a user error."
  (or (firstpair-bundle-current)
      (user-error "This buffer is not part of a FirstPair bundle")))

(defun firstpair-reader-follow-nearest-node (&optional fork)
  "Follow the reference or menu item at point.
References into the book's other manual open in that manual's window.
FORK is passed to `Info-follow-nearest-node'."
  (interactive "P")
  (let ((firstpair-reader--redirecting t))
    (Info-follow-nearest-node fork)))

(defun firstpair-reader-mouse-follow-nearest-node (click)
  "Follow the reference or menu item under CLICK.
See `firstpair-reader-follow-nearest-node'."
  (interactive "e")
  (let ((firstpair-reader--redirecting t))
    (Info-mouse-follow-nearest-node click)))

(defun firstpair-reader-follow-reference ()
  "Follow a cross-reference chosen by name, as `Info-follow-reference'."
  (interactive)
  (let ((firstpair-reader--redirecting t))
    (call-interactively #'Info-follow-reference)))

(defun firstpair-reader--link-at-point-p ()
  "Return non-nil when point is on an Info note or menu item."
  (or (get-text-property (point) 'link-args)
      (and (> (point) (point-min))
           (get-text-property (1- (point)) 'link-args))
      (button-at (point))
      (and (> (point) (point-min)) (button-at (1- (point))))
      (Info-get-token (point) "\\*note[ \n\t]+"
                      "\\*note[ \n\t]+\\([^:]*\\):\\(:\\|[ \n\t]*\\(([^)]*)\\|[^.,;\n]*\\)[.,;]\\)")
      (Info-get-token (point) "\\* +" "\\* +\\([^:]*\\):")))

(defun firstpair-reader-return ()
  "Follow a link, or advance through the poem and look up its next word.
RET keeps ordinary Info behavior on links and in the references manual.  In
an aligned source node away from a link, it performs the same action as
Next ▶."
  (interactive)
  (if (and (eq (firstpair-reader--role) 'reader)
           (not (firstpair-reader--link-at-point-p))
           (firstpair-reader--source-node-p (firstpair-reader--bundle)))
      (firstpair-reader-next-marked-lookup)
    (firstpair-reader-follow-nearest-node)))

(defun firstpair-reader-describe-word (&optional word)
  "Show the dictionary entry for WORD, by default the word at point.
The entry replaces an idle references Top pane, or opens below an active
source-reference pane."
  (interactive)
  (let* ((bundle (firstpair-reader--bundle))
         (overlay (firstpair-reader--overlay-at (point)))
         (word (or word
                   (and overlay (buffer-substring-no-properties
                                 (overlay-start overlay) (overlay-end overlay)))
                   (thing-at-point 'word t)
                   (read-string "Look up word: "))))
    (let ((buffer (firstpair-lexicon-render bundle word)))
      (firstpair-reader--underline-current-word bundle word)
      (firstpair-reader--show buffer 'lexicon)
      (when firstpair-reader-touch
        (with-current-buffer buffer
          (setq mode-line-format (firstpair-reader--dictionary-bar)))))
    word))

(defun firstpair-reader--source-node-p (bundle)
  "Return non-nil when the current node of BUNDLE has source regions."
  (seq-some (lambda (region) (plist-get region :source))
            (firstpair-reader--regions bundle)))

(defun firstpair-reader--source-spans (bundle)
  "Buffer spans (START . END) of the source-language regions of the current node."
  (let (spans)
    (dolist (region (firstpair-reader--regions bundle) (nreverse spans))
      (when (plist-get region :source)
        (save-excursion
          (goto-char (point-min))
          (when (zerop (forward-line (1- (plist-get region :start))))
            (let ((start (point)))
              (forward-line (1+ (- (plist-get region :end) (plist-get region :start))))
              (push (cons start (point)) spans))))))))

(defun firstpair-reader--source-word-at-point (bundle)
  "Return the source-language word at point in BUNDLE, or nil."
  (let ((bounds (bounds-of-thing-at-point 'word)))
    (when (and bounds
               (firstpair-reader--in-spans-p
                (car bounds) (firstpair-reader--source-spans bundle)))
      (buffer-substring-no-properties (car bounds) (cdr bounds)))))

(defun firstpair-reader--lookup-source-word-at-point (bundle)
  "Update the dictionary for BUNDLE's source word at point without prompting."
  (let ((word (firstpair-reader--source-word-at-point bundle)))
    (when word
      (firstpair-reader-describe-word word)
      word)))

(defun firstpair-reader--in-spans-p (position spans)
  (seq-some (lambda (span) (and (<= (car span) position) (< position (cdr span)))) spans))

(defun firstpair-reader--move-source-word (forward spans)
  "Move to the next word inside SPANS, or the previous unless FORWARD.
Return non-nil when a word was found."
  (let ((origin (point)) (found nil))
    (save-excursion
      (catch 'done
        (while (if forward (< (point) (point-max)) (> (point) (point-min)))
          (if forward (forward-word 1) (backward-word 1))
          (let ((start (if forward (save-excursion (backward-word 1) (point)) (point))))
            (when (and (/= start origin)
                       (firstpair-reader--in-spans-p start spans)
                       (if forward (> start origin) (< start origin)))
              (setq found start) (throw 'done t))))))
    (when found (goto-char found) t)))

(defun firstpair-reader--move-marked (forward)
  "Move point to the next dictionary word, or the previous one unless FORWARD.
In prose these are the marked words; in an aligned edition they are the
words of the source-language regions, which are all looked up directly."
  (let* ((bundle (firstpair-reader--bundle))
         (spans (firstpair-reader--source-spans bundle))
         (overlays (firstpair-reader--marked-overlays)))
    (if spans
        (unless (firstpair-reader--move-source-word forward spans)
          (user-error (if forward "No further source words in this canto" "No earlier source words in this canto")))
      (let* ((current (firstpair-reader--overlay-at (point)))
             (origin (if current (overlay-start current) (point)))
             (target (if forward
                         (seq-find (lambda (overlay) (> (overlay-start overlay) origin)) overlays)
                       (seq-find (lambda (overlay) (< (overlay-start overlay) origin))
                                 (reverse overlays)))))
        (if target (goto-char (overlay-start target))
          (user-error (if forward "No further marked words" "No earlier marked words")))))))

(defun firstpair-reader-next-marked ()
  "Move to the next word the dictionary window can explain."
  (interactive)
  (firstpair-reader--move-marked t))

(defun firstpair-reader-previous-marked ()
  "Move to the previous word the dictionary window can explain."
  (interactive)
  (firstpair-reader--move-marked nil))

(defun firstpair-reader--significant-word-p ()
  "Return non-nil when the source word at point carries lexical weight."
  (let ((word (downcase (or (thing-at-point 'word t) ""))))
    (and (not (string-empty-p word))
         (not (member word firstpair-reader-significant-stopwords)))))

(defun firstpair-reader--move-significant (forward)
  "Move to the next significant source word, or previous unless FORWARD."
  (let ((origin (point)) found)
    (condition-case nil
        (while (not found)
          (firstpair-reader--move-marked forward)
          (when (firstpair-reader--significant-word-p)
            (setq found t)))
      (user-error
       (goto-char origin)
       (user-error (if forward "No further significant words"
                     "No earlier significant words"))))
    found))

(defun firstpair-reader-next-significant-marked ()
  "Move to the next significant source word."
  (interactive)
  (firstpair-reader--move-significant t))

(defun firstpair-reader-previous-significant-marked ()
  "Move to the previous significant source word."
  (interactive)
  (firstpair-reader--move-significant nil))

(defun firstpair-reader-references ()
  "Choose one of the references quoted in this node and open it below."
  (interactive)
  (let* ((bundle (firstpair-reader--bundle))
         (records (firstpair-bundle-records-for-node bundle Info-current-node)))
    (unless records
      (user-error "Nothing in this node quotes a reference"))
    (let* ((labels (mapcar (lambda (record) (alist-get 'label record)) records))
           (choice (if (cdr labels) (completing-read "Reference: " labels nil t) (car labels)))
           (record (seq-find (lambda (record) (equal (alist-get 'label record) choice)) records)))
      (firstpair-reader--goto 'references
                              (firstpair-reader--node bundle (firstpair-bundle-reference bundle)
                                                      (alist-get 'node record))))))

(defun firstpair-reader-open-file ()
  "Open the file the bundle delivers for the reference shown in this node."
  (interactive)
  (let* ((bundle (firstpair-reader--bundle))
         (record (seq-find (lambda (record) (equal (alist-get 'node record) Info-current-node))
                           (firstpair-bundle-records bundle)))
         (file (and record (alist-get 'file record))))
    (when (or (null file) (string-empty-p file))
      (user-error "This node has no delivered file"))
    (let ((path (expand-file-name file (firstpair-bundle-root bundle))))
      (unless (file-exists-p path)
        (user-error "Missing bundle file: %s" file))
      (with-selected-window (firstpair-reader--ensure-window 'references)
        (if (file-directory-p path) (dired path) (view-file path))))))

(defun firstpair-reader-translation-languages (&optional choose)
  "Cycle the dictionary window's languages: each alone, then all together.
With a prefix argument CHOOSE, pick the languages by name instead.
The choice applies to every lookup, gloss, and glossary until changed."
  (interactive "P")
  (let ((bundle (firstpair-reader--bundle)))
    (message "Translations: %s"
             (if choose
                 (firstpair-lexicon-choose-languages bundle)
               (firstpair-lexicon-cycle-languages bundle)))
    (firstpair-lexicon-refresh)
    (firstpair-reader-refresh-regions)))

(defun firstpair-reader-previous-translation-languages ()
  "Select the previous dictionary and visible-translation language state."
  (interactive)
  (let ((bundle (firstpair-reader--bundle)))
    (message "Translations: %s" (firstpair-lexicon-cycle-languages bundle -1))
    (firstpair-lexicon-refresh)
    (firstpair-reader-refresh-regions)))

(defun firstpair-reader--region-at-point (bundle)
  "Return the aligned region containing point, or nil."
  (let ((line (line-number-at-pos)))
    (seq-find (lambda (region)
                (and (<= (plist-get region :start) line) (<= line (plist-get region :end))))
              (firstpair-reader--regions bundle))))

(defun firstpair-reader--translation-target-at-point (bundle)
  "Return (LANG . ID) for the translation region at point in BUNDLE.
Source and non-aligned text target the first visible language's first
edition."
  (let* ((region (firstpair-reader--region-at-point bundle))
         (translation (and region (not (plist-get region :source))
                           (firstpair-bundle-translation bundle (plist-get region :language))))
         (lang (or (and translation (alist-get 'lang translation))
                   (alist-get 'id (car (firstpair-reader--ordered-languages bundle)))))
         (id (or (and translation (alist-get 'id translation))
                 (and lang (car (firstpair-reader--effective-translations bundle lang))))))
    (cons lang id)))

(defun firstpair-reader--language-at-point (bundle)
  "The translation language to act on at point in BUNDLE."
  (car (firstpair-reader--translation-target-at-point bundle)))

(defun firstpair-reader--translation-title (bundle id)
  "The display title of translation ID, marking approximate alignment."
  (let ((item (firstpair-bundle-translation bundle id)))
    (if (not item) id
      (concat (or (alist-get 'title item) (alist-get 'translator item) id)
              (if (equal (alist-get 'alignment item) "line") "" " ≈")))))

(defun firstpair-reader-translations-label (bundle)
  "Describe the translations on screen, per language and in display order."
  (let ((languages (firstpair-reader--ordered-languages bundle)))
    (if (not languages) "None"
      (mapconcat
       (lambda (language)
         (let* ((lang (alist-get 'id language))
                (ids (firstpair-reader--effective-translations bundle lang)))
           (concat (alist-get 'label language) ": "
                   (if ids
                       (mapconcat (lambda (id)
                                    (firstpair-reader--translation-title bundle id))
                                  ids " + ")
                     "—"))))
       languages "; "))))

(defun firstpair-reader-show-current-translations ()
  "Report the translations currently visible without changing them.
The returned label is also used by the top-level Translations menu."
  (interactive)
  (let* ((bundle (firstpair-reader--bundle))
         (label (if (firstpair-bundle-translations bundle)
                    (firstpair-reader-translations-label bundle)
                  "This edition has no switchable translations")))
    (message "%s" (if (display-graphic-p)
                       (concat "Showing: " label)
                     (firstpair-reader--terminal-translations-summary bundle)))
    label))

(defun firstpair-reader--current-translations-menu-label ()
  "Return the live label for the Translations menu's read-only first item."
  (condition-case nil
      (format "Showing: %s" (let ((inhibit-message t))
                               (firstpair-reader-show-current-translations)))
    (error "Showing: no FirstPair edition")))

(defun firstpair-reader--translations-p ()
  "Non-nil when the active bundle switches between translations."
  (condition-case nil
      (and (firstpair-bundle-translations (firstpair-reader--bundle)) t)
    (error nil)))

(defun firstpair-reader-choose-translation ()
  "Show or hide a translation of the language at point, chosen by name."
  (interactive)
  (firstpair-reader-choose-toggle-translation))

(defun firstpair-reader-choose-translation-languages ()
  "Choose which translation languages are visible by name."
  (interactive)
  (firstpair-reader-translation-languages t))

(defun firstpair-reader--translation-language-visible-p (bundle lang)
  "Return non-nil when BUNDLE currently shows translation language LANG."
  (seq-some (lambda (language) (equal (alist-get 'id language) lang))
            (firstpair-lexicon-selected bundle)))

(defun firstpair-reader--show-translation-language (bundle lang)
  "Add LANG to the visible translation languages of BUNDLE."
  (let ((declared (mapcar (lambda (language) (alist-get 'id language))
                          (firstpair-bundle-translation-languages bundle)))
        (selected (mapcar (lambda (language) (alist-get 'id language))
                          (firstpair-lexicon-selected bundle))))
    (setq firstpair-lexicon-languages
          (seq-filter (lambda (candidate)
                        (or (equal candidate lang) (member candidate selected)))
                      declared))))

(defun firstpair-reader--hide-translation-language (bundle lang)
  "Remove LANG from the visible translation languages of BUNDLE."
  (let ((selected (mapcar (lambda (language) (alist-get 'id language))
                          (firstpair-lexicon-selected bundle))))
    (setq firstpair-lexicon-languages (or (delete lang selected) :none))
    (setq firstpair-reader-translation-selections
          (assoc-delete-all lang firstpair-reader-translation-selections))))

(defun firstpair-reader--after-translation-change (bundle lang)
  "Refresh, persist, and report LANG's editions after a change in BUNDLE."
  (firstpair-reader-refresh-regions)
  (firstpair-lexicon-refresh)
  (ignore-errors (firstpair-reader-save-state))
  (if (display-graphic-p)
      (message "%s" (firstpair-reader-translations-label bundle))
    (firstpair-reader--schedule-terminal-language-feedback bundle lang)))

(defun firstpair-reader-toggle-language-translation (lang id)
  "Show translation ID of LANG when hidden; hide it when on screen.
Hiding the last shown edition hides the language; ID nil hides the
language outright."
  (let* ((bundle (firstpair-reader--bundle))
         (visible (firstpair-reader--translation-language-visible-p bundle lang))
         (effective (and visible (firstpair-reader--effective-translations bundle lang))))
    (cond
     ((null id)
      (firstpair-reader--hide-translation-language bundle lang))
     ((member id effective)
      (let ((rest (remove id effective)))
        (if rest
            (setf (alist-get lang firstpair-reader-translation-selections nil nil #'equal)
                  rest)
          (firstpair-reader--hide-translation-language bundle lang))))
     (t
      (unless (seq-find (lambda (item) (equal (alist-get 'id item) id))
                        (firstpair-reader--candidates bundle lang))
        (user-error "That translation does not cover this part"))
      (unless visible (firstpair-reader--show-translation-language bundle lang))
      (setf (alist-get lang firstpair-reader-translation-selections nil nil #'equal)
            (append effective (list id)))))
    (firstpair-reader--after-translation-change bundle lang)))

(defun firstpair-reader-select-language-translation (lang id)
  "Menu command: toggle edition ID of LANG, or hide LANG when ID is nil."
  (firstpair-reader-toggle-language-translation lang id))

(defun firstpair-reader-language-first (lang)
  "Show translation language LANG's block before the other languages."
  (let* ((bundle (firstpair-reader--bundle))
         (current (mapcar (lambda (item) (alist-get 'id item))
                          (firstpair-reader--ordered-languages bundle))))
    (setq firstpair-reader-language-order (cons lang (delete lang current)))
    (firstpair-reader--after-translation-change bundle lang)))

(defun firstpair-reader-language-first-at-point ()
  "Show the language at point's block before the other languages."
  (interactive)
  (let ((bundle (firstpair-reader--bundle)))
    (firstpair-reader-language-first (firstpair-reader--language-at-point bundle))))

(defun firstpair-reader-move-translation-earlier (lang id)
  "Move edition ID one step earlier among LANG's editions on screen."
  (let* ((bundle (firstpair-reader--bundle))
         (effective (firstpair-reader--effective-translations bundle lang))
         (position (seq-position effective id)))
    (when (and position (> position 0))
      (let ((ids (copy-sequence effective)))
        (setf (nth position ids) (nth (1- position) ids))
        (setf (nth (1- position) ids) id)
        (setf (alist-get lang firstpair-reader-translation-selections nil nil #'equal)
              ids)))
    (firstpair-reader--after-translation-change bundle lang)))

(defun firstpair-reader--translation-language-menu-command (lang id)
  "Return a stable named menu command toggling ID for language LANG.
Terminal-app menu bridges cannot all dispatch anonymous closure commands."
  (let ((command
         (intern (format "firstpair-reader-menu-%s-%s" lang (or id "none")))))
    (fset command
          `(lambda ()
             ,(format "Toggle %s for terminal translation language %s."
                      (or id "None") lang)
             (interactive)
             (firstpair-reader-select-language-translation ,lang ,id)))
    command))

(defun firstpair-reader--translation-language-menu (lang)
  "Build the terminal translation submenu for language LANG.
Every shown edition carries a checked box; selecting an unchecked one
shows it as well, selecting a checked one hides it."
  (let* ((bundle (firstpair-reader--bundle))
         (language (seq-find (lambda (item) (equal (alist-get 'id item) lang))
                             (firstpair-bundle-translation-languages bundle)))
         (visible (firstpair-reader--translation-language-visible-p bundle lang))
         (effective (and visible (firstpair-reader--effective-translations bundle lang)))
         (none-command
          (firstpair-reader--translation-language-menu-command lang nil))
         (entries (list (list none-command 'menu-item "None" none-command
                              :help "Hide this translation language"
                              :button (cons 'radio (not visible))))))
    (dolist (item (firstpair-reader--candidates bundle lang))
      (let* ((id (alist-get 'id item))
             (command
              (firstpair-reader--translation-language-menu-command lang id)))
        (setq entries
              (append entries
                      (list
                       (list command 'menu-item
                             (firstpair-reader--translation-title bundle id)
                             command
                             :help "Show or hide this edition"
                             :button (cons 'checkbox
                                           (and (member id effective) t))))))))
    (append (list 'keymap
                  (format "%s translations"
                          (or (alist-get 'label language) (upcase lang))))
            entries)))

(defun firstpair-reader--terminal-english-menu (_binding)
  "Return the current English translation submenu for a terminal menu bar."
  (firstpair-reader--translation-language-menu "en"))

(defun firstpair-reader--terminal-russian-menu (_binding)
  "Return the current Russian translation submenu for a terminal menu bar."
  (firstpair-reader--translation-language-menu "ru"))

(defun firstpair-reader--translation-language-available-p (lang)
  "Return non-nil when the active bundle declares translation language LANG."
  (condition-case nil
      (seq-some (lambda (item) (equal (alist-get 'id item) lang))
                (firstpair-bundle-translation-languages
                 (firstpair-reader--bundle)))
    (error nil)))

(defun firstpair-reader--translation-short-title (bundle id)
  "Return a compact title for translation ID in BUNDLE."
  (let* ((item (firstpair-bundle-translation bundle id))
         (title (or (and item (alist-get 'title item))
                    (and item (alist-get 'translator item)) id)))
    (string-trim (car (split-string (or title "—") " (" t)))))

(defun firstpair-reader--terminal-translations-summary (bundle)
  "Describe BUNDLE's visible translations compactly enough for a phone."
  (let ((languages (firstpair-reader--ordered-languages bundle)))
    (if (not languages) "None"
      (mapconcat
       (lambda (language)
         (let* ((lang (alist-get 'id language))
                (ids (firstpair-reader--effective-translations bundle lang)))
           (concat (upcase lang) " "
                   (if ids
                       (mapconcat (lambda (id)
                                    (firstpair-reader--translation-short-title bundle id))
                                  ids "+")
                     "—"))))
       languages " | "))))

(defvar firstpair-reader--terminal-translation-feedback nil
  "Translation feedback waiting for the current TTY menu command to finish.")

(defun firstpair-reader--show-terminal-translation-feedback ()
  "Show and clear translation feedback queued by a TTY menu command."
  (when firstpair-reader--terminal-translation-feedback
    (let ((label firstpair-reader--terminal-translation-feedback))
      (setq firstpair-reader--terminal-translation-feedback nil)
      (remove-hook 'post-command-hook
                   #'firstpair-reader--show-terminal-translation-feedback)
      (message "%s" label))))

(defun firstpair-reader--schedule-terminal-language-feedback (bundle lang &optional _id)
  "Keep LANG's shown edition list visible after a TTY menu tap."
  (let* ((language (seq-find (lambda (row) (equal (alist-get 'id row) lang))
                             (firstpair-bundle-translation-languages bundle)))
         (ids (and (firstpair-reader--translation-language-visible-p bundle lang)
                   (firstpair-reader--effective-translations bundle lang)))
         (label (format "%s: %s"
                        (or (alist-get 'label language) (upcase lang))
                        (if ids
                            (mapconcat (lambda (id)
                                         (firstpair-reader--translation-title bundle id))
                                       ids " + ")
                          "None"))))
    ;; A terminal menu invokes this command before its own teardown.  Posting
    ;; from the outer command loop leaves the result in the echo area after
    ;; that teardown instead of letting the menu erase it.
    (setq firstpair-reader--terminal-translation-feedback label)
    (remove-hook 'post-command-hook
                 #'firstpair-reader--show-terminal-translation-feedback)
    (add-hook 'post-command-hook
              #'firstpair-reader--show-terminal-translation-feedback)))

(defun firstpair-reader--replace-translation (bundle lang id step)
  "Swap edition ID of LANG for its next unshown alternative, by STEP.
The replacement takes ID's place in the language's display order, and
point stays in the block that changed."
  (let* ((origin (firstpair-reader--region-at-point bundle))
         (origin-line (line-number-at-pos))
         (origin-offset (and origin (- origin-line (plist-get origin :start))))
         (effective (firstpair-reader--effective-translations bundle lang))
         (others (remove id effective))
         (candidates (seq-remove (lambda (candidate) (member candidate others))
                                 (mapcar (lambda (item) (alist-get 'id item))
                                         (firstpair-reader--candidates bundle lang))))
         (position (seq-position candidates id)))
    (when (< (length candidates) 2)
      (user-error "No other translation of this language covers this part"))
    (let ((next (nth (if position
                         (mod (+ position step) (length candidates))
                       (if (< step 0) (1- (length candidates)) 0))
                     candidates))
          (slot (seq-position effective id)))
      (setf (alist-get lang firstpair-reader-translation-selections nil nil #'equal)
            (if slot
                (append (seq-take effective slot) (list next)
                        (nthcdr (1+ slot) effective))
              (append effective (list next))))
      (firstpair-reader-refresh-regions)
      (firstpair-lexicon-refresh)
      (ignore-errors (firstpair-reader-save-state))
      ;; Keep point in the block that changed.  Otherwise the old region
      ;; becomes invisible and a second tap can accidentally target another.
      (when (and origin (not (plist-get origin :source)))
        (let ((replacement
               (seq-find
                (lambda (region)
                  (and (equal (plist-get region :language) next)
                       (equal (plist-get region :unit) (plist-get origin :unit))))
                (firstpair-reader--regions bundle))))
          (when replacement
            (goto-char (point-min))
            (forward-line
             (+ (1- (plist-get replacement :start))
                (min (or origin-offset 0)
                     (- (plist-get replacement :end)
                        (plist-get replacement :start))))))))
      next)))

(defun firstpair-reader-terminal-next-translation ()
  "Swap the edition at point for the next one of its language."
  (interactive)
  (let* ((bundle (firstpair-reader--bundle))
         (target (firstpair-reader--translation-target-at-point bundle)))
    (let ((inhibit-message t))
      (firstpair-reader--replace-translation bundle (car target) (cdr target) 1))
    (firstpair-reader--schedule-terminal-language-feedback bundle (car target))))

(defun firstpair-reader-terminal-previous-translation ()
  "Swap the edition at point for the previous one of its language."
  (interactive)
  (let* ((bundle (firstpair-reader--bundle))
         (target (firstpair-reader--translation-target-at-point bundle)))
    (let ((inhibit-message t))
      (firstpair-reader--replace-translation bundle (car target) (cdr target) -1))
    (firstpair-reader--schedule-terminal-language-feedback bundle (car target))))

(defun firstpair-reader--multiple-translations-p ()
  "Non-nil when the language at point has an unshown edition to swap in."
  (condition-case nil
      (let* ((bundle (firstpair-reader--bundle))
             (target (firstpair-reader--translation-target-at-point bundle))
             (effective (firstpair-reader--effective-translations bundle (car target))))
        (> (length (firstpair-reader--candidates bundle (car target)))
           (length effective)))
    (error nil)))

(defun firstpair-reader-rotate-translation (&optional choose)
  "Swap the edition at point for the next one of its language.
With a prefix argument CHOOSE, show or hide an edition by name.  Only
translations that cover the current part are used; every choice is kept
for its language until changed."
  (interactive "P")
  (let* ((bundle (firstpair-reader--bundle))
         (target (firstpair-reader--translation-target-at-point bundle)))
    (unless (firstpair-bundle-translations bundle)
      (user-error "This bundle has one translation per language"))
    (if choose
        (firstpair-reader-choose-toggle-translation)
      (firstpair-reader--replace-translation bundle (car target) (cdr target) 1)
      (message "%s" (firstpair-reader-translations-label bundle)))))

(defun firstpair-reader-previous-translation ()
  "Swap the edition at point for the previous one of its language."
  (interactive)
  (let* ((bundle (firstpair-reader--bundle))
         (target (firstpair-reader--translation-target-at-point bundle)))
    (unless (firstpair-bundle-translations bundle)
      (user-error "This bundle has one translation per language"))
    (firstpair-reader--replace-translation bundle (car target) (cdr target) -1)
    (message "%s" (firstpair-reader-translations-label bundle))))

(defun firstpair-reader-choose-toggle-translation ()
  "Show or hide an edition of the language at point, chosen by name."
  (interactive)
  (let* ((bundle (firstpair-reader--bundle))
         (lang (firstpair-reader--language-at-point bundle))
         (effective (firstpair-reader--effective-translations bundle lang))
         (titles (mapcar (lambda (item)
                           (let ((id (alist-get 'id item)))
                             (cons (concat (if (member id effective) "✓ " "  ")
                                           (firstpair-reader--translation-title bundle id))
                                   id)))
                         (firstpair-reader--candidates bundle lang))))
    (unless titles
      (user-error "No translation of this language covers this part"))
    (firstpair-reader-toggle-language-translation
     lang
     (cdr (assoc (completing-read "Show or hide translation: "
                                  (mapcar #'car titles) nil t)
                 titles)))))

(defun firstpair-reader-second-translation ()
  "Show one more edition of the language at point, or collapse to one.
The header row and the Tr menus are the first-class controls; this key
keeps its old rhythm: it adds an edition when one is shown, and returns
to a single edition when several are."
  (interactive)
  (let* ((bundle (firstpair-reader--bundle))
         (lang (firstpair-reader--language-at-point bundle)))
    (unless (firstpair-bundle-translations bundle)
      (user-error "This bundle has one translation per language"))
    (let* ((effective (firstpair-reader--effective-translations bundle lang))
           (unshown (seq-remove (lambda (id) (member id effective))
                                (mapcar (lambda (item) (alist-get 'id item))
                                        (firstpair-reader--candidates bundle lang)))))
      (cond ((cdr effective)
             (setf (alist-get lang firstpair-reader-translation-selections nil nil #'equal)
                   (list (car effective)))
             (firstpair-reader--after-translation-change bundle lang))
            (unshown
             (firstpair-reader-toggle-language-translation lang (car unshown)))
            (t (user-error "No second translation of this language covers this part"))))))

(defun firstpair-reader-glossary ()
  "Open the glossary of dictionary words in the references window."
  (interactive)
  (let* ((bundle (firstpair-reader--bundle))
         (language (alist-get 'language (firstpair-bundle-lexicon bundle)))
         (node (format "%s Glossary" (capitalize (or language "")))))
    (condition-case nil
        (firstpair-reader--goto 'references
                                (firstpair-reader--node bundle (firstpair-bundle-reference bundle) node))
      (error (user-error "This edition has no glossary")))))

(defun firstpair-reader-other-window ()
  "Move between the reader, references, and dictionary windows."
  (interactive)
  (let* ((windows (delq nil (mapcar #'firstpair-reader--window '(reader references lexicon))))
         (position (seq-position windows (selected-window)))
         (target (and windows (nth (mod (1+ (or position -1)) (length windows)) windows))))
    (when target (select-window target))))

(defun firstpair-reader--bundle-directory-p (directory)
  "Return non-nil when DIRECTORY is the root of a FirstPair bundle."
  (file-readable-p (expand-file-name "data/bundle.json" directory)))

;;;###autoload
(defun firstpair-reader-discover (&optional directories)
  "Register every bundle found under DIRECTORIES and return them.
DIRECTORIES defaults to `firstpair-reader-bundle-directories'.  A directory
that is itself a bundle is registered; otherwise its subdirectories that are
bundles are."
  (interactive)
  (let (found)
    (dolist (directory (or directories firstpair-reader-bundle-directories))
      (let ((directory (expand-file-name directory)))
        (cond ((firstpair-reader--bundle-directory-p directory)
               (push (firstpair-reader-register directory) found))
              ((file-directory-p directory)
               (dolist (child (directory-files directory t "\\`[^.]"))
                 (when (and (file-directory-p child)
                            (firstpair-reader--bundle-directory-p child))
                   (push (firstpair-reader-register child) found)))))))
    (when (called-interactively-p 'any)
      (message "Registered %d FirstPair bundle%s" (length found) (if (= 1 (length found)) "" "s")))
    (nreverse found)))

(defun firstpair-reader--choose (root)
  "Return the bundle at ROOT, or let the user pick a registered bundle.
With no bundle registered, search `firstpair-reader-bundle-directories'
and finally ask for a bundle directory."
  (cond (root (firstpair-reader-register root))
        ((and (null firstpair-bundles) (firstpair-reader-discover))
         (firstpair-reader--choose nil))
        ((null firstpair-bundles)
         (firstpair-reader-register
          (read-directory-name "FirstPair bundle directory: " nil nil t)))
        ((null (cdr firstpair-bundles)) (cdar firstpair-bundles))
        (t (let* ((titles (mapcar (lambda (entry)
                                    (let ((bundle (cdr entry)))
                                      (cons (format "%s (%s)" (firstpair-bundle-title bundle)
                                                    (firstpair-bundle-edition bundle))
                                            bundle)))
                                  firstpair-bundles))
                  (choice (completing-read "Book: " titles nil t)))
             (cdr (assoc choice titles))))))

(defun firstpair-reader--reset-roles ()
  "Forget which windows play which role."
  (dolist (window (window-list nil 'no-minibuffer))
    (dolist (parameter '(firstpair-role firstpair-borrowed-role
                         firstpair-borrowed-buffer firstpair-borrowed-start
                         firstpair-borrowed-point firstpair-borrowed-hscroll))
      (set-window-parameter window parameter nil))))

(defun firstpair-reader-layout ()
  "Arrange the reader, references, and dictionary windows again."
  (interactive)
  (let* ((bundle (or (firstpair-bundle-current) (firstpair-reader--choose nil)))
         (reader (cond ((eq (firstpair-reader--role) 'reader) (current-buffer))
                       ((get-buffer firstpair-reader-buffer))))
         (references (get-buffer firstpair-reader-references-buffer))
         (lexicon (get-buffer firstpair-lexicon-buffer)))
    (delete-other-windows)
    (firstpair-reader--reset-roles)
    (let ((window (firstpair-reader--claim (selected-window) 'reader)))
      (if reader
          (set-window-buffer window reader)
        (firstpair-reader--goto 'reader (firstpair-reader--node bundle (firstpair-bundle-reader bundle) "Top")))
      (if (buffer-live-p references)
          (firstpair-reader--show references 'references)
        (firstpair-reader--goto 'references
                                (firstpair-reader--node bundle (firstpair-bundle-reference bundle) "Top")))
      (when (buffer-live-p lexicon)
        (firstpair-reader--show lexicon 'lexicon))
      (select-window window))))

;;;###autoload
(defun firstpair-read (&optional root)
  "Open a FirstPair book: the text above, its references below.
With a prefix argument, or when called from Lisp with ROOT, read the
bundle at ROOT; otherwise read the registered bundle."
  (interactive (list (and current-prefix-arg (read-directory-name "Bundle directory: "))))
  (let ((bundle (firstpair-reader--choose root)))
    (delete-other-windows)
    (firstpair-reader--reset-roles)
    (let ((window (firstpair-reader--claim (selected-window) 'reader))
          (firstpair-reader--setting-up t))
      (firstpair-reader--goto 'reader (firstpair-reader--node bundle (firstpair-bundle-reader bundle) "Top"))
      (firstpair-reader--goto 'references
                              (firstpair-reader--node bundle (firstpair-bundle-reference bundle) "Top"))
      (select-window window)
      (when (firstpair-reader--resume bundle)
        (message "Resumed at %s" Info-current-node))
      (firstpair-reader--arm-save)
      bundle)))

;;; Info directory installation

(defconst firstpair-reader--dir-preamble
  "This is the file .../dir, which contains the
topmost node of the Info hierarchy, called (dir)Top.
The first time you invoke Info you start off looking at this node.

\x1f
File: dir,\tNode: Top,\tThis is the top of the INFO tree

  This (the Directory node) gives a menu of major topics.

* Menu:

"
  "Contents of a fresh Info `dir' file, as `install-info' writes it.")

(defun firstpair-reader--dir-entries (info-file)
  "Return (SECTION . MENU-LINES) declared in the header of INFO-FILE."
  (with-temp-buffer
    (insert-file-contents info-file nil 0 4096)
    (goto-char (point-min))
    (let ((section (and (re-search-forward "^INFO-DIR-SECTION \\(.+\\)$" nil t)
                        (match-string 1)))
          (lines nil))
      (goto-char (point-min))
      (when (re-search-forward "^START-INFO-DIR-ENTRY\n" nil t)
        (while (not (or (eobp) (looking-at "^END-INFO-DIR-ENTRY")))
          (push (buffer-substring-no-properties (line-beginning-position) (line-end-position))
                lines)
          (forward-line 1)))
      (cons (or section "Books") (nreverse lines)))))

(defun firstpair-reader--dir-remove (lines)
  "Delete from the current buffer every menu line naming the manuals in LINES."
  (dolist (line lines)
    (when (string-match "(\\([^)]+\\))" line)
      (let ((target (regexp-quote (match-string 0 line))))
        (goto-char (point-min))
        (while (re-search-forward (concat "^\\* [^\n]*: " target "[^\n]*\n") nil t)
          (replace-match ""))))))

(defun firstpair-reader--update-dir (dir-file section lines &optional remove)
  "List LINES under SECTION in the Info DIR-FILE, or delete them when REMOVE.
This is what `install-info' does, for machines without it."
  (with-temp-buffer
    (when (file-exists-p dir-file)
      (insert-file-contents dir-file))
    (when (zerop (buffer-size))
      (insert firstpair-reader--dir-preamble))
    (firstpair-reader--dir-remove lines)
    (unless remove
      (goto-char (point-min))
      (if (re-search-forward (concat "^" (regexp-quote section) "\n") nil t)
          (dolist (line lines) (insert line "\n"))
        (goto-char (point-max))
        (unless (bolp) (insert "\n"))
        (insert "\n" section "\n")
        (dolist (line lines) (insert line "\n"))))
    (write-region (point-min) (point-max) dir-file nil 'silent)))

(defun firstpair-reader--install-info-program ()
  "Return the `install-info' executable, or nil."
  (executable-find "install-info"))

;;;###autoload
(defun firstpair-reader-install-info (&optional bundle directory)
  "Copy BUNDLE's manuals into DIRECTORY and list them in its Info `dir' file.
Afterwards `info' and `C-h i' show the book beside the system manuals.
DIRECTORY defaults to `firstpair-reader-info-directory'.  The GNU
`install-info' program is used when present; otherwise the `dir' file is
updated directly.  Returns DIRECTORY."
  (interactive)
  (let* ((bundle (or bundle (firstpair-reader--choose nil)))
         (directory (file-name-as-directory
                     (expand-file-name (or directory firstpair-reader-info-directory))))
         (program (firstpair-reader--install-info-program)))
    (make-directory directory t)
    (dolist (stem (list (firstpair-bundle-reader bundle) (firstpair-bundle-reference bundle)))
      (let ((source (expand-file-name (concat stem ".info") (firstpair-bundle-root bundle)))
            (target (expand-file-name (concat stem ".info") directory)))
        (copy-file source target t)
        ;; A large manual is split into subfiles <stem>.info-1, -2, ...
        (dolist (part (directory-files (firstpair-bundle-root bundle) t
                                       (concat "\\`" (regexp-quote stem) "\\.info-[0-9]+\\'")))
          (copy-file part (expand-file-name (file-name-nondirectory part) directory) t))
        (if program
            (unless (zerop (call-process program nil nil nil
                                         (concat "--info-dir=" (directory-file-name directory))
                                         target))
              (error "install-info could not register %s" target))
          (let ((entries (firstpair-reader--dir-entries target)))
            (firstpair-reader--update-dir (expand-file-name "dir" directory)
                                          (car entries) (cdr entries))))))
    (info-initialize)
    (add-to-list 'Info-directory-list (directory-file-name directory))
    (message "Installed %s into %s. Keep it with (add-to-list \\='Info-directory-list \"%s\") in your init file, or INFOPATH in your shell."
             (firstpair-bundle-title bundle) directory (directory-file-name directory))
    directory))

;;;###autoload
(defun firstpair-reader-uninstall-info (&optional bundle directory)
  "Remove BUNDLE's manuals from the Info DIRECTORY and its `dir' file."
  (interactive)
  (let* ((bundle (or bundle (firstpair-reader--choose nil)))
         (directory (file-name-as-directory
                     (expand-file-name (or directory firstpair-reader-info-directory))))
         (program (firstpair-reader--install-info-program)))
    (dolist (stem (list (firstpair-bundle-reader bundle) (firstpair-bundle-reference bundle)))
      (let ((target (expand-file-name (concat stem ".info") directory)))
        (when (file-exists-p target)
          (if program
              (call-process program nil nil nil "--delete"
                            (concat "--info-dir=" (directory-file-name directory)) target)
            (let ((entries (firstpair-reader--dir-entries target)))
              (firstpair-reader--update-dir (expand-file-name "dir" directory)
                                            (car entries) (cdr entries) t)))
          (delete-file target))))
    (message "Removed %s from %s" (firstpair-bundle-title bundle) directory)
    directory))

;;;###autoload
(defun firstpair-reader-register (root)
  "Register the bundle at ROOT and enable the reader for its manuals."
  (let ((bundle (firstpair-bundle-register root)))
    (add-hook 'Info-selection-hook #'firstpair-reader--after-select)
    (advice-add 'Info-goto-node :around #'firstpair-reader--goto-node-advice)
    (advice-add 'Info-insert-file-contents :after #'firstpair-reader--note-file-read)
    bundle))

;;; Mode

(defvar-local firstpair-reader--saved-header-line-format nil
  "The Info header line replaced by the persistent translation names.")

(defvar-local firstpair-reader--translation-header-installed nil
  "Non-nil when this buffer shows the persistent translation header.")

(defun firstpair-reader--install-translation-header (bundle)
  "Show BUNDLE's visible edition names directly below the Emacs menu bar."
  (when (and (equal (firstpair-bundle-manual)
                    (firstpair-bundle-reader bundle))
             (firstpair-bundle-translations bundle)
             (not firstpair-reader--translation-header-installed))
    (setq firstpair-reader--saved-header-line-format header-line-format
          firstpair-reader--translation-header-installed t)
    (setq-local header-line-format
                '(:eval (firstpair-reader--translation-header-line)))))

(defun firstpair-reader--restore-header-line ()
  "Restore the Info header line replaced by `firstpair-reader-mode'."
  (when firstpair-reader--translation-header-installed
    (setq-local header-line-format firstpair-reader--saved-header-line-format)
    (setq firstpair-reader--saved-header-line-format nil
          firstpair-reader--translation-header-installed nil)))

(defvar firstpair-reader-mode-map
  (let ((map (make-sparse-keymap)))
    (define-key map (kbd "C-c C-d") #'firstpair-reader-describe-word)
    (define-key map (kbd "C-c C-n") #'firstpair-reader-next-marked)
    (define-key map (kbd "C-c C-p") #'firstpair-reader-previous-marked)
    (define-key map (kbd "C-c C-r") #'firstpair-reader-references)
    (define-key map (kbd "C-c C-f") #'firstpair-reader-open-file)
    (define-key map (kbd "C-c C-g") #'firstpair-reader-glossary)
    (define-key map (kbd "C-c C-t") #'firstpair-reader-translation-languages)
    (define-key map (kbd "C-c C-v") #'firstpair-reader-rotate-translation)
    (define-key map (kbd "C-c C-b") #'firstpair-reader-second-translation)
    (define-key map (kbd "C-c C-s") #'firstpair-reader-show-current-translations)
    ;; Single keys for phones: the same commands without the C-c chord.
    (define-key map (kbd "d") #'firstpair-reader-describe-word)
    (define-key map (kbd "t") #'firstpair-reader-translation-languages)
    (define-key map (kbd "T") #'firstpair-reader-previous-translation-languages)
    (define-key map (kbd "v") #'firstpair-reader-rotate-translation)
    (define-key map (kbd "b") #'firstpair-reader-second-translation)
    (define-key map (kbd "=") #'firstpair-reader-show-current-translations)
    (define-key map (kbd ",") #'firstpair-reader-previous-marked)
    (define-key map (kbd ".") #'firstpair-reader-next-marked)
    (define-key map (kbd "j") #'firstpair-reader-next-marked-lookup)
    (define-key map (kbd "k") #'firstpair-reader-previous-marked-lookup)
    (define-key map (kbd "J") #'firstpair-reader-next-significant-marked-lookup)
    (define-key map (kbd "K") #'firstpair-reader-previous-significant-marked-lookup)
    (define-key map (kbd "]") #'firstpair-reader-terminal-next-translation)
    (define-key map (kbd "[") #'firstpair-reader-terminal-previous-translation)
    (define-key map (kbd "RET") #'firstpair-reader-return)
    (define-key map [return] #'firstpair-reader-return)
    (define-key map (kbd "r") #'firstpair-reader-references)
    (define-key map (kbd "?") #'firstpair-reader-help)
    (define-key map [mouse-1] #'firstpair-reader-touch-click)
    (define-key map [drag-mouse-1] #'firstpair-reader-touch-click)
    (define-key map [mouse-3] #'firstpair-reader-rotate-translation)
    (define-key map [down-mouse-1] #'ignore)
    ;; TTY mouse decoding can lose the string-local map while retaining the
    ;; mode-line area.  Resolve our button property explicitly in that case;
    ;; never let a miss fall through to Emacs's buffer/window mode-line map.
    (define-key map [mode-line mouse-1] #'firstpair-reader-mode-line-click)
    (define-key map [mode-line drag-mouse-1] #'firstpair-reader-mode-line-click)
    (define-key map [mode-line down-mouse-1] #'ignore)
    (define-key map [mode-line double-mouse-1] #'ignore)
    (define-key map [mode-line triple-mouse-1] #'ignore)
    (define-key map [header-line mouse-1] #'firstpair-reader-mode-line-click)
    (define-key map [header-line drag-mouse-1] #'firstpair-reader-mode-line-click)
    (define-key map [header-line down-mouse-1] #'ignore)
    (define-key map [header-line double-mouse-1] #'ignore)
    (define-key map [header-line triple-mouse-1] #'ignore)
    (define-key map (kbd "C-c C-l") #'firstpair-reader-layout)
    (define-key map (kbd "C-c C-o") #'firstpair-reader-other-window)
    (define-key map [remap Info-follow-nearest-node] #'firstpair-reader-follow-nearest-node)
    (define-key map [remap Info-mouse-follow-nearest-node] #'firstpair-reader-mouse-follow-nearest-node)
    (define-key map [remap Info-follow-reference] #'firstpair-reader-follow-reference)
    map)
  "Keymap for `firstpair-reader-mode'.")

(easy-menu-define firstpair-reader-translations-menu firstpair-reader-mode-map
  "Inspect and change the translations visible in a FirstPair edition."
  '("Translations"
    ["Showing" firstpair-reader-show-current-translations
     :label (firstpair-reader--current-translations-menu-label)
     :help "Report the translations currently visible; this changes nothing"]
    "---"
    ["Show or Hide Translation..." firstpair-reader-choose-toggle-translation
     :enable (firstpair-reader--translations-p)]
    ["Next Translation at Point" firstpair-reader-rotate-translation
     :enable (firstpair-reader--multiple-translations-p)]
    ["This Language First" firstpair-reader-language-first-at-point
     :enable (firstpair-reader--translations-p)]
    "---"
    ["Choose Languages..." firstpair-reader-choose-translation-languages t]
    ["Cycle Languages" firstpair-reader-translation-languages t]))

;; Keep the full translation submenu in graphical Emacs.  A terminal gets one
;; compact submenu per supported language, with None first and then its editions.
(define-key firstpair-reader-mode-map [menu-bar translations]
  `(menu-item "Translations" ,firstpair-reader-translations-menu
              :visible (display-graphic-p)
              :help "Open translation choices"))
(define-key-after firstpair-reader-mode-map [menu-bar translation-english]
  '(menu-item "Tr-Eng" ignore
              :filter firstpair-reader--terminal-english-menu
              :visible (and (not (display-graphic-p))
                            (firstpair-reader--translation-language-available-p "en"))
              :help "Choose or hide the English translation")
  'translations)
(define-key-after firstpair-reader-mode-map [menu-bar translation-russian]
  '(menu-item "Tr-Rus" ignore
              :filter firstpair-reader--terminal-russian-menu
              :visible (and (not (display-graphic-p))
                            (firstpair-reader--translation-language-available-p "ru"))
              :help "Choose or hide the Russian translation")
  'translation-english)

;;;###autoload
;;; Touch: single keys, taps, and a button bar

(defvar firstpair-reader--bar-gap-map
  (let ((map (make-sparse-keymap)))
    (dolist (area '(header-line mode-line))
      (dolist (event '(mouse-1 drag-mouse-1 down-mouse-1
                       double-mouse-1 triple-mouse-1 mouse-2 mouse-3))
        (define-key map (vector area event) #'ignore)))
    (dolist (event '(mouse-1 drag-mouse-1 down-mouse-1
                     double-mouse-1 triple-mouse-1 mouse-2 mouse-3))
      (define-key map (vector event) #'ignore))
    map)
  "Keymap that keeps gaps in Reader bars from invoking the stock mode line.")

(defun firstpair-reader--no-help-echo (&rest _arguments)
  "Mask the mode line's inherited mouse help in terminal Reader bars."
  nil)

(defun firstpair-reader--event-button-command (event)
  "Return the Reader button command at EVENT, or nil for a non-button cell."
  (let ((string-position (posn-string (event-start event))))
    (when (and (consp string-position)
               (stringp (car string-position))
               (integer-or-marker-p (cdr string-position)))
      (get-text-property (cdr string-position)
                         'firstpair-reader-command
                         (car string-position)))))

(defun firstpair-reader--run-button-command (event command)
  "Select EVENT's window and invoke Reader button COMMAND."
  (let ((window (posn-window (event-start event))))
    (when (window-live-p window)
      (select-window window)))
  (when (commandp command)
    (call-interactively command)))

(defun firstpair-reader-mode-line-click (event)
  "Run the Reader button at mode-line EVENT, ignoring every non-button cell."
  (interactive "e")
  (let ((command (firstpair-reader--event-button-command event)))
    (when command
      (firstpair-reader--run-button-command event command))))

(defun firstpair-reader--bar-gap (&optional display)
  "Return an inert one-cell bar gap, with optional DISPLAY specification."
  (let ((gap (propertize " "
                         'local-map firstpair-reader--bar-gap-map
                         'help-echo #'firstpair-reader--no-help-echo)))
    (when display
      (put-text-property 0 1 'display display gap))
    gap))

(defun firstpair-reader--button (label command &optional help)
  "A bar button LABEL running COMMAND on a tap, with HELP as tooltip.
The command runs with the tapped window selected, so a button on the book
acts on the book even while the dictionary window has focus."
  (let ((map (make-sparse-keymap))
        (action (lambda (event)
                  (interactive "e")
                  (firstpair-reader--run-button-command event command))))
    (define-key map [header-line mouse-1] action)
    (define-key map [header-line drag-mouse-1] action)
    (define-key map [header-line down-mouse-1] #'ignore)
    (define-key map [header-line double-mouse-1] #'ignore)
    (define-key map [header-line triple-mouse-1] #'ignore)
    (define-key map [header-line mouse-2] action)
    (define-key map [mode-line mouse-1] action)
    (define-key map [mode-line drag-mouse-1] action)
    ;; Own the press as well as the release.  Otherwise the standard mode-line
    ;; map begins a resize before our release handler runs; a retry can then be
    ;; interpreted as a double-click and maximize or replace a reading pane.
    (define-key map [mode-line down-mouse-1] #'ignore)
    (define-key map [mode-line double-mouse-1] #'ignore)
    (define-key map [mode-line triple-mouse-1] #'ignore)
    (define-key map [mode-line mouse-2] action)
    (define-key map [mouse-1] action)
    (define-key map [drag-mouse-1] action)
    (define-key map [down-mouse-1] #'ignore)
    (define-key map [double-mouse-1] #'ignore)
    (define-key map [triple-mouse-1] #'ignore)
    (propertize (concat " " label " ")
                'face '(:box (:line-width 1) :inherit mode-line-highlight)
                'mouse-face 'highlight 'local-map map
                'firstpair-reader-command command
                'help-echo (if (display-graphic-p)
                               (or help label)
                             #'firstpair-reader--no-help-echo))))

(defun firstpair-reader--bar (&rest buttons)
  "A header line of BUTTONS (label . command) separated by a space."
  (cons "" (mapcan (lambda (button)
                      (list (firstpair-reader--button (car button) (cdr button))
                            (firstpair-reader--bar-gap)))
                    buttons)))

(defun firstpair-reader--split-bar (left right)
  "A bar with LEFT buttons at the start and RIGHT buttons at the right edge."
  (let* ((left-items
          (mapcan (lambda (button)
                    (list (firstpair-reader--button (car button) (cdr button))
                          (firstpair-reader--bar-gap)))
                  left))
         (right-items
          (mapcan (lambda (button)
                    (list (firstpair-reader--button (car button) (cdr button))
                          (firstpair-reader--bar-gap)))
                  right))
         (right-width
          (apply #'+ (mapcar (lambda (item)
                               (if (stringp item) (string-width item) 0))
                             right-items))))
    (append (cons "" left-items)
            (list (firstpair-reader--bar-gap
                   `(space :align-to (- right ,right-width))))
            right-items)))

(defun firstpair-reader--reader-bar (bundle)
  "The book's middle bar: dictionary, pages, cantos, and references."
  (ignore bundle)
  (firstpair-reader--bar (cons "Dict" #'firstpair-reader-toggle-dictionary)
                         (cons "▲" #'firstpair-reader-page-up)
                         (cons "▼" #'firstpair-reader-page-down)
                         (cons "◀c" #'Info-prev)
                         (cons "c▶" #'Info-next)
                         (cons "Top" #'Info-top-node)
                         (cons "Refs" #'firstpair-reader-references)
                         (cons "?" #'firstpair-reader-help)))

(defun firstpair-reader-page-down ()
  "Show the next screen of the book."
  (interactive)
  (with-selected-window (or (firstpair-reader--window 'reader) (selected-window))
    (condition-case nil (scroll-up-command) (end-of-buffer (Info-next)))))

(defun firstpair-reader-page-up ()
  "Show the previous screen of the book."
  (interactive)
  (with-selected-window (or (firstpair-reader--window 'reader) (selected-window))
    (condition-case nil (scroll-down-command) (beginning-of-buffer nil))))

(defun firstpair-reader--movement-bar ()
  "The book's bottom bar, nearest the thumb: paging and navigation."
  (firstpair-reader--bar (cons "▲ page" #'firstpair-reader-page-up)
                         (cons "▼ page" #'firstpair-reader-page-down)
                         (cons "◀ canto" #'Info-prev)
                         (cons "canto ▶" #'Info-next)
                         (cons "Top" #'Info-top-node)
                         (cons "Refs" #'firstpair-reader-references)
                         (cons "?" #'firstpair-reader-help)))

(defun firstpair-reader--dictionary-bar ()
  "The lowest Reader bar: lexical and translation controls."
  (firstpair-reader--bar
   (cons "Tr<" #'firstpair-reader-terminal-previous-translation)
   (cons "Tr>" #'firstpair-reader-terminal-next-translation)
   (cons "Lang" #'firstpair-lexicon-cycle-languages-command)
   (cons "<<" #'firstpair-reader-previous-significant-marked-lookup)
   (cons "<" #'firstpair-reader-previous-marked-lookup)
   (cons ">" #'firstpair-reader-next-marked-lookup)
   (cons ">>" #'firstpair-reader-next-significant-marked-lookup)))

(defun firstpair-reader-toggle-dictionary ()
  "Open the dictionary at point, or close it when already visible."
  (interactive)
  (if (window-live-p (firstpair-reader--window 'lexicon))
      (firstpair-reader-close-dictionary)
    (firstpair-reader-describe-word)))

(defun firstpair-reader-close-dictionary ()
  "Close the dictionary window."
  (interactive)
  (let ((reader (firstpair-reader--window 'reader)))
    (when (window-live-p reader)
      (with-current-buffer (window-buffer reader)
        (firstpair-reader--clear-current-word))))
  (let ((window (firstpair-reader--window 'lexicon)))
    (when (window-live-p window)
      (unless (firstpair-reader--restore-borrowed-window window)
        (delete-window window)))))

(defun firstpair-lexicon-cycle-languages-command ()
  "Cycle the dictionary languages from the dictionary window."
  (interactive)
  (with-selected-window (or (firstpair-reader--window 'reader) (selected-window))
    (firstpair-reader-translation-languages)))

(defun firstpair-reader-next-marked-lookup ()
  "Look up the next dictionary word of the book."
  (interactive)
  (with-selected-window (or (firstpair-reader--window 'reader) (selected-window))
    (firstpair-reader-next-marked)
    (firstpair-reader-describe-word)))

(defun firstpair-reader-previous-marked-lookup ()
  "Look up the previous dictionary word of the book."
  (interactive)
  (with-selected-window (or (firstpair-reader--window 'reader) (selected-window))
    (firstpair-reader-previous-marked)
    (firstpair-reader-describe-word)))

(defun firstpair-reader-next-significant-marked-lookup ()
  "Look up the next significant source word of the book."
  (interactive)
  (with-selected-window (or (firstpair-reader--window 'reader) (selected-window))
    (firstpair-reader-next-significant-marked)
    (firstpair-reader-describe-word)))

(defun firstpair-reader-previous-significant-marked-lookup ()
  "Look up the previous significant source word of the book."
  (interactive)
  (with-selected-window (or (firstpair-reader--window 'reader) (selected-window))
    (firstpair-reader-previous-significant-marked)
    (firstpair-reader-describe-word)))

(defun firstpair-reader-touch-click (event)
  "Act on a tap at EVENT: look up a dictionary word, follow a link, or move point."
  (interactive "e")
  (mouse-set-point event)
  (let ((bundle (firstpair-reader--bundle))
        (overlay (firstpair-reader--overlay-at (point))))
    (cond ((firstpair-reader--lookup-source-word-at-point bundle))
          (overlay
           (firstpair-reader-describe-word
            (buffer-substring-no-properties
             (overlay-start overlay) (overlay-end overlay))))
          ((firstpair-reader--link-at-point-p)
           (firstpair-reader-mouse-follow-nearest-node event))
          (t nil))))

(defun firstpair-reader-help ()
  "Show the reader's keys and taps."
  (interactive)
  (with-help-window "*FirstPair Reader keys*"
    (princ "FirstPair Reader — keys and taps\n\n")
    (princ "Tap a word            look it up          d   dictionary for the word at point\n")
    (princ "Tap a link            follow it           ,   .   previous / next dictionary word\n")
    (princ "                                      RET / j   next source word, looked up at once; k previous\n")
    (princ "Long press / right    next translation    t   languages: English, Русский, both\n")
    (princ "                                          =   show current translations (changes nothing)\n")
    (princ "Top Emacs menu        Translations        in iSH: Tr-Eng and Tr-Rus are checkboxes — any number of editions per language\n")
    (princ "Second row            EN Longfellow ◀Cary | RU Мин   tap a name to hide it, ◀ to move it earlier, EN/RU to put that block first\n")
    (princ "Middle bar            Dict open/close · ▲ ▼ page · ◀c c▶ canto · Top · Refs · ?\n")
    (princ "Bottom bar            Tr< Tr> · Lang · << < > >> words\n")
    (princ "                        << and >> skip frequent function words such as prepositions and essere\n")
    (princ "                                          b   one more edition of the language at point / back to one\n")
    (princ "                                          n   p   next / previous canto     SPC  DEL  page down / up\n")
    (princ "                                          r   references    g   glossary    l   back    ?   this help    q   quit\n")
    (princ "\nIn the dictionary window: m more/less senses, t languages, q close.  Everything above also has a C-c C-<letter> form.\n")))

(defun firstpair-reader--apply-touch (bundle)
  "Give the current reader buffer its button bar and turn on mouse reporting.
Terminals that report only focus (iSH sends ESC [ I on a tap) have those
sequences decoded as focus events, so a tap never reads as M-[ I."
  (when firstpair-reader-touch
    (when (boundp 'mode-line-default-help-echo)
      (setq-local mode-line-default-help-echo nil))
    ;; Only the book's own window carries the bars; the references manual
    ;; below it keeps Info's plain header and mode line.
    (when (equal (firstpair-bundle-manual) (firstpair-bundle-reader bundle))
      ;; One control bar, on the mode line between the book and its references;
      ;; the persistent edition-name header remains above the book body.
      (setq mode-line-format
            (append (firstpair-reader--reader-bar bundle)
                    (list (firstpair-reader--bar-gap)
                          '(:eval
                            (propertize (or Info-current-node "")
                                        'local-map firstpair-reader--bar-gap-map
                                        'help-echo
                                        #'firstpair-reader--no-help-echo))))))
    (unless (display-graphic-p)
      (unless (bound-and-true-p xterm-mouse-mode)
        (ignore-errors (xterm-mouse-mode 1)))
      ;; A terminal that reports focus (iSH does, on every tap) sends ESC [ I / ESC [ O;
      ;; decode them to events and let them fall through silently.
      (define-key input-decode-map "\e[I" [focus-in])
      (define-key input-decode-map "\e[O" [focus-out])
      (dolist (event '([focus-in] [focus-out]))
        (unless (lookup-key global-map event)
          (define-key global-map event #'ignore))))))

(define-minor-mode firstpair-reader-mode
  "Read a FirstPair bundle: text above, references or dictionary below.
\\{firstpair-reader-mode-map}"
  :lighter " FirstPair"
  :keymap firstpair-reader-mode-map
  (if firstpair-reader-mode
      (progn
        (setq-local buffer-read-only t)
        (when (boundp 'text-conversion-style)
          (setq-local text-conversion-style nil)))
    (firstpair-reader--unmark)
    (firstpair-reader--clear-current-word)
    (when (local-variable-p 'mode-line-default-help-echo)
      (kill-local-variable 'mode-line-default-help-echo))
    (firstpair-reader--restore-header-line)))

(provide 'firstpair-reader)
;;; firstpair-reader.el ends here
