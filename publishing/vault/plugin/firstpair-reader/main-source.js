/*
 * FirstPair Reader 2 — the offline book reader for every FirstPair vault.
 *
 * One ItemView reads any FirstPair Reader index (contract.js): a plain book,
 * a library of editions, aligned multilingual chapters with dictionaries, a
 * code book with fragment cards.  It is read-only by default; the optional
 * editing tools (settings) attach text and voice notes to selected spans in
 * the shared decisions ledger, as FirstPair Triptych does.
 *
 * Navigation: one rail, Previous · [Previous word] · Up · Back · Top · TOC ·
 * [Next word] · Next, at the bottom or top.  Up climbs page → part →
 * contents → library; TOC shows the contents with the current page marked;
 * Back restores the exact earlier location, scroll and focus; Top is
 * reversible.  Every static fallback note opens the Reader at its place.
 *
 * Several books: a vault whose root and top-level folders hold more than one
 * Reader index gets a shelf.  Each book keeps its own position, Back history,
 * languages, and interface language; Up from a book's contents returns to
 * the shelf.
 */

const obsidian = require("obsidian");
const { ItemView, MarkdownRenderer, Platform, Plugin, PluginSettingTab, Setting, setIcon } = obsidian;
const Notice = obsidian.Notice || class { constructor(message) { console.log(message); } };
const normalizePath = obsidian.normalizePath || ((value) => value);
const requestUrl = obsidian.requestUrl;
const Component = obsidian.Component || class {
  load() {}
  unload() {}
  addChild(child) { return child; }
  register() {}
};

const contract = require("./contract");
const {
  dictionaryLookup, exampleText, LruCache, mergeEntries, normalizeWord,
} = require("./dictionary");
const quotes = require("./quotes");
const bookState = require("./book-state");
const { readerText } = require("./strings");
const reviewState = require("../firstpair-triptych/review-state");
const metricsCore = require("../shared/metrics");

let uiLang = "en";
const t = (key, vars) => readerText(uiLang, key, vars);
// A language's own display name in the interface language (no hard-coded list).
const languageName = (code) => {
  try {
    return new Intl.DisplayNames([uiLang], { type: "language" }).of(code) || code;
  } catch (_error) {
    return code;
  }
};

const { DecisionStore } = require("../shared/ledger-store")({
  normalizePath,
  notifyUnreadable: () => {},
});
const voiceCore = require("../shared/voice-core")({
  Notice, Platform, normalizePath, requestUrl, t: (key, vars) => t(key, vars),
});
// The span editor every FirstPair reader shares (word picker, coloured and
// striped spans, chooser, overlap limit, saved rows).
// One Back/Forward history per view (shared/nav-history.js).
const { NavHistory } = require("../shared/nav-history");
// Left/Right arrows turn pages on a hardware keyboard (shared/page-keys.js).
const { bindPageKeys } = require("../shared/page-keys");
const editor = require("../shared/span-editor")({
  Notice, Platform, t: (key, vars) => t(key, vars),
  actionLabel: (action) => readerText(uiLang, action === "voice" ? "voice" : `action_${action}`),
});
// Blocks a span note may sit in: paragraphs, list items, and headings.
const EDITABLE_BLOCKS = "p, li, h2, h3, h4, h5, h6";

const VIEW_TYPE = "firstpair-reader";
const TARGET_INDEX = "_data/targets.json";
const HISTORY_LIMIT = 100;
const STACK_BELOW = 700;
// The shelf is not a book: its interface stays in the vault default.
const SHELF_LANG = "en";
const FRAGMENT_LANGUAGES = ["firstpair-fragment", "rgbdns-fragment", "sail-fragment"];
const INTERLINEAR = ["text", "pinyin", "gloss"];
const INTERLINEAR_ICONS = { text: ["type"], pinyin: ["a-large-small", "case-sensitive"], gloss: ["book-a", "book-open"] };
const LAYOUTS = [
  { id: "auto", icons: ["smartphone"] },
  { id: "columns", icons: ["columns-2", "columns"] },
  { id: "stacked", icons: ["rows-3", "rows"] },
];
const layoutName = (layout) => t(`layout_${layout.id}`);
// Obsidian's bundled Lucide set renamed some icons; take the first it knows.
const setAnyIcon = (element, names) => {
  for (const name of names) {
    setIcon(element, name);
    if (element.querySelector("svg")) return;
  }
};

const DEFAULT_SETTINGS = {
  layout: "auto",
  reserveDrawerColumn: true,
  keepDrawerOpen: false,
  dictionaryLanguages: "shown",
  drawerPosition: "side",
  drawerHeight: 0.33,
  resume: true,
  // Per book, keyed by its root folder (book-state.js); `state`, `choices`,
  // `hiddenColumns` and `defaultColumn` below are the 2.4.x maps keyed by
  // title, read once to migrate a book that has no record yet.
  books: {},
  lastBook: null,
  state: {},
  // Top: Obsidian's own bottom bar (mobile toolbar, status bar) covers a
  // bottom rail.
  railPosition: "top",
  sourcesInNewTab: false,
  hiddenColumns: {},
  defaultColumn: {},
  editing: false,
  transcriptionEngine: "auto",
  autoTranscribe: true,
  voiceLanguage: "",
  mlxWhisperPath: "",
  mlxModel: voiceCore.DEFAULT_MLX_MODEL,
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  apiModel: "whisper-1",
};

// Back and Forward: the shared FirstPair history (shared/nav-history.js);
// push records the place being left and clears Forward.
class ReaderHistory extends NavHistory {
  constructor(limit = HISTORY_LIMIT) {
    super(limit);
  }

  push(value) {
    this.visit(value);
  }

  get items() {
    return this.backStack;
  }
}

const reducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The first fenced code block's lines, by CommonMark's rule: it closes only
// at a fence of the same character at least as long as the opening one, so
// a source file's own ``` blocks inside a longer ```` fence stay inside.
function fencedLines(text) {
  const lines = String(text || "").split("\n");
  let open = -1;
  let marker = "";
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(lines[index]);
    if (!match) continue;
    if (open < 0) {
      open = index;
      marker = match[1];
      continue;
    }
    const run = /^ {0,3}(`+|~+)\s*$/.exec(lines[index]);
    if (run && run[1][0] === marker[0] && run[1].length >= marker.length) return lines.slice(open + 1, index);
  }
  return open < 0 ? [] : lines.slice(open + 1);
}

/* ------------------------------------------------------------------ view */

class FirstPairReaderView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.book = null;
    this.library = null;
    this.editionId = null;
    this.pages = [];
    this.position = 0;
    this.mode = "page";
    this.partId = null;
    this.notePath = null;
    this.noteLines = null;
    this.history = new ReaderHistory();
    // Every book of the vault (one: no shelf), the one shown (kept while the
    // shelf is up), and each book's Back history and unsaved session state.
    this.books = [];
    this.broken = [];
    this.entry = null;
    this.bookKey = null;
    this.histories = new Map();
    this.sessions = new Map();
    this.opened = false;
    this.uiSignature = null;
    this.parallel = null;
    this.enabled = new Set();
    // An aligned edition whose source column is optional (a translation read
    // on its own, the source a study layer) and the interlinear word layer
    // shown with it: "text", "pinyin" (reading above), or "gloss" (both).
    this.sourceShown = true;
    this.interlinear = "gloss";
    // The page's units by id (to redraw glosses in place), the gloss
    // languages they were drawn with, and the translation tab chosen last.
    this.chapterUnits = null;
    this.glossKey = null;
    this.tabLang = null;
    this.wordPosition = -1;
    this.columns = [];
    this.renderChild = null;
    this.renderToken = 0;
    this.pendingTarget = null;
    this.activeCell = 0;
  }

  getViewType() { return VIEW_TYPE; }

  getIcon() { return "book-open"; }

  getDisplayText() {
    if (this.mode === "shelf") return t("shelf");
    const title = this.parallel?.title ?? this.book?.title ?? t("reader");
    if (this.mode === "page" && this.pages[this.position] && !this.parallel) {
      return `${title} — ${this.pages[this.position].title}`;
    }
    return title;
  }

  /* ---------------------------------------------------- aligned editions */

  translationsOf(lang) { return this.parallel.translations.filter((item) => (item.lang ?? item.id) === lang); }

  languages() {
    if (!this.parallel) {
      return Object.entries(this.book?.dictionaries || {}).map(([id, entry]) => ({ id, label: entry.label || id }));
    }
    if (this.parallel.languages) return this.parallel.languages;
    const seen = new Map();
    for (const item of this.parallel.translations) {
      const lang = item.lang ?? item.id;
      if (!seen.has(lang)) seen.set(lang, { id: lang, label: item.label });
    }
    return [...seen.values()];
  }

  translation(id) { return this.parallel.translations.find((item) => item.id === id); }

  sourceOptional() { return Boolean(this.parallel?.sourceLanguage?.optional); }

  hasInterlinear() { return Boolean(this.parallel?.interlinear); }

  /* ------------------------------------------------- interlinear glosses */

  // The language of words[i][2]: aligned.interlinear.glossLang, else the
  // first translation's.
  primaryGlossLang() { return contract.primaryGlossLang(this.parallel); }

  // The gloss language picked for this book (data.json books[<root>]
  // .glossLang), or null for Auto.
  glossChoice() { return this.bookData().glossLang ?? null; }

  // Languages to try, best first: the explicit choice, then the shown
  // translation columns in display order (on phone tabs the translation tab
  // chosen last leads), else the book's interface language.
  glossOrder() {
    let shown = [...new Set(this.columns.map((column) => column.lang))];
    if (this.page?.hasClass("firstpair-reader__page--tabbed") && shown.includes(this.tabLang)) {
      shown = [this.tabLang, ...shown.filter((lang) => lang !== this.tabLang)];
    }
    return contract.glossOrder({ explicit: this.glossChoice(), shown, uiLang: this.entry?.uiLang ?? null });
  }

  // The gloss languages this page offers (the primary one, then the others
  // in column order), plus the book's explicit choice.
  glossChoices() {
    const units = this.chapterUnits ? [...this.chapterUnits.values()] : [];
    const choices = contract.glossLanguages(this.parallel, units, this.languages().map((language) => language.id));
    const explicit = this.glossChoice();
    return explicit && !choices.includes(explicit) ? [...choices, explicit] : choices;
  }

  glossLabel(lang) {
    const language = this.languages().find((item) => item.id === lang);
    return { short: this.languageShort({ id: lang, label: language?.label ?? languageName(lang) }), name: language?.label ?? languageName(lang) };
  }

  async setGlossChoice(lang) {
    await this.saveBookData({ glossLang: lang || null });
    if (this.mode === "page" && this.parallel) await this.renderPage(false);
  }

  // Auto → each offered language → Auto (the command).
  async cycleGlossLanguage() {
    if (!this.parallel || !this.hasInterlinear()) return;
    const cycle = [null, ...this.glossChoices()];
    const at = cycle.indexOf(this.glossChoice());
    const next = cycle[(at + 1) % cycle.length];
    await this.setGlossChoice(next);
    new Notice(`${t("gloss_lang_aria")}: ${next ? this.glossLabel(next).name : t("gloss_auto")}`);
  }

  // Glosses redrawn in place when their language changes without a render
  // (a phone tab chosen).
  refreshGlosses() {
    if (!this.chapterUnits || this.interlinear !== "gloss") return;
    if (this.glossOrder().join("|") === this.glossKey) return;
    for (const row of Array.from(this.page.querySelectorAll(".firstpair-reader__interlinear"))) {
      const unit = this.chapterUnits.get(row.closest(".firstpair-reader__strip")?.getAttribute("data-unit-id"));
      const cell = row.parentElement;
      if (!unit || !cell) continue;
      row.remove();
      this.appendInterlinear(cell, unit);
    }
  }

  languageShort(language) {
    return language.short ?? ({ en: "Eng", ru: "Рус", it: "Ita", la: "Lat", zh: "中文" }[language.id] ?? language.label);
  }

  translationName(item) {
    const name = item.title ?? item.translator ?? item.label ?? item.id;
    return name.replace(/\s*\([^()]*\)\s*$/u, "").trim();
  }

  currentPart() {
    const page = this.pages[this.position];
    if (!page) return undefined;
    return this.book.parts.find((part) => part.id === page.partId)?.title;
  }

  covers(item, part) { return !item.coverage || !part || item.coverage.includes(part); }

  // The translation to show for a language: the remembered choice if it covers
  // this page, else the language's default, else the first that covers.
  choiceFor(lang, exclude = null) {
    const part = this.currentPart();
    const candidates = this.translationsOf(lang).filter((item) => item.id !== exclude);
    const remembered = this.bookData().choices?.[lang];
    const pick = candidates.find((item) => item.id === remembered && this.covers(item, part))
      ?? candidates.find((item) => item.default && this.covers(item, part))
      ?? candidates.find((item) => this.covers(item, part)) ?? candidates[0];
    return pick?.id ?? null;
  }

  async remember(lang, id) {
    await this.saveBookData({ choices: { ...(this.bookData().choices ?? {}), [lang]: id } });
  }

  async rotate(index) {
    const column = this.columns[index];
    const others = this.columns.filter((c, i) => i !== index && c.lang === column.lang).map((c) => c.id);
    const part = this.currentPart();
    const list = this.translationsOf(column.lang).filter((item) => !others.includes(item.id) && this.covers(item, part));
    if (list.length < 2) return;
    const at = list.findIndex((item) => item.id === column.id);
    column.id = list[(at + 1) % list.length].id;
    if (index === this.columns.findIndex((c) => c.lang === column.lang)) await this.remember(column.lang, column.id);
    await this.renderPage(false);
  }

  async addColumn(lang) {
    const first = this.columns.find((c) => c.lang === lang);
    if (!first) return;
    const id = this.choiceFor(lang, first.id);
    if (!id || id === first.id) return;
    const at = this.columns.lastIndexOf(first);
    this.columns.splice(at + 1, 0, { lang, id, extra: true });
    await this.renderPage(false);
  }

  async removeColumn(index) {
    this.columns.splice(index, 1);
    await this.renderPage(false);
  }

  syncColumns() {
    const kept = this.columns.filter((c) => this.enabled.has(c.lang));
    for (const lang of this.languages().map((l) => l.id)) {
      if (this.enabled.has(lang) && !kept.some((c) => c.lang === lang)) kept.push({ lang, id: this.choiceFor(lang) });
    }
    const part = this.currentPart();
    for (const column of kept.filter((c) => !c.extra)) {
      const item = this.translation(column.id);
      if (!item || !this.covers(item, part)) column.id = this.choiceFor(column.lang) ?? column.id;
    }
    for (const column of kept.filter((c) => c.extra)) {
      const primary = kept.find((c) => !c.extra && c.lang === column.lang);
      const item = this.translation(column.id);
      if (!item || !this.covers(item, part) || column.id === primary?.id) {
        column.id = this.choiceFor(column.lang, primary?.id ?? null) ?? column.id;
      }
    }
    const order = this.languages().map((l) => l.id);
    kept.sort((a, b) => order.indexOf(a.lang) - order.indexOf(b.lang) || (a.extra ? 1 : 0) - (b.extra ? 1 : 0));
    this.columns = kept;
  }

  /* -------------------------------------------------------------- opening */

  async readJson(path, optional = false) {
    const text = await this.plugin.io.read(path);
    if (text === null) {
      if (optional) return null;
      throw new Error(`Missing ${path}`);
    }
    return JSON.parse(text);
  }

  buildFrame() {
    this.teardown();
    this.uiSignature = null;
    this.previous = null;
    this.containerEl.empty();
    this.frame = this.containerEl.createDiv({ cls: "firstpair-reader__frame" });
    this.root = this.frame.createDiv({ cls: "firstpair-reader" });
    this.toolbar = this.root.createDiv({ cls: "firstpair-reader__toolbar" });
    this.page = this.root.createDiv({ cls: "firstpair-reader__page" });
    this.drawer = this.frame.createDiv({ cls: "firstpair-reader__drawer", attr: { hidden: "" } });
    this.rail = this.root.createDiv({
      cls: "firstpair-reader__rail",
      attr: { role: "navigation", "aria-label": t("nav_aria") },
    });
    this.frame.toggleClass("firstpair-reader__frame--rail-top", this.plugin.settings.railPosition === "top");
    this.keydown = (event) => {
      if (event.key !== "Escape" || this.drawer.hasAttribute("hidden")) return;
      this.closeDrawer();
      if (this.lastWordButton && this.lastWordButton.isConnected) this.lastWordButton.focus();
    };
    this.frame.addEventListener("keydown", this.keydown);
    this.frame.addEventListener("click", (event) => {
      if (this.drawer.hasAttribute("hidden") || this.drawer.contains(event.target)) return;
      if (event.target.closest?.(".firstpair-reader__word, .firstpair-reader__toolbar, .firstpair-reader__rail")) return;
      this.closeDrawer();
    });
    this.root.addEventListener("scroll", () => this.saveStateSoon(), { passive: true });
    // A horizontal swipe on tabbed columns moves to the neighbouring language.
    let startX = null;
    let startY = null;
    this.page.addEventListener("touchstart", (event) => {
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    }, { passive: true });
    this.page.addEventListener("touchend", (event) => {
      if (startX === null || !this.page.hasClass("firstpair-reader__page--tabbed")) return;
      const dx = event.changedTouches[0].clientX - startX;
      const dy = event.changedTouches[0].clientY - startY;
      startX = null;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const count = this.page.querySelectorAll(".firstpair-reader__cell-tab").length;
      this.activeCell = Math.max(0, Math.min(count - 1, this.activeCell + (dx < 0 ? 1 : -1)));
      this.applyTabs();
    }, { passive: true });
  }

  async onOpen() {
    this.buildFrame();
    bindPageKeys(this, {
      previous: () => this.goPrevious(),
      next: () => this.goNext(),
      isActive: () => this.app.workspace.activeLeaf === this.leaf && (this.mode === "page" || this.mode === "part"),
    });
    try {
      const { books, broken } = await this.plugin.loadBooks();
      this.books = books;
      this.broken = broken;
      let target = this.pendingTarget;
      this.pendingTarget = null;
      const initial = this.initialBook(target);
      if (initial) {
        await this.enterBook(initial);
        if (target?.mode === "shelf") this.mode = "shelf";
      } else this.mode = "shelf";
      this.ensureUi();
      this.watchLayout();
      // A target that arrived while the book was loading wins.
      if (this.pendingTarget) target = this.pendingTarget;
      this.pendingTarget = null;
      this.opened = true;
      if (target) await this.applyTarget(target, false);
      else await this.render();
      const saved = this.book ? this.savedState() : null;
      if (!target && saved?.scrollTop && this.mode !== "shelf") this.root.scrollTop = saved.scrollTop;
      if (!target && saved?.word && this.mode === "page") {
        const button = this.wordButtons().find((candidate) => candidate.textContent === saved.word);
        if (button) await this.selectWord(button); else await this.openDictionary(saved.word);
      }
    } catch (error) {
      this.showError(error);
    }
  }

  /* ---------------------------------------------------------------- books */

  hasShelf() { return this.books.length > 1; }

  bookByKey(key) {
    if (typeof key !== "string") return null;
    const wanted = key.normalize("NFC");
    return this.books.find((book) => contract.bookKey(book) === wanted) ?? null;
  }

  // One book opens as before; several open the book a target names, else the
  // book read last, else the shelf.
  initialBook(target) {
    if (this.books.length === 1) return this.books[0];
    const named = this.bookByKey(target?.bookKey);
    if (named) return named;
    if (target?.pageId && !target.bookKey) {
      const holder = this.books.find((book) => book.pages?.some((page) => page.id === target.pageId));
      const last = this.bookByKey(this.plugin.settings.lastBook);
      if (last?.pages?.some((page) => page.id === target.pageId)) return last;
      if (holder) return holder;
    }
    return this.bookByKey(this.plugin.settings.lastBook);
  }

  // Back and Forward are per book; the first book takes the view's own.
  historyFor(key) {
    if (!this.histories.has(key)) this.histories.set(key, this.histories.size ? new ReaderHistory() : this.history);
    return this.histories.get(key);
  }

  // Shows a book: its own index defaults, then (restore) its own saved
  // languages and place.  Nothing of the previous book carries over.
  async enterBook(model, restore = true) {
    await this.leaveBook();
    this.entry = model;
    this.bookKey = contract.bookKey(model);
    this.history = this.historyFor(this.bookKey);
    await this.plugin.useModel(model);
    this.mode = "page";
    this.partId = null;
    this.editionId = null;
    this.columns = [];
    this.interlinear = "gloss";
    this.sourceShown = true;
    this.wordPosition = -1;
    this.activeCell = 0;
    this.lastWord = null;
    this.chapterUnits = null;
    this.glossKey = null;
    this.tabLang = null;
    this.drawer?.setAttribute("hidden", "");
    if (model.format === "library") {
      this.library = model;
      const saved = this.savedState();
      await this.useEdition(saved?.editionId || model.editions[0].id, false);
      if (!saved) this.mode = "library";
    } else {
      this.library = null;
      await this.useBook(model);
    }
    if (restore) this.restoreState();
    this.plugin.settings.lastBook = this.bookKey;
  }

  // Before another book or the shelf: the book's state is kept for this
  // session and, with Resume on, saved.
  async leaveBook() {
    if (!this.book || this.bookKey === null || this.mode === "shelf") return;
    clearTimeout(this.saveTimer);
    this.sessions.set(this.bookKey, this.currentState());
    await this.saveState();
  }

  // A book picked on the shelf (or named by a link) opens at its remembered
  // page, else its start; a library without a saved place at its editions.
  async openBook(model) {
    await this.enterBook(model);
    const saved = this.savedState();
    if (this.library && !saved) this.mode = "library";
    else if (saved?.pageId || !this.library) this.mode = "page";
    return saved;
  }

  async openFromShelf(key) {
    const model = this.bookByKey(key);
    if (!model) return;
    const saved = await this.openBook(model);
    // Back from the book's first place returns to the shelf.
    this.history.push({ mode: "shelf", bookKey: this.bookKey, position: this.position, partId: this.partId, scrollTop: 0 });
    await this.render();
    if (saved?.scrollTop && saved.pageId === this.pages[this.position]?.id) this.root.scrollTop = saved.scrollTop;
  }

  async showShelf() {
    if (this.hasShelf() && this.mode !== "shelf") await this.go({ mode: "shelf" });
  }

  // The interface language follows the book on screen (its ui_lang); the
  // shelf keeps the vault default.  Rail and toolbar are rebuilt when either
  // the language or the book changes.
  ensureUi() {
    const lang = this.mode === "shelf" || !this.entry ? SHELF_LANG : (this.entry.uiLang || "en");
    const signature = `${lang}|${this.bookKey}|${this.mode === "shelf"}`;
    uiLang = lang;
    if (signature === this.uiSignature && this.previous) return;
    this.uiSignature = signature;
    this.rail.setAttribute("aria-label", t("nav_aria"));
    this.makeToolbar();
    this.makeRail();
  }

  async useBook(book) {
    this.book = book;
    this.pages = book.pages;
    this.position = 0;
    this.parallel = null;
    this.enabled = new Set();
    if (book.aligned) {
      this.parallel = typeof book.aligned === "string" ? await this.readJson(book.aligned) : book.aligned;
      const source = this.parallel.sourceLanguage || {};
      this.sourceShown = !(source.optional && source.defaultVisible === false);
      for (const language of this.languages()) {
        const items = this.translationsOf(language.id);
        if (items.some((item) => item.defaultVisible !== false)) this.enabled.add(language.id);
      }
    } else {
      for (const language of this.languages()) this.enabled.add(language.id);
    }
    if (book.startPage) {
      const start = this.pages.findIndex((page) => page.id === book.startPage);
      if (start >= 0) this.position = start;
    }
  }

  async useEdition(editionId, render = true) {
    const book = await contract.loadEdition(this.plugin.io, this.library, editionId);
    this.editionId = this.library.editions.find((edition) => edition.id === editionId)?.id
      ?? this.library.editions[0].id;
    await this.useBook(book);
    if (render) {
      this.mode = "contents";
      await this.render();
    }
  }

  teardown() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.orientation && this.applyLayout) this.orientation.removeEventListener("change", this.applyLayout);
    this.orientation = null;
    this.renderChild?.unload();
    this.renderChild = null;
    clearTimeout(this.saveTimer);
  }

  async onClose() {
    await this.saveState();
    this.teardown();
  }

  showError(error) {
    console.error("FirstPair Reader", error);
    this.page.empty();
    const box = this.page.createDiv({ cls: "firstpair-reader__error" });
    box.createEl("p", { text: t("error_open", { error: error?.message ?? error }) });
    box.createEl("p", { text: t("error_sync") });
    const retry = box.createEl("button", { text: t("retry") });
    retry.addEventListener("click", () => {
      this.plugin.model = null;
      this.plugin.shelf = null;
      this.opened = false;
      void this.onOpen();
    });
  }

  /* --------------------------------------------------------------- resume */

  // The 2.4.x settings key of this book (its title), for migration only.
  legacyKey() { return this.parallel?.title ?? this.library?.title ?? this.book?.title ?? "reader"; }

  bookData() { return this.plugin.bookRecord(this.bookKey ?? "", this.legacyKey()); }

  async saveBookData(patch) { await this.plugin.saveBook(this.bookKey ?? "", this.legacyKey(), patch); }

  savedState() {
    if (!this.plugin.settings.resume) return this.sessions.get(this.bookKey) ?? null;
    return this.bookData().state ?? null;
  }

  restoreState() {
    const saved = this.savedState();
    if (!saved) return;
    const position = this.pages.findIndex((page) => page.id === saved.pageId);
    if (position >= 0) this.position = position;
    if (["contents", "part"].includes(saved.mode) || (saved.mode === "library" && this.library)) this.mode = saved.mode;
    if (saved.partId) this.partId = saved.partId;
    if (this.parallel) {
      if (Array.isArray(saved.enabled)) {
        this.enabled = new Set(saved.enabled.filter((lang) => this.languages().some((l) => l.id === lang)));
      }
      if (this.sourceOptional() && typeof saved.source === "boolean") this.sourceShown = saved.source;
      if (INTERLINEAR.includes(saved.interlinear)) this.interlinear = saved.interlinear;
      if (Array.isArray(saved.columns)) {
        this.columns = saved.columns.filter((c) => this.translation(c.id))
          .map((c) => ({ lang: c.lang, id: c.id, extra: Boolean(c.extra) }));
      }
    }
  }

  currentState() {
    return {
      mode: this.mode === "note" ? "page" : this.mode,
      editionId: this.editionId,
      partId: this.partId,
      pageId: this.pages[this.position]?.id,
      scrollTop: Math.round(this.root?.scrollTop ?? 0),
      enabled: [...this.enabled],
      source: this.sourceShown,
      interlinear: this.interlinear,
      columns: this.columns.map((c) => ({ lang: c.lang, id: c.id, extra: Boolean(c.extra) })),
      word: this.drawer && !this.drawer.hasAttribute("hidden") ? this.lastWord ?? null : null,
    };
  }

  saveStateSoon() {
    if (!this.plugin.settings.resume || !this.pages.length || this.mode === "shelf") return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveState(), 400);
  }

  async saveState() {
    if (!this.plugin.settings.resume || !this.pages.length || this.mode === "shelf" || this.bookKey === null) return;
    await this.plugin.saveBook(this.bookKey, this.legacyKey(), { state: this.currentState() }, { lastBook: this.bookKey });
  }

  // Obsidian keeps the leaf's state across restarts and passes the targets
  // of note takeover here.
  getState() {
    return {
      mode: this.mode,
      pageId: this.pages[this.position]?.id ?? null,
      partId: this.partId,
      editionId: this.editionId,
      bookKey: this.bookKey,
    };
  }

  async setState(state, result) {
    if (state && (state.pageId || state.mode || typeof state.bookKey === "string")) {
      if (!this.opened) this.pendingTarget = state;
      else await this.applyTarget(state, false, true);
    }
    return super.setState?.(state, result);
  }

  // A target may name its book (bookKey): a different book, or any book
  // while the shelf is up, is opened first at its own remembered place.
  async applyTarget(target, recordHistory = true, newSession = false) {
    if (target.mode === "shelf") {
      if (newSession) this.history.clear();
      if (this.hasShelf()) return this.go({ mode: "shelf" }, recordHistory);
      return this.render();
    }
    const named = this.hasShelf() ? this.bookByKey(target.bookKey) : null;
    if (named && (named !== this.entry || this.mode === "shelf")) {
      await this.openBook(named);
      recordHistory = false;
    }
    if (newSession) this.history.clear();
    if (!this.book) return this.render();
    if (target.editionId && this.library && target.editionId !== this.editionId) {
      await this.useEdition(target.editionId, false);
    }
    if (target.mode === "page" || (!target.mode && target.pageId)) {
      const position = this.pages.findIndex((page) => page.id === target.pageId);
      if (position >= 0) return this.go({ mode: "page", position }, recordHistory);
    }
    if (target.mode === "part") return this.go({ mode: "part", partId: target.partId }, recordHistory);
    if (target.mode === "contents") return this.go({ mode: "contents" }, recordHistory);
    if (target.mode === "library" && this.library) return this.go({ mode: "library" }, recordHistory);
    if (target.mode === "note" && target.notePath) {
      return this.go({ mode: "note", notePath: target.notePath, noteLines: target.noteLines || null }, recordHistory);
    }
    return this.render();
  }

  /* ----------------------------------------------------------- navigation */

  snapshot() {
    const focused = this.page.ownerDocument.activeElement;
    const focus = focused && this.page.contains(focused) && focused.id ? `#${focused.id}` : null;
    return {
      mode: this.mode,
      bookKey: this.bookKey,
      editionId: this.editionId,
      position: this.position,
      partId: this.partId,
      notePath: this.notePath,
      noteLines: this.noteLines,
      scrollTop: this.root.scrollTop,
      trackLeft: this.page.querySelector(".firstpair-reader__strip")?.scrollLeft ?? 0,
      focus,
    };
  }

  async go(next, recordHistory = true) {
    if (recordHistory) this.history.push(this.snapshot());
    if (next.mode === "shelf") await this.leaveBook();
    this.mode = next.mode;
    if (next.position !== undefined) this.position = next.position;
    if (next.mode === "part") this.partId = next.partId;
    if (next.mode === "page") this.partId = this.pages[this.position]?.partId ?? this.partId;
    if (next.mode === "note") {
      this.notePath = next.notePath;
      this.noteLines = next.noteLines || null;
    }
    await this.render();
    if (next.scrollTop !== undefined) this.root.scrollTop = next.scrollTop;
  }

  async jump(position) {
    if (position < 0 || position >= this.pages.length) return;
    if (position === this.position && this.mode === "page") return;
    await this.go({ mode: "page", position });
  }

  async openPage(pageId) {
    const position = this.pages.findIndex((page) => page.id === pageId);
    if (position >= 0) await this.jump(position);
  }

  async goPrevious() {
    if (this.mode === "page") await this.jump(this.position - 1);
  }

  async goNext() {
    if (this.mode === "page") return this.jump(this.position + 1);
    if (this.mode === "part") {
      const part = this.book.parts.find((item) => item.id === this.partId);
      const first = this.pages.findIndex((page) => page.id === part?.pageIds[0]);
      return this.jump(first >= 0 ? first : this.position);
    }
    return this.jump(this.position);
  }

  async goUp() {
    if (this.mode === "page") return this.go({ mode: "part", partId: this.pages[this.position].partId });
    if (this.mode === "note") return this.go({ mode: "page", position: this.position });
    if (this.mode === "part") return this.go({ mode: "contents" });
    if (this.mode === "contents" && this.library) return this.go({ mode: "library" });
    if ((this.mode === "contents" || this.mode === "library") && this.hasShelf()) return this.go({ mode: "shelf" });
    return undefined;
  }

  async showContents() {
    if (this.mode !== "contents" && this.book) await this.go({ mode: "contents" });
  }

  async restore() {
    const state = this.history.back(this.snapshot());
    if (state) await this.showSnapshot(state);
  }

  async goForward() {
    const state = this.history.forward(this.snapshot());
    if (state) await this.showSnapshot(state);
  }

  async showSnapshot(state) {
    const other = state.mode !== "shelf" && typeof state.bookKey === "string" && state.bookKey !== this.bookKey
      ? this.bookByKey(state.bookKey) : null;
    if (other) await this.enterBook(other, false);
    if (state.editionId && this.library && state.editionId !== this.editionId) {
      await this.useEdition(state.editionId, false);
    }
    await this.go({ ...state }, false);
    this.root.scrollTop = state.scrollTop;
    const strip = this.page.querySelector(".firstpair-reader__strip");
    if (strip && state.trackLeft) strip.scrollLeft = state.trackLeft;
    if (state.focus) {
      const element = this.page.querySelector(state.focus);
      if (element) {
        element.scrollIntoView?.({ block: "center" });
        element.focus?.({ preventScroll: true });
        element.addClass?.("firstpair-reader__focus");
      }
    }
  }

  toTop() {
    if (this.root.scrollTop > 0) this.history.push(this.snapshot());
    if (typeof this.root.scrollTo === "function") {
      this.root.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    } else this.root.scrollTop = 0;
    this.page.querySelector("h1")?.focus?.({ preventScroll: true });
    this.updateRail();
  }

  /* ------------------------------------------------------------------ rail */

  hasWords() {
    if (this.parallel) return Boolean(this.parallel.dictionaries);
    return Boolean(this.book?.dictionaries && this.book?.words);
  }

  makeButton(key, icon, action) {
    const label = t(key);
    const button = this.rail.createEl("button", {
      cls: `firstpair-reader__control firstpair-reader__control--${key.replace("nav_", "").replace(/_/g, "-")}`,
      attr: { "aria-label": label, title: label },
    });
    // Icons only: the name is the button's accessible label and tooltip.
    setIcon(button, icon);
    button.addEventListener("click", action);
    return button;
  }

  makeRail() {
    this.rail.empty();
    const words = this.hasWords();
    this.previous = this.makeButton("nav_previous", "chevron-left", () => this.goPrevious());
    this.previousDestination = this.previous.createSpan({ cls: "firstpair-reader__destination" });
    if (words) this.previousWord = this.makeButton("nav_previous_word", "chevrons-left", () => this.stepWord(-1));
    else this.previousWord = null;
    this.up = this.makeButton("nav_up", "corner-left-up", () => this.goUp());
    this.back = this.makeButton("nav_back", "rotate-ccw", () => this.restore());
    this.forward = this.makeButton("nav_forward", "rotate-cw", () => this.goForward());
    this.top = this.makeButton("nav_top", "arrow-up-to-line", () => this.toTop());
    this.toc = this.makeButton("nav_toc", "list", () => this.showContents());
    if (words) this.nextWord = this.makeButton("nav_next_word", "chevrons-right", () => this.stepWord(1));
    else this.nextWord = null;
    this.next = this.makeButton("nav_next", "chevron-right", () => this.goNext());
    this.nextDestination = this.next.createSpan({ cls: "firstpair-reader__destination" });
    this.progress = this.rail.createDiv({ cls: "firstpair-reader__progress", attr: { role: "status", "aria-live": "polite" } });
    this.rail.toggleClass("firstpair-reader__rail--words", words);
  }

  updateRail() {
    if (!this.previous) return;
    const inPage = this.mode === "page";
    const shelf = this.mode === "shelf";
    const previous = inPage ? this.pages[this.position - 1] : null;
    const next = shelf ? null : inPage ? this.pages[this.position + 1] : this.mode === "part"
      ? this.pages.find((page) => page.partId === this.partId) : this.pages[this.position];
    this.previous.disabled = !previous;
    this.next.disabled = !next;
    this.previous.title = previous?.title ?? t("start");
    this.next.title = next?.title ?? t("end");
    this.previousDestination.setText(previous?.title ?? "");
    this.nextDestination.setText(next?.title ?? "");
    this.up.disabled = shelf || (this.mode === "library" && !this.hasShelf())
      || (this.mode === "contents" && !this.library && !this.hasShelf());
    this.toc.disabled = this.mode === "contents" || shelf;
    this.back.disabled = !this.history.canBack();
    this.forward.disabled = !this.history.canForward();
    this.top.disabled = false;
    this.updateWordNavigation();
    const part = this.book?.parts.find((item) => item.id === (this.mode === "part" ? this.partId : this.pages[this.position]?.partId));
    const text = shelf ? t("shelf")
      : this.mode === "library" ? t("library")
      : this.mode === "contents" ? t("contents")
      : this.mode === "part" ? part?.title ?? ""
      : `${t("page_of", { n: this.position + 1, total: this.pages.length })}${part ? ` · ${part.title}` : ""}`;
    this.progress.setText(text);
  }

  /* ------------------------------------------------------------ toolbar */

  makeToolbar() {
    this.toolbar.empty();
    if (!this.parallel) {
      this.toolbar.hidden = true;
      return;
    }
    this.toolbar.hidden = false;
    this.languageControls = this.toolbar.createDiv({
      cls: "firstpair-reader__languages", attr: { role: "group", "aria-label": t("languages_aria") },
    });
    this.updateToolbar();
    this.layoutButton = this.toolbar.createEl("button", { cls: "firstpair-reader__layout-toggle" });
    this.layoutButton.addEventListener("click", async () => {
      const index = LAYOUTS.findIndex((item) => item.id === this.plugin.settings.layout);
      await this.plugin.saveSettings({ layout: LAYOUTS[(index + 1) % LAYOUTS.length].id });
      this.applyLayout();
    });
    this.showLayoutChoice();
  }

  updateToolbar() {
    if (!this.languageControls) return;
    this.languageControls.empty();
    const part = this.currentPart();
    if (this.sourceOptional()) {
      const source = this.parallel.sourceLanguage;
      const group = this.languageControls.createDiv({ cls: "firstpair-reader__language firstpair-reader__language--source" });
      const label = group.createEl("label", { cls: "firstpair-reader__language-toggle", attr: { title: source.label } });
      const input = label.createEl("input", { type: "checkbox", attr: { "aria-label": source.label } });
      input.checked = this.sourceShown;
      input.addEventListener("change", async () => {
        // A page with nothing on it is never shown: the last column stays.
        if (!input.checked && !this.columns.length) { input.checked = true; return; }
        this.sourceShown = input.checked;
        await this.renderPage(false);
      });
      label.createSpan({ text: this.languageShort({ id: source.lang ?? source.id, label: source.label, short: source.short }), attr: { "aria-hidden": "true" } });
      if (this.sourceShown && this.hasInterlinear()) {
        const name = `${t("interlinear_aria")}: ${t(`interlinear_${this.interlinear}`)}`;
        const layers = group.createEl("button", {
          cls: "firstpair-reader__interlinear-toggle", attr: { "aria-label": name, title: name },
        });
        setAnyIcon(layers, INTERLINEAR_ICONS[this.interlinear]);
        layers.addEventListener("click", async () => {
          this.interlinear = INTERLINEAR[(INTERLINEAR.indexOf(this.interlinear) + 1) % INTERLINEAR.length];
          await this.renderPage(false);
        });
        // Glosses in several languages: Auto follows the shown columns.
        const choices = this.interlinear === "gloss" ? this.glossChoices() : [];
        if (choices.length > 1) {
          const chosen = this.glossChoice();
          const title = `${t("gloss_lang_aria")}: ${chosen ? this.glossLabel(chosen).name : t("gloss_auto")}`;
          const select = group.createEl("select", {
            cls: "firstpair-reader__picker firstpair-reader__gloss-picker", attr: { "aria-label": title, title },
          });
          const auto = select.createEl("option", { text: t("gloss_auto") });
          auto.value = "";
          for (const lang of choices) {
            const option = select.createEl("option", { text: this.glossLabel(lang).short, attr: { title: this.glossLabel(lang).name, lang } });
            option.value = lang;
          }
          select.value = chosen ?? "";
          select.addEventListener("change", () => this.setGlossChoice(select.value || null));
        }
      }
    }
    for (const language of this.languages()) {
      const group = this.languageControls.createDiv({ cls: "firstpair-reader__language" });
      const label = group.createEl("label", { cls: "firstpair-reader__language-toggle", attr: { title: language.label } });
      const input = label.createEl("input", { type: "checkbox", attr: { "aria-label": language.label } });
      input.checked = this.enabled.has(language.id);
      input.addEventListener("change", async () => {
        if (!input.checked && !this.sourceShown && this.enabled.size === 1) { input.checked = true; return; }
        if (input.checked) this.enabled.add(language.id); else this.enabled.delete(language.id);
        await this.renderPage(false);
      });
      label.createSpan({ text: this.languageShort(language), attr: { "aria-hidden": "true" } });
      if (!this.enabled.has(language.id)) continue;
      const available = this.translationsOf(language.id).filter((item) => this.covers(item, part));
      if (available.length < 2) continue;
      const columns = this.columns.map((column, index) => ({ ...column, index })).filter((column) => column.lang === language.id);
      for (const column of columns) {
        const others = columns.filter((other) => other.index !== column.index).map((other) => other.id);
        const selected = this.translation(column.id);
        const selectedTitle = selected?.title ?? selected?.translator ?? selected?.label ?? selected?.id ?? column.id;
        const select = group.createEl("select", {
          cls: "firstpair-reader__picker",
          attr: { "aria-label": t("translation_picker", { language: language.label, title: selectedTitle }), title: selectedTitle },
        });
        for (const item of available.filter((candidate) => !others.includes(candidate.id))) {
          const fullTitle = item.title ?? item.translator ?? item.label ?? item.id;
          const option = select.createEl("option", { text: this.translationName(item), attr: { title: fullTitle, "aria-label": fullTitle } });
          option.value = item.id;
          if (item.id === column.id) option.selected = true;
        }
        select.addEventListener("change", async () => {
          this.columns[column.index].id = select.value;
          if (!column.extra) await this.remember(language.id, select.value);
          await this.renderPage(false);
        });
        if (column.extra) {
          const remove = group.createEl("button", {
            cls: "firstpair-reader__column-control", text: "−",
            attr: { "aria-label": t("remove_second"), title: t("remove_second") },
          });
          remove.addEventListener("click", () => this.removeColumn(column.index));
        }
      }
      if (columns.length === 1 && available.length > 1) {
        const add = group.createEl("button", {
          cls: "firstpair-reader__column-control", text: "+",
          attr: { "aria-label": t("second_column_aria"), title: t("second_column") },
        });
        add.addEventListener("click", () => this.addColumn(language.id));
      }
    }
  }

  showLayoutChoice() {
    const choice = LAYOUTS.find((item) => item.id === this.plugin.settings.layout) ?? LAYOUTS[0];
    this.layoutButton.empty();
    setAnyIcon(this.layoutButton, choice.icons);
    this.layoutButton.setAttribute("aria-label", t("layout_tap", { name: layoutName(choice) }));
    this.layoutButton.title = t("layout", { name: layoutName(choice) });
  }

  // Width and orientation are both watched: an iPad in landscape has room
  // for columns, a phone held upright does not, and a narrow desktop pane
  // behaves like the phone.  Columns on a phone become tabs that follow taps
  // and swipes, one language per screen.
  watchLayout() {
    this.applyLayout = () => {
      if (!this.parallel) {
        this.sizeDrawer();
        return;
      }
      let layout = this.plugin.settings.layout;
      const narrow = this.root.clientWidth < STACK_BELOW;
      if (layout === "auto") {
        const portrait = this.orientation?.matches ?? false;
        layout = narrow || (Platform.isMobile && portrait) ? "stacked" : "columns";
      }
      this.page.toggleClass("firstpair-reader__page--stacked", layout === "stacked");
      this.page.toggleClass("firstpair-reader__page--columns", layout === "columns");
      this.page.toggleClass("firstpair-reader__page--tabbed", layout === "columns" && narrow && this.root.clientWidth > 0);
      this.applyTabs();
      this.root.style.setProperty("--firstpair-toolbar-height", `${this.toolbar.hidden ? 0 : this.toolbar.offsetHeight}px`);
      if (this.layoutButton) this.showLayoutChoice();
      this.sizeDrawer();
    };
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      this.orientation = window.matchMedia("(orientation: portrait)");
      this.orientation.addEventListener("change", this.applyLayout);
    }
    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(() => this.applyLayout());
      this.resizeObserver.observe(this.root);
    }
  }

  // Phone tabs over the aligned columns: tap a tab, or swipe the text, to
  // move between languages; the chosen language opens first on every page.
  applyTabs() {
    const tabbed = this.page.hasClass("firstpair-reader__page--tabbed");
    let tabs = this.page.querySelector(".firstpair-reader__cell-tabs");
    if (!tabbed) {
      tabs?.remove();
      for (const cell of this.page.querySelectorAll(".firstpair-reader__cell")) cell.removeClass("is-hidden");
      this.refreshGlosses();
      return;
    }
    const labels = Array.from(this.page.querySelectorAll(".firstpair-reader__column-label"));
    if (!tabs) {
      tabs = this.page.ownerDocument.createElement("div");
      tabs.className = "firstpair-reader__cell-tabs";
      tabs.setAttribute("role", "tablist");
      tabs.setAttribute("data-reader-ui", "");
      const anchor = this.page.querySelector(".firstpair-reader__column-labels");
      if (anchor) anchor.after(tabs); else this.page.prepend(tabs);
      const remembered = this.bookData().defaultColumn;
      const index = labels.findIndex((label) => label.dataset.cellKey === remembered);
      this.activeCell = index >= 0 ? index : Math.min(this.activeCell, Math.max(0, labels.length - 1));
      if (this.tabLang === null && remembered && remembered !== "source") this.tabLang = remembered.split(":")[0];
      labels.forEach((label, index) => {
        const tab = tabs.createEl("button", {
          cls: "firstpair-reader__cell-tab",
          text: label.dataset.short || label.textContent,
          attr: { type: "button", role: "tab", title: t("language_tab_title") },
        });
        tab.addEventListener("click", async () => {
          this.activeCell = index;
          this.applyTabs();
          await this.saveBookData({ defaultColumn: label.dataset.cellKey });
        });
      });
    }
    tabs.querySelectorAll(".firstpair-reader__cell-tab").forEach((tab, index) => {
      tab.toggleClass("is-active", index === this.activeCell);
      tab.setAttribute("aria-selected", index === this.activeCell ? "true" : "false");
    });
    for (const strip of this.page.querySelectorAll(".firstpair-reader__strip")) {
      Array.from(strip.querySelectorAll(".firstpair-reader__cell")).forEach((cell, index) => {
        cell.toggleClass("is-hidden", index !== this.activeCell);
      });
    }
    // The translation tab chosen last gives the source's glosses their language.
    const key = labels[this.activeCell]?.dataset.cellKey;
    if (key && key !== "source") this.tabLang = key.split(":")[0];
    this.refreshGlosses();
  }

  /* ---------------------------------------------------------------- drawer */

  sizeDrawer() {
    if (!this.drawer || this.drawer.hasAttribute("hidden")) return;
    const style = this.drawer.style;
    for (const property of ["left", "width", "top", "bottom", "height"]) style.removeProperty(property);
    this.root.style.removeProperty("height");
    this.drawer.removeClass("firstpair-reader__drawer--bottom");
    const pane = this.frame.getBoundingClientRect();
    if (!pane.width) return;
    const strip = this.page.hasClass("firstpair-reader__page--columns") && !this.page.hasClass("firstpair-reader__page--tabbed")
      ? this.page.querySelector(".firstpair-reader__strip") : null;
    if (!strip && this.plugin.settings.drawerPosition === "bottom") {
      const height = Math.round(pane.height * Math.min(0.85, Math.max(0.15, this.plugin.settings.drawerHeight)));
      this.drawer.addClass("firstpair-reader__drawer--bottom");
      this.ensureGrip();
      style.left = "0px";
      style.width = `${Math.round(pane.width)}px`;
      style.top = "auto";
      style.bottom = "0px";
      style.height = `${height}px`;
      if (this.plugin.settings.keepDrawerOpen) this.root.style.height = `calc(100% - ${height}px)`;
      return;
    }
    style.top = `${this.toolbar.hidden ? 0 : this.toolbar.offsetHeight}px`;
    style.bottom = `${this.rail.offsetHeight}px`;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    if (!strip) {
      const width = Math.min(pane.width * 0.9, Math.max(30 * rem, pane.width * 0.4));
      style.left = `${Math.round(pane.width - width)}px`;
      style.width = `${Math.round(width)}px`;
      return;
    }
    const grid = strip.getBoundingClientRect();
    const tracks = Number(strip.style.getPropertyValue("--firstpair-columns")) || strip.children.length || 1;
    const gap = parseFloat(getComputedStyle(strip).columnGap) || 0;
    const track = (grid.width - gap * (tracks - 1)) / tracks;
    const cells = strip.querySelectorAll(".firstpair-reader__cell");
    const index = this.reservedTrack ? cells.length : Math.max(0, cells.length - 1);
    const left = Math.max(0, grid.left - pane.left + index * (track + gap) - gap / 2);
    const width = Math.min(pane.width, Math.max(15 * rem, pane.width - left));
    style.left = `${Math.round(pane.width - width)}px`;
    style.width = `${Math.round(width)}px`;
  }

  ensureGrip() {
    if (this.grip && this.grip.parentElement === this.drawer && this.drawer.firstElementChild === this.grip) return;
    this.grip?.remove();
    this.grip = this.drawer.ownerDocument.createElement("div");
    this.grip.className = "firstpair-reader__drawer-grip";
    this.grip.setAttribute("role", "separator");
    this.grip.setAttribute("aria-label", t("dictionary_grip"));
    this.drawer.prepend(this.grip);
    this.grip.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.grip.setPointerCapture?.(event.pointerId);
      const pane = this.frame.getBoundingClientRect();
      const move = (moveEvent) => {
        const share = Math.min(0.85, Math.max(0.15, (pane.bottom - moveEvent.clientY) / pane.height));
        this.plugin.settings.drawerHeight = share;
        this.sizeDrawer();
      };
      const finish = async () => {
        this.grip.removeEventListener("pointermove", move);
        this.grip.removeEventListener("pointerup", finish);
        this.grip.removeEventListener("pointercancel", finish);
        await this.plugin.saveSettings({ drawerHeight: this.plugin.settings.drawerHeight });
      };
      this.grip.addEventListener("pointermove", move);
      this.grip.addEventListener("pointerup", finish);
      this.grip.addEventListener("pointercancel", finish);
    });
  }

  closeDrawer() {
    if (this.plugin.settings.keepDrawerOpen) return;
    this.drawer.setAttribute("hidden", "");
    this.root.style.removeProperty("height");
    this.saveStateSoon();
  }

  showDrawer() {
    this.drawer.removeAttribute("hidden");
    this.sizeDrawer();
    if (this.drawer.childElementCount <= (this.grip ? 1 : 0)) {
      const head = this.drawer.createDiv({ cls: "firstpair-reader__drawer-head" });
      head.createEl("strong", { text: t("dictionary") });
      this.drawer.createEl("p", { text: t("dictionary_hint"), cls: "firstpair-reader__drawer-hint" });
    }
  }

  /* ----------------------------------------------------------------- words */

  wordButtons() { return Array.from(this.page.querySelectorAll(".firstpair-reader__word")); }

  updateWordNavigation() {
    if (!this.previousWord || !this.nextWord) return;
    const words = this.wordButtons();
    if (this.wordPosition >= words.length) this.wordPosition = -1;
    for (const [index, word] of words.entries()) {
      const active = index === this.wordPosition;
      word.toggleClass("firstpair-reader__word--active", active);
      if (active) word.setAttribute("aria-current", "true"); else word.removeAttribute("aria-current");
    }
    this.previousWord.disabled = !words.length || this.wordPosition <= 0;
    this.nextWord.disabled = !words.length || this.wordPosition === words.length - 1;
  }

  async selectWord(button, scroll = false) {
    const words = this.wordButtons();
    const position = words.indexOf(button);
    if (position < 0) return;
    this.wordPosition = position;
    this.updateWordNavigation();
    if (scroll) button.scrollIntoView?.({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    this.lastWordButton = button;
    await this.openDictionary(button.textContent);
  }

  async stepWord(direction) {
    const words = this.wordButtons();
    if (!words.length) return;
    const position = this.wordPosition < 0 ? (direction > 0 ? 0 : -1) : this.wordPosition + direction;
    if (position < 0 || position >= words.length) return;
    await this.selectWord(words[position], true);
  }

  makeWord(container, token) {
    const word = container.ownerDocument.createElement("button");
    word.className = "firstpair-reader__word";
    word.textContent = token;
    word.addEventListener("click", () => this.selectWord(word));
    return word;
  }

  appendText(container, lines, clickable = false) {
    for (const line of Array.isArray(lines) ? lines : [lines]) {
      const row = container.createDiv({ cls: "firstpair-reader__verse" });
      if (!clickable) {
        row.setText(line);
        continue;
      }
      for (const token of String(line).split(/([\p{L}\p{M}]+[’']?)/u)) {
        if (/^[\p{L}\p{M}]/u.test(token)) row.appendChild(this.makeWord(row, token));
        else row.appendText(token);
      }
    }
  }

  // Interlinear words: each [text, reading, gloss] a stack with the reading
  // above and (in "gloss") the gloss below; a word without a reading
  // (punctuation, digits) runs inline.  The gloss is in the language the
  // shown translations call for (glossOrder), from the unit's `glosses`, or
  // words[i][2].
  appendInterlinear(container, unit) {
    const words = unit.words;
    const row = container.createDiv({ cls: `firstpair-reader__interlinear firstpair-reader__interlinear--${this.interlinear}` });
    let glossLang = null;
    let glosses = [];
    if (this.interlinear === "gloss") {
      const order = this.glossOrder();
      this.glossKey = order.join("|");
      ({ lang: glossLang, glosses } = contract.unitGlosses(unit, order, this.primaryGlossLang()));
      if (glossLang) row.setAttribute("data-gloss-lang", glossLang);
    }
    for (const [index, [text, reading]] of words.entries()) {
      if (!reading) {
        row.createSpan({ cls: "firstpair-reader__iword firstpair-reader__iword--plain", text });
        continue;
      }
      const word = row.createSpan({ cls: "firstpair-reader__iword" });
      word.createSpan({ cls: "firstpair-reader__ireading", text: reading });
      word.createSpan({ cls: "firstpair-reader__itext", text });
      if (this.interlinear === "gloss") {
        word.createSpan({ cls: "firstpair-reader__igloss", text: glosses[index] || "", attr: glossLang ? { lang: glossLang } : {} });
      }
    }
  }

  // Words of the source language inside rendered Markdown become dictionary
  // buttons; the text nodes are split in place, so links, emphasis, and
  // other markup around them survive.
  wrapWords(container) {
    const words = this.book?.words;
    if (!words || !this.book.dictionaries) return;
    if (words.notes && this.mode === "note" && !String(this.notePath || "").startsWith(words.notes)) return;
    if (words.notes && this.mode === "page") return;
    const selector = words.selector || `[lang="${words.lang}"]`;
    for (const element of container.querySelectorAll(selector)) {
      const walker = element.ownerDocument.createTreeWalker(element, 4);
      const nodes = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest("a, button, code, pre, mark, .firstpair-reader__word")) continue;
        nodes.push(node);
      }
      for (const node of nodes) {
        const parts = node.data.split(/([\p{L}\p{M}]+[’']?)/u);
        if (parts.length < 2) continue;
        const fragment = element.ownerDocument.createDocumentFragment();
        for (const token of parts) {
          if (!token) continue;
          if (/^[\p{L}\p{M}]/u.test(token)) fragment.appendChild(this.makeWord(element, token));
          else fragment.appendChild(element.ownerDocument.createTextNode(token));
        }
        node.replaceWith(fragment);
      }
    }
  }

  dictionaryLanguages() {
    const languages = this.languages();
    const shown = languages.filter((language) => this.enabled.has(language.id));
    if (this.plugin.settings.dictionaryLanguages !== "all") return shown;
    return [...shown, ...languages.filter((language) => !this.enabled.has(language.id))];
  }

  dictionaries() {
    return this.parallel?.dictionaries ?? this.book?.dictionaries ?? {};
  }

  sourceLang() {
    return this.parallel?.sourceLanguage?.lang ?? this.parallel?.sourceLanguage?.id
      ?? this.book?.words?.lang ?? this.book?.lang ?? "";
  }

  async openDictionary(surface) {
    this.lastWord = surface;
    this.drawer.empty();
    this.grip = null;
    this.drawer.removeAttribute("hidden");
    this.sizeDrawer();
    const head = this.drawer.createDiv({ cls: "firstpair-reader__drawer-head" });
    head.createEl("strong", { text: surface });
    if (!this.plugin.settings.keepDrawerOpen) {
      const close = head.createEl("button", {
        text: t("dictionary_close"), cls: "firstpair-reader__drawer-close", attr: { "aria-label": t("dictionary_close_aria") },
      });
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        this.closeDrawer();
        if (this.lastWordButton?.isConnected) this.lastWordButton.focus();
      });
    }
    let found = false;
    const lang = this.sourceLang();
    for (const language of this.dictionaryLanguages()) {
      const dictionary = this.dictionaries()[language.id];
      if (!dictionary) continue;
      const section = this.drawer.createDiv({
        cls: "firstpair-reader__definition",
        attr: { lang: language.id, role: "group", "aria-label": t("dictionary_section", { label: language.label }) },
      });
      let entries;
      try {
        entries = await this.plugin.lookup(dictionary.path, surface, lang);
      } catch (error) {
        section.createEl("p", { text: t("dictionary_missing", { error: error.message }), cls: "firstpair-reader__warning" });
        continue;
      }
      if (!entries.length) {
        section.createEl("p", { text: t("dictionary_none"), cls: "firstpair-reader__none" });
        continue;
      }
      found = true;
      const merged = mergeEntries(entries);
      const [first, ...rest] = merged;
      const SENSES = 3;
      const renderEntry = (entry, container, senses = entry.definitions) => {
        const entryHead = container.createDiv({ cls: "firstpair-reader__entry-head" });
        entryHead.createSpan({ text: [entry.headword, entry.partOfSpeech].filter(Boolean).join(" · "), cls: "firstpair-reader__headword" });
        if (entry.grammar) entryHead.createSpan({ text: ` ${entry.grammar}`, cls: "firstpair-reader__grammar" });
        container.createEl("p", { text: senses.join("; "), cls: "firstpair-reader__senses" });
        for (const example of entry.examples ?? []) container.createEl("blockquote", { text: exampleText(example) });
      };
      renderEntry({ ...first, examples: first.examples.slice(0, 1) }, section, first.definitions.slice(0, SENSES));
      const extraSenses = first.definitions.slice(SENSES);
      const count = rest.length + (extraSenses.length ? 1 : 0);
      if (count) {
        const more = section.createEl("button", { cls: "firstpair-reader__more", text: t("more", { count }), attr: { "aria-expanded": "false" } });
        const hidden = section.createDiv({ cls: "firstpair-reader__more-entries", attr: { hidden: "" } });
        if (extraSenses.length) hidden.createEl("p", { text: t("also", { senses: extraSenses.join("; ") }), cls: "firstpair-reader__senses" });
        for (const entry of rest) renderEntry(entry, hidden);
        more.addEventListener("click", () => {
          const open = hidden.hasAttribute("hidden");
          if (open) hidden.removeAttribute("hidden"); else hidden.setAttribute("hidden", "");
          more.setText(open ? t("less") : t("more", { count }));
          more.setAttribute("aria-expanded", String(open));
        });
      }
    }
    if (!found) this.drawer.createEl("p", { text: t("dictionary_try") });
    this.saveStateSoon();
  }

  /* --------------------------------------------------------------- render */

  async render() {
    if (this.mode === "page" && this.book) return this.renderPage();
    if (!this.book) this.mode = "shelf";
    this.ensureUi();
    this.renderToken += 1;
    this.page.empty();
    this.page.removeClass("firstpair-reader__page--parallel");
    this.renderChild?.unload();
    this.renderChild = null;
    this.toolbar.hidden = true;
    try {
      if (this.mode === "shelf") this.renderShelf();
      else if (this.mode === "library") this.renderLibrary();
      else if (this.mode === "contents") this.renderContents();
      else if (this.mode === "part") this.renderPart();
      else if (this.mode === "note") await this.renderNote(this.renderToken);
    } catch (error) {
      this.showError(error);
      return;
    }
    this.root.scrollTop = 0;
    this.updateRail();
    this.saveStateSoon();
  }

  heading(text) {
    return this.page.createEl("h1", { text, attr: { tabindex: "-1" } });
  }

  pageButton(container, page) {
    const item = container.createEl("li");
    const button = item.createEl("button", { cls: "firstpair-reader__toc-page", text: page.title, attr: { type: "button" } });
    if (this.pages[this.position]?.id === page.id) {
      button.addClass("is-current");
      button.setAttribute("aria-current", "page");
    }
    button.addEventListener("click", () => this.openPage(page.id));
  }

  // Every book of the vault: title, author and subtitle when the index has
  // them, the language pair, and the page it was left on.
  renderShelf() {
    this.heading(t("shelf"));
    const list = this.page.createEl("ul", { cls: "firstpair-reader__shelf" });
    for (const model of this.books) {
      const entry = contract.shelfEntry(model);
      const button = list.createEl("li").createEl("button", {
        cls: "firstpair-reader__shelf-book", attr: { type: "button", "data-book": entry.key },
      });
      button.createSpan({ cls: "firstpair-reader__shelf-title", text: entry.title, attr: model.lang ? { lang: model.lang } : {} });
      if (entry.subtitle) button.createSpan({ cls: "firstpair-reader__shelf-subtitle", text: entry.subtitle });
      if (entry.author) button.createSpan({ cls: "firstpair-reader__shelf-author", text: entry.author });
      if (entry.languages) button.createSpan({ cls: "firstpair-reader__shelf-languages", text: entry.languages });
      const record = this.plugin.bookRecord(entry.key, legacyKeyOf(model));
      const saved = this.plugin.settings.resume ? record.state : this.sessions.get(entry.key);
      const page = saved?.pageId && model.pages?.find((item) => item.id === saved.pageId);
      if (page) button.createSpan({ cls: "firstpair-reader__shelf-place", text: t("shelf_continue", { page: page.title }) });
      if (entry.key === this.bookKey) {
        button.addClass("is-current");
        button.setAttribute("aria-current", "true");
      }
      button.addEventListener("click", () => this.openFromShelf(entry.key));
    }
    for (const item of this.broken) {
      list.createEl("li").createEl("p", {
        cls: "firstpair-reader__warning",
        text: t("shelf_unreadable", { folder: item.root || "/", error: item.error?.message ?? item.error }),
      });
    }
  }

  renderLibrary() {
    this.heading(this.library.title);
    const families = new Map();
    for (const edition of this.library.editions) {
      const family = edition.family || "";
      if (!families.has(family)) families.set(family, []);
      families.get(family).push(edition);
    }
    for (const [family, editions] of families) {
      if (family) this.page.createEl("h2", { text: family });
      const list = this.page.createEl("ul", { cls: "firstpair-reader__library" });
      for (const edition of editions) {
        const button = list.createEl("li").createEl("button", {
          cls: "firstpair-reader__toc-page",
          text: [edition.title, edition.version].filter(Boolean).join(" · "),
          attr: { type: "button" },
        });
        if (edition.id === this.editionId) {
          button.addClass("is-current");
          button.setAttribute("aria-current", "true");
        }
        button.addEventListener("click", async () => {
          this.history.push(this.snapshot());
          await this.useEdition(edition.id, false);
          await this.go({ mode: "contents" }, false);
        });
      }
    }
    const sources = this.library.sources;
    if (sources && (sources.anthology || sources.notes.length)) {
      this.page.createEl("h2", { text: t("sources") });
      const list = this.page.createEl("ul", { cls: "firstpair-reader__library" });
      const add = (title, note) => {
        const button = list.createEl("li").createEl("button", { cls: "firstpair-reader__toc-page", text: title, attr: { type: "button" } });
        button.addEventListener("click", () => this.go({ mode: "note", notePath: note }));
      };
      if (sources.anthology) add(t("anthology"), sources.anthology);
      for (const note of sources.notes) add(note.title, note.note);
    }
  }

  renderContents() {
    this.heading(this.book.title);
    if (this.book.cover && this.pages[this.position]?.id === (this.book.startPage ?? this.pages[0].id)) this.renderCover();
    for (const part of this.book.parts) {
      if (this.book.parts.length > 1 || part.title !== this.book.title) {
        const heading = this.page.createEl("h2");
        const button = heading.createEl("button", { cls: "firstpair-reader__toc-part", text: part.title, attr: { type: "button" } });
        if (part.id === this.pages[this.position]?.partId) button.addClass("is-current");
        button.addEventListener("click", () => this.go({ mode: "part", partId: part.id }));
      }
      const list = this.page.createEl("ol", { cls: "firstpair-reader__toc" });
      for (const id of part.pageIds) this.pageButton(list, this.pages.find((page) => page.id === id));
    }
  }

  renderPart() {
    const part = this.book.parts.find((item) => item.id === this.partId) ?? this.book.parts[0];
    this.partId = part.id;
    const kicker = this.page.createEl("p", { cls: "firstpair-reader__kicker", text: this.book.title });
    kicker.setAttribute("data-reader-ui", "");
    this.heading(part.title);
    const list = this.page.createEl("ol", { cls: "firstpair-reader__toc" });
    for (const id of part.pageIds) this.pageButton(list, this.pages.find((page) => page.id === id));
  }

  renderCover() {
    const file = this.app.vault.getAbstractFileByPath(this.book.cover);
    if (!file || !this.app.vault.getResourcePath) return;
    this.page.createEl("img", {
      cls: "firstpair-reader__cover",
      attr: { src: this.app.vault.getResourcePath(file), alt: this.book.title },
    });
  }

  async pageMarkdown(page) {
    if (page.markdown !== null && page.markdown !== undefined) return page.markdown;
    const text = await this.plugin.io.read(page.file);
    if (text === null) throw new Error(`Missing Reader page: ${page.file}`);
    if (page.marker) {
      const block = contract.extractMarked(text, page.marker);
      if (block === null) throw new Error(`Reader page ${page.id} is missing its markers in ${page.file}`);
      return block;
    }
    return text.replace(/^---\n[\s\S]*?\n---\n/, "");
  }

  async renderMarkdown(markdown, sourcePath) {
    this.renderChild?.unload();
    this.renderChild = new Component();
    this.renderChild.load();
    const body = this.page.createDiv({ cls: "firstpair-reader__markdown markdown-rendered" });
    await MarkdownRenderer.render(this.app, markdown, body, sourcePath, this.renderChild);
    return body;
  }

  async renderPage(resetScroll = true) {
    this.mode = "page";
    this.ensureUi();
    if (resetScroll) this.wordPosition = -1;
    const token = ++this.renderToken;
    const entry = this.pages[this.position];
    this.page.empty();
    this.page.removeClass("firstpair-reader__page--parallel");
    this.toolbar.hidden = !this.parallel;
    this.chapterUnits = null;
    try {
      if (this.parallel && entry.chapter) await this.renderParallel(entry);
      else {
        const markdown = await this.pageMarkdown(entry);
        if (token !== this.renderToken) return;
        this.renderMetrics(entry);
        if (this.book.cover && entry.id === (this.book.startPage ?? this.pages[0].id)) this.renderCover();
        const body = await this.renderMarkdown(markdown, entry.file || "");
        if (token !== this.renderToken) return;
        this.decorate(body, entry.file || "");
        if (entry.anchor) this.scrollToAnchor(body, entry.anchor);
      }
    } catch (error) {
      this.showError(error);
      return;
    }
    if (token !== this.renderToken) return;
    if (resetScroll && !entry.anchor) this.root.scrollTop = 0;
    if (this.plugin.settings.keepDrawerOpen && this.hasWords()) this.showDrawer(); else this.sizeDrawer();
    this.updateRail();
    void this.paintNotes();
    this.saveStateSoon();
  }

  async renderParallel(entry) {
    const chapter = await this.readJson(entry.chapter);
    this.chapterUnits = new Map(chapter.units.map((unit) => [unit.id, unit]));
    this.page.addClass("firstpair-reader__page--parallel");
    this.page.createEl("h1", { text: chapter.title, attr: { tabindex: "-1" } });
    this.renderMetrics(entry);
    this.syncColumns();
    const source = {
      source: true,
      label: this.parallel.sourceLanguage.label,
      lang: this.parallel.sourceLanguage.lang ?? this.parallel.sourceLanguage.id,
    };
    const shown = this.columns.map((column, index) => ({ ...column, index, item: this.translation(column.id) }));
    const sourceLast = this.parallel.sourceLanguage.position === "right";
    const sources = this.sourceShown ? [source] : [];
    const cells = sourceLast ? [...shown, ...sources] : [...sources, ...shown];
    const tracks = Math.max(cells.length, this.plugin.settings.reserveDrawerColumn ? 1 + this.languages().length : 0);
    this.reservedTrack = tracks > cells.length;
    const labels = this.page.createDiv({ cls: "firstpair-reader__column-labels" });
    labels.style.setProperty("--firstpair-columns", String(tracks));
    for (const cell of cells) this.columnHeader(labels, cell);
    // One column is a plain book: no header naming it.
    if (cells.length === 1) labels.hidden = true;
    for (const unit of chapter.units) {
      const strip = this.page.createDiv({
        cls: `firstpair-reader__strip${unit.kind ? ` firstpair-reader__strip--${unit.kind}` : ""}`,
        attr: { "data-unit-id": unit.id, "data-translations": String(shown.length) },
      });
      strip.style.setProperty("--firstpair-columns", String(tracks));
      for (const cell of cells) {
        const isSource = Boolean(cell.source);
        const element = strip.createDiv({
          cls: `firstpair-reader__cell firstpair-reader__cell--${isSource ? "source" : "translation"}`,
          attr: { lang: cell.lang, "data-label": isSource ? cell.label : this.columnTitle(cell) },
        });
        if (isSource && Array.isArray(unit.words) && this.hasInterlinear() && this.interlinear !== "text") {
          this.appendInterlinear(element, unit);
        } else {
          this.appendText(element, isSource ? unit.source : (unit.translations?.[cell.id] ?? []), isSource);
        }
      }
    }
    this.updateToolbar();
    this.page.querySelector(".firstpair-reader__cell-tabs")?.remove();
    this.applyLayout();
  }

  columnTitle(cell) {
    const item = cell.item ?? this.translation(cell.id);
    if (!item) return cell.label ?? cell.id;
    const name = item.title ?? item.translator ?? item.label;
    const approximate = item.alignment && item.alignment !== "line" ? " ≈" : "";
    return `${item.label && name !== item.label ? `${item.label} · ` : ""}${name}${approximate}`;
  }

  columnHeader(labels, cell) {
    const head = labels.createDiv({ cls: "firstpair-reader__column-label" });
    head.dataset.cellKey = cell.source ? "source" : `${cell.lang}:${cell.extra ? "extra" : "main"}`;
    head.dataset.short = cell.source ? cell.label : this.languageShort({ id: cell.lang, label: cell.item?.label ?? cell.lang });
    if (cell.source) {
      head.createSpan({ text: cell.label });
      return;
    }
    const item = cell.item;
    const part = this.currentPart();
    const alternatives = this.translationsOf(cell.lang).filter((other) => this.covers(other, part)
      && !this.columns.some((c) => c !== this.columns[cell.index] && c.lang === cell.lang && c.id === other.id));
    const name = head.createEl("button", {
      cls: "firstpair-reader__column-name", text: this.columnTitle(cell),
      attr: { title: alternatives.length > 1 ? t("next_translation") : this.columnTitle(cell) },
    });
    if (item?.alignment && item.alignment !== "line") name.setAttribute("aria-description", t("approximate"));
    if (alternatives.length > 1) {
      name.addClass("firstpair-reader__column-name--rotates");
      name.addEventListener("click", () => this.rotate(cell.index));
    }
    if (cell.extra) {
      const remove = head.createEl("button", {
        cls: "firstpair-reader__column-control", text: "−", attr: { "aria-label": t("remove_column"), title: t("remove_column") },
      });
      remove.addEventListener("click", () => this.removeColumn(cell.index));
    } else if (alternatives.length > 1 && !this.columns.some((c) => c.extra && c.lang === cell.lang)) {
      const add = head.createEl("button", {
        cls: "firstpair-reader__column-control", text: "+", attr: { "aria-label": t("second_column_aria"), title: t("second_column") },
      });
      add.addEventListener("click", () => this.addColumn(cell.lang));
    }
  }

  async renderNote(token) {
    const path = contract.safePath(this.notePath, "note");
    const file = /\.[A-Za-z0-9]+$/.test(path.split("/").pop()) ? path : `${path}.md`;
    const text = await this.plugin.io.read(file);
    if (text === null) throw new Error(`Missing note: ${file}`);
    if (token !== this.renderToken) return;
    const kicker = this.page.createEl("p", { cls: "firstpair-reader__kicker", text: this.book.title });
    kicker.setAttribute("data-reader-ui", "");
    const body = await this.renderMarkdown(text.replace(/^---\n[\s\S]*?\n---\n/, ""), file);
    if (token !== this.renderToken) return;
    this.decorate(body, file);
    if (this.noteLines) this.highlightLines(body, this.noteLines);
    void this.paintNotes();
  }

  // Everything a rendered page or note needs from the Reader.
  decorate(body, sourcePath) {
    this.bindLinks(body, sourcePath);
    this.bindSourceRails(body);
    this.bindColumnToggles(body);
    this.wrapWords(body);
    this.plugin.bindReaderLinks(body, { bookKey: this.bookKey });
    this.plugin.bindEvidenceTargets(body);
    this.bindSelection(body);
  }

  renderMetrics(entry) {
    const metrics = this.plugin.metrics;
    if (!metrics || !metrics.metrics.length) return;
    const byEdition = metrics.values[entry.id] || {};
    const values = byEdition[this.editionId] || byEdition["*"] || Object.values(byEdition)[0] || {};
    const shown = metricsCore.rankedMetrics(metrics.metrics).filter((metric) => Number.isFinite(values[metric.key]));
    if (!shown.length) return;
    const row = this.page.createDiv({ cls: "firstpair-reader__metrics", attr: { "data-reader-ui": "" } });
    for (const metric of shown) {
      const value = values[metric.key];
      const severity = metricsCore.metricSeverity(metric, value);
      row.createSpan({
        cls: `firstpair-reader__metric${severity ? ` firstpair-reader__metric--${severity}` : ""}`,
        text: `${metric.letter} ${metricsCore.formatMetric(metric, value)}`,
        attr: { title: `${metricsCore.metricText(metric, "label", uiLang)} — ${metricsCore.metricText(metric, "description", uiLang)}` },
      });
    }
  }

  scrollToAnchor(body, anchor) {
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(anchor) : anchor.replace(/"/g, '\\"');
    const target = body.querySelector(`[id="${escaped}"]`)
      || body.querySelector(`a[name="${anchor}"]`);
    if (target) target.scrollIntoView?.({ block: "start" });
  }

  /* ---------------------------------------------------------------- links */

  // Links are bound in the capture phase: inside a dynamic ItemView on a
  // phone, Obsidian's own delegation is unreliable.
  bindLinks(body, sourcePath) {
    body.addEventListener("click", (event) => {
      const anchor = event.target.closest?.("a");
      if (!anchor || !body.contains(anchor)) return;
      const href = anchor.getAttribute("data-href") || anchor.getAttribute("href") || "";
      if (!href || /^(https?|mailto|obsidian|firstpair):/i.test(href)) return;
      event.preventDefault();
      event.stopPropagation();
      void this.followLink(href, sourcePath, anchor);
    }, true);
  }

  async followLink(href, sourcePath, anchor) {
    if (href.startsWith("#")) {
      const id = decodeURIComponent(href.slice(1));
      const target = this.page.querySelector(`[id="${id.replace(/"/g, '\\"')}"]`)
        || Array.from(this.page.querySelectorAll("h1, h2, h3, h4, h5, h6")).find((heading) => heading.textContent.trim() === id);
      if (!target) return;
      if (!anchor.id) anchor.id = `fp-ref-${Math.random().toString(36).slice(2, 10)}`;
      anchor.focus?.({ preventScroll: true });
      this.history.push(this.snapshot());
      target.scrollIntoView?.({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus?.({ preventScroll: true });
      target.addClass?.("firstpair-reader__focus");
      this.updateRail();
      return;
    }
    const [rawLinkpath, subpath = ""] = href.split("#");
    // Markdown links arrive percent-encoded ("Жизнь%20и%20судьба/…").
    const linkpath = decodePath(rawLinkpath);
    const dest = this.app.metadataCache?.getFirstLinkpathDest?.(linkpath, sourcePath);
    const path = dest?.path ?? (linkpath.endsWith(".md") ? linkpath : `${linkpath}.md`);
    // A note of another book on the shelf opens that book there.
    const holder = this.hasShelf() ? contract.bookForNote(this.books, path) : null;
    if (holder && holder !== this.entry && holder.format !== "library" && !subpath.startsWith("^")) {
      const elsewhere = contract.targetForNote(holder, path);
      if (elsewhere) return this.applyTarget({ ...elsewhere, bookKey: contract.bookKey(holder) });
    }
    const target = contract.targetForNote(this.book, path);
    if (target && !subpath.startsWith("^")) {
      if (target.mode === "page") return this.openPage(target.pageId);
      return this.go(target);
    }
    if (subpath.startsWith("^") || this.plugin.settings.sourcesInNewTab || !path.endsWith(".md")) {
      return this.app.workspace.openLinkText?.(href, sourcePath, this.plugin.settings.sourcesInNewTab ? "tab" : false);
    }
    return this.go({ mode: "note", notePath: path.replace(/\.md$/, "") });
  }

  // A quotation whose blockquote carries exactly one reviewed source link
  // (note#^block) becomes a source rail: the whole block opens the source.
  bindSourceRails(body) {
    for (const quote of body.querySelectorAll("blockquote")) {
      const links = Array.from(quote.querySelectorAll("a")).filter((link) => (link.getAttribute("data-href") || "").includes("#^"));
      if (links.length !== 1) continue;
      const href = links[0].getAttribute("data-href");
      quote.addClass("firstpair-reader__source-rail");
      quote.setAttribute("role", "link");
      quote.setAttribute("tabindex", "0");
      const open = () => void this.followLink(href, this.pages[this.position]?.file || "", links[0]);
      quote.addEventListener("click", (event) => {
        if (event.target.closest("a, button, mark")) return;
        open();
      });
      quote.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    }
  }

  // Tables whose header names languages get one toggle bar per note; at
  // least one language always stays on, and the choice is remembered.
  bindColumnToggles(body) {
    const tables = Array.from(body.querySelectorAll("table")).filter((table) => {
      const heads = Array.from(table.querySelectorAll("thead th, tr:first-child th"));
      return heads.length >= 3;
    });
    if (!tables.length) return;
    const names = Array.from(tables[0].querySelectorAll("thead th, tr:first-child th")).slice(1).map((cell) => cell.textContent.trim());
    if (names.length < 2) return;
    const hidden = new Set(this.bookData().hiddenColumns || []);
    const bar = body.ownerDocument.createElement("div");
    bar.className = "firstpair-reader__column-toggles";
    bar.setAttribute("role", "group");
    bar.setAttribute("data-reader-ui", "");
    body.prepend(bar);
    const apply = () => {
      for (const table of tables) {
        for (const row of table.querySelectorAll("tr")) {
          Array.from(row.children).forEach((cell, index) => {
            if (index === 0) return;
            cell.toggleClass("is-hidden", hidden.has(names[index - 1]));
          });
        }
      }
    };
    names.forEach((name) => {
      const label = bar.createEl("label");
      const box = label.createEl("input", { type: "checkbox" });
      box.checked = !hidden.has(name);
      label.appendText(` ${name}`);
      box.addEventListener("change", async () => {
        if (!box.checked && names.filter((other) => !hidden.has(other)).length <= 1) {
          box.checked = true;
          return;
        }
        if (box.checked) hidden.delete(name); else hidden.add(name);
        apply();
        await this.saveBookData({ hiddenColumns: [...hidden] });
      });
    });
    apply();
  }

  // A highlight band over the given lines of the first code block.
  highlightLines(body, lines) {
    const pre = body.querySelector("pre");
    if (!pre) return;
    const style = getComputedStyle(pre);
    const lineHeight = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 14) * 1.5;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    pre.style.position = "relative";
    const band = pre.ownerDocument.createElement("div");
    band.className = "firstpair-reader__line-band";
    band.setAttribute("data-reader-ui", "");
    band.style.top = `${paddingTop + (lines.start - 1) * lineHeight}px`;
    band.style.height = `${(lines.end - lines.start + 1) * lineHeight}px`;
    pre.appendChild(band);
    band.scrollIntoView?.({ block: "center" });
  }

  /* -------------------------------------------------------- span notes */

  noteFragmentKey() {
    if (this.mode === "note") return `reader/note/${this.notePath}`;
    const page = this.pages[this.position];
    return page ? `reader/${this.editionId || "book"}/${page.id}` : null;
  }

  // Editing (off by default) uses the shared span editor: a page toggle shows
  // Words beside each paragraph; Words opens the word picker with Note and
  // Voice; saved spans are coloured on the paragraph itself.
  bindSelection(body) {
    if (!this.plugin.settings.editing) return;
    const bar = body.ownerDocument.createElement("div");
    bar.className = "firstpair-reader__edit-bar";
    bar.setAttribute("data-reader-ui", "");
    const toggle = bar.createEl("button", {
      cls: "lt-chip lt-sentence-toggle", text: t("sentence_words"),
      attr: { type: "button", "aria-pressed": "false" },
    });
    toggle.addEventListener("click", () => {
      const showing = !body.hasClass("firstpair-reader__editing");
      body.toggleClass("firstpair-reader__editing", showing);
      toggle.setAttribute("aria-pressed", showing ? "true" : "false");
      toggle.toggleClass("lt-chip-on", showing);
    });
    body.prepend(bar);
    this.editBlocks = [];
    const fragmentKey = this.noteFragmentKey();
    Array.from(body.querySelectorAll(EDITABLE_BLOCKS)).forEach((block) => {
      if (block.closest("[data-reader-ui]") || block.querySelector(EDITABLE_BLOCKS)) return;
      const text = editor.textNodes(block).text;
      if (!text.trim()) return;
      const index = this.editBlocks.length;
      const sentenceId = `${fragmentKey}:B${String(index + 1).padStart(4, "0")}:${reviewState.sentenceFingerprint(text)}`;
      const words = block.ownerDocument.createElement("button");
      words.type = "button";
      words.className = "lt-words-toggle firstpair-reader__words-toggle";
      words.textContent = t("words");
      words.setAttribute("data-reader-ui", "");
      words.setAttribute("aria-pressed", "false");
      block.prepend(words);
      const entry = { block, text, sentenceId, words, editorEl: null, picker: null, saved: null };
      words.addEventListener("click", () => this.toggleBlockEditor(entry));
      this.editBlocks.push(entry);
    });
  }

  blockRecords(ledger, entry) {
    const fragmentKey = this.noteFragmentKey();
    return Object.values(ledger.span_notes || {})
      .filter((note) => note.fragment_key === fragmentKey && note.sentence_id === entry.sentenceId)
      .map((note) => ({ ...note, action: "note" }));
  }

  toggleBlockEditor(entry) {
    if (entry.editorEl) {
      const open = !entry.editorEl.hasClass("is-open");
      entry.editorEl.toggleClass("is-open", open);
      entry.words.setAttribute("aria-pressed", open ? "true" : "false");
      return;
    }
    const editorEl = entry.block.ownerDocument.createElement("div");
    editorEl.className = "lt-word-editor firstpair-reader__words-editor is-open";
    editorEl.setAttribute("data-reader-ui", "");
    entry.block.after(editorEl);
    entry.editorEl = editorEl;
    entry.words.setAttribute("aria-pressed", "true");
    const tokens = reviewState.wordTokens(entry.text, entry.sentenceId);
    const open = async (selector, autoRecord) => {
      const ledger = await this.loadLedger();
      if (!ledger) return;
      if (!editor.overlapAllowed(this.blockRecords(ledger, entry), entry.text, selector)) return;
      await this.openSpanNote(entry, selector, autoRecord);
    };
    entry.picker = editor.createWordPicker(editorEl, entry.text, tokens, {
      actions: [
        { key: "note", label: t("note"), onSelect: (selector) => open(selector, false) },
        { key: "voice", label: t("voice"), onSelect: (selector) => open(selector, true) },
      ],
    });
    entry.saved = editorEl.createDiv({ cls: "lt-saved-phrases" });
    void this.paintNotes();
  }

  async loadLedger() {
    try {
      return await this.plugin.store.load(await this.plugin.voiceContext());
    } catch (_error) {
      new Notice(t("editing_ledger_other"));
      return null;
    }
  }

  spanDetails(entry, selector) {
    const fragmentKey = this.noteFragmentKey();
    const page = this.pages[this.position];
    const edition = this.editionId || "book";
    return {
      id: reviewState.spanNoteKey(fragmentKey, edition, entry.sentenceId, selector.start, selector.end, selector.exact),
      fragment_key: fragmentKey,
      set: "reader",
      lineage: this.mode === "note" ? this.notePath : page?.id,
      incipit: this.mode === "note" ? this.notePath : page?.title,
      edition,
      edition_title: this.library?.editions.find((item) => item.id === this.editionId)?.title || this.book.title,
      unit: fragmentKey,
      sentence_id: entry.sentenceId,
      sentence_fingerprint: reviewState.sentenceFingerprint(entry.text),
      selector,
      token_keys: selector.token_keys || [],
    };
  }

  async openSpanNote(entry, selector, autoRecord) {
    let context;
    try {
      context = await this.plugin.voiceContext();
      await this.plugin.store.load(context);
    } catch (_error) {
      new Notice(t("editing_ledger_other"));
      return;
    }
    this.plugin.openSpanNoteDialog({
      context,
      details: this.spanDetails(entry, selector),
      selector,
      root: entry.block,
      autoRecord,
      setLedger: () => {},
      refresh: () => void this.paintNotes(),
      onClose: () => entry.picker?.clear(),
    });
  }

  // Colour every saved span on its paragraph; list notes whose paragraph or
  // words changed, never moving them onto other words.
  async paintNotes() {
    if (!this.plugin.settings.editing || !this.editBlocks?.length) return;
    let ledger;
    try {
      ledger = await this.plugin.store.load(await this.plugin.voiceContext());
    } catch (_error) {
      return;
    }
    this.page.querySelector(".firstpair-reader__unmatched")?.remove();
    const fragmentKey = this.noteFragmentKey();
    const placed = new Set();
    const unmatched = [];
    for (const entry of this.editBlocks) {
      const records = this.blockRecords(ledger, entry);
      for (const record of records) placed.add(record.id);
      const painted = editor.paintSpans(entry.block, records, {
        onOpen: (record) => void this.openSpanNote(entry, makeSelectorFor(entry.text, record), false),
      });
      unmatched.push(...painted.unmatched);
      entry.picker?.paint(records);
      if (entry.saved) {
        editor.renderSavedRows(entry.saved, records, {
          label: (record) => `“${record.exact}” · ${[t("note"), record.voice.length ? `🎙 ${record.voice.length}` : "", record.text].filter(Boolean).join(" · ")}`,
          onOpen: (record) => void this.openSpanNote(entry, makeSelectorFor(entry.text, record), false),
          confirmRemove: (record) => record.voice.length > 0,
          onRemove: async (record) => {
            await this.plugin.store.update(await this.plugin.voiceContext(),
              (current) => reviewState.clearSpanNote(current, record.id));
            for (const clip of record.voice) await this.plugin.trashVaultPath(clip.path);
            await this.paintNotes();
          },
        });
      }
    }
    for (const note of Object.values(ledger.span_notes || {})) {
      if (note.fragment_key === fragmentKey && !placed.has(note.id)) unmatched.push(note);
    }
    if (unmatched.length) {
      const box = this.page.createDiv({ cls: "firstpair-reader__unmatched", attr: { "data-reader-ui": "" } });
      box.createEl("h3", { text: t("unmatched_notes") });
      for (const note of unmatched) {
        box.createEl("p", { text: `“${note.exact}”${note.text ? ` · ${note.text}` : ""}` });
      }
    }
  }
}

// A book's 2.4.x settings key before its aligned index is read.
function legacyKeyOf(model) {
  const aligned = model.aligned && typeof model.aligned === "object" ? model.aligned : null;
  return (model.format === "library" ? model.title : aligned?.title) ?? model.title;
}

function decodePath(value) {
  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return value;
  }
}

function makeSelectorFor(text, record) {
  return reviewState.makeSelector(text, Number(record.start), Number(record.end), record.token_keys || []);
}

/* -------------------------------------------------------------- settings */

class FirstPairReaderSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const settings = this.plugin.settings;
    const save = async (patch, refresh = null) => {
      await this.plugin.saveSettings(patch);
      if (refresh !== null) this.plugin.refreshViews(refresh);
    };
    new Setting(containerEl).setName(t("settings_layout")).setDesc(t("settings_layout_desc"))
      .addDropdown((dropdown) => {
        for (const item of LAYOUTS) dropdown.addOption(item.id, layoutName(item));
        dropdown.setValue(settings.layout).onChange((value) => save({ layout: value }, false));
      });
    new Setting(containerEl).setName(t("settings_reserve")).setDesc(t("settings_reserve_desc"))
      .addToggle((toggle) => toggle.setValue(settings.reserveDrawerColumn).onChange((value) => save({ reserveDrawerColumn: value }, true)));
    new Setting(containerEl).setName(t("settings_keep_open")).setDesc(t("settings_keep_open_desc"))
      .addToggle((toggle) => toggle.setValue(settings.keepDrawerOpen).onChange((value) => save({ keepDrawerOpen: value }, true)));
    new Setting(containerEl).setName(t("settings_drawer_position")).setDesc(t("settings_drawer_position_desc"))
      .addDropdown((dropdown) => dropdown.addOption("side", t("drawer_side")).addOption("bottom", t("drawer_bottom")).setValue(settings.drawerPosition)
        .onChange((value) => save({ drawerPosition: value }, false)));
    new Setting(containerEl).setName(t("settings_band_height")).setDesc(t("settings_band_height_desc"))
      .addSlider((slider) => slider.setLimits(15, 85, 5).setValue(Math.round(settings.drawerHeight * 100)).setDynamicTooltip()
        .onChange((value) => save({ drawerHeight: value / 100 }, false)));
    new Setting(containerEl).setName(t("settings_resume")).setDesc(t("settings_resume_desc"))
      .addToggle((toggle) => toggle.setValue(settings.resume).onChange((value) => save({
        resume: value, ...(value ? {} : { state: {}, books: bookState.withoutStates(settings) }),
      })));
    new Setting(containerEl).setName(t("settings_dictionary_languages")).setDesc(t("settings_dictionary_languages_desc"))
      .addDropdown((dropdown) => dropdown.addOption("shown", t("dictionary_shown")).addOption("all", t("dictionary_all")).setValue(settings.dictionaryLanguages)
        .onChange((value) => save({ dictionaryLanguages: value })));
    new Setting(containerEl).setName(t("settings_rail")).setDesc(t("settings_rail_desc"))
      .addDropdown((dropdown) => dropdown.addOption("bottom", t("rail_bottom")).addOption("top", t("rail_top")).setValue(settings.railPosition)
        .onChange(async (value) => {
          await save({ railPosition: value, railPositionChosen: true });
          for (const leaf of this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE)) {
            leaf.view?.frame?.toggleClass("firstpair-reader__frame--rail-top", value === "top");
          }
        }));
    new Setting(containerEl).setName(t("settings_sources_tab")).setDesc(t("settings_sources_tab_desc"))
      .addToggle((toggle) => toggle.setValue(settings.sourcesInNewTab).onChange((value) => save({ sourcesInNewTab: value })));
    new Setting(containerEl).setName(t("settings_editing")).setDesc(t("settings_editing_desc"))
      .addToggle((toggle) => toggle.setValue(settings.editing).onChange(async (value) => {
        await save({ editing: value }, true);
        this.display();
      }));
    if (!settings.editing) return;
    const text = (name, key, placeholder) => {
      new Setting(containerEl).setName(t(name)).addText?.((field) => field.setPlaceholder(placeholder)
        .setValue(settings[key] || "").onChange((value) => save({ [key]: value.trim() })));
    };
    new Setting(containerEl).setName(t("settings_engine")).setDesc(t("settings_engine_desc"))
      .addDropdown((dropdown) => dropdown
        .addOption("auto", `${t("engine_local")} → ${t("engine_api")}`)
        .addOption("local", t("engine_local"))
        .addOption("api", t("engine_api"))
        .addOption("off", t("engine_off"))
        .setValue(settings.transcriptionEngine)
        .onChange((value) => save({ transcriptionEngine: value })));
    new Setting(containerEl).setName(t("settings_auto")).setDesc(t("settings_auto_desc"))
      .addToggle((toggle) => toggle.setValue(settings.autoTranscribe).onChange((value) => save({ autoTranscribe: value })));
    text("settings_language", "voiceLanguage", "auto · en · ru · it");
    if (Platform.isDesktopApp) {
      text("settings_mlx_path", "mlxWhisperPath", "~/.local/bin/mlx_whisper");
      text("settings_mlx_model", "mlxModel", voiceCore.DEFAULT_MLX_MODEL);
    }
    text("settings_api_url", "apiBaseUrl", "https://api.openai.com/v1");
    text("settings_api_key", "apiKey", "sk-…");
    text("settings_api_model", "apiModel", "whisper-1");
  }
}

/* ---------------------------------------------------------------- plugin */

module.exports = class FirstPairReaderPlugin extends Plugin {
  async onload() {
    this.targets = null;
    this.model = null;
    this.modelIdentity = null;
    this.metrics = null;
    this.fragments = null;
    this.quoteIndex = null;
    this.readerTransition = false;
    this.lookup = dictionaryLookup((path) => this.readDictionaryFile(path), new LruCache(8));
    const saved = await this.loadData();
    // Before 2.4.1 every save wrote the whole settings object, so a bottom
    // rail nobody chose was stored as if chosen; only an explicit choice
    // (railPositionChosen) keeps it.
    if (saved && saved.railPosition === "bottom" && !saved.railPositionChosen) delete saved.railPosition;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    // 2.5.0 keeps state per book (book-state.js); the 2.4.x title-keyed maps
    // stay as they were and seed each book's record when it is first opened.
    this.settings.books = { ...(saved?.books && typeof saved.books === "object" ? saved.books : {}) };
    this.shelf = null;
    this.currentBook = null;
    this.store = new DecisionStore(this.app);
    this.transcribing = new Set();
    this.voiceListeners = new Set();
    this.pendingRun = null;
    this.io = this.makeIo();
    // Mobile keeps Backlinks/Outgoing-links leaves after their core plugins
    // are switched off; a swipe would land on "Plugin no longer active".
    for (const type of ["backlink", "outgoing-link"]) {
      const core = this.app.internalPlugins?.getPluginById?.(type);
      if (core && !core.enabled) this.app.workspace.detachLeavesOfType?.(type);
    }
    this.addSettingTab(new FirstPairReaderSettingTab(this.app, this));
    this.registerView(VIEW_TYPE, (leaf) => new FirstPairReaderView(leaf, this));
    this.addRibbonIcon("book-open", t("open_reader"), () => this.activate());
    this.addCommand({ id: "open-reader", name: "Open Reader", callback: () => this.activate() });
    this.addCommand({ id: "open-shelf", name: t("open_shelf"), callback: () => this.activate(undefined, { shelf: true }) });
    const viewCommand = (id, name, action) => this.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        const view = this.activeView();
        if (!view) return false;
        if (!checking) void action(view);
        return true;
      },
    });
    viewCommand("reader-previous", "Previous page", (view) => view.goPrevious());
    viewCommand("reader-next", "Next page", (view) => view.goNext());
    viewCommand("reader-back", "Back", (view) => view.restore());
    viewCommand("reader-forward", "Forward", (view) => view.goForward());
    viewCommand("reader-up", "Up", (view) => view.goUp());
    viewCommand("reader-top", "Top", (view) => view.toTop());
    viewCommand("reader-contents", "Contents", (view) => view.showContents());
    viewCommand("reader-gloss-language", "Next gloss language", (view) => view.cycleGlossLanguage());
    this.addCommand({ id: "find-source", name: t("find_source"), callback: () => void this.findSource() });
    this.addCommand({
      id: "transcribe-voice-notes", name: t("cmd_transcribe"),
      callback: () => void this.transcribePending({ includeFailed: true }),
    });
    this.registerMarkdownPostProcessor((element, context) => {
      this.bindEvidenceTargets(element);
      this.bindReaderLinks(element, { sourcePath: context?.sourcePath });
    });
    if (typeof this.registerMarkdownCodeBlockProcessor === "function") {
      for (const language of FRAGMENT_LANGUAGES) {
        this.registerMarkdownCodeBlockProcessor(language, (source, element) => void this.renderFragment(source, element));
      }
    }
    this.registerObsidianProtocolHandler?.("firstpair-reader", (params) => this.activate(params.page, {
      bookKey: typeof params.book === "string" ? params.book : undefined,
      shelf: params.shelf !== undefined,
    }));
    if (this.app.workspace.on && this.registerEvent) {
      this.registerEvent(this.app.workspace.on("file-open", (file) => void this.takeOver(file)));
    }
    this.app.workspace.onLayoutReady?.(() => {
      if (this.settings.editing && this.settings.autoTranscribe) void this.transcribePending({ quiet: true });
    });
  }

  makeIo() {
    const vault = this.app.vault;
    return {
      read: async (path) => {
        const file = vault.getAbstractFileByPath(path);
        if (file && !file.children) return /\.md$/i.test(path) && vault.cachedRead ? vault.cachedRead(file) : vault.read(file);
        const adapter = vault.adapter;
        if (adapter && await adapter.exists?.(path)) return adapter.read(path);
        return null;
      },
      list: async (path) => {
        const adapter = vault.adapter;
        if (!adapter?.list) return null;
        try {
          const listing = await adapter.list(path || "/");
          return { files: listing.files || [], folders: listing.folders || [] };
        } catch (_error) {
          return null;
        }
      },
    };
  }

  async saveSettings(patch) {
    Object.assign(this.settings, patch);
    await this.saveData(this.settings);
  }

  // A book's record: its own, else migrated from the 2.4.x maps (not saved
  // until the book saves something).
  bookRecord(key, legacyKey) {
    return bookState.bookRecord(this.settings, key, legacyKey).record;
  }

  async saveBook(key, legacyKey, patch, extra = {}) {
    await this.saveSettings({ books: bookState.patchBook(this.settings, key, patch, legacyKey), ...extra });
  }

  activeView() {
    const view = this.app.workspace.getActiveViewOfType?.(FirstPairReaderView);
    return view || this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view || null;
  }

  refreshViews(rerender = false) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (!(view instanceof FirstPairReaderView) || !view.applyLayout) continue;
      if (rerender) void view.render(); else view.applyLayout();
    }
  }

  // Every book of the vault, discovered once (contract.discoverAll).
  async loadBooks(force = false) {
    if (this.shelf && !force) return this.shelf;
    const { books, broken } = await contract.discoverAll(this.io);
    for (const book of books) await this.enrichLegacy(book);
    this.shelf = { books, broken };
    // Settings from 2.4.x name no book: the one their saved place belongs to
    // is the book read last.
    if (this.settings.lastBook === null || this.settings.lastBook === undefined) {
      const resumed = books.find((book) => bookState.legacyRecord(this.settings, legacyKeyOf(book))?.state);
      if (resumed) this.settings.lastBook = contract.bookKey(resumed);
    }
    if (!this.currentBook || !books.includes(this.currentBook)) {
      this.currentBook = null;
      this.model = null;
      const last = books.find((book) => contract.bookKey(book) === this.settings.lastBook);
      await this.useModel(last ?? books[0]);
    }
    return this.shelf;
  }

  // The book on screen (or read last): its model, identity, metrics, and
  // the caches that belong to it.
  async loadModel(force = false) {
    if (this.model && !force) return this.model;
    await this.loadBooks(force);
    return this.model;
  }

  async useModel(model) {
    if (!model || (this.currentBook === model && this.model === model)) return;
    this.currentBook = model;
    this.model = model;
    this.fragments = null;
    this.quoteIndex = null;
    this.targets = null;
    this.modelIdentity = reviewState.sha256Id(JSON.stringify({
      title: model.title, version: model.version, commit: model.sourceCommit, format: model.format,
      pages: (model.pages || []).map((page) => [page.id, page.file, page.anchor]),
      editions: (model.editions || []).map((edition) => [edition.id, edition.version]),
    }));
    this.metrics = null;
    if (model.metrics) {
      try {
        this.metrics = metricsCore.parseMetrics(await this.io.read(model.metrics));
      } catch (_error) {
        this.metrics = null;
      }
    }
    return model;
  }

  // Older vault formats carry some capabilities by convention: Cicero's
  // dictionaries, quote index and cover; a code book's fragment ledger.
  async enrichLegacy(model) {
    const data = model.root ? `${model.root}/_data` : "_data";
    if (!model.quotes) {
      for (const name of quotes.DEFAULT_INDEX_NAMES) {
        if ((await this.io.read(`${data}/${name}`)) !== null) {
          model.quotes = `${data}/${name}`;
          break;
        }
      }
    }
    if (model.format === "cicero") {
      const dictionaries = {};
      for (const target of ["en", "ru", "it"]) {
        const path = `${data}/dictionaries/la-${target}.json`;
        if ((await this.io.read(path)) !== null) dictionaries[target] = { path, label: languageName(target) };
      }
      if (Object.keys(dictionaries).length) {
        model.dictionaries = dictionaries;
        model.words = { selector: "td:first-child", lang: "la", notes: `${model.root}/Bilingual Sources/` };
      }
      for (const cover of ["Assets/cicero-on-himself-diagonal.png", "Illustrations/cicero-on-himself-diagonal.webp"]) {
        const path = `${model.root}/${cover}`;
        if (this.app.vault.getAbstractFileByPath(path)) {
          model.cover = path;
          break;
        }
      }
    }
  }

  async readDictionaryFile(path) {
    const text = await this.io.read(path);
    if (text === null) throw new Error(`missing ${path}`);
    return JSON.parse(text);
  }

  async voiceContext() {
    const model = await this.loadModel();
    const slug = String(model.title || "reader").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return { projectId: `reader-${slug || "book"}`, sourceContentId: this.modelIdentity };
  }

  /* ---------------------------------------------------- note takeover */

  async takeOver(file) {
    if (!file || this.readerTransition || !/\.md$/i.test(file.path)) return;
    let books;
    try {
      ({ books } = await this.loadBooks());
    } catch (_error) {
      return;
    }
    // The book whose folder holds the note (one book: that book).
    const holder = contract.bookForNote(books, file.path);
    const book = holder && holder.format !== "library" ? holder : null;
    const found = book ? contract.targetForNote(book, file.path) : null;
    if (!found) return;
    const target = { ...found, bookKey: contract.bookKey(book) };
    const leaf = this.app.workspace.getLeavesOfType?.("markdown")?.find((candidate) => candidate.view?.file?.path === file.path);
    if (!leaf) return;
    this.readerTransition = true;
    try {
      await leaf.setViewState({ type: VIEW_TYPE, active: true, state: target });
    } finally {
      this.readerTransition = false;
    }
  }

  /* ------------------------------------------------------ evidence links */

  async loadTargets() {
    if (this.targets) return this.targets;
    // A book in a folder keeps its own index; the vault's is the fallback.
    const root = this.currentBook?.root;
    const text = (root ? await this.io.read(`${root}/${TARGET_INDEX}`) : null) ?? await this.io.read(TARGET_INDEX);
    if (text === null) return new Map();
    const rows = JSON.parse(text);
    this.targets = new Map(rows.map((row) => [row.id, row]));
    return this.targets;
  }

  bindEvidenceTargets(element) {
    for (const anchor of element.querySelectorAll('a[href^="firstpair:target:"]')) {
      anchor.addEventListener("click", async (event) => {
        event.preventDefault();
        const id = anchor.getAttribute("href").slice("firstpair:target:".length);
        const target = (await this.loadTargets()).get(id);
        if (!target) return;
        const file = this.app.vault.getAbstractFileByPath(target.path);
        if (!file) return;
        if (file.children) {
          new Notice(t("folder_target", { path: target.path }));
          return;
        }
        await this.app.workspace.getLeaf(false).openFile(file);
      });
    }
  }

  // [Open the Reader](firstpair:reader) and [Canto 1](firstpair:page:<id>)
  // become buttons, so a phone never tries to open the custom scheme.
  // The context names the book a link belongs to: the Reader's own book, or
  // the note it sits in (a book's Home opens that book; the vault's shelf
  // Home, belonging to none, opens the book read last or the shelf).
  bindReaderLinks(element, context = {}) {
    for (const anchor of Array.from(element.querySelectorAll('a[href="firstpair:reader"], a[href^="firstpair:page:"]'))) {
      const href = anchor.getAttribute("href");
      const button = anchor.ownerDocument.createElement("button");
      button.className = "firstpair-reader__link";
      button.textContent = anchor.textContent;
      button.setAttribute("data-href", href);
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await this.activate(href.startsWith("firstpair:page:") ? href.slice("firstpair:page:".length) : undefined, context);
      });
      anchor.replaceWith(button);
    }
  }

  async activate(pageId, { bookKey, sourcePath, shelf = false } = {}) {
    let key = typeof bookKey === "string" ? bookKey : undefined;
    if (key === undefined && sourcePath) {
      try {
        const holder = contract.bookForNote((await this.loadBooks()).books, sourcePath);
        if (holder) key = contract.bookKey(holder);
      } catch (_error) {
        key = undefined;
      }
    }
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (!(view instanceof FirstPairReaderView)) return;
    if (shelf) {
      await view.showShelf();
      return;
    }
    if (view.hasShelf()) {
      if (key === undefined && pageId && !view.pages.some((page) => page.id === pageId)) {
        const holder = view.books.find((book) => book.pages?.some((page) => page.id === pageId));
        if (holder) key = contract.bookKey(holder);
      }
      // No context while the shelf is up: the book read last.
      if (key === undefined && view.mode === "shelf" && view.entry) key = view.bookKey;
      if (key !== undefined && (key !== view.bookKey || view.mode === "shelf")) {
        await view.applyTarget({ bookKey: key, ...(pageId ? { mode: "page", pageId } : {}) });
        return;
      }
    }
    if (pageId) await view.openPage(pageId);
  }

  /* -------------------------------------------------------- code fragments */

  async fragmentRow(id) {
    const model = await this.loadModel();
    if (!model.fragments) return null;
    if (!this.fragments) {
      const text = await this.io.read(model.fragments);
      const rows = text ? JSON.parse(text) : [];
      this.fragments = new Map((Array.isArray(rows) ? rows : rows.fragments || []).map((row) => [row.id, row]));
    }
    return this.fragments.get(id) || null;
  }

  async renderFragment(source, element) {
    let payload;
    try {
      payload = JSON.parse(source);
    } catch (_error) {
      element.createEl("pre", { text: source });
      return;
    }
    let row = null;
    try {
      row = await this.fragmentRow(payload.id);
    } catch (_error) {
      row = null;
    }
    const fragment = {
      id: payload.id,
      symbol: row?.symbol || payload.symbol || payload.id,
      path: row?.source_path || payload.sourcePath || "",
      codeNote: row?.code_note || payload.codeNote || "",
      start: Number(row?.start_line || payload.startLine || 1),
      end: Number(row?.end_line || payload.endLine || row?.start_line || payload.startLine || 1),
      summary: row?.summary || "",
    };
    const card = element.createDiv({ cls: "firstpair-reader__fragment" });
    card.createEl("strong", { text: fragment.symbol });
    card.createEl("code", { cls: "firstpair-reader__fragment-path", text: `${fragment.path}:${fragment.start}-${fragment.end}` });
    if (fragment.summary) card.createEl("p", { text: fragment.summary });
    const actions = card.createDiv({ cls: "firstpair-reader__fragment-actions" });
    const show = actions.createEl("button", { text: t("show_code"), attr: { type: "button", "aria-expanded": "false" } });
    const open = actions.createEl("button", { text: t("open_file"), attr: { type: "button" } });
    const excerpt = card.createDiv({ cls: "firstpair-reader__fragment-code", attr: { hidden: "" } });
    show.addEventListener("click", async () => {
      const opening = excerpt.hasAttribute("hidden");
      if (opening && !excerpt.childElementCount) await this.fillExcerpt(excerpt, fragment);
      if (opening) excerpt.removeAttribute("hidden"); else excerpt.setAttribute("hidden", "");
      show.setText(opening ? t("hide_code") : t("show_code"));
      show.setAttribute("aria-expanded", String(opening));
    });
    open.addEventListener("click", async () => {
      const note = fragment.codeNote.replace(/\.md$/, "");
      const view = this.activeView();
      if (view && view.book) await view.go({ mode: "note", notePath: note, noteLines: { start: fragment.start, end: fragment.end } });
      else await this.app.workspace.openLinkText?.(note, "", false);
    });
  }

  // The fragment's lines, numbered, read from the code note's source fence.
  async fillExcerpt(container, fragment) {
    const note = fragment.codeNote.endsWith(".md") ? fragment.codeNote : `${fragment.codeNote}.md`;
    const text = await this.io.read(note);
    if (text === null) {
      container.createEl("p", { text: t("code_missing", { path: note }) });
      return;
    }
    const full = text.indexOf("## Full Source");
    const lines = fencedLines(full >= 0 ? text.slice(full) : text);
    const pre = container.createEl("pre", { cls: "firstpair-reader__fragment-lines" });
    for (let number = fragment.start; number <= Math.min(fragment.end, lines.length); number += 1) {
      const row = pre.createDiv({ cls: "firstpair-reader__fragment-line" });
      row.createSpan({ cls: "firstpair-reader__line-number", text: String(number) });
      row.createSpan({ text: lines[number - 1] });
    }
    container.createEl("p", { cls: "firstpair-reader__fragment-range", text: t("code_lines", { start: fragment.start, end: fragment.end }) });
  }

  /* -------------------------------------------------------- source finder */

  async findSource() {
    const model = await this.loadModel();
    if (!model.quotes) {
      new Notice(t("no_source", { score: 0 }));
      return;
    }
    if (!this.quoteIndex) {
      const parsed = quotes.parseIndex(await this.io.read(model.quotes));
      this.quoteIndex = quotes.buildSearchIndex(parsed.entries);
    }
    const host = typeof activeWindow !== "undefined" ? activeWindow : (typeof window !== "undefined" ? window : null);
    const selection = host?.getSelection?.()?.toString?.().trim() || "";
    const editor = this.app.workspace.activeEditor?.editor;
    let query = selection || editor?.getSelection?.() || "";
    if (!query && editor) {
      const cursor = editor.getCursor();
      query = quotes.extractCursorText(editor.getLine(cursor.line), cursor.ch);
    }
    if (!query) {
      new Notice(t("no_quote"));
      return;
    }
    const matches = quotes.matchEntries(query, this.quoteIndex, { limit: 8 });
    const best = matches[0];
    if (!best || best.score < 0.66) {
      new Notice(t("no_source", { score: Math.round((best?.score || 0) * 100) }));
      return;
    }
    const decisive = matches.length === 1 || (best.score >= 0.88 && best.score - (matches[1]?.score || 0) >= 0.055);
    const openEntry = (entry) => this.app.workspace.openLinkText?.(
      quotes.bilingualLinkTarget(entry), "", this.settings.sourcesInNewTab ? "tab" : false,
    );
    if (decisive) {
      await openEntry(best.entry);
      return;
    }
    const near = matches.filter((match) => best.score - match.score <= 0.14);
    const SuggestModal = obsidian.SuggestModal;
    if (!SuggestModal) {
      await openEntry(best.entry);
      return;
    }
    const plugin = this;
    new (class extends SuggestModal {
      getSuggestions(input) {
        const needle = input.toLowerCase();
        return near.filter((match) => !needle || [match.entry.work_title, match.entry.citation, match.matchedText]
          .some((value) => String(value || "").toLowerCase().includes(needle)));
      }

      renderSuggestion(match, element) {
        element.createEl("div", { text: [match.entry.work_title, match.entry.citation].filter(Boolean).join(" · ") });
        element.createEl("small", { text: `${match.language} ${Math.round(match.score * 100)}% — ${match.matchedText.slice(0, 140)}` });
      }

      onChooseSuggestion(match) {
        void openEntry.call(plugin, match.entry);
      }
    })(this.app).open();
  }
};

voiceCore.install(module.exports);

module.exports.__test = Object.freeze({
  FirstPairReaderView,
  ReaderHistory,
  contract,
  fencedLines,
  setUiLanguage: (lang) => { uiLang = lang; },
});
