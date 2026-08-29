const { ItemView, MarkdownRenderer, Platform, Plugin, setIcon } = require("obsidian");

const VIEW_TYPE = "firstpair-reader";
const READER_INDEX = "_data/reader.json";
const PARALLEL_INDEX = "_data/parallel-reader.json";
const TARGET_INDEX = "_data/targets.json";
const DICTIONARY_INDEX_SCHEMA = "firstpair-reader-dictionary-index-v1";
// Layouts for aligned editions. "auto" follows the device: stacked when the
// reader is narrow or a phone is held upright, columns otherwise.
const LAYOUTS = [
  { id: "auto", label: "Auto", icon: "smartphone" },
  { id: "columns", label: "Columns", icon: "columns-2" },
  { id: "stacked", label: "Stacked", icon: "rows-3" },
];
const STACK_BELOW = 700;
const DEFAULT_SETTINGS = { layout: "auto" };

class ReaderHistory {
  constructor(limit = 64) { this.limit = limit; this.items = []; }
  push(value) { this.items.push(value); if (this.items.length > this.limit) this.items.shift(); }
  pop() { return this.items.pop() ?? null; }
}

const normalizeWord = (value) => value.normalize("NFC").toLocaleLowerCase("it-IT")
  .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");

class FirstPairReaderView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf); this.plugin = plugin; this.pages = []; this.position = 0;
    this.history = new ReaderHistory(); this.parallel = null; this.enabled = new Set();
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return this.parallel?.title ?? "FirstPair Reader"; }
  getIcon() { return "book-open"; }

  async readJson(path, optional = false) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) { if (optional) return null; throw new Error(`Missing ${path}`); }
    return JSON.parse(await this.app.vault.read(file));
  }
  async onOpen() {
    this.containerEl.empty(); this.root = this.containerEl.createDiv({ cls: "firstpair-reader" });
    this.toolbar = this.root.createDiv({ cls: "firstpair-reader__toolbar" });
    this.page = this.root.createDiv({ cls: "firstpair-reader__page" });
    this.drawer = this.root.createDiv({ cls: "firstpair-reader__drawer", attr: { hidden: "" } });
    this.rail = this.root.createDiv({ cls: "firstpair-reader__rail" });
    await this.loadIndex(); this.makeToolbar(); this.makeRail(); this.watchLayout(); await this.renderPage();
  }
  async onClose() { this.resizeObserver?.disconnect(); this.orientation?.removeEventListener("change", this.applyLayout); }
  async loadIndex() {
    this.parallel = await this.readJson(PARALLEL_INDEX, true);
    const value = this.parallel?.pages ?? await this.readJson(READER_INDEX);
    if (!Array.isArray(value) || !value.length) throw new Error("Reader index is empty");
    this.pages = value;
    for (const language of this.parallel?.translations ?? []) if (language.defaultVisible !== false) this.enabled.add(language.id);
  }
  makeToolbar() {
    if (!this.parallel) { this.toolbar.hidden = true; return; }
    this.toolbar.createSpan({ text: "Translations", cls: "firstpair-reader__toolbar-title" });
    for (const language of this.parallel.translations) {
      const label = this.toolbar.createEl("label", { cls: "firstpair-reader__language-toggle" });
      const input = label.createEl("input", { type: "checkbox" }); input.checked = this.enabled.has(language.id);
      input.addEventListener("change", async () => {
        if (input.checked) this.enabled.add(language.id); else this.enabled.delete(language.id);
        await this.renderPage(false);
      });
      label.createSpan({ text: language.label });
    }
    this.layoutButton = this.toolbar.createEl("button", { cls: "firstpair-reader__layout-toggle" });
    this.layoutButton.addEventListener("click", async () => {
      const index = LAYOUTS.findIndex((item) => item.id === this.plugin.settings.layout);
      await this.plugin.saveSettings({ layout: LAYOUTS[(index + 1) % LAYOUTS.length].id });
      this.applyLayout();
    });
    this.showLayoutChoice();
  }
  showLayoutChoice() {
    const choice = LAYOUTS.find((item) => item.id === this.plugin.settings.layout) ?? LAYOUTS[0];
    this.layoutButton.empty(); setIcon(this.layoutButton, choice.icon);
    this.layoutButton.createSpan({ text: choice.label, cls: "firstpair-reader__button-label" });
    this.layoutButton.setAttribute("aria-label", `Layout: ${choice.label} (tap to change)`); this.layoutButton.title = `Layout: ${choice.label}`;
  }
  // Orientation and width are both watched: an iPad in landscape has room for
  // columns, an iPhone held upright does not, and a narrow desktop pane behaves
  // like the phone.
  watchLayout() {
    this.applyLayout = () => {
      if (!this.parallel) return;
      let layout = this.plugin.settings.layout;
      if (layout === "auto") {
        const portrait = this.orientation?.matches ?? false;
        layout = this.root.clientWidth < STACK_BELOW || (Platform.isMobile && portrait) ? "stacked" : "columns";
      }
      this.page.toggleClass("firstpair-reader__page--stacked", layout === "stacked");
      this.page.toggleClass("firstpair-reader__page--columns", layout === "columns");
      if (this.layoutButton) this.showLayoutChoice();
      this.sizeDrawer();
    };
    if (typeof window.matchMedia === "function") { this.orientation = window.matchMedia("(orientation: portrait)"); this.orientation.addEventListener("change", this.applyLayout); }
    if (typeof ResizeObserver === "function") { this.resizeObserver = new ResizeObserver(() => this.applyLayout()); this.resizeObserver.observe(this.root); }
  }
  // In column layout the drawer covers only the last column, as on a desktop,
  // so the source and the other translations stay readable beside it.
  sizeDrawer() {
    if (!this.drawer || this.drawer.hasAttribute("hidden")) return;
    const last = this.page.hasClass("firstpair-reader__page--columns") ? this.page.querySelector(".firstpair-reader__strip .firstpair-reader__cell:last-child") : null;
    if (!last) { this.drawer.style.removeProperty("width"); return; }
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const width = Math.min(window.innerWidth * 0.9, Math.max(15 * rem, window.innerWidth - last.getBoundingClientRect().left + 8));
    this.drawer.style.width = `${Math.round(width)}px`;
  }
  makeButton(label, icon, action) {
    const button = this.rail.createEl("button", { attr: { "aria-label": label, title: label } });
    setIcon(button, icon); button.createSpan({ text: label, cls: "firstpair-reader__button-label" });
    button.addEventListener("click", action); return button;
  }
  makeRail() {
    this.previous = this.makeButton("Previous", "chevron-left", () => this.jump(this.position - 1));
    this.up = this.makeButton("Up", "corner-left-up", () => this.openHome());
    this.back = this.makeButton("Back", "rotate-ccw", () => this.restore());
    this.top = this.makeButton("Top", "arrow-up-to-line", () => this.toTop());
    this.toc = this.makeButton("TOC", "list", () => this.openHome());
    this.next = this.makeButton("Next", "chevron-right", () => this.jump(this.position + 1));
  }
  snapshot() { return { position: this.position, scrollTop: this.root.scrollTop }; }
  async jump(position) { if (position < 0 || position >= this.pages.length || position === this.position) return; this.history.push(this.snapshot()); this.position = position; await this.renderPage(); }
  async open(pageId) { const position = this.pages.findIndex((page) => page.id === pageId); if (position >= 0) await this.jump(position); }
  async restore() { const state = this.history.pop(); if (!state) return; this.position = state.position; await this.renderPage(); this.root.scrollTop = state.scrollTop; }
  toTop() { this.history.push(this.snapshot()); this.root.scrollTop = 0; }
  async openHome() { const home = this.app.vault.getAbstractFileByPath("Home.md"); if (home) await this.app.workspace.getLeaf(false).openFile(home); }

  appendText(container, lines, clickable = false) {
    for (const line of Array.isArray(lines) ? lines : [lines]) {
      const row = container.createDiv({ cls: "firstpair-reader__verse" });
      if (!clickable) { row.setText(line); continue; }
      for (const token of line.split(/([\p{L}\p{M}]+[’']?)/u)) {
        if (/^[\p{L}\p{M}]/u.test(token)) {
          const word = row.createEl("button", { text: token, cls: "firstpair-reader__word" });
          word.addEventListener("click", () => this.openDictionary(token));
        } else row.appendText(token);
      }
    }
  }
  async renderParallel(entry) {
    const chapter = await this.readJson(entry.path); this.page.addClass("firstpair-reader__page--parallel");
    this.page.createEl("h1", { text: chapter.title });
    // The source text leads: a learner reads the original first and the
    // translations, in their declared order, follow. A title may still
    // declare sourceLanguage.position "right" for the older arrangement.
    const translations = this.parallel.translations.filter((item) => this.enabled.has(item.id));
    const sourceLast = this.parallel.sourceLanguage.position === "right";
    const languages = sourceLast ? [...translations, this.parallel.sourceLanguage] : [this.parallel.sourceLanguage, ...translations];
    const labels = this.page.createDiv({ cls: "firstpair-reader__column-labels" });
    labels.style.setProperty("--firstpair-columns", String(languages.length));
    for (const language of languages) labels.createDiv({ text: language.label, cls: "firstpair-reader__column-label" });
    for (const unit of chapter.units) {
      const strip = this.page.createDiv({ cls: "firstpair-reader__strip", attr: { "data-unit-id": unit.id, "data-translations": String(translations.length) } });
      strip.style.setProperty("--firstpair-columns", String(languages.length));
      for (const language of languages) {
        const isSource = language === this.parallel.sourceLanguage;
        const cell = strip.createDiv({ cls: `firstpair-reader__cell firstpair-reader__cell--${isSource ? "source" : "translation"}`, attr: { lang: language.lang ?? language.id, "data-label": language.label } });
        this.appendText(cell, isSource ? unit.source : (unit.translations?.[language.id] ?? []), isSource);
      }
    }
    this.applyLayout();
  }
  async openDictionary(surface) {
    const word = normalizeWord(surface); this.drawer.empty(); this.drawer.removeAttribute("hidden"); this.sizeDrawer();
    const head = this.drawer.createDiv({ cls: "firstpair-reader__drawer-head" }); head.createEl("strong", { text: surface });
    const close = head.createEl("button", { text: "Close", attr: { "aria-label": "Close dictionary" } });
    close.addEventListener("click", () => this.drawer.setAttribute("hidden", ""));
    let found = false;
    for (const language of this.parallel.translations.filter((item) => this.enabled.has(item.id))) {
      const dictionary = this.parallel.dictionaries?.[language.id]; if (!dictionary) continue;
      const section = this.drawer.createDiv({ cls: "firstpair-reader__definition" }); section.createEl("h3", { text: language.label });
      let entries;
      try { entries = await this.plugin.lookup(dictionary.path, word); }
      catch (error) { section.createEl("p", { text: `This dictionary is not in the vault yet (${error.message}). If the vault is synced, wait for the sync to finish.`, cls: "firstpair-reader__warning" }); continue; }
      if (!entries.length) { section.createEl("p", { text: "No exact headword entry." }); continue; }
      found = true;
      for (const entry of entries) {
        const head = section.createEl("h4", { text: [entry.headword, entry.partOfSpeech].filter(Boolean).join(" · ") });
        if (entry.grammar) head.createSpan({ text: ` ${entry.grammar}`, cls: "firstpair-reader__grammar" });
        section.createEl("p", { text: (entry.definitions ?? []).join("; ") });
        for (const example of entry.examples ?? []) section.createEl("blockquote", { text: typeof example === "string" ? example : [example.latin ?? example.source, example.translation].filter(Boolean).join(" — ") });
      }
    }
    if (!found) this.drawer.createEl("p", { text: "Try the headword form; this offline edition does not guess every historical inflection." });
  }
  async renderPage(resetScroll = true) {
    const entry = this.pages[this.position]; this.page.empty(); this.page.removeClass("firstpair-reader__page--parallel");
    if (this.parallel) await this.renderParallel(entry);
    else {
      const file = this.app.vault.getAbstractFileByPath(entry.path); if (!file) throw new Error(`Missing Reader page: ${entry.path}`);
      await MarkdownRenderer.render(this.app, await this.app.vault.read(file), this.page, entry.path, this.plugin);
    }
    if (resetScroll) this.root.scrollTop = 0;
    this.previous.disabled = this.position === 0; this.next.disabled = this.position === this.pages.length - 1;
    this.back.disabled = !this.history.items.length;
    this.previous.title = this.pages[this.position - 1]?.title ?? "Previous";
    this.next.title = this.pages[this.position + 1]?.title ?? "Next";
  }
}

module.exports = class FirstPairReaderPlugin extends Plugin {
  async onload() {
    this.targets = null; this.dictionaries = new Map();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.registerView(VIEW_TYPE, (leaf) => new FirstPairReaderView(leaf, this));
    this.addRibbonIcon("book-open", "Open the FirstPair Reader", () => this.activate());
    this.addCommand({ id: "open-reader", name: "Open Reader", callback: () => this.activate() });
    this.registerMarkdownPostProcessor((element) => { this.bindEvidenceTargets(element); this.bindReaderLinks(element); });
    // obsidian://firstpair-reader?page=<id> opens a page from outside the vault (Shortcuts, other notes).
    this.registerObsidianProtocolHandler("firstpair-reader", (params) => this.activate(params.page));
  }
  async saveSettings(patch) { Object.assign(this.settings, patch); await this.saveData(this.settings); }
  async loadDictionary(path) {
    if (this.dictionaries.has(path)) return this.dictionaries.get(path);
    const file = this.app.vault.getAbstractFileByPath(path); if (!file) throw new Error(`missing ${path}`);
    const value = JSON.parse(await this.app.vault.read(file)); this.dictionaries.set(path, value); return value;
  }
  // A dictionary is either one file of entries or an index whose shards are
  // keyed by headword prefix, kept small enough for Obsidian Sync and phones.
  async lookup(path, word) {
    const dictionary = await this.loadDictionary(path);
    if (dictionary.schema !== DICTIONARY_INDEX_SCHEMA) return dictionary.entries?.[word] ?? [];
    const base = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    for (let length = Math.min(word.length, dictionary.prefixLength ?? 1); length >= 0; length -= 1) {
      const shard = dictionary.shards?.[word.slice(0, length)]; if (!shard) continue;
      const entries = (await this.loadDictionary(base + shard)).entries?.[word]; if (entries) return entries;
    }
    return [];
  }
  async loadTargets() {
    if (this.targets) return this.targets; const file = this.app.vault.getAbstractFileByPath(TARGET_INDEX); if (!file) return new Map();
    const rows = JSON.parse(await this.app.vault.read(file)); this.targets = new Map(rows.map((row) => [row.id, row])); return this.targets;
  }
  bindEvidenceTargets(element) {
    for (const anchor of element.querySelectorAll('a[href^="firstpair:target:"]')) anchor.addEventListener("click", async (event) => {
      event.preventDefault(); const id = anchor.getAttribute("href").slice("firstpair:target:".length); const target = (await this.loadTargets()).get(id); if (!target) return;
      const file = this.app.vault.getAbstractFileByPath(target.path); if (file) await this.app.workspace.getLeaf(false).openFile(file);
    });
  }
  // Home.md links: [Open the Reader](firstpair:reader) and [Canto 1](firstpair:page:<id>).
  bindReaderLinks(element) {
    for (const anchor of element.querySelectorAll('a[href="firstpair:reader"], a[href^="firstpair:page:"]')) anchor.addEventListener("click", async (event) => {
      event.preventDefault(); event.stopPropagation(); const href = anchor.getAttribute("href");
      await this.activate(href.startsWith("firstpair:page:") ? href.slice("firstpair:page:".length) : undefined);
    });
  }
  async activate(pageId) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf("tab"); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
    this.app.workspace.revealLeaf(leaf);
    if (pageId && leaf.view instanceof FirstPairReaderView) await leaf.view.open(pageId);
  }
};
