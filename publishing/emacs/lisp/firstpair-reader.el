;;; firstpair-reader.el --- Read a FirstPair book in Emacs Info  -*- lexical-binding: t; -*-

;; Copyright (C) 2026 First Pair Press
;; Author: First Pair Press
;; Version: 1.13
;; Package-Requires: ((emacs "27.1"))
;; Keywords: docs, hypermedia

;;; Commentary:

;; The reading side of a FirstPair Emacs bundle.  A bundle is two Info
;; manuals: the book, and the references the book points at.  This mode keeps
;; them in separate windows -- the book above, its references below, and a
;; dictionary window under both -- so following a citation never moves the
;; reading position.  It also underlines the words the bundle's offline
;; lexicon can explain and looks them up with a single key.
;;
;; Load a bundle's init.el, then M-x firstpair-read.  Everything else is
;; ordinary Info: n, p, u and l move, SPC scrolls, RET follows.

;;; Code:

(require 'cl-lib)
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
  "Height in lines of the dictionary window."
  :type 'integer)

(defcustom firstpair-reader-highlight t
  "Non-nil underlines the words the dictionary window can explain."
  :type 'boolean)

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

(defconst firstpair-reader-buffer "*FirstPair Reader*"
  "Name of the Info buffer showing the book.")

(defconst firstpair-reader-references-buffer "*FirstPair References*"
  "Name of the Info buffer showing the references.")

(defvar-local firstpair-reader--overlays nil
  "Overlays this mode placed in the current node.")

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

(defun firstpair-reader--ensure-window (role)
  "Return a window for ROLE, creating it below the reader when needed."
  (or (firstpair-reader--window role)
      (pcase role
        ('reader (firstpair-reader--claim (selected-window) 'reader))
        ('references
         (let* ((anchor (or (firstpair-reader--window 'reader) (selected-window)))
                (window (firstpair-reader--split
                         anchor
                         (round (* (window-height anchor) firstpair-reader-references-height)))))
           (if window (firstpair-reader--claim window 'references) anchor)))
        ('lexicon
         (let* ((anchor (or (firstpair-reader--window 'references)
                            (firstpair-reader--window 'reader)
                            (selected-window)))
                (window (firstpair-reader--split anchor firstpair-reader-lexicon-height)))
           (if window (firstpair-reader--claim window 'lexicon) anchor))))))

(defun firstpair-reader--show (buffer role &optional select)
  "Display BUFFER in the ROLE window and return that window.
Select the window when SELECT is non-nil."
  (let ((window (firstpair-reader--ensure-window role)))
    (unless (eq (window-buffer window) buffer)
      (set-window-buffer window buffer))
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
                               (plist-get (overlay-get overlay 'firstpair-marked) :form))
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

(defvar firstpair-reader-translation-choices nil
  "Alist of language id to the translation id shown for it.
A language without an entry shows its default translation.")

(defvar firstpair-reader-second-translations nil
  "Alist of language id to a second translation id shown under the first, or nil.")

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

(defun firstpair-reader-translation-for (bundle lang &optional exclude)
  "Return the id of the translation shown for LANG: the chosen one if it covers
this page, else the language's default, else the first that covers; EXCLUDE
names a translation not to return."
  (let* ((candidates (firstpair-reader--candidates bundle lang exclude))
         (chosen (alist-get lang firstpair-reader-translation-choices nil nil #'equal))
         (pick (or (seq-find (lambda (item) (equal (alist-get 'id item) chosen)) candidates)
                   (seq-find (lambda (item) (eq (alist-get 'default item) t)) candidates)
                   (car candidates))))
    (and pick (alist-get 'id pick))))

(defun firstpair-reader--shown-translations (bundle)
  "Return the translation ids on screen: one per selected language, plus seconds."
  (let (ids)
    (dolist (language (firstpair-lexicon-selected bundle))
      (let* ((lang (alist-get 'id language))
             (first (firstpair-reader-translation-for bundle lang))
             (second (alist-get lang firstpair-reader-second-translations nil nil #'equal)))
        (when first (push first ids))
        (when (and second (not (equal second first))
                   (member second (mapcar (lambda (item) (alist-get 'id item))
                                          (firstpair-reader--candidates bundle lang first))))
          (push second ids))))
    (nreverse ids)))

(defun firstpair-reader--apply-regions (bundle)
  "Hide the translation regions of the current node that are not selected.
A region shows when its translation is the one chosen for a selected
language (see `firstpair-reader-translation-for'), or that language's
second translation. Bundles without a translation table select by language
id, the dictionary's choice."
  (let ((chosen (if (firstpair-bundle-translations bundle)
                    (firstpair-reader--shown-translations bundle)
                  (mapcar (lambda (item) (alist-get 'id item)) (firstpair-lexicon-selected bundle)))))
    (dolist (region (firstpair-bundle-regions-for-node bundle (firstpair-bundle-manual) Info-current-node))
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
  "Apply the language selection to every open reader buffer."
  (dolist (buffer (buffer-list))
    (with-current-buffer buffer
      (when (and firstpair-reader-mode (firstpair-bundle-current))
        (let ((bundle (firstpair-bundle-current)))
          (firstpair-reader--mark bundle)
          (firstpair-reader--fontify-emphasis)
          (when Info-hide-note-references
            (firstpair-reader--tidy-references bundle))
          (firstpair-reader--apply-regions bundle))))))

(defun firstpair-reader--marked-overlays ()
  "Return the overlays that mark dictionary words, in buffer order."
  (seq-filter (lambda (overlay) (overlay-get overlay 'firstpair-marked))
              firstpair-reader--overlays))

(defun firstpair-reader--overlay-at (position)
  "Return the marked-word overlay covering POSITION, or nil."
  (seq-find (lambda (overlay)
              (and (<= (overlay-start overlay) position) (< position (overlay-end overlay))))
            (firstpair-reader--marked-overlays)))

(defun firstpair-reader--after-select ()
  "Enable the reader in Info buffers that belong to a registered bundle."
  (let ((bundle (firstpair-bundle-current)))
    (cond (bundle
           (unless firstpair-reader-mode (firstpair-reader-mode 1))
           (firstpair-reader--mark bundle)
           (firstpair-reader--fontify-emphasis)
           (when Info-hide-note-references
             (firstpair-reader--tidy-references bundle))
           (firstpair-reader--apply-regions bundle)
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
                          :choices firstpair-reader-translation-choices
                          :seconds firstpair-reader-second-translations
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
      (setq firstpair-reader-translation-choices (plist-get state :choices)
            firstpair-reader-second-translations (plist-get state :seconds))
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

(defun firstpair-reader-describe-word (&optional word)
  "Show the dictionary entry for WORD, by default the word at point.
The entry opens in the dictionary window below the references."
  (interactive)
  (let* ((bundle (firstpair-reader--bundle))
         (overlay (firstpair-reader--overlay-at (point)))
         (word (or word
                   (and overlay (buffer-substring-no-properties
                                 (overlay-start overlay) (overlay-end overlay)))
                   (thing-at-point 'word t)
                   (read-string "Look up word: "))))
    (let ((buffer (firstpair-lexicon-render bundle word)))
      (firstpair-reader--show buffer 'lexicon)
      (when firstpair-reader-touch
        (with-current-buffer buffer
          (setq header-line-format
                (append (firstpair-reader--dictionary-bar)
                        (list (if (stringp header-line-format) header-line-format (or (and (listp header-line-format) (cadr header-line-format)) ""))))))))
    word))

(defun firstpair-reader--move-marked (forward)
  "Move point to the next marked word, or the previous one unless FORWARD."
  (let* ((overlays (firstpair-reader--marked-overlays))
         (current (firstpair-reader--overlay-at (point)))
         (origin (if current (overlay-start current) (point)))
         (target (if forward
                     (seq-find (lambda (overlay) (> (overlay-start overlay) origin)) overlays)
                   (seq-find (lambda (overlay) (< (overlay-start overlay) origin))
                             (reverse overlays)))))
    (unless target
      (user-error "No more marked words in this node"))
    (goto-char (overlay-start target))
    (let ((gloss (firstpair-lexicon-gloss
                  (firstpair-reader--bundle)
                  (plist-get (overlay-get target 'firstpair-marked) :form))))
      (when gloss (message "%s" gloss)))))

(defun firstpair-reader-next-marked ()
  "Move to the next word the dictionary window can explain."
  (interactive)
  (firstpair-reader--move-marked t))

(defun firstpair-reader-previous-marked ()
  "Move to the previous word the dictionary window can explain."
  (interactive)
  (firstpair-reader--move-marked nil))

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

(defun firstpair-reader--region-at-point (bundle)
  "Return the aligned region containing point, or nil."
  (let ((line (line-number-at-pos)))
    (seq-find (lambda (region)
                (and (<= (plist-get region :start) line) (<= line (plist-get region :end))))
              (firstpair-bundle-regions-for-node bundle (firstpair-bundle-manual) Info-current-node))))

(defun firstpair-reader--language-at-point (bundle)
  "The translation language to act on.
That of the region under point, else the first selected language."
  (let* ((region (firstpair-reader--region-at-point bundle))
         (translation (and region (not (plist-get region :source))
                           (firstpair-bundle-translation bundle (plist-get region :language)))))
    (or (and translation (alist-get 'lang translation))
        (alist-get 'id (car (firstpair-lexicon-selected bundle))))))

(defun firstpair-reader--translation-title (bundle id)
  "The display title of translation ID, marking approximate alignment."
  (let ((item (firstpair-bundle-translation bundle id)))
    (if (not item) id
      (concat (or (alist-get 'title item) (alist-get 'translator item) id)
              (if (equal (alist-get 'alignment item) "line") "" " ≈")))))

(defun firstpair-reader-translations-label (bundle)
  "Describe the translations on screen, per language."
  (mapconcat (lambda (language)
               (let* ((lang (alist-get 'id language))
                      (first (firstpair-reader-translation-for bundle lang))
                      (second (alist-get lang firstpair-reader-second-translations nil nil #'equal)))
                 (concat (alist-get 'label language) ": "
                         (if first (firstpair-reader--translation-title bundle first) "—")
                         (if (and second (not (equal second first)))
                             (concat " + " (firstpair-reader--translation-title bundle second))
                           ""))))
             (firstpair-lexicon-selected bundle) "; "))

(defun firstpair-reader-rotate-translation (&optional choose)
  "Show the next translation of the language at point (or the first selected one).
With a prefix argument CHOOSE, pick the translation by name. Only the
translations that cover the current part are offered; the choice is kept
for the language until changed."
  (interactive "P")
  (let* ((bundle (firstpair-reader--bundle))
         (lang (firstpair-reader--language-at-point bundle)))
    (unless (firstpair-bundle-translations bundle)
      (user-error "This bundle has one translation per language"))
    (let* ((second (alist-get lang firstpair-reader-second-translations nil nil #'equal))
           (candidates (firstpair-reader--candidates bundle lang second))
           (ids (mapcar (lambda (item) (alist-get 'id item)) candidates))
           (current (firstpair-reader-translation-for bundle lang second)))
      (when (< (length ids) 2)
        (user-error "No other translation of this language covers this part"))
      (let ((next (if choose
                      (let* ((titles (mapcar (lambda (id) (cons (firstpair-reader--translation-title bundle id) id)) ids)))
                        (cdr (assoc (completing-read "Translation: " (mapcar #'car titles) nil t) titles)))
                    (nth (mod (1+ (or (seq-position ids current) -1)) (length ids)) ids))))
        (setf (alist-get lang firstpair-reader-translation-choices nil nil #'equal) next)
        (firstpair-reader-refresh-regions)
        (firstpair-lexicon-refresh)
        (message "%s" (firstpair-reader-translations-label bundle))))))

(defun firstpair-reader-second-translation ()
  "Show a second translation of the language at point under the first, or hide it.
Repeated, it moves the second translation on to the next one; when none is
left it hides the second column."
  (interactive)
  (let* ((bundle (firstpair-reader--bundle))
         (lang (firstpair-reader--language-at-point bundle)))
    (unless (firstpair-bundle-translations bundle)
      (user-error "This bundle has one translation per language"))
    (let* ((first (firstpair-reader-translation-for bundle lang))
           (ids (mapcar (lambda (item) (alist-get 'id item)) (firstpair-reader--candidates bundle lang first)))
           (current (alist-get lang firstpair-reader-second-translations nil nil #'equal))
           (position (seq-position ids current))
           (next (cond ((null ids) nil)
                       ((null current) (car ids))
                       ((and position (< (1+ position) (length ids))) (nth (1+ position) ids))
                       (t nil))))
      (setf (alist-get lang firstpair-reader-second-translations nil nil #'equal) next)
      (firstpair-reader-refresh-regions)
      (firstpair-lexicon-refresh)
      (message "%s" (if next (firstpair-reader-translations-label bundle)
                      (format "Second %s translation hidden" (alist-get 'label (firstpair-bundle-translation bundle first))))))))

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
    (set-window-parameter window 'firstpair-role nil)))

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
    bundle))

;;; Mode

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
    ;; Single keys for phones: the same commands without the C-c chord.
    (define-key map (kbd "d") #'firstpair-reader-describe-word)
    (define-key map (kbd "t") #'firstpair-reader-translation-languages)
    (define-key map (kbd "v") #'firstpair-reader-rotate-translation)
    (define-key map (kbd "b") #'firstpair-reader-second-translation)
    (define-key map (kbd ",") #'firstpair-reader-previous-marked)
    (define-key map (kbd ".") #'firstpair-reader-next-marked)
    (define-key map (kbd "j") #'firstpair-reader-next-marked-lookup)
    (define-key map (kbd "k") #'firstpair-reader-previous-marked-lookup)
    (define-key map (kbd "r") #'firstpair-reader-references)
    (define-key map (kbd "?") #'firstpair-reader-help)
    (define-key map [mouse-1] #'firstpair-reader-touch-click)
    (define-key map [mouse-3] #'firstpair-reader-rotate-translation)
    (define-key map [down-mouse-1] #'ignore)
    (define-key map (kbd "C-c C-l") #'firstpair-reader-layout)
    (define-key map (kbd "C-c C-o") #'firstpair-reader-other-window)
    (define-key map [remap Info-follow-nearest-node] #'firstpair-reader-follow-nearest-node)
    (define-key map [remap Info-mouse-follow-nearest-node] #'firstpair-reader-mouse-follow-nearest-node)
    (define-key map [remap Info-follow-reference] #'firstpair-reader-follow-reference)
    map)
  "Keymap for `firstpair-reader-mode'.")

;;;###autoload
;;; Touch: single keys, taps, and a button bar

(defun firstpair-reader--button (label command &optional help)
  "A header-line button LABEL running COMMAND on a tap, with HELP as tooltip."
  (let ((map (make-sparse-keymap)))
    (define-key map [header-line mouse-1] command)
    (define-key map [header-line mouse-2] command)
    (define-key map [mode-line mouse-1] command)
    (define-key map [mode-line mouse-2] command)
    (define-key map [mouse-1] command)
    (propertize (concat " " label " ")
                'face '(:box (:line-width 1) :inherit mode-line-highlight)
                'mouse-face 'highlight 'local-map map 'help-echo (or help label))))

(defun firstpair-reader--bar (&rest buttons)
  "A header line of BUTTONS (label . command) separated by a space."
  (cons "" (mapcan (lambda (button) (list (firstpair-reader--button (car button) (cdr button)) " ")) buttons)))

(defun firstpair-reader--reader-bar (bundle)
  "The book's top bar: word by word through the dictionary, then translations."
  (let ((many (firstpair-bundle-translations bundle)))
    (apply #'firstpair-reader--bar
           (append (list (cons "◀ word" #'firstpair-reader-previous-marked-lookup)
                         (cons "word ▶" #'firstpair-reader-next-marked-lookup)
                         (cons "Dict" #'firstpair-reader-describe-word)
                         (cons "Langs" #'firstpair-reader-translation-languages))
                   (and many (list (cons "Next tr" #'firstpair-reader-rotate-translation)
                                   (cons "2nd" #'firstpair-reader-second-translation)))))))

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
  "The dictionary window's button bar."
  (firstpair-reader--bar (cons "Close" #'firstpair-reader-close-dictionary)
                         (cons "Langs" #'firstpair-lexicon-cycle-languages-command)
                         (cons "◀ word" #'firstpair-reader-previous-marked-lookup)
                         (cons "word ▶" #'firstpair-reader-next-marked-lookup)))

(defun firstpair-reader-close-dictionary ()
  "Close the dictionary window."
  (interactive)
  (let ((window (firstpair-reader--window 'lexicon)))
    (when (window-live-p window) (delete-window window))))

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

(defun firstpair-reader-touch-click (event)
  "Act on a tap at EVENT: look up a dictionary word, follow a link, or move point."
  (interactive "e")
  (mouse-set-point event)
  (cond ((firstpair-reader--overlay-at (point)) (firstpair-reader-describe-word))
        ((or (Info-get-token (point) "\\*note[ \n\t]+" "\\*note[ \n\t]+\\([^:]*\\):\\(:\\|[ \n\t]*\\(([^)]*)\\|[^.,;\n]*\\)[.,;]\\)")
             (Info-get-token (point) "\\* +" "\\* +\\([^:]*\\):"))
         (firstpair-reader-mouse-follow-nearest-node event))
        (t nil)))

(defun firstpair-reader-help ()
  "Show the reader's keys and taps."
  (interactive)
  (with-help-window "*FirstPair Reader keys*"
    (princ "FirstPair Reader — keys and taps\n\n")
    (princ "Tap a word            look it up          d   dictionary for the word at point\n")
    (princ "Tap a link            follow it           ,   .   previous / next dictionary word\n")
    (princ "                                          j   k   next / previous word, looked up at once\n")
    (princ "Long press / right    next translation    t   languages: English, Русский, both\n")
    (princ "Top bar               words, dictionary   v   next translation of the language at point\n")
    (princ "Bottom bar            paging, cantos      SPC DEL   page down / up\n")
    (princ "                                          b   second translation under the first\n")
    (princ "                                          n   p   next / previous canto     SPC  DEL  page down / up\n")
    (princ "                                          r   references    g   glossary    l   back    ?   this help    q   quit\n")
    (princ "\nIn the dictionary window: t languages, q close.  Everything above also has a C-c C-<letter> form.\n")))

(defun firstpair-reader--apply-touch (bundle)
  "Give the current reader buffer its button bar and turn on mouse reporting.
Terminals that report only focus (iSH sends ESC [ I on a tap) have those
sequences decoded as focus events, so a tap never reads as M-[ I."
  (when firstpair-reader-touch
    ;; Only the book's own window carries the bars; the references manual
    ;; below it keeps Info's plain header and mode line.
    (when (equal (firstpair-bundle-manual) (firstpair-bundle-reader bundle))
      (setq header-line-format (firstpair-reader--reader-bar bundle))
      (setq mode-line-format (append (firstpair-reader--movement-bar) (list " " '(:eval (or Info-current-node ""))))))
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
  "Read a FirstPair bundle: references below the text, dictionary below both.
\\{firstpair-reader-mode-map}"
  :lighter " FirstPair"
  :keymap firstpair-reader-mode-map
  (unless firstpair-reader-mode
    (firstpair-reader--unmark)))

(provide 'firstpair-reader)
;;; firstpair-reader.el ends here
