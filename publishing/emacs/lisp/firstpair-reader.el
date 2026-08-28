;;; firstpair-reader.el --- Read a FirstPair book in Emacs Info  -*- lexical-binding: t; -*-

;; Copyright (C) 2026 First Pair Press
;; Author: First Pair Press
;; Version: 1.0
;; Package-Requires: ((emacs "28.1"))
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

(defun firstpair-reader--redirect-role (nodename)
  "Return the window role NODENAME should open in, or nil to follow it here."
  (let* ((target (firstpair-reader--parse-target nodename))
         (bundle (and target (firstpair-bundle-for-manual (car target)))))
    (when bundle
      (let ((role (if (equal (car target) (firstpair-bundle-reference bundle))
                      'references
                    'reader)))
        (unless (eq role (firstpair-reader--role))
          role)))))

(defun firstpair-reader--goto-node-advice (original nodename &rest arguments)
  "Open NODENAME in the window its manual belongs to while a reader command runs.
ORIGINAL is `Info-goto-node'; ARGUMENTS are passed through to it."
  (let ((role (and firstpair-reader--redirecting
                   (firstpair-reader--redirect-role nodename))))
    (if role
        (firstpair-reader--goto role nodename)
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
             (limit (line-end-position)))
        (if (and (<= end limit)
                 (equal (firstpair-lexicon-normalise (buffer-substring-no-properties start end))
                        form))
            (cons start end)
          (let (found)
            (while (and (not found) (re-search-forward "[[:alpha:]]+" limit t))
              (when (equal (firstpair-lexicon-normalise (match-string-no-properties 0)) form)
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
           (when Info-hide-note-references
             (firstpair-reader--tidy-references bundle)))
          (firstpair-reader-mode
           (firstpair-reader-mode -1)))))

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
    (firstpair-reader--show (firstpair-lexicon-render bundle word) 'lexicon)
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
                              (format "(%s)%s" (firstpair-bundle-reference bundle)
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

(defun firstpair-reader-glossary ()
  "Open the glossary of dictionary words in the references window."
  (interactive)
  (let* ((bundle (firstpair-reader--bundle))
         (language (alist-get 'language (firstpair-bundle-lexicon bundle)))
         (node (format "%s Glossary" (capitalize (or language "")))))
    (condition-case nil
        (firstpair-reader--goto 'references
                                (format "(%s)%s" (firstpair-bundle-reference bundle) node))
      (error (user-error "This edition has no glossary")))))

(defun firstpair-reader-other-window ()
  "Move between the reader, references, and dictionary windows."
  (interactive)
  (let* ((windows (delq nil (mapcar #'firstpair-reader--window '(reader references lexicon))))
         (position (seq-position windows (selected-window)))
         (target (and windows (nth (mod (1+ (or position -1)) (length windows)) windows))))
    (when target (select-window target))))

(defun firstpair-reader--choose (root)
  "Return the bundle at ROOT, or let the user pick a registered bundle."
  (cond (root (firstpair-reader-register root))
        ((null firstpair-bundles)
         (user-error "No FirstPair bundle is registered; load a bundle's init.el first"))
        ((null (cdr firstpair-bundles)) (cdar firstpair-bundles))
        (t (let* ((titles (mapcar (lambda (entry)
                                    (cons (firstpair-bundle-title (cdr entry)) (cdr entry)))
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
        (firstpair-reader--goto 'reader (format "(%s)Top" (firstpair-bundle-reader bundle))))
      (if (buffer-live-p references)
          (firstpair-reader--show references 'references)
        (firstpair-reader--goto 'references
                                (format "(%s)Top" (firstpair-bundle-reference bundle))))
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
    (let ((window (firstpair-reader--claim (selected-window) 'reader)))
      (firstpair-reader--goto 'reader (format "(%s)Top" (firstpair-bundle-reader bundle)))
      (firstpair-reader--goto 'references (format "(%s)Top" (firstpair-bundle-reference bundle)))
      (select-window window)
      bundle)))

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
    (define-key map (kbd "C-c C-l") #'firstpair-reader-layout)
    (define-key map (kbd "C-c C-o") #'firstpair-reader-other-window)
    (define-key map [remap Info-follow-nearest-node] #'firstpair-reader-follow-nearest-node)
    (define-key map [remap Info-mouse-follow-nearest-node] #'firstpair-reader-mouse-follow-nearest-node)
    (define-key map [remap Info-follow-reference] #'firstpair-reader-follow-reference)
    map)
  "Keymap for `firstpair-reader-mode'.")

;;;###autoload
(define-minor-mode firstpair-reader-mode
  "Read a FirstPair bundle: references below the text, dictionary below both.
\\{firstpair-reader-mode-map}"
  :lighter " FirstPair"
  :keymap firstpair-reader-mode-map
  (unless firstpair-reader-mode
    (firstpair-reader--unmark)))

(provide 'firstpair-reader)
;;; firstpair-reader.el ends here
