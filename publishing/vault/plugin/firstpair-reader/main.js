const { ItemView, MarkdownRenderer, Platform, Plugin, PluginSettingTab, Setting, setIcon } = require("obsidian");

const VIEW_TYPE = "firstpair-reader";
const READER_INDEX = "_data/reader.json";
const PARALLEL_INDEX = "_data/parallel-reader.json";
const TARGET_INDEX = "_data/targets.json";
const DICTIONARY_INDEX_SCHEMA = "firstpair-reader-dictionary-index-v1";
// Layouts for aligned editions. "auto" follows the device: stacked when the
// reader is narrow or a phone is held upright, columns otherwise.
const LAYOUTS = [
  { id: "auto", label: "Auto", short: "Auto", icons: ["smartphone"] },
  { id: "columns", label: "Columns", short: "Cols", icons: ["columns-2", "columns"] },
  { id: "stacked", label: "Stacked", short: "Stack", icons: ["rows-3", "rows"] },
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
// drawerPosition: in stacked layout the dictionary is a side panel or a band
// at the bottom; a kept-open bottom band shortens the text so it flows above.
// drawerHeight: the bottom band's share of the pane, a third by default, set
// by dragging the band's top edge or in the settings.
// resume: the Reader reopens exactly where it was — page, scroll position,
// languages, translations and extra columns, the open dictionary word —
// remembered per edition in settings.state.
const DEFAULT_SETTINGS = { layout: "auto", reserveDrawerColumn: true, keepDrawerOpen: false, dictionaryLanguages: "shown", drawerPosition: "side", drawerHeight: 0.33, resume: true, state: {} };

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
    this.wordPosition = -1;
    // columns: the translations on screen, in order — one per language by
    // default, a second column of a language when the reader asks for it.
    this.columns = [];
  }
  // An edition lists translations; each has a lang. Older editions have one
  // translation per language and no lang field, so the id serves as lang.
  translationsOf(lang) { return this.parallel.translations.filter((item) => (item.lang ?? item.id) === lang); }
  languages() {
    if (this.parallel.languages) return this.parallel.languages;
    const seen = new Map();
    for (const item of this.parallel.translations) { const lang = item.lang ?? item.id; if (!seen.has(lang)) seen.set(lang, { id: lang, label: item.label }); }
    return [...seen.values()];
  }
  translation(id) { return this.parallel.translations.find((item) => item.id === id); }
  languageShort(language) {
    return language.short ?? ({ en: "Eng", ru: "Рус" }[language.id] ?? language.label);
  }
  translationName(item) {
    const name = item.title ?? item.translator ?? item.label ?? item.id;
    return name.replace(/\s*\([^()]*\)\s*$/u, "").trim();
  }
  currentPart() { return this.pages[this.position]?.part; }
  covers(item, part) { return !item.coverage || !part || item.coverage.includes(part); }
  // The translation to show for a language: the remembered choice if it covers
  // this page, else the language's default, else the first that covers.
  choiceFor(lang, exclude = null) {
    const part = this.currentPart(); const candidates = this.translationsOf(lang).filter((item) => item.id !== exclude);
    const remembered = this.plugin.settings.choices?.[this.parallel.title]?.[lang];
    const pick = candidates.find((item) => item.id === remembered && this.covers(item, part))
      ?? candidates.find((item) => item.default && this.covers(item, part))
      ?? candidates.find((item) => this.covers(item, part)) ?? candidates[0];
    return pick?.id ?? null;
  }
  async remember(lang, id) {
    const choices = { ...(this.plugin.settings.choices ?? {}) };
    choices[this.parallel.title] = { ...(choices[this.parallel.title] ?? {}), [lang]: id };
    await this.plugin.saveSettings({ choices });
  }
  // Rotate a column to the next translation of its language (skipping the
  // other column of that language, if any) and remember the choice.
  async rotate(index) {
    const column = this.columns[index]; const others = this.columns.filter((c, i) => i !== index && c.lang === column.lang).map((c) => c.id);
    const part = this.currentPart();
    const list = this.translationsOf(column.lang).filter((item) => !others.includes(item.id) && this.covers(item, part));
    if (list.length < 2) return;
    const at = list.findIndex((item) => item.id === column.id);
    column.id = list[(at + 1) % list.length].id;
    if (index === this.columns.findIndex((c) => c.lang === column.lang)) await this.remember(column.lang, column.id);
    await this.renderPage(false);
  }
  async addColumn(lang) {
    const first = this.columns.find((c) => c.lang === lang); if (!first) return;
    const id = this.choiceFor(lang, first.id); if (!id || id === first.id) return;
    const at = this.columns.lastIndexOf(first); this.columns.splice(at + 1, 0, { lang, id, extra: true });
    await this.renderPage(false);
  }
  async removeColumn(index) { this.columns.splice(index, 1); await this.renderPage(false); }
  syncColumns() {
    // Enabled languages each keep at least one column; disabled ones lose theirs.
    const kept = this.columns.filter((c) => this.enabled.has(c.lang));
    for (const lang of this.languages().map((l) => l.id)) {
      if (this.enabled.has(lang) && !kept.some((c) => c.lang === lang)) kept.push({ lang, id: this.choiceFor(lang) });
    }
    const part = this.currentPart();
    // Primary columns first (the remembered or default translation that covers
    // this page), then extras, which must differ from their primary.
    for (const column of kept.filter((c) => !c.extra)) { const item = this.translation(column.id); if (!item || !this.covers(item, part)) column.id = this.choiceFor(column.lang) ?? column.id; }
    for (const column of kept.filter((c) => c.extra)) {
      const primary = kept.find((c) => !c.extra && c.lang === column.lang); const item = this.translation(column.id);
      if (!item || !this.covers(item, part) || column.id === primary?.id) column.id = this.choiceFor(column.lang, primary?.id ?? null) ?? column.id;
    }
    const order = this.languages().map((l) => l.id);
    kept.sort((a, b) => order.indexOf(a.lang) - order.indexOf(b.lang) || (a.extra ? 1 : 0) - (b.extra ? 1 : 0));
    this.columns = kept;
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
    // The frame is the drawer's containing block: the scrolling root and the
    // drawer are siblings in it, so the drawer stays put while the text
    // scrolls, and its position is measured against the frame — never the
    // window, whose coordinates Obsidian's contained leaves do not share.
    this.containerEl.empty(); this.frame = this.containerEl.createDiv({ cls: "firstpair-reader__frame" });
    this.root = this.frame.createDiv({ cls: "firstpair-reader" });
    this.toolbar = this.root.createDiv({ cls: "firstpair-reader__toolbar" });
    this.page = this.root.createDiv({ cls: "firstpair-reader__page" });
    this.drawer = this.frame.createDiv({ cls: "firstpair-reader__drawer", attr: { hidden: "" } });
    this.rail = this.root.createDiv({ cls: "firstpair-reader__rail" });
    // Escape, or a tap on the text away from a word, closes the drawer.
    this.registerDomEvent?.(this.frame, "keydown", (event) => { if (event.key === "Escape") this.closeDrawer(); });
    this.frame.addEventListener("click", (event) => {
      if (this.drawer.hasAttribute("hidden") || this.drawer.contains(event.target)) return;
      if (event.target.closest?.(".firstpair-reader__word, .firstpair-reader__toolbar, .firstpair-reader__rail")) return;
      this.closeDrawer();
    });
    try {
      await this.loadIndex(); this.restoreState(); this.makeToolbar(); this.makeRail(); this.watchLayout(); await this.renderPage();
      const saved = this.savedState();
      if (saved?.scrollTop) this.root.scrollTop = saved.scrollTop;
      if (saved?.word) {
        const button = this.wordButtons().find((candidate) => candidate.textContent === saved.word);
        if (button) await this.selectWord(button); else await this.openDictionary(saved.word);
      }
      this.root.addEventListener("scroll", () => this.saveStateSoon(), { passive: true });
    }
    catch (error) { this.showError(error); }
  }
  // --- Resume ---------------------------------------------------------------
  stateKey() { return this.parallel?.title ?? "reader"; }
  savedState() { return this.plugin.settings.resume ? this.plugin.settings.state?.[this.stateKey()] : null; }
  restoreState() {
    const saved = this.savedState(); if (!saved) return;
    const position = this.pages.findIndex((page) => page.id === saved.pageId);
    if (position >= 0) this.position = position;
    if (this.parallel) {
      if (Array.isArray(saved.enabled)) { this.enabled = new Set(saved.enabled.filter((lang) => this.languages().some((l) => l.id === lang))); }
      if (Array.isArray(saved.columns)) this.columns = saved.columns.filter((c) => this.translation(c.id)).map((c) => ({ lang: c.lang, id: c.id, extra: Boolean(c.extra) }));
    }
  }
  currentState() {
    return { pageId: this.pages[this.position]?.id, scrollTop: Math.round(this.root?.scrollTop ?? 0), enabled: [...this.enabled],
             columns: this.columns.map((c) => ({ lang: c.lang, id: c.id, extra: Boolean(c.extra) })), word: this.drawer && !this.drawer.hasAttribute("hidden") ? this.lastWord ?? null : null };
  }
  saveStateSoon() {
    if (!this.plugin.settings.resume || !this.pages.length) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveState(), 400);
  }
  async saveState() {
    if (!this.plugin.settings.resume || !this.pages.length) return;
    const state = { ...(this.plugin.settings.state ?? {}), [this.stateKey()]: this.currentState() };
    await this.plugin.saveSettings({ state });
  }
  // A vault still syncing, or a half-written index, must never leave a blank view.
  showError(error) {
    console.error("FirstPair Reader", error);
    this.page.empty(); const box = this.page.createDiv({ cls: "firstpair-reader__error" });
    box.createEl("p", { text: `The Reader could not open this vault: ${error?.message ?? error}` });
    box.createEl("p", { text: "If the vault is still syncing, wait for it to finish, then try again." });
    const retry = box.createEl("button", { text: "Retry" }); retry.addEventListener("click", () => this.onOpen());
  }
  async onClose() { clearTimeout(this.saveTimer); await this.saveState(); this.resizeObserver?.disconnect(); this.orientation?.removeEventListener("change", this.applyLayout); }
  // Obsidian keeps the leaf's state across restarts too; the page id rides on it.
  getState() { return { pageId: this.pages[this.position]?.id ?? null }; }
  async setState(state, result) {
    if (state?.pageId && this.pages.length) { const position = this.pages.findIndex((page) => page.id === state.pageId); if (position >= 0 && position !== this.position) { this.position = position; await this.renderPage(); } }
    return super.setState?.(state, result);
  }
  async loadIndex() {
    this.parallel = await this.readJson(PARALLEL_INDEX, true);
    const value = this.parallel?.pages ?? await this.readJson(READER_INDEX);
    if (!Array.isArray(value) || !value.length) throw new Error("Reader index is empty");
    this.pages = value;
    if (this.parallel) {
      for (const language of this.languages()) {
        const items = this.translationsOf(language.id);
        if (items.some((item) => item.defaultVisible !== false)) this.enabled.add(language.id);
      }
    }
  }
  makeToolbar() {
    if (!this.parallel) { this.toolbar.hidden = true; return; }
    this.languageControls = this.toolbar.createDiv({ cls: "firstpair-reader__languages" });
    this.updateToolbar();
    this.layoutButton = this.toolbar.createEl("button", { cls: "firstpair-reader__layout-toggle" });
    this.layoutButton.addEventListener("click", async () => {
      const index = LAYOUTS.findIndex((item) => item.id === this.plugin.settings.layout);
      await this.plugin.saveSettings({ layout: LAYOUTS[(index + 1) % LAYOUTS.length].id });
      this.applyLayout();
    });
    this.showLayoutChoice();
  }
  // One group per language: its checkbox, and — when it has several
  // translations — a picker for the one on screen and + for a second column
  // (then a second picker and −). Pickers work where column headers are
  // hidden: phones, and the stacked layout.
  updateToolbar() {
    if (!this.languageControls) return;
    this.languageControls.empty();
    const part = this.currentPart();
    for (const language of this.languages()) {
      const group = this.languageControls.createDiv({ cls: "firstpair-reader__language" });
      const label = group.createEl("label", { cls: "firstpair-reader__language-toggle", attr: { title: language.label } });
      const input = label.createEl("input", { type: "checkbox", attr: { "aria-label": language.label } }); input.checked = this.enabled.has(language.id);
      input.addEventListener("change", async () => {
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
        const select = group.createEl("select", { cls: "firstpair-reader__picker", attr: { "aria-label": `${language.label} translation: ${selectedTitle}`, title: selectedTitle } });
        for (const item of available.filter((item) => !others.includes(item.id))) {
          const fullTitle = item.title ?? item.translator ?? item.label ?? item.id;
          const option = select.createEl("option", { text: this.translationName(item), attr: { title: fullTitle, "aria-label": fullTitle } }); option.value = item.id;
          if (item.id === column.id) option.selected = true;
        }
        select.addEventListener("change", async () => {
          this.columns[column.index].id = select.value;
          if (!column.extra) await this.remember(language.id, select.value);
          await this.renderPage(false);
        });
        if (column.extra) {
          const remove = group.createEl("button", { cls: "firstpair-reader__column-control", text: "−", attr: { "aria-label": "Remove the second column", title: "Remove the second column" } });
          remove.addEventListener("click", () => this.removeColumn(column.index));
        }
      }
      if (columns.length === 1 && available.length > 1) {
        const add = group.createEl("button", { cls: "firstpair-reader__column-control", text: "+", attr: { "aria-label": "Show a second translation beside this one", title: "Second translation" } });
        add.addEventListener("click", () => this.addColumn(language.id));
      }
    }
  }
  showLayoutChoice() {
    const choice = LAYOUTS.find((item) => item.id === this.plugin.settings.layout) ?? LAYOUTS[0];
    this.layoutButton.empty(); setAnyIcon(this.layoutButton, choice.icons);
    this.layoutButton.createSpan({ text: choice.label, cls: "firstpair-reader__button-label" });
    this.layoutButton.createSpan({ text: choice.short, cls: "firstpair-reader__button-short" });
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
      this.root.style.setProperty("--firstpair-toolbar-height", `${this.toolbar.hidden ? 0 : this.toolbar.offsetHeight}px`);
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
    for (const property of ["left", "width", "top", "bottom", "height"]) style.removeProperty(property);
    this.root.style.removeProperty("height"); this.drawer.removeClass("firstpair-reader__drawer--bottom");
    const pane = this.frame.getBoundingClientRect();
    if (!pane.width) return;
    const strip = this.page.hasClass("firstpair-reader__page--columns") ? this.page.querySelector(".firstpair-reader__strip") : null;
    if (!strip && this.plugin.settings.drawerPosition === "bottom") {
      // A band across the bottom; kept open, the text is shortened to flow above it.
      const height = Math.round(pane.height * Math.min(0.85, Math.max(0.15, this.plugin.settings.drawerHeight)));
      this.drawer.addClass("firstpair-reader__drawer--bottom"); this.ensureGrip();
      style.left = "0px"; style.width = `${Math.round(pane.width)}px`; style.top = "auto"; style.bottom = "0px"; style.height = `${height}px`;
      if (this.plugin.settings.keepDrawerOpen) this.root.style.height = `calc(100% - ${height}px)`;
      return;
    }
    // Between the toolbar and the rail, so their buttons stay reachable.
    style.top = `${this.toolbar.hidden ? 0 : this.toolbar.offsetHeight}px`; style.bottom = `${this.rail.offsetHeight}px`;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    if (!strip) {
      // Stacked: a generous panel — two fifths of the pane, never under 30rem, never over nine tenths.
      const width = Math.min(pane.width * 0.9, Math.max(30 * rem, pane.width * 0.4));
      style.left = `${Math.round(pane.width - width)}px`; style.width = `${Math.round(width)}px`; return;
    }
    const grid = strip.getBoundingClientRect();
    const tracks = Number(strip.style.getPropertyValue("--firstpair-columns")) || strip.children.length || 1;
    const gap = parseFloat(getComputedStyle(strip).columnGap) || 0;
    const track = (grid.width - gap * (tracks - 1)) / tracks;
    const cells = strip.querySelectorAll(".firstpair-reader__cell");
    // The drawer's own column: the empty track, or the last visible one — as
    // an offset from the frame's left edge.
    const index = this.reservedTrack ? cells.length : Math.max(0, cells.length - 1);
    const left = Math.max(0, grid.left - pane.left + index * (track + gap) - gap / 2);
    const width = Math.min(pane.width, Math.max(15 * rem, pane.width - left));
    style.left = `${Math.round(pane.width - width)}px`; style.width = `${Math.round(width)}px`;
  }
  makeButton(label, icon, action) {
    const button = this.rail.createEl("button", { attr: { "aria-label": label, title: label } });
    setIcon(button, icon); button.createSpan({ text: label, cls: "firstpair-reader__button-label" });
    button.addEventListener("click", action); return button;
  }
  makeRail() {
    this.previous = this.makeButton("Previous", "chevron-left", () => this.jump(this.position - 1));
    this.previousWord = this.makeButton("Previous word", "chevrons-left", () => this.stepWord(-1));
    this.up = this.makeButton("Up", "corner-left-up", () => this.openHome());
    this.back = this.makeButton("Back", "rotate-ccw", () => this.restore());
    this.top = this.makeButton("Top", "arrow-up-to-line", () => this.toTop());
    this.toc = this.makeButton("TOC", "list", () => this.openHome());
    this.nextWord = this.makeButton("Next word", "chevrons-right", () => this.stepWord(1));
    this.next = this.makeButton("Next", "chevron-right", () => this.jump(this.position + 1));
  }
  snapshot() { return { position: this.position, scrollTop: this.root.scrollTop }; }
  async jump(position) { if (position < 0 || position >= this.pages.length || position === this.position) return; this.history.push(this.snapshot()); this.position = position; await this.renderPage(); }
  async openPage(pageId) { const position = this.pages.findIndex((page) => page.id === pageId); if (position >= 0) await this.jump(position); }
  async restore() { const state = this.history.pop(); if (!state) return; this.position = state.position; await this.renderPage(); this.root.scrollTop = state.scrollTop; }
  toTop() { this.history.push(this.snapshot()); this.root.scrollTop = 0; }
  async openHome() { const home = this.app.vault.getAbstractFileByPath("Home.md"); if (home) await this.app.workspace.getLeaf(false).openFile(home); }

  wordButtons() { return Array.from(this.page.querySelectorAll(".firstpair-reader__word")); }
  updateWordNavigation() {
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
    const words = this.wordButtons(); const position = words.indexOf(button);
    if (position < 0) return;
    this.wordPosition = position; this.updateWordNavigation();
    if (scroll) button.scrollIntoView?.({ block: "center", behavior: "smooth" });
    await this.openDictionary(button.textContent);
  }
  async stepWord(direction) {
    const words = this.wordButtons(); if (!words.length) return;
    const position = this.wordPosition < 0 ? (direction > 0 ? 0 : -1) : this.wordPosition + direction;
    if (position < 0 || position >= words.length) return;
    await this.selectWord(words[position], true);
  }

  appendText(container, lines, clickable = false) {
    for (const line of Array.isArray(lines) ? lines : [lines]) {
      const row = container.createDiv({ cls: "firstpair-reader__verse" });
      if (!clickable) { row.setText(line); continue; }
      for (const token of line.split(/([\p{L}\p{M}]+[’']?)/u)) {
        if (/^[\p{L}\p{M}]/u.test(token)) {
          const word = row.createEl("button", { text: token, cls: "firstpair-reader__word" });
          word.addEventListener("click", () => this.selectWord(word));
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
    this.syncColumns();
    const source = { source: true, label: this.parallel.sourceLanguage.label, lang: this.parallel.sourceLanguage.lang ?? this.parallel.sourceLanguage.id };
    const shown = this.columns.map((column, index) => ({ ...column, index, item: this.translation(column.id) }));
    const sourceLast = this.parallel.sourceLanguage.position === "right";
    const cells = sourceLast ? [...shown, source] : [source, ...shown];
    // Reserved tracks: one per language plus the source, so a switched-off
    // language leaves its track empty for the dictionary.
    const tracks = Math.max(cells.length, this.plugin.settings.reserveDrawerColumn ? 1 + this.languages().length : 0);
    this.reservedTrack = tracks > cells.length;
    const labels = this.page.createDiv({ cls: "firstpair-reader__column-labels" });
    labels.style.setProperty("--firstpair-columns", String(tracks));
    for (const cell of cells) this.columnHeader(labels, cell);
    for (const unit of chapter.units) {
      const strip = this.page.createDiv({ cls: "firstpair-reader__strip", attr: { "data-unit-id": unit.id, "data-translations": String(shown.length) } });
      strip.style.setProperty("--firstpair-columns", String(tracks));
      for (const cell of cells) {
        const isSource = Boolean(cell.source);
        const element = strip.createDiv({ cls: `firstpair-reader__cell firstpair-reader__cell--${isSource ? "source" : "translation"}`, attr: { lang: cell.lang, "data-label": isSource ? cell.label : this.columnTitle(cell) } });
        this.appendText(element, isSource ? unit.source : (unit.translations?.[cell.id] ?? []), isSource);
      }
    }
    this.updateToolbar();
    this.applyLayout();
  }
  // Which dictionaries answer, and in what order: the translations on screen
  // first (in the edition's order), then — only when the setting says all —
  // the ones switched off.
  dictionaryLanguages() {
    const languages = this.languages();
    const shown = languages.filter((language) => this.enabled.has(language.id));
    if (this.plugin.settings.dictionaryLanguages !== "all") return shown;
    return [...shown, ...languages.filter((language) => !this.enabled.has(language.id))];
  }
  // The grip along the band's top edge: drag it to resize; the share is remembered.
  ensureGrip() {
    if (this.grip && this.grip.parentElement === this.drawer && this.drawer.firstElementChild === this.grip) return;
    this.grip?.remove(); this.grip = this.drawer.ownerDocument.createElement("div"); this.grip.className = "firstpair-reader__drawer-grip";
    this.grip.setAttribute("role", "separator"); this.grip.setAttribute("aria-label", "Drag to resize the dictionary");
    this.drawer.prepend(this.grip);
    this.grip.addEventListener("pointerdown", (event) => {
      event.preventDefault(); this.grip.setPointerCapture?.(event.pointerId);
      const pane = this.frame.getBoundingClientRect();
      const move = (moveEvent) => {
        const share = Math.min(0.85, Math.max(0.15, (pane.bottom - moveEvent.clientY) / pane.height));
        this.plugin.settings.drawerHeight = share; this.sizeDrawer();
      };
      const finish = async () => { this.grip.removeEventListener("pointermove", move); this.grip.removeEventListener("pointerup", finish); this.grip.removeEventListener("pointercancel", finish); await this.plugin.saveSettings({ drawerHeight: this.plugin.settings.drawerHeight }); };
      this.grip.addEventListener("pointermove", move); this.grip.addEventListener("pointerup", finish); this.grip.addEventListener("pointercancel", finish);
    });
  }
  closeDrawer() { if (!this.plugin.settings.keepDrawerOpen) { this.drawer.setAttribute("hidden", ""); this.root.style.removeProperty("height"); this.saveStateSoon(); } }
  showDrawer() {
    this.drawer.removeAttribute("hidden"); this.sizeDrawer();
    if (this.drawer.childElementCount <= (this.grip ? 1 : 0)) {
      const head = this.drawer.createDiv({ cls: "firstpair-reader__drawer-head" }); head.createEl("strong", { text: "Dictionary" });
      this.drawer.createEl("p", { text: "Select a word of the source text.", cls: "firstpair-reader__drawer-hint" });
    }
  }
  columnTitle(cell) {
    const item = cell.item ?? this.translation(cell.id); if (!item) return cell.label ?? cell.id;
    const name = item.title ?? item.translator ?? item.label;
    const approximate = item.alignment && item.alignment !== "line" ? " ≈" : "";
    return `${item.label && name !== item.label ? item.label + " · " : ""}${name}${approximate}`;
  }
  // A column header: the language, the translation's name (rotating through
  // the language's translations on click), "+" for a second column of the
  // language, "−" on that second column.
  columnHeader(labels, cell) {
    const head = labels.createDiv({ cls: "firstpair-reader__column-label" });
    if (cell.source) { head.createSpan({ text: cell.label }); return; }
    const item = cell.item; const part = this.currentPart();
    const alternatives = this.translationsOf(cell.lang).filter((other) => this.covers(other, part) && !this.columns.some((c) => c !== this.columns[cell.index] && c.lang === cell.lang && c.id === other.id));
    const name = head.createEl("button", { cls: "firstpair-reader__column-name", text: this.columnTitle(cell), attr: { title: alternatives.length > 1 ? "Next translation" : this.columnTitle(cell) } });
    if (item?.alignment && item.alignment !== "line") name.setAttribute("aria-description", "Approximate alignment");
    if (alternatives.length > 1) { name.addClass("firstpair-reader__column-name--rotates"); name.addEventListener("click", () => this.rotate(cell.index)); }
    if (cell.extra) {
      const remove = head.createEl("button", { cls: "firstpair-reader__column-control", text: "−", attr: { "aria-label": "Remove this column", title: "Remove this column" } });
      remove.addEventListener("click", () => this.removeColumn(cell.index));
    } else if (alternatives.length > 1 && !this.columns.some((c) => c.extra && c.lang === cell.lang)) {
      const add = head.createEl("button", { cls: "firstpair-reader__column-control", text: "+", attr: { "aria-label": "Show a second translation beside this one", title: "Second translation" } });
      add.addEventListener("click", () => this.addColumn(cell.lang));
    }
  }
  mergeEntries(entries) {
    const groups = new Map();
    for (const entry of entries) {
      const key = [entry.headword ?? "", entry.partOfSpeech ?? "", entry.grammar ?? ""].join("\u0000");
      const group = groups.get(key) ?? { headword: entry.headword, partOfSpeech: entry.partOfSpeech, grammar: entry.grammar, definitions: [], examples: [] };
      for (const definition of entry.definitions ?? []) {
        const plain = definition.trim();
        if (plain && !group.definitions.some((known) => known === plain || known.startsWith(plain) || plain.startsWith(known))) group.definitions.push(plain);
      }
      for (const example of entry.examples ?? []) if (!group.examples.includes(example)) group.examples.push(example);
      groups.set(key, group);
    }
    return [...groups.values()].map((group) => ({ ...group, examples: group.examples.slice(0, 2) }));
  }
  async openDictionary(surface) {
    const word = normalizeWord(surface); this.lastWord = surface; this.drawer.empty(); this.grip = null; this.drawer.removeAttribute("hidden"); this.sizeDrawer();
    const head = this.drawer.createDiv({ cls: "firstpair-reader__drawer-head" }); head.createEl("strong", { text: surface });
    if (!this.plugin.settings.keepDrawerOpen) {
      const close = head.createEl("button", { text: "Close", cls: "firstpair-reader__drawer-close", attr: { "aria-label": "Close dictionary" } });
      close.addEventListener("click", (event) => { event.stopPropagation(); this.closeDrawer(); });
    }
    let found = false;
    for (const language of this.dictionaryLanguages()) {
      const dictionary = this.parallel.dictionaries?.[language.id]; if (!dictionary) continue;
      const section = this.drawer.createDiv({ cls: "firstpair-reader__definition", attr: { lang: language.id, role: "group", "aria-label": `${language.label} dictionary` } });
      let entries;
      try { entries = await this.plugin.lookup(dictionary.path, word); }
      catch (error) { section.createEl("p", { text: `This dictionary is not in the vault yet (${error.message}). If the vault is synced, wait for the sync to finish.`, cls: "firstpair-reader__warning" }); continue; }
      if (!entries.length) { section.createEl("p", { text: "No exact headword entry.", cls: "firstpair-reader__none" }); continue; }
      found = true;
      // Entries from several sources repeat one another: merge by headword,
      // part of speech, and grammar, drop repeated senses, show the first
      // merged entry and fold the rest behind "N more".
      const merged = this.mergeEntries(entries);
      const [first, ...rest] = merged; const SENSES = 3;
      const renderEntry = (entry, container, senses = entry.definitions) => {
        const head = container.createDiv({ cls: "firstpair-reader__entry-head" });
        head.createSpan({ text: [entry.headword, entry.partOfSpeech].filter(Boolean).join(" · "), cls: "firstpair-reader__headword" });
        if (entry.grammar) head.createSpan({ text: ` ${entry.grammar}`, cls: "firstpair-reader__grammar" });
        container.createEl("p", { text: senses.join("; "), cls: "firstpair-reader__senses" });
        for (const example of entry.examples ?? []) container.createEl("blockquote", { text: typeof example === "string" ? example : [example.latin ?? example.source, example.translation].filter(Boolean).join(" — ") });
      };
      // The top entry, its first senses only; the remaining senses and the
      // other entries wait behind the disclosure.
      renderEntry({ ...first, examples: first.examples.slice(0, 1) }, section, first.definitions.slice(0, SENSES));
      const extraSenses = first.definitions.slice(SENSES);
      const count = rest.length + (extraSenses.length ? 1 : 0);
      if (count) {
        const more = section.createEl("button", { cls: "firstpair-reader__more", text: `${count} more`, attr: { "aria-expanded": "false" } });
        const hidden = section.createDiv({ cls: "firstpair-reader__more-entries", attr: { hidden: "" } });
        if (extraSenses.length) hidden.createEl("p", { text: `also: ${extraSenses.join("; ")}`, cls: "firstpair-reader__senses" });
        for (const entry of rest) renderEntry(entry, hidden);
        more.addEventListener("click", () => {
          const open = hidden.hasAttribute("hidden");
          if (open) hidden.removeAttribute("hidden"); else hidden.setAttribute("hidden", "");
          more.setText(open ? "less" : `${count} more`); more.setAttribute("aria-expanded", String(open));
        });
      }
    }
    if (!found) this.drawer.createEl("p", { text: "Try the headword form; this offline edition does not guess every historical inflection." });
    this.saveStateSoon();
  }
  async renderPage(resetScroll = true) {
    if (resetScroll) this.wordPosition = -1;
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
    this.updateWordNavigation();
    this.previous.title = this.pages[this.position - 1]?.title ?? "Previous";
    this.next.title = this.pages[this.position + 1]?.title ?? "Next";
    this.saveStateSoon();
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
    new Setting(containerEl).setName("Dictionary position in stacked layout")
      .setDesc("Side: a panel on the right. Bottom: a band across the bottom of the screen; with the dictionary kept open, the text flows above it.")
      .addDropdown((dropdown) => dropdown.addOption("side", "Side").addOption("bottom", "Bottom").setValue(this.plugin.settings.drawerPosition)
        .onChange(async (value) => { await this.plugin.saveSettings({ drawerPosition: value }); this.plugin.refreshViews(); }));
    new Setting(containerEl).setName("Bottom band height")
      .setDesc("The share of the screen the bottom dictionary takes, as a percentage; dragging the band's top edge changes it too.")
      .addSlider((slider) => slider.setLimits(15, 85, 5).setValue(Math.round(this.plugin.settings.drawerHeight * 100)).setDynamicTooltip()
        .onChange(async (value) => { await this.plugin.saveSettings({ drawerHeight: value / 100 }); this.plugin.refreshViews(); }));
    new Setting(containerEl).setName("Resume where you left off")
      .setDesc("Reopen the Reader on the same page and scroll position, with the same languages, translations, and dictionary entry. Off: the Reader opens at the first page.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.resume)
        .onChange(async (value) => { await this.plugin.saveSettings({ resume: value, ...(value ? {} : { state: {} }) }); }));
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
