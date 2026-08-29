const { ItemView, MarkdownRenderer, Plugin, setIcon } = require("obsidian");

const VIEW_TYPE = "firstpair-reader";
const READER_INDEX = "_data/reader.json";
const PARALLEL_INDEX = "_data/parallel-reader.json";
const TARGET_INDEX = "_data/targets.json";

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
    await this.loadIndex(); this.makeToolbar(); this.makeRail(); await this.renderPage();
  }
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
      const strip = this.page.createDiv({ cls: "firstpair-reader__strip", attr: { "data-unit-id": unit.id } });
      strip.style.setProperty("--firstpair-columns", String(languages.length));
      for (const language of languages) {
        const isSource = language === this.parallel.sourceLanguage;
        const cell = strip.createDiv({ cls: `firstpair-reader__cell firstpair-reader__cell--${isSource ? "source" : language.id}`, attr: { lang: language.lang ?? language.id } });
        this.appendText(cell, isSource ? unit.source : (unit.translations?.[language.id] ?? []), isSource);
      }
    }
  }
  async openDictionary(surface) {
    const word = normalizeWord(surface); this.drawer.empty(); this.drawer.removeAttribute("hidden");
    const head = this.drawer.createDiv({ cls: "firstpair-reader__drawer-head" }); head.createEl("strong", { text: surface });
    const close = head.createEl("button", { text: "Close", attr: { "aria-label": "Close dictionary" } });
    close.addEventListener("click", () => this.drawer.setAttribute("hidden", ""));
    let found = false;
    for (const language of this.parallel.translations.filter((item) => this.enabled.has(item.id))) {
      const dictionary = this.parallel.dictionaries?.[language.id]; if (!dictionary) continue;
      const data = await this.plugin.loadDictionary(dictionary.path); const entries = data.entries[word] ?? [];
      const section = this.drawer.createDiv({ cls: "firstpair-reader__definition" }); section.createEl("h3", { text: language.label });
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
    this.registerView(VIEW_TYPE, (leaf) => new FirstPairReaderView(leaf, this));
    this.addRibbonIcon("book-open", "Open the FirstPair Reader", () => this.activate());
    this.addCommand({ id: "open-reader", name: "Open Reader", callback: () => this.activate() });
    this.registerMarkdownPostProcessor((element) => this.bindEvidenceTargets(element));
  }
  async loadDictionary(path) {
    if (this.dictionaries.has(path)) return this.dictionaries.get(path);
    const file = this.app.vault.getAbstractFileByPath(path); if (!file) throw new Error(`Missing dictionary: ${path}`);
    const value = JSON.parse(await this.app.vault.read(file)); this.dictionaries.set(path, value); return value;
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
  async activate() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf("tab"); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
    this.app.workspace.revealLeaf(leaf);
  }
};
