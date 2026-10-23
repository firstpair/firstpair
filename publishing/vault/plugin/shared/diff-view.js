"use strict";

/*
 * Precomputed edition diffs (firstpair.edition-diffs.v1 and v2), shared by
 * every FirstPair reader.  The builder (publishing/vault/edition_diffs.py)
 * writes <book>/_data/<diffs file>: for each page, every pair of editions
 * and the whole set, as code-point ranges over each pane's text.  Nothing is
 * diffed on the device; a reader only picks the entry for the panes it shows:
 *
 *   two panes     the pair: the earlier pane marks what it lost ("del"),
 *                 the later what it gained ("ins"); v2 ranges also carry
 *                 the change's category (punct ... moved), which filters
 *   three panes   the set: words in no other pane ("uniq"), words shared
 *                 with exactly one other pane ("share:<edition>"); a history
 *                 lens narrows it to what the latest edition rewrote of
 *                 settled text, to reverts, or to what is new
 *
 * v2 files also carry recurring one-word substitutions ("rules") and a
 * per-Part summary, which renderRules and renderSummary draw for a review
 * page.  paint() wraps ranges inside an element whose text starts at a
 * known code-point offset of the pane text; it walks text nodes only, so
 * span marks and other wrappers already there survive.  Elements marked
 * [data-reader-ui] are skipped.
 */

const DIFFS_SCHEMAS = new Set(["firstpair.edition-diffs.v1", "firstpair.edition-diffs.v2"]);
const DIFFS_SCHEMA = "firstpair.edition-diffs.v2";
const KIND_RE = /^(del|ins|uniq|part|share:.+)$/;
// Ordered by risk: the order filters and summaries use.
const CATEGORIES = ["punct", "inflect", "function", "lexical", "restructure", "rewrite", "content", "moved"];
const LENSES = ["all", "rewritten", "reverts", "new"];

function parseDiffs(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  if (!data || !DIFFS_SCHEMAS.has(data.schema) || !Array.isArray(data.editions)) {
    throw new Error("unsupported edition diffs file");
  }
  const object = (value) => (value && typeof value === "object" ? value : {});
  return {
    editions: data.editions.map(String),
    pages: object(data.pages),
    rules: object(data.rules),
    summary: object(data.summary),
    categories: Array.isArray(data.categories) ? data.categories.map(String) : [],
  };
}

// The ranges for each shown edition, or null when fewer than two editions
// are shown.  The key follows the file's edition order, whatever order the
// panes are drawn in.
function diffFor(diffs, pageKey, shownEditions) {
  if (!diffs) return null;
  const shown = diffs.editions.filter((edition) => shownEditions.includes(edition));
  if (shown.length < 2) return null;
  const mode = shown.length === 2 ? "pair" : "all";
  const entry = diffs.pages[pageKey];
  if (!entry) return { mode, ranges: {}, editions: shown, same: true };
  return { mode, ranges: entry[shown.join("|")] || {}, editions: shown, same: false };
}

// History lens over the set: which (edition, kind) marks to keep.  Editions
// are in reading order; the last is the latest, the first the earliest.
function lensAccepts(lens, editions, edition, kind) {
  if (!lens || lens === "all") return true;
  const first = editions[0];
  const last = editions[editions.length - 1];
  const share = kind.startsWith("share:") ? kind.slice(6) : null;
  if (lens === "new") return edition === last && kind === "uniq";
  if (lens === "rewritten") {
    // Text the earlier editions agreed on, and what the latest put instead.
    if (edition === last) return kind === "uniq";
    return share !== null && share !== last;
  }
  if (lens === "reverts") {
    // The latest went back to the earliest wording; the middle lost its own.
    if (edition === last) return share === first;
    if (edition === first) return share === last;
    return kind === "uniq";
  }
  return true;
}

function kindClasses(kind, editions, category) {
  const classes = ["fp-diff"];
  if (kind.startsWith("share:")) {
    const index = editions.indexOf(kind.slice(6));
    classes.push("fp-diff-share", `fp-diff-ed-${index < 0 ? 0 : index % 3}`);
  } else {
    classes.push(`fp-diff-${kind}`);
  }
  if (category) classes.push(`fp-diff-cat-${category}`);
  return classes;
}

function textNodesOf(element) {
  const nodes = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) nodes.push(child);
      else if (child.nodeType === 1 && !child.hasAttribute("data-reader-ui")) walk(child);
    }
  };
  walk(element);
  return nodes;
}

// Code-point offset -> UTF-16 index inside one string.
function utf16Index(text, codePoints) {
  let index = 0;
  for (let seen = 0; seen < codePoints && index < text.length; seen += 1) {
    index += text.codePointAt(index) > 0xffff ? 2 : 1;
  }
  return index;
}

// The ranges a view shows: categories hidden by the reader and marks the
// lens rejects are dropped before painting.
function visibleRanges(ranges, options = {}) {
  const hidden = options.hiddenCategories || {};
  return (ranges || []).filter(([, , kind, category]) => (
    KIND_RE.test(kind)
    && !(category && hidden[category])
    && (!options.lens || lensAccepts(options.lens, options.lensEditions || [], options.edition, kind))
  ));
}

// Wrap the parts of `element` covered by `ranges`; the element's text begins
// at code point `offset` of the pane text.  `titleFor(range)` names a mark.
function paint(element, ranges, offset = 0, options = {}) {
  const shown = visibleRanges(ranges, options);
  if (!element || !shown.length) return;
  const editions = options.editions || [];
  const titleFor = options.titleFor || (() => "");
  const document = element.ownerDocument;
  let cursor = offset;
  for (const node of textNodesOf(element)) {
    const text = node.data;
    const length = Array.from(text).length;
    const start = cursor;
    const end = cursor + length;
    cursor = end;
    const hits = shown.filter(([from, to]) => from < end && start < to);
    if (!hits.length) continue;
    // Cut the node at every range boundary inside it, left to right.
    const cuts = new Set();
    for (const [from, to] of hits) {
      if (from > start) cuts.add(from - start);
      if (to < end) cuts.add(to - start);
    }
    const pieces = [];
    let rest = node;
    let restStart = 0;
    for (const cut of [...cuts].sort((a, b) => a - b)) {
      const tail = rest.splitText(utf16Index(rest.data, cut - restStart));
      pieces.push({ node: rest, from: start + restStart });
      rest = tail;
      restStart = cut;
    }
    pieces.push({ node: rest, from: start + restStart });
    for (const piece of pieces) {
      const hit = hits.find(([from, to]) => from <= piece.from && piece.from < to);
      if (!hit || !piece.node.data.trim()) continue;
      const mark = document.createElement("span");
      mark.className = kindClasses(hit[2], editions, hit[3]).join(" ");
      const title = titleFor(hit);
      if (title) mark.title = title;
      if (hit[4]) mark.setAttribute("data-fp-target", hit[4]);
      piece.node.parentNode.insertBefore(mark, piece.node);
      mark.appendChild(piece.node);
    }
  }
}

// Paint every element of a pane body that declares its offset with
// data-fp-offset (text runs drawn straight from the pane text).
function paintPane(body, ranges, options = {}) {
  if (!body || !ranges || !ranges.length) return;
  for (const element of body.querySelectorAll("[data-fp-offset]")) {
    paint(element, ranges, Number(element.getAttribute("data-fp-offset")) || 0, options);
  }
}

// Remove diff marks, restoring the plain text nodes.
function clear(element) {
  for (const mark of [...element.querySelectorAll("span.fp-diff")]) {
    mark.replaceWith(...mark.childNodes);
  }
  element.normalize();
}

// Pair keys of a file in reading order ("A|B", "A|C", "B|C").
function pairKeys(diffs) {
  const keys = [];
  diffs.editions.forEach((left, i) => {
    diffs.editions.slice(i + 1).forEach((right) => keys.push(`${left}|${right}`));
  });
  return keys;
}

// The book-wide rules of one pair, each with Accept / Reject.  `decisions`
// maps rule id -> "accept" | "reject"; onDecide(rule, decision|null) saves.
function renderRules(container, diffs, pair, options) {
  const { t, onDecide, onOpen } = options;
  const pageTitle = options.pageTitle || ((key) => key);
  const decisions = options.decisions || {};
  const rules = diffs.rules[pair] || [];
  const list = container.createDiv({ cls: "fp-rules" });
  if (!rules.length) {
    list.createEl("p", { cls: "fp-rules-empty", text: t("rules_none") });
    return list;
  }
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  for (const rule of rules) {
    const row = list.createDiv({ cls: "fp-rule" });
    const decision = decisions[rule.id] || "";
    if (decision) row.addClass(`fp-rule-${decision}`);
    const head = row.createDiv({ cls: "fp-rule-head" });
    head.createSpan({ cls: "fp-rule-from", text: rule.from });
    head.createSpan({ cls: "fp-rule-arrow", text: " → " });
    head.createSpan({ cls: "fp-rule-to", text: rule.to });
    head.createSpan({ cls: "fp-rule-count", text: ` ${t("rules_count", { count: rule.count, pages: rule.pages })}` });
    if (rule.reverse_count) {
      const opposite = byId.get(rule.reverse);
      head.createSpan({
        cls: "fp-rule-conflict",
        text: t("rules_conflict", { from: rule.to, to: rule.from, count: rule.reverse_count }),
        attr: { title: opposite ? t("rules_conflict_title") : "" },
      });
    }
    const actions = row.createDiv({ cls: "fp-rule-actions" });
    for (const choice of ["accept", "reject"]) {
      const button = actions.createEl("button", {
        cls: `fp-rule-${choice}-button${decision === choice ? " is-active" : ""}`,
        text: t(`rules_${choice}`),
        attr: { type: "button", "aria-pressed": decision === choice ? "true" : "false" },
      });
      button.addEventListener("click", () => onDecide(rule, decision === choice ? null : choice));
    }
    const places = actions.createEl("button", {
      cls: "fp-rule-places-button", text: t("rules_places"), attr: { type: "button", "aria-expanded": "false" },
    });
    const placeList = row.createDiv({ cls: "fp-rule-places" });
    placeList.hidden = true;
    const fillPlaces = () => {
      if (!placeList.childElementCount) {
        const seen = new Set();
        for (const [key] of rule.occurrences) {
          if (seen.has(key)) continue;
          seen.add(key);
          const link = placeList.createEl("button", {
            cls: "fp-rule-place", text: pageTitle(key), attr: { type: "button" },
          });
          link.addEventListener("click", () => onOpen(key));
        }
      }
    };
    const setOpen = (open) => {
      if (open) fillPlaces();
      placeList.hidden = !open;
      places.setAttribute("aria-expanded", open ? "true" : "false");
    };
    // A rule opened before (options.expanded) shows its pages again.
    if (options.expanded && options.expanded.has(rule.id)) setOpen(true);
    places.addEventListener("click", () => {
      setOpen(placeList.hidden);
      if (options.onToggle) options.onToggle(rule.id, !placeList.hidden);
    });
  }
  return list;
}

// Words changed per Part and category for one pair: one stacked bar per
// Part, widths relative to the busiest Part.
function renderSummary(container, diffs, pair, options) {
  const { t } = options;
  const parts = options.parts || [];
  const data = diffs.summary[pair] || {};
  const wrap = container.createDiv({ cls: "fp-heat" });
  const legend = wrap.createDiv({ cls: "fp-heat-legend" });
  for (const category of CATEGORIES) {
    const item = legend.createSpan({ cls: "fp-heat-key" });
    item.createSpan({ cls: `fp-heat-swatch fp-heat-${category}` });
    item.createSpan({ text: t(`diff_cat_${category}`) });
  }
  const totals = parts.map((part) => CATEGORIES.reduce((sum, c) => sum + ((data[part.id] || {})[c] || 0), 0));
  const busiest = Math.max(1, ...totals);
  parts.forEach((part, index) => {
    const row = wrap.createDiv({ cls: "fp-heat-row" });
    const label = row.createEl(options.onOpenPart ? "button" : "span", {
      cls: "fp-heat-label", text: part.title, attr: options.onOpenPart ? { type: "button" } : {},
    });
    if (options.onOpenPart) label.addEventListener("click", () => options.onOpenPart(part));
    const bar = row.createDiv({ cls: "fp-heat-bar" });
    bar.style.width = `${Math.max(2, (totals[index] / busiest) * 100)}%`;
    for (const category of CATEGORIES) {
      const words = (data[part.id] || {})[category] || 0;
      if (!words) continue;
      const cell = bar.createSpan({
        cls: `fp-heat-cell fp-heat-${category}`,
        attr: { title: `${t(`diff_cat_${category}`)}: ${words}` },
      });
      cell.style.flexGrow = String(words);
    }
    row.createSpan({ cls: "fp-heat-total", text: String(totals[index]) });
  });
  return wrap;
}

module.exports = {
  CATEGORIES, DIFFS_SCHEMA, LENSES, clear, diffFor, kindClasses, lensAccepts, paint, paintPane,
  pairKeys, parseDiffs, renderRules, renderSummary, visibleRanges,
};
