// A minimal stand-in for the `obsidian` module, enough to open the FirstPair
// Reader in jsdom: the DOM helpers Obsidian adds to elements, ItemView,
// Plugin, MarkdownRenderer, Platform, and setIcon.
const { JSDOM } = require("jsdom");

function installDomHelpers(window) {
  const proto = window.Element.prototype;
  proto.createEl = function (tag, options = {}) {
    const element = this.ownerDocument.createElement(tag);
    if (typeof options === "string") options = { cls: options };
    if (options.cls) element.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
    if (options.text != null) element.textContent = String(options.text);
    if (options.type) element.setAttribute("type", options.type);
    for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, String(value));
    this.appendChild(element);
    return element;
  };
  proto.createDiv = function (options) { return this.createEl("div", options); };
  proto.createSpan = function (options) { return this.createEl("span", options); };
  proto.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
  proto.setText = function (text) { this.textContent = text; };
  proto.appendText = function (text) { this.appendChild(this.ownerDocument.createTextNode(text)); };
  proto.addClass = function (...classes) { this.classList.add(...classes); };
  proto.removeClass = function (...classes) { this.classList.remove(...classes); };
  proto.toggleClass = function (classes, value) { for (const cls of [].concat(classes)) this.classList.toggle(cls, value); };
  proto.hasClass = function (cls) { return this.classList.contains(cls); };
}

function makeWindow() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  installDomHelpers(dom.window);
  dom.window.matchMedia = (query) => ({ matches: dom.window.__portrait ?? false, media: query, addEventListener() {}, removeEventListener() {} });
  dom.window.ResizeObserver = class { observe() {} disconnect() {} };
  return dom.window;
}

class ItemView {
  constructor(leaf) { this.leaf = leaf; this.app = leaf.app; this.containerEl = leaf.containerEl; }
}
class Plugin {
  constructor(app) { this.app = app; this.views = {}; this.commands = []; this.postProcessors = []; this.protocolHandlers = {}; this.data = null; }
  registerView(type, factory) { this.views[type] = factory; }
  addSettingTab(tab) { this.settingTab = tab; }
  addRibbonIcon() {}
  addCommand(command) { this.commands.push(command); }
  registerMarkdownPostProcessor(fn) { this.postProcessors.push(fn); }
  registerObsidianProtocolHandler(name, fn) { this.protocolHandlers[name] = fn; }
  async loadData() { return this.data; }
  async saveData(value) { this.data = value; }
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = app.settingsContainer; } }
class Setting {
  constructor(container) { this.container = container; this.el = container.createDiv({ cls: "setting-item" }); }
  setName(name) { this.el.createDiv({ text: name, cls: "setting-item-name" }); return this; }
  setDesc(text) { this.el.createDiv({ text, cls: "setting-item-description" }); return this; }
  addDropdown(fn) { const select = this.el.createEl("select"); const api = { addOption(value, label) { const option = select.createEl("option", { text: label }); option.value = value; return api; }, setValue(value) { select.value = value; return api; }, onChange(handler) { select.addEventListener("change", () => handler(select.value)); return api; } }; fn(api); return this; }
  addSlider(fn) { const input = this.el.createEl("input", { type: "range" }); const api = { setLimits(min, max, step) { input.min = min; input.max = max; input.step = step; return api; }, setValue(value) { input.value = value; return api; }, setDynamicTooltip() { return api; }, onChange(handler) { input.addEventListener("change", () => handler(Number(input.value))); return api; } }; fn(api); return this; }
  addToggle(fn) { const input = this.el.createEl("input", { type: "checkbox" }); const api = { setValue(value) { input.checked = value; return api; }, onChange(handler) { input.addEventListener("change", () => handler(input.checked)); return api; } }; fn(api); return this; }
}
const MarkdownRenderer = { async render(app, markdown, element) { element.textContent = markdown; } };
const Platform = { isMobile: false };
const setIcon = (element, name) => { if (!["smartphone", "columns-2", "rows-3", "chevron-left", "chevron-right", "corner-left-up", "rotate-ccw", "arrow-up-to-line", "list"].includes(name)) return; const svg = element.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("data-icon", name); element.appendChild(svg); };

module.exports = { ItemView, Plugin, PluginSettingTab, Setting, MarkdownRenderer, Platform, setIcon, makeWindow };
