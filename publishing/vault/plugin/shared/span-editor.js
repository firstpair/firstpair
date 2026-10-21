"use strict";

/*
 * The span editor shared by every FirstPair reader (FirstPair Triptych and
 * FirstPair Reader 2).  An improvement here reaches both.
 *
 *   createWordPicker  word chips for one sentence or paragraph: on a touch
 *                     screen the whole word is the target (tap, or drag across
 *                     words); with a mouse each word has a checkbox and Only.
 *   paintSpans        saved spans coloured on the text itself: only
 *                     overlapping spans take different colours (three at
 *                     most), a word in two or three spans is striped, and a
 *                     tap opens the span or a chooser.
 *   overlapAllowed    refuses a fourth overlapping span.
 *   renderSavedRows   one row per saved span with Change and Remove.
 *
 * Text positions are Unicode code points, as the shared ledger requires.
 * Containers may hold Reader controls marked [data-reader-ui]; their text is
 * not part of the span text.
 */

const {
  MAX_SPAN_OVERLAP,
  codePointLength,
  makeSelector,
  overlapDepth,
  resolveAnnotation,
  selectedTokenRange,
  spanColors,
} = require("../firstpair-triptych/review-state");

// deps: { Notice, Platform, t, actionLabel }
module.exports = function spanEditor(deps) {
  const { Notice, Platform, t } = deps;
  const actionLabel = deps.actionLabel || ((action) => t(`action_${action}`));

  function isTouchDevice() {
    if (Platform && Platform.isMobile) return true;
    try {
      return typeof window !== "undefined" && Boolean(window.matchMedia)
        && window.matchMedia("(pointer: coarse)").matches;
    } catch (_error) {
      return false;
    }
  }

  // A note with a recording is a voice span: it takes the voice palette.
  const isVoice = (record) => Array.isArray(record.voice) && record.voice.length > 0;
  // The colour token of one span: its overlap colour in its own palette.
  function fillToken(record, colors) {
    return `${isVoice(record) ? "voice" : "span"}-${colors.get(record.id) || 0}`;
  }

  // A span's colour, or the stripes of the two or three spans on one word.
  // Each entry is a token ("span-1", "voice-0") or a bare overlap index.
  function spanFill(colors) {
    const palette = colors.map((color) => `var(--lt-${typeof color === "number" ? `span-${color}` : color})`);
    if (palette.length === 1) return palette[0];
    const band = 7;
    const stops = palette.map((value, index) => `${value} ${index * band}px ${(index + 1) * band}px`);
    return `repeating-linear-gradient(135deg, ${stops.join(", ")})`;
  }

  // Up to three saved spans may cover one word; editing a span over the same
  // words is always allowed.
  function overlapAllowed(records, text, selector) {
    const others = (records || []).filter((record) => !(
      Number(record.start) === selector.start && Number(record.end) === selector.end
    ));
    if (overlapDepth(text, others, selector.start, selector.end) < MAX_SPAN_OVERLAP) return true;
    new Notice(t("overlap_limit"));
    return false;
  }

  /* --------------------------------------------------------------- marks */

  function textNodes(container) {
    const document = container.ownerDocument;
    const walker = document.createTreeWalker(container, 4, {
      acceptNode(node) {
        for (let element = node.parentElement; element && element !== container; element = element.parentElement) {
          if (element.hasAttribute && element.hasAttribute("data-reader-ui")) return 2;
        }
        return 1;
      },
    });
    const nodes = [];
    let text = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      nodes.push({ node, start: text.length, end: text.length + node.data.length });
      text += node.data;
    }
    return { text, nodes };
  }

  function unwrapMarks(container) {
    for (const mark of Array.from(container.querySelectorAll("mark.lt-phrase-mark"))) {
      mark.replaceWith(...mark.childNodes);
    }
    container.normalize();
  }

  // Colour saved spans on the container's own text nodes, keeping its markup.
  // Returns the colour map and the records whose quote no longer resolves.
  function paintSpans(container, records, options = {}) {
    unwrapMarks(container);
    const map = textNodes(container);
    const points = Array.from(map.text);
    const units = (offset) => points.slice(0, offset).join("").length;
    const colors = spanColors(map.text, records);
    const resolved = [];
    const unmatched = [];
    for (const record of records) {
      const at = resolveAnnotation(map.text, record);
      if (at) resolved.push({ record, start: units(at.start), end: units(at.end) });
      else unmatched.push(record);
    }
    const bounds = new Set();
    for (const entry of resolved) {
      bounds.add(entry.start);
      bounds.add(entry.end);
    }
    const cuts = [...bounds].sort((left, right) => left - right);
    // Split text nodes at every span boundary, then wrap each covered piece.
    for (const entry of map.nodes) {
      const inside = cuts.filter((cut) => cut > entry.start && cut < entry.end);
      let node = entry.node;
      let offset = entry.start;
      for (const cut of inside) {
        node = node.splitText(cut - offset);
        offset = cut;
      }
    }
    const fresh = textNodes(container);
    for (const piece of fresh.nodes) {
      const covering = resolved.filter((entry) => entry.start <= piece.start && piece.end <= entry.end);
      if (!covering.length || !piece.node.data) continue;
      const spanRecords = covering.map((entry) => entry.record);
      const actions = [...new Set(spanRecords.map((record) => record.action).filter(Boolean))];
      const mark = container.ownerDocument.createElement("mark");
      mark.className = ["lt-phrase-mark", ...actions.map((action) => `lt-phrase-${action}`),
        spanRecords.length > 1 ? "lt-phrase-overlap" : ""].filter(Boolean).join(" ");
      mark.setAttribute("role", "button");
      mark.setAttribute("tabindex", "0");
      if (spanRecords.some(isVoice)) mark.classList.add("lt-phrase-voice");
      mark.style.background = spanFill(spanRecords.map((record) => fillToken(record, colors)));
      piece.node.parentNode.insertBefore(mark, piece.node);
      mark.appendChild(piece.node);
      const activate = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (spanRecords.length === 1) options.onOpen?.(spanRecords[0], mark);
        else chooseSpan(spanRecords, colors, { anchor: mark, onOpen: (record) => options.onOpen?.(record, mark) });
      };
      mark.addEventListener("click", activate);
      mark.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") activate(event);
      });
    }
    return { colors, unmatched };
  }

  // Several spans under one tap: name each and open the one chosen.
  function chooseSpan(records, colors, { anchor, onOpen }) {
    const document = anchor.ownerDocument;
    for (const prior of document.querySelectorAll(".lt-selection-menu")) prior.remove();
    const menu = document.createElement("div");
    menu.className = "lt-selection-menu lt-span-chooser";
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", t("spans_choose"));
    const heading = document.createElement("div");
    heading.className = "lt-variant-heading";
    heading.textContent = t("spans_choose");
    menu.appendChild(heading);
    for (const record of records) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lt-span-choice";
      const swatch = document.createElement("span");
      swatch.className = "lt-span-swatch";
      swatch.style.background = spanFill([fillToken(record, colors)]);
      const label = actionLabel(isVoice(record) ? "voice" : record.action);
      button.append(swatch, document.createTextNode(`“${record.exact}” · ${label}`));
      button.addEventListener("click", () => {
        menu.remove();
        onOpen(record);
      });
      menu.appendChild(button);
    }
    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    const view = document.defaultView;
    const menuRect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, view.innerWidth - menuRect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 6, view.innerHeight - menuRect.height - 8))}px`;
    const dismiss = (event) => {
      if (!menu.contains(event.target)) {
        menu.remove();
        document.removeEventListener("pointerdown", dismiss, true);
      }
    };
    document.addEventListener("pointerdown", dismiss, true);
    return menu;
  }

  /* --------------------------------------------------------- word picker */

  // Word chips over `text` (tokens from review-state wordTokens or the
  // builder).  options: { actions: [{ key, label, onSelect(selector) }],
  // onOnly(selector, anchor) (mouse only), onChange(selector) }.
  function createWordPicker(editor, text, tokens, options = {}) {
    const touch = isTouchDevice();
    editor.toggleClass?.("lt-touch-picker", touch);
    const selectAllLabel = editor.createEl("label", { cls: "lt-select-all-words" });
    const selectAll = selectAllLabel.createEl("input", { type: "checkbox" });
    selectAllLabel.createSpan({ text: t("whole_sentence") });
    editor.createSpan({ cls: "lt-word-help", text: t(touch ? "words_hint_touch" : "words_hint") });
    const tokenList = editor.createSpan({ cls: "lt-word-token-list" });
    const summary = editor.createSpan({ cls: "lt-word-summary", text: t("select_hint") });
    const actionRow = editor.createSpan({ cls: "lt-word-actions" });
    const checks = new Map();
    const picker = { selector: null, tokens, checks, editor };

    const update = () => {
      const selected = [...checks.entries()].filter(([, box]) => box.checked).map(([key]) => key);
      selectAll.checked = Boolean(tokens.length && selected.length === tokens.length);
      selectAll.indeterminate = Boolean(selected.length && selected.length < tokens.length);
      for (const box of checks.values()) box.closest("label")?.toggleClass("is-selected", box.checked);
      selectAllLabel.toggleClass("is-selected", selectAll.checked);
      try {
        picker.selector = selected.length ? selectedTokenRange(text, tokens, selected) : null;
        if (selectAll.checked) {
          picker.selector = makeSelector(text, 0, codePointLength(text), tokens.map((token) => token.key));
        }
        summary.setText(picker.selector ? t("selected_quote", { quote: picker.selector.exact }) : t("select_hint"));
      } catch (_error) {
        picker.selector = null;
        summary.setText(t("one_phrase_hint"));
      }
      for (const button of actionRow.querySelectorAll("button.lt-phrase-action")) button.disabled = !picker.selector;
      clear.disabled = !selected.length;
      options.onChange?.(picker.selector);
    };
    picker.clear = () => {
      for (const box of checks.values()) box.checked = false;
      selectAll.checked = false;
      selectAll.indeterminate = false;
      update();
    };

    // Press a word and drag across its neighbours to select the phrase in one
    // gesture; a plain tap toggles one word.
    let drag = null;
    const applyDrag = (index) => {
      if (!drag) return;
      const first = Math.min(drag.start, index);
      const last = Math.max(drag.start, index);
      tokens.forEach((token, position) => {
        checks.get(token.key).checked = position >= first && position <= last
          ? drag.selecting : drag.original[position];
      });
      update();
    };
    tokenList.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      const hit = editor.ownerDocument.elementFromPoint(event.clientX, event.clientY);
      const target = hit && hit.closest ? hit.closest(".lt-word-token-select[data-token-index]") : null;
      if (target && tokenList.contains(target)) applyDrag(Number(target.dataset.tokenIndex));
    });
    const endDrag = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (tokenList.hasPointerCapture && tokenList.hasPointerCapture(event.pointerId)) {
        tokenList.releasePointerCapture(event.pointerId);
      }
      drag = null;
    };
    tokenList.addEventListener("pointerup", endDrag);
    tokenList.addEventListener("pointercancel", endDrag);

    for (const [index, token] of tokens.entries()) {
      const control = tokenList.createSpan({ cls: "lt-word-token" });
      const label = control.createEl("label", {
        cls: "lt-word-token-select", attr: { "data-token-index": String(index) },
      });
      const box = label.createEl("input", { type: "checkbox" });
      label.createSpan({ text: token.text });
      checks.set(token.key, box);
      label.addEventListener("pointerdown", (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        drag = {
          start: index,
          pointerId: event.pointerId,
          selecting: !box.checked,
          original: tokens.map((item) => checks.get(item.key).checked),
        };
        if (tokenList.setPointerCapture) tokenList.setPointerCapture(event.pointerId);
        applyDrag(index);
      });
      // The gesture already toggled; keyboard activation (detail 0) toggles here.
      label.addEventListener("click", (event) => {
        event.preventDefault();
        if (event.detail === 0) {
          box.checked = !box.checked;
          update();
        }
      });
      box.addEventListener("change", update);
      if (!touch && options.onOnly) {
        const only = control.createEl("button", {
          cls: "lt-word-only", text: t("only"), attr: { type: "button", title: t("only_title", { word: token.text }) },
        });
        only.addEventListener("click", () => {
          for (const other of checks.values()) other.checked = false;
          box.checked = true;
          update();
          if (picker.selector) options.onOnly({ ...picker.selector }, only);
        });
      }
    }
    for (const action of options.actions || []) {
      const button = actionRow.createEl("button", {
        cls: `lt-phrase-action lt-action-${action.key}`,
        text: action.label || actionLabel(action.key),
        attr: { type: "button", disabled: "disabled" },
      });
      button.addEventListener("click", () => {
        if (picker.selector) void action.onSelect({ ...picker.selector }, button);
      });
    }
    const clear = actionRow.createEl("button", {
      cls: "lt-clear-word-selection", text: t("clear_selection"), attr: { type: "button", disabled: "disabled" },
    });
    clear.addEventListener("click", () => picker.clear());
    selectAll.addEventListener("change", () => {
      for (const box of checks.values()) box.checked = selectAll.checked;
      update();
    });

    // Chips carry their spans' colours, so earlier spans show before a new
    // selection starts.
    picker.paint = (records) => {
      const colors = spanColors(text, records);
      const spans = records.map((record) => ({ record, at: resolveAnnotation(text, record) })).filter((entry) => entry.at);
      for (const token of tokens) {
        const label = checks.get(token.key)?.closest("label");
        if (!label) continue;
        const covering = spans.filter((entry) => entry.at.start < token.end && token.start < entry.at.end);
        label.toggleClass("lt-token-in-span", covering.length > 0);
        label.style.background = covering.length
          ? spanFill(covering.map((entry) => fillToken(entry.record, colors))) : "";
      }
    };
    picker.clear();
    return picker;
  }

  /* ---------------------------------------------------------- saved rows */

  // One row per saved span: its words and label, Change, and Remove (two
  // taps when removal also discards recordings).
  function renderSavedRows(container, records, options) {
    container.empty();
    container.hidden = records.length === 0;
    if (!records.length) return;
    container.createSpan({ cls: "lt-saved-heading", text: t("saved_phrases") });
    for (const record of records) {
      const item = container.createDiv({ cls: `lt-saved-row lt-saved-${record.action}` });
      const label = item.createEl("button", { cls: "lt-saved-phrase", text: options.label(record), attr: { type: "button" } });
      label.addEventListener("click", () => options.onOpen(record, label));
      const change = item.createEl("button", { cls: "lt-saved-change", text: t("change"), attr: { type: "button" } });
      change.addEventListener("click", () => options.onOpen(record, change));
      const remove = item.createEl("button", { cls: "lt-saved-remove mod-warning", text: t("remove"), attr: { type: "button" } });
      let armed = false;
      remove.addEventListener("click", async () => {
        if (options.confirmRemove?.(record) && !armed) {
          armed = true;
          remove.setText(t("confirm_delete_clip"));
          container.ownerDocument.defaultView.setTimeout(() => {
            armed = false;
            remove.setText(t("remove"));
          }, 4000);
          return;
        }
        remove.disabled = true;
        try {
          await options.onRemove(record);
        } catch (error) {
          remove.disabled = false;
          new Notice(t("phrase_choice_failed", { error: error.message || error }));
        }
      });
    }
  }

  return {
    chooseSpan, createWordPicker, fillToken, isTouchDevice, overlapAllowed, paintSpans, renderSavedRows, spanFill, textNodes,
  };
};
