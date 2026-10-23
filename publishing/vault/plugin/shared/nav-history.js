"use strict";

/*
 * Back / Forward navigation history shared by every FirstPair reader.
 *
 * Entries are plain data (JSON-safe): whatever a reader needs to return to a
 * place, typically { view, state, scrollTop }.  Going somewhere new records
 * where you were and clears Forward; Back and Forward each move the current
 * place to the other stack, as a browser does.  Both stacks are bounded.
 *
 * FirstPair Triptych keeps one history per workspace leaf, so the Reader,
 * Review, and a note opened in the same pane share it; the FirstPair Reader
 * keeps one per view.
 */

const DEFAULT_LIMIT = 100;

class NavHistory {
  constructor(limit = DEFAULT_LIMIT) {
    this.limit = limit;
    this.backStack = [];
    this.forwardStack = [];
    this.listeners = new Set();
  }

  // Leaving `current` for somewhere new.
  visit(current) {
    if (!current) return;
    const last = this.backStack[this.backStack.length - 1];
    if (!last || JSON.stringify(last) !== JSON.stringify(current)) {
      this.backStack.push(current);
      if (this.backStack.length > this.limit) this.backStack.shift();
    }
    this.forwardStack = [];
    this.changed();
  }

  // The place to show instead of `current`, or null.
  back(current) {
    const target = this.backStack.pop();
    if (!target) return null;
    if (current) this.forwardStack.push(current);
    if (this.forwardStack.length > this.limit) this.forwardStack.shift();
    this.changed();
    return target;
  }

  forward(current) {
    const target = this.forwardStack.pop();
    if (!target) return null;
    if (current) this.backStack.push(current);
    if (this.backStack.length > this.limit) this.backStack.shift();
    this.changed();
    return target;
  }

  canBack() {
    return this.backStack.length > 0;
  }

  canForward() {
    return this.forwardStack.length > 0;
  }

  clear() {
    this.backStack = [];
    this.forwardStack = [];
    this.changed();
  }

  // listener() runs after every change; returns an unsubscribe function.
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  changed() {
    for (const listener of [...this.listeners]) listener(this);
  }
}

// One history per key (a workspace leaf), created on first use.
function historyRegistry(limit = DEFAULT_LIMIT) {
  const histories = new WeakMap();
  return (key) => {
    if (!histories.has(key)) histories.set(key, new NavHistory(limit));
    return histories.get(key);
  };
}

module.exports = { DEFAULT_LIMIT, NavHistory, historyRegistry };
