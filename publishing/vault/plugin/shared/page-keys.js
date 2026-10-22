"use strict";

/*
 * Left and Right arrows turn pages in a FirstPair reader view on a hardware
 * keyboard (a Mac, or an iPad with a keyboard), shared by FirstPair Triptych
 * and the FirstPair Reader.  The keys belong to the reader only while its
 * leaf is the active one and nothing else wants them: a text field, a menu
 * or dialog, a modifier chord, or an element marked [data-keep-arrows].
 */

const TEXT_INPUT = /^(INPUT|TEXTAREA|SELECT)$/;
const OPEN_LAYERS = [
  ".modal-container",
  ".menu",
  ".suggestion-container",
  ".lt-correction-overlay",
  ".lt-selection-menu",
  ".lt-span-chooser",
].join(", ");

function wantsArrows(event, document) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return true;
  const target = event.target;
  if (target && (target.isContentEditable || TEXT_INPUT.test(target.tagName || ""))) return true;
  if (target && target.closest && target.closest("[data-keep-arrows]")) return true;
  return Boolean(document.querySelector(OPEN_LAYERS));
}

// view: an Obsidian ItemView; previous/next: page turns; isActive(): whether
// this view should take the keys now.  Bound once per view.
function bindPageKeys(view, { previous, next, isActive }) {
  if (view.__firstpairPageKeys) return;
  view.__firstpairPageKeys = true;
  const document = view.containerEl.ownerDocument;
  view.registerDomEvent(document, "keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (!view.containerEl.isConnected || !isActive() || wantsArrows(event, document)) return;
    event.preventDefault();
    void (event.key === "ArrowLeft" ? previous() : next());
  });
}

module.exports = { bindPageKeys, wantsArrows };
