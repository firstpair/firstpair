// The element helpers Obsidian adds to the DOM, for the shared modules that
// build their own controls (the span editor's word picker).

export function installDomShim() {
  const proto = Node.prototype
  if (proto.createEl) return
  const make = (parent, tag, options = {}) => {
    const element = document.createElement(tag)
    if (typeof options === 'string') options = { cls: options }
    if (options.cls) element.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls
    if (options.text != null) element.textContent = options.text
    if (options.attr) for (const [key, value] of Object.entries(options.attr)) element.setAttribute(key, value)
    if (options.type) element.type = options.type
    if (options.value != null) element.value = options.value
    parent.appendChild(element)
    return element
  }
  proto.createEl = function createEl(tag, options) { return make(this, tag, options) }
  proto.createDiv = function createDiv(options) { return make(this, 'div', options) }
  proto.createSpan = function createSpan(options) { return make(this, 'span', options) }
  const el = HTMLElement.prototype
  el.addClass = function addClass(...names) { this.classList.add(...names.filter(Boolean)) }
  el.removeClass = function removeClass(...names) { this.classList.remove(...names) }
  el.toggleClass = function toggleClass(name, on) { this.classList.toggle(name, on) }
  el.hasClass = function hasClass(name) { return this.classList.contains(name) }
  el.empty = function empty() { this.replaceChildren() }
  el.setText = function setText(text) { this.textContent = text }
}
