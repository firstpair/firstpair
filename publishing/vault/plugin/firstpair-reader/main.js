const { ItemView, MarkdownRenderer, Platform, Plugin, PluginSettingTab, Setting, setIcon } = require("obsidian");

const VIEW_TYPE = "firstpair-reader";
const READER_INDEX = "_data/reader.json";
const PARALLEL_INDEX = "_data/parallel-reader.json";
const TARGET_INDEX = "_data/targets.json";
const DICTIONARY_INDEX_SCHEMA = "firstpair-reader-dictionary-index-v1";
// Layouts for aligned editions. "auto" follows the device: stacked when the
// reader is narrow or a phone is held upright, columns otherwise.
const LAYOUTS = [
  { id: "auto", label: "Auto", icons: ["smartphone"] },
  { id: "columns", label: "Columns", icons: ["columns-2", "columns"] },
  { id: "stacked", label: "Stacked", icons: ["rows-3", "rows"] },
];
// Obsidian's bundled Lucide set renamed some icons; take the first name it knows.
const setAnyIcon = (element, names) => { for (const name of names) { setIcon(element, name); if (element.querySelector("svg")) return; } };
const STACK_BELOW = 700;
// reserveDrawerColumn: with a translation switched off, the remaining columns
// keep their places on the left and the empty track is where the dictionary
// drawer opens, so it never covers a visible translation.
// keepDrawerOpen: the dictionary is a standing column that keeps the last entry.
// dictionaryLanguages: "shown" answers only in the translations on screen;
// "all" answers in every language, the shown ones first.
const DEFAULT_SETTINGS = { layout: "auto", reserveDrawerColumn: true, keepDrawerOpen: false, dictionaryLanguages: "shown" };

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
    try { await this.loadIndex(); this.makeToolbar(); this.makeRail(); this.watchLayout(); await this.renderPage(); }
    catch (error) { this.showError(error); }
  }
  // A vault still syncing, or a half-written index, must never leave a blank view.
  showError(error) {
    console.error("FirstPair Reader", error);
    this.page.empty(); const box = this.page.createDiv({ cls: "firstpair-reader__error" });
    box.createEl("p", { text: `The Reader could not open this vault: ${error?.message ?? error}` });
    box.createEl("p", { text: "If the vault is still syncing, wait for it to finish, then try again." });
    const retry = box.createEl("button", { text: "Retry" }); retry.addEventListener("click", () => this.onOpen());
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
    this.layoutButton.empty(); setAnyIcon(this.layoutButton, choice.icons);
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
  // The drawer is placed by measurement: in column layout it sits exactly on
  // the reserved (empty) track when there is one, otherwise over the last
  // column; either way it never covers a translation the reader is using. In
  // stacked layout it is a panel on the right of the Reader pane.
  sizeDrawer() {
    if (!this.drawer || this.drawer.hasAttribute("hidden")) return;
    const style = this.drawer.style;
    for (const property of ["left", "top", "width", "height"]) style.removeProperty(property);
    const pane = this.root.getBoundingClientRect();
    if (!pane.width) return;
    style.top = `${Math.round(pane.top)}px`; style.height = `${Math.round(pane.height)}px`;
    const strip = this.page.hasClass("firstpair-reader__page--columns") ? this.page.querySelector(".firstpair-reader__strip") : null;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    if (!strip) {
      const width = Math.min(30 * rem, pane.width * 0.9);
      style.left = `${Math.round(pane.right - width)}px`; style.width = `${Math.round(width)}px`; return;
    }
    const grid = strip.getBoundingClientRect();
    const tracks = Number(strip.style.getPropertyValue("--firstpair-columns")) || strip.children.length || 1;
    const gap = parseFloat(getComputedStyle(strip).columnGap) || 0;
    const track = (grid.width - gap * (tracks - 1)) / tracks;
    const cells = strip.querySelectorAll(".firstpair-reader__cell");
    // The drawer's own column: the empty track, or the last visible one.
    const index = this.reservedTrack ? cells.length : Math.max(0, cells.length - 1);
    const left = grid.left + index * (track + gap) - gap / 2;
    const width = Math.max(15 * rem, pane.right - left);
    style.left = `${Math.round(Math.max(pane.left, left))}px`; style.width = `${Math.round(Math.min(width, pane.width))}px`;
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
  async openPage(pageId) { const position = this.pages.findIndex((page) => page.id === pageId); if (position >= 0) await this.jump(position); }
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
    const tracks = this.plugin.settings.reserveDrawerColumn ? 1 + this.parallel.translations.length : languages.length;
    this.reservedTrack = tracks > languages.length;
    const labels = this.page.createDiv({ cls: "firstpair-reader__column-labels" });
    labels.style.setProperty("--firstpair-columns", String(tracks));
    for (const language of languages) labels.createDiv({ text: language.label, cls: "firstpair-reader__column-label" });
    for (const unit of chapter.units) {
      const strip = this.page.createDiv({ cls: "firstpair-reader__strip", attr: { "data-unit-id": unit.id, "data-translations": String(translations.length) } });
      strip.style.setProperty("--firstpair-columns", String(tracks));
      for (const language of languages) {
        const isSource = language === this.parallel.sourceLanguage;
        const cell = strip.createDiv({ cls: `firstpair-reader__cell firstpair-reader__cell--${isSource ? "source" : "translation"}`, attr: { lang: language.lang ?? language.id, "data-label": language.label } });
        this.appendText(cell, isSource ? unit.source : (unit.translations?.[language.id] ?? []), isSource);
      }
    }
    this.applyLayout();
  }
  // Which dictionaries answer, and in what order: the translations on screen
  // first (in the edition's order), then — only when the setting says all —
  // the ones switched off.
  dictionaryLanguages() {
    const shown = this.parallel.translations.filter((item) => this.enabled.has(item.id));
    if (this.plugin.settings.dictionaryLanguages !== "all") return shown;
    return [...shown, ...this.parallel.translations.filter((item) => !this.enabled.has(item.id))];
  }
  showDrawer() {
    this.drawer.removeAttribute("hidden"); this.sizeDrawer();
    if (!this.drawer.childElementCount) {
      const head = this.drawer.createDiv({ cls: "firstpair-reader__drawer-head" }); head.createEl("strong", { text: "Dictionary" });
      this.drawer.createEl("p", { text: "Select a word of the source text.", cls: "firstpair-reader__drawer-hint" });
    }
  }
  async openDictionary(surface) {
    const word = normalizeWord(surface); this.drawer.empty(); this.drawer.removeAttribute("hidden"); this.sizeDrawer();
    const head = this.drawer.createDiv({ cls: "firstpair-reader__drawer-head" }); head.createEl("strong", { text: surface });
    if (!this.plugin.settings.keepDrawerOpen) {
      const close = head.createEl("button", { text: "Close", attr: { "aria-label": "Close dictionary" } });
      close.addEventListener("click", () => this.drawer.setAttribute("hidden", ""));
    }
    let found = false;
    for (const language of this.dictionaryLanguages()) {
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
    try {
      if (this.parallel) await this.renderParallel(entry);
      else {
        const file = this.app.vault.getAbstractFileByPath(entry.path); if (!file) throw new Error(`Missing Reader page: ${entry.path}`);
        await MarkdownRenderer.render(this.app, await this.app.vault.read(file), this.page, entry.path, this.plugin);
      }
    } catch (error) { this.showError(error); return; }
    if (resetScroll) this.root.scrollTop = 0;
    if (this.plugin.settings.keepDrawerOpen) this.showDrawer(); else this.sizeDrawer();
    this.previous.disabled = this.position === 0; this.next.disabled = this.position === this.pages.length - 1;
    this.back.disabled = !this.history.items.length;
    this.previous.title = this.pages[this.position - 1]?.title ?? "Previous";
    this.next.title = this.pages[this.position + 1]?.title ?? "Next";
  }
}

class FirstPairReaderSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this; containerEl.empty();
    new Setting(containerEl).setName("Layout").setDesc("Auto follows the width of the Reader pane and the orientation of a phone; Columns and Stacked stay fixed.")
      .addDropdown((dropdown) => { for (const item of LAYOUTS) dropdown.addOption(item.id, item.label); dropdown.setValue(this.plugin.settings.layout)
        .onChange(async (value) => { await this.plugin.saveSettings({ layout: value }); this.plugin.refreshViews(); }); });
    new Setting(containerEl).setName("Reserve the last column for the dictionary")
      .setDesc("With a translation switched off, keep the remaining columns in place on the left; the dictionary drawer opens over the empty column instead of covering a translation. Off: the visible columns spread across the full width.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.reserveDrawerColumn)
        .onChange(async (value) => { await this.plugin.saveSettings({ reserveDrawerColumn: value }); this.plugin.refreshViews(true); }));
    new Setting(containerEl).setName("Keep the dictionary open")
      .setDesc("The dictionary is a standing column that keeps the last entry while you read and turn pages, instead of a drawer that closes.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.keepDrawerOpen)
        .onChange(async (value) => { await this.plugin.saveSettings({ keepDrawerOpen: value }); this.plugin.refreshViews(true); }));
    new Setting(containerEl).setName("Dictionary languages")
      .setDesc("Shown: answer only in the translations on screen — one language when one translation is on. All: answer in every language of the edition, the shown ones first.")
      .addDropdown((dropdown) => dropdown.addOption("shown", "Shown translations").addOption("all", "All, shown first").setValue(this.plugin.settings.dictionaryLanguages)
        .onChange(async (value) => { await this.plugin.saveSettings({ dictionaryLanguages: value }); }));
  }
}

module.exports = class FirstPairReaderPlugin extends Plugin {
  async onload() {
    this.targets = null; this.dictionaries = new Map();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new FirstPairReaderSettingTab(this.app, this));
    this.registerView(VIEW_TYPE, (leaf) => new FirstPairReaderView(leaf, this));
    this.addRibbonIcon("book-open", "Open the FirstPair Reader", () => this.activate());
    this.addCommand({ id: "open-reader", name: "Open Reader", callback: () => this.activate() });
    this.registerMarkdownPostProcessor((element) => { this.bindEvidenceTargets(element); this.bindReaderLinks(element); });
    // obsidian://firstpair-reader?page=<id> opens a page from outside the vault (Shortcuts, other notes).
    this.registerObsidianProtocolHandler("firstpair-reader", (params) => this.activate(params.page));
  }
  async saveSettings(patch) { Object.assign(this.settings, patch); await this.saveData(this.settings); }
  refreshViews(rerender = false) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view; if (!(view instanceof FirstPairReaderView) || !view.applyLayout) continue;
      if (rerender) view.renderPage(false); else view.applyLayout();
    }
  }
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
  // Each anchor is replaced by a button, so Obsidian's own handling of
  // external links (which on a phone may try to open the scheme) never runs.
  bindReaderLinks(element) {
    for (const anchor of Array.from(element.querySelectorAll('a[href="firstpair:reader"], a[href^="firstpair:page:"]'))) {
      const href = anchor.getAttribute("href");
      const button = element.doc?.createElement?.("button") ?? anchor.ownerDocument.createElement("button");
      button.className = "firstpair-reader__link"; button.textContent = anchor.textContent; button.setAttribute("data-href", href);
      button.addEventListener("click", async (event) => {
        event.preventDefault(); event.stopPropagation();
        await this.activate(href.startsWith("firstpair:page:") ? href.slice("firstpair:page:".length) : undefined);
      });
      anchor.replaceWith(button);
    }
  }
  async activate(pageId) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf("tab"); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
    this.app.workspace.revealLeaf(leaf);
    if (pageId && leaf.view instanceof FirstPairReaderView) await leaf.view.openPage(pageId);
  }
};
