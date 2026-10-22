"use strict";

/*
 * Precomputed edition diffs (firstpair.edition-diffs.v1), shared by every
 * FirstPair reader.  The builder (publishing/vault/edition_diffs.py) writes
 * <book>/_data/<diffs file>: for each page, every pair of editions and the
 * whole set, as code-point ranges over each pane's text.  Nothing is diffed
 * on the device; a reader only picks the entry for the panes it shows:
 *
 *   two panes     the pair: the earlier pane marks what it lost ("del"),
 *                 the later what it gained ("ins")
 *   three panes   the set: words in no other pane ("uniq"), words shared
 *                 with exactly one other pane ("share:<edition>")
 *
 * paint() wraps ranges inside an element whose text starts at a known
 * code-point offset of the pane text; it walks text nodes only, so span
 * marks and other wrappers already there survive.  Elements marked
 * [data-reader-ui] are skipped.
 */

const DIFFS_SCHEMA = "firstpair.edition-diffs.v1";
const KIND_RE = /^(del|ins|uniq|part|share:.+)$/;

function parseDiffs(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  if (!data || data.schema !== DIFFS_SCHEMA || !Array.isArray(data.editions)) {
    throw new Error("unsupported edition diffs file");
  }
  const pages = data.pages && typeof data.pages === "object" ? data.pages : {};
  return { editions: data.editions.map(String), pages };
}

// The ranges for each shown edition, or null when fewer than two editions
// are shown or the page has no difference.  The key follows the file's
// edition order, whatever order the panes are drawn in.
function diffFor(diffs, pageKey, shownEditions) {
  if (!diffs) return null;
  const shown = diffs.editions.filter((edition) => shownEditions.includes(edition));
  if (shown.length < 2) return null;
  const entry = diffs.pages[pageKey];
  if (!entry) return { mode: shown.length === 2 ? "pair" : "all", ranges: {}, editions: shown, same: true };
  const ranges = entry[shown.join("|")] || {};
  return { mode: shown.length === 2 ? "pair" : "all", ranges, editions: shown, same: false };
}

function kindClasses(kind, editions) {
  if (kind.startsWith("share:")) {
    const index = editions.indexOf(kind.slice(6));
    return ["fp-diff", "fp-diff-share", `fp-diff-ed-${index < 0 ? 0 : index % 3}`];
  }
  return ["fp-diff", `fp-diff-${kind}`];
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

// Wrap the parts of `element` covered by `ranges`; the element's text begins
// at code point `offset` of the pane text.  `titleFor(kind)` names a mark.
function paint(element, ranges, offset = 0, options = {}) {
  if (!element || !ranges || !ranges.length) return;
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
    const hits = ranges.filter(([from, to, kind]) => from < end && start < to && KIND_RE.test(kind));
    if (!hits.length) continue;
    // Cut the node at every range boundary inside it, right to left.
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
      mark.className = kindClasses(hit[2], editions).join(" ");
      const title = titleFor(hit[2]);
      if (title) mark.title = title;
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

module.exports = { DIFFS_SCHEMA, clear, diffFor, kindClasses, paint, paintPane, parseDiffs };
