const { ItemView, MarkdownRenderer, Plugin, setIcon } = require("obsidian");

const VIEW_TYPE = "firstpair-reader";
const READER_INDEX = "_data/reader.json";
const TARGET_INDEX = "_data/targets.json";

class ReaderHistory {
  constructor(limit = 64) {
    this.limit = limit;
    this.items = [];
  }

  push(value) {
    this.items.push(value);
    if (this.items.length > this.limit) this.items.shift();
  }

  pop() {
    return this.items.pop() ?? null;
  }

  clear() {
    this.items = [];
  }
}

class FirstPairReaderView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.pages = [];
    this.position = 0;
    this.history = new ReaderHistory();
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "FirstPair Reader"; }
  getIcon() { return "book-open"; }

  async onOpen() {
    this.containerEl.empty();
    this.root = this.containerEl.createDiv({ cls: "firstpair-reader" });
    this.page = this.root.createDiv({ cls: "firstpair-reader__page" });
    this.rail = this.root.createDiv({ cls: "firstpair-reader__rail" });
    await this.loadIndex();
    this.makeRail();
    await this.renderPage();
  }

  async loadIndex() {
    const file = this.app.vault.getAbstractFileByPath(READER_INDEX);
    if (!file) throw new Error(`Missing ${READER_INDEX}`);
    const value = JSON.parse(await this.app.vault.read(file));
    if (!Array.isArray(value) || value.length === 0) throw new Error("Reader index is empty");
    this.pages = value;
  }

  makeButton(label, icon, action) {
    const button = this.rail.createEl("button", { attr: { "aria-label": label, title: label } });
    setIcon(button, icon);
    button.createSpan({ text: label, cls: "firstpair-reader__button-label" });
    button.addEventListener("click", action);
    return button;
  }

  makeRail() {
    this.previous = this.makeButton("Previous", "chevron-left", () => this.jump(this.position - 1));
    this.up = this.makeButton("Up", "corner-left-up", () => this.openHome());
    this.back = this.makeButton("Back", "rotate-ccw", () => this.restore());
    this.top = this.makeButton("Top", "arrow-up-to-line", () => this.toTop());
    this.toc = this.makeButton("TOC", "list", () => this.openHome());
    this.next = this.makeButton("Next", "chevron-right", () => this.jump(this.position + 1));
  }

  snapshot() {
    return { position: this.position, scrollTop: this.root.scrollTop };
  }

  async jump(position) {
    if (position < 0 || position >= this.pages.length || position === this.position) return;
    this.history.push(this.snapshot());
    this.position = position;
    await this.renderPage();
  }

  async restore() {
    const state = this.history.pop();
    if (!state) return;
    this.position = state.position;
    await this.renderPage();
    this.root.scrollTop = state.scrollTop;
  }

  toTop() {
    this.history.push(this.snapshot());
    this.root.scrollTop = 0;
  }

  async openHome() {
    const home = this.app.vault.getAbstractFileByPath("Home.md");
    if (home) await this.app.workspace.getLeaf(false).openFile(home);
  }

  async renderPage() {
    const entry = this.pages[this.position];
    const file = this.app.vault.getAbstractFileByPath(entry.path);
    if (!file) throw new Error(`Missing Reader page: ${entry.path}`);
    this.page.empty();
    await MarkdownRenderer.render(this.app, await this.app.vault.read(file), this.page, entry.path, this.plugin);
    this.root.scrollTop = 0;
    this.previous.disabled = this.position === 0;
    this.next.disabled = this.position === this.pages.length - 1;
    this.back.disabled = this.history.items.length === 0;
    this.previous.title = this.pages[this.position - 1]?.title ?? "Previous";
    this.next.title = this.pages[this.position + 1]?.title ?? "Next";
  }
}

module.exports = class FirstPairReaderPlugin extends Plugin {
  async onload() {
    this.targets = null;
    this.registerView(VIEW_TYPE, (leaf) => new FirstPairReaderView(leaf, this));
    this.addRibbonIcon("book-open", "Open the FirstPair Reader", () => this.activate());
    this.addCommand({ id: "open-reader", name: "Open Reader", callback: () => this.activate() });
    this.registerMarkdownPostProcessor((element) => this.bindEvidenceTargets(element));
  }

  async loadTargets() {
    if (this.targets) return this.targets;
    const file = this.app.vault.getAbstractFileByPath(TARGET_INDEX);
    if (!file) return new Map();
    const rows = JSON.parse(await this.app.vault.read(file));
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
        if (file) await this.app.workspace.getLeaf(false).openFile(file);
      });
    }
  }

  async activate() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }
};
