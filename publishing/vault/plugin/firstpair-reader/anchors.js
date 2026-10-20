"use strict";

/*
 * Text-quote anchors on a rendered Reader page (optional span notes).
 *
 * A page's text is the concatenation of its text nodes, in document order,
 * excluding Reader controls (anything inside [data-reader-ui]).  Selectors are
 * stored in Unicode code points, as the shared ledger requires: exact text,
 * 32 code points of prefix and suffix, and start/end offsets.  Highlighting
 * re-anchors on the exact quote (prefix/suffix break ties) and wraps each
 * text-node segment of the match in a <mark>, so the page's own markup stays
 * intact.
 */

const {
  codePointLength,
  makeSelector,
  resolveAnnotation,
} = require("../firstpair-triptych/review-state");

function textNodes(root) {
  const document = root.ownerDocument;
  const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, {
    acceptNode(node) {
      for (let element = node.parentElement; element && element !== root; element = element.parentElement) {
        if (element.hasAttribute && element.hasAttribute("data-reader-ui")) return 2; // FILTER_REJECT
      }
      return 1; // FILTER_ACCEPT
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

// UTF-16 offset of a DOM point within the page text, or -1 when outside.
function offsetOf(map, container, offset) {
  for (const entry of map.nodes) {
    if (entry.node === container) return entry.start + offset;
  }
  if (container.nodeType === 1) {
    const child = container.childNodes[offset] || null;
    for (const entry of map.nodes) {
      if (child && (child === entry.node || child.contains(entry.node))) return entry.start;
    }
    if (offset >= container.childNodes.length) {
      let last = -1;
      for (const entry of map.nodes) if (container.contains(entry.node)) last = entry.end;
      return last;
    }
  }
  return -1;
}

// The code-point selector for a DOM Range inside the page, or null.
function selectorFromRange(root, range) {
  if (!range || range.collapsed || !root.contains(range.commonAncestorContainer)) return null;
  const map = textNodes(root);
  const startUnit = offsetOf(map, range.startContainer, range.startOffset);
  const endUnit = offsetOf(map, range.endContainer, range.endOffset);
  if (startUnit < 0 || endUnit <= startUnit) return null;
  let from = startUnit;
  let to = endUnit;
  while (from < to && /\s/.test(map.text[from])) from += 1;
  while (to > from && /\s/.test(map.text[to - 1])) to -= 1;
  if (to <= from) return null;
  const start = codePointLength(map.text.slice(0, from));
  const end = start + codePointLength(map.text.slice(from, to));
  return makeSelector(map.text, start, end);
}

function unitsFromPoints(text, points) {
  return Array.from(text).slice(0, points).join("").length;
}

// Wrap the selector's match in marks; returns the marks, or [] when the
// quote no longer resolves uniquely (the note is then listed as unmatched).
function highlight(root, selector, className, onActivate) {
  const map = textNodes(root);
  const resolved = resolveAnnotation(map.text, selector);
  if (!resolved) return [];
  const from = unitsFromPoints(map.text, resolved.start);
  const to = unitsFromPoints(map.text, resolved.end);
  const marks = [];
  for (const entry of map.nodes) {
    const segmentStart = Math.max(from, entry.start);
    const segmentEnd = Math.min(to, entry.end);
    if (segmentEnd <= segmentStart) continue;
    let node = entry.node;
    const localStart = segmentStart - entry.start;
    const localEnd = segmentEnd - entry.start;
    if (localEnd < node.data.length) node.splitText(localEnd);
    if (localStart > 0) node = node.splitText(localStart);
    const mark = root.ownerDocument.createElement("mark");
    mark.className = className;
    mark.setAttribute("role", "button");
    mark.setAttribute("tabindex", "0");
    node.parentNode.insertBefore(mark, node);
    mark.appendChild(node);
    if (onActivate) {
      mark.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onActivate(mark);
      });
      mark.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate(mark);
        }
      });
    }
    marks.push(mark);
  }
  return marks;
}

module.exports = { highlight, selectorFromRange, textNodes };
