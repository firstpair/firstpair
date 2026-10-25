// FirstPair Reader 2 on plain books, libraries, code books, Cicero-style
// source tables, phone tabs, and the optional span notes — with Markdown
// rendered by `marked` (wikilinks and code-block processors included) over a
// writable temporary vault.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import Module from 'node:module'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const mock = require('./obsidian-mock.cjs')
const { marked } = require('marked')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'obsidian') return require.resolve('./obsidian-mock.cjs')
  return originalResolve.call(this, request, ...rest)
}
let activePlugin = null
mock.Plugin.prototype.registerMarkdownCodeBlockProcessor = function (language, fn) { (this.codeProcessors ||= {})[language] = fn }
mock.Plugin.prototype.registerEvent = function () {}
mock.Component = class { load() {} unload() {} addChild(child) { return child } register() {} }
mock.Notice = class { constructor(message) { (globalThis.__notices ||= []).push(String(message)) } }
mock.normalizePath = (value) => value
const originalRender = mock.MarkdownRenderer.render
const markedRender = async (app, markdown, element) => {
  const linked = markdown
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (m, target, label) => `<a class="internal-link" data-href="${target}" href="${target}">${label}</a>`)
    .replace(/\[\[([^\]]+)\]\]/g, (m, target) => `<a class="internal-link" data-href="${target}" href="${target}">${target}</a>`)
  element.innerHTML = marked.parse(linked)
  for (const code of Array.from(element.querySelectorAll('pre > code[class^="language-"]'))) {
    const processor = activePlugin?.codeProcessors?.[code.className.replace('language-', '')]
    if (!processor) continue
    const holder = element.ownerDocument.createElement('div')
    code.parentElement.replaceWith(holder)
    await processor(code.textContent, holder)
  }
}

const pluginPath = fileURLToPath(new URL('../vault/plugin/firstpair-reader/main.js', import.meta.url))
const pluginModule = new Module(pluginPath)
pluginModule.filename = pluginPath
pluginModule.paths = Module._nodeModulePaths(fileURLToPath(new URL('.', import.meta.url)))
pluginModule._compile(readFileSync(pluginPath, 'utf8'), pluginPath + '.cjs')
const PluginClass = pluginModule.exports

const settle = async (count = 6) => { for (let i = 0; i < count; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)) }

function vaultOf(files) {
  const root = mkdtempSync(join(tmpdir(), 'firstpair-reader-books-'))
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true })
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value))
  }
  return root
}

function makeApp(root, window) {
  const exists = (path) => existsSync(join(root, path))
  const vault = {
    getAbstractFileByPath: (path) => (exists(path) ? (statSync(join(root, path)).isDirectory() ? { path, children: [] } : { path }) : null),
    read: async (file) => readFileSync(join(root, file.path), 'utf8'),
    cachedRead: async (file) => readFileSync(join(root, file.path), 'utf8'),
    getResourcePath: (file) => `app://local/${file.path}`,
    trash: async () => {},
    adapter: {
      exists: async (path) => exists(path),
      read: async (path) => readFileSync(join(root, path), 'utf8'),
      write: async (path, data) => { mkdirSync(join(root, dirname(path)), { recursive: true }); writeFileSync(join(root, path), data) },
      rename: async (from, to) => renameSync(join(root, from), join(root, to)),
      remove: async (path) => rmSync(join(root, path)),
      mkdir: async (path) => mkdirSync(join(root, path), { recursive: true }),
      list: async (path) => {
        const dir = path === '/' ? '' : path
        const names = readdirSync(join(root, dir))
        const rel = (name) => (dir ? `${dir}/${name}` : name)
        return { files: names.filter((n) => statSync(join(root, rel(n))).isFile()).map(rel), folders: names.filter((n) => statSync(join(root, rel(n))).isDirectory()).map(rel) }
      },
    },
  }
  const opened = []
  const leaves = []
  const workspace = {
    getLeavesOfType: (type) => leaves.filter((leaf) => leaf.type === type),
    getLeaf() {
      const container = window.document.body.createDiv()
      const leaf = { app, containerEl: container, async setViewState(state) { leaf.type = state.type; leaf.view = plugin.views[state.type](leaf); await leaf.view.onOpen(); if (state.state) await leaf.view.setState(state.state) }, async openFile(file) { opened.push(file.path) } }
      leaves.push(leaf)
      return leaf
    },
    revealLeaf() {},
    openLinkText: async (link) => { opened.push(link) },
  }
  const metadataCache = { getFirstLinkpathDest: (linkpath) => (exists(`${linkpath}.md`) ? { path: `${linkpath}.md` } : null) }
  const app = { vault, workspace, metadataCache, opened, settingsContainer: window.document.body.createDiv() }
  const plugin = new PluginClass(app)
  return { app, plugin }
}

async function open(files, { width = 1200, render = markedRender, settings = null } = {}) {
  const window = mock.makeWindow()
  Object.assign(globalThis, { window, document: window.document, getComputedStyle: window.getComputedStyle.bind(window), ResizeObserver: window.ResizeObserver })
  mock.MarkdownRenderer.render = render
  globalThis.__notices = []
  const root = vaultOf(files)
  const { app, plugin } = makeApp(root, window)
  if (settings) plugin.data = settings
  activePlugin = plugin
  await plugin.onload()
  await plugin.activate()
  await settle()
  const leaf = app.workspace.getLeavesOfType('firstpair-reader')[0]
  Object.defineProperty(leaf.containerEl.querySelector('.firstpair-reader'), 'clientWidth', { value: width, configurable: true })
  leaf.view.applyLayout?.()
  return { window, root, app, plugin, view: leaf.view, el: leaf.containerEl, done: () => { mock.MarkdownRenderer.render = originalRender; rmSync(root, { recursive: true, force: true }) } }
}

const rail = (el) => Object.fromEntries(Array.from(el.querySelectorAll('.firstpair-reader__rail button')).map((b) => [b.getAttribute('aria-label'), b]))

const BOOK = {
  'Book/_data/reader.json': {
    schema: 'firstpair-reader.v2', title: 'Plain Book', launcher: 'Book/Reader', contents: 'Book/Contents',
    parts: [{ id: 'A', title: 'Part A' }, { id: 'B', title: 'Part B' }],
    pages: [
      { id: 'p1', title: 'One', part: 'A', path: 'Book/Pages/one.md' },
      { id: 'p2', title: 'Two', part: 'A', path: 'Book/Pages/two.md' },
      { id: 'p3', title: 'Three', part: 'B', path: 'Book/Pages/three.md' },
    ],
  },
  'Book/Pages/one.md': '# One\n\nA claim<sup><a id="ref-1" href="#fn-1">1</a></sup> and a link to [[Book/Pages/three|the third page]].\n\n' + 'filler\n\n'.repeat(40) + '<p id="fn-1">Footnote one.</p>\n',
  'Book/Pages/two.md': '# Two\n\nSecond page.\n',
  'Book/Pages/three.md': '# Three\n\nThird page.\n',
  'Book/Reader.md': 'launcher',
}

test('a plain book: six controls, Up and TOC inside the Reader, footnotes and Back, links to pages', async () => {
  const { el, view, done } = await open(BOOK)
  try {
    assert.deepEqual(Object.keys(rail(el)), ['Previous', 'Up', 'Back', 'Forward', 'Top', 'TOC', 'Next'])
    assert.match(el.querySelector('.firstpair-reader__markdown h1').textContent, /One/)
    assert.equal(rail(el).Next.querySelector('.firstpair-reader__destination').textContent, 'Two')
    // The footnote jumps inside the Reader; Back returns to the reference.
    el.querySelector('a[href="#fn-1"]').click(); await settle()
    assert.equal(el.ownerDocument.activeElement.id, 'fn-1')
    rail(el).Back.click(); await settle()
    assert.equal(view.mode, 'page'); assert.equal(view.pages[view.position].id, 'p1')
    assert.equal(el.ownerDocument.activeElement.id, 'ref-1', 'Back refocuses the exact reference')
    // A wikilink to another Reader page opens it in the Reader.
    el.querySelector('a.internal-link').click(); await settle()
    assert.equal(view.pages[view.position].id, 'p3')
    // Up: page → part → contents; TOC marks the current page; Back returns.
    rail(el).Up.click(); await settle()
    assert.equal(view.mode, 'part'); assert.match(el.querySelector('h1').textContent, /Part B/)
    rail(el).Up.click(); await settle()
    assert.equal(view.mode, 'contents'); assert.equal(rail(el).Up.disabled, true); assert.equal(rail(el).TOC.disabled, true)
    assert.equal(el.querySelector('.firstpair-reader__toc-page.is-current').textContent, 'Three')
    rail(el).Back.click(); await settle(); rail(el).Back.click(); await settle()
    assert.equal(view.mode, 'page'); assert.equal(view.pages[view.position].id, 'p3')
    // Static fallback notes open the Reader at their place.
    assert.deepEqual(view.plugin.constructor.__test.contract.targetForNote(view.book, 'Book/Reader.md'), { mode: 'contents' })
  } finally { done() }
})

test('Cicero-style source tables: words keep their markup, one language bar, never zero', async () => {
  const files = {
    'Cicero/_data/reader.json': { schema_version: 1, title: 'Cicero', parts: [{ id: 'P1', title: 'One' }], pages: [{ id: 'C1', order: 1, title: 'Proem', part_id: 'P1', note: 'Cicero/Reader/C1', markdown: '# Proem\n\n> Quoted [[Cicero/Bilingual Sources/Letters#^p1|source]]\n' }] },
    'Cicero/_data/dictionaries/la-en.json': { schema: 'firstpair-reader-dictionary-v1', entries: { arma: [{ headword: 'arma', partOfSpeech: 'noun', grammar: 'neuter plural', definitions: ['arms'] }] } },
    'Cicero/_data/dictionaries/la-ru.json': { schema: 'firstpair-reader-dictionary-v1', entries: { arma: [{ headword: 'arma', partOfSpeech: 'noun', definitions: ['оружие'] }] } },
    'Cicero/Bilingual Sources/Letters.md': '### 1\n\n| Latin | English | Русский |\n|---|---|---|\n| *Arma* virumque [cano](https://example.org) | Arms and the man | Битвы и мужа |\n\n### 2\n\n| Latin | English | Русский |\n|---|---|---|\n| Arma iterum | Arms again | Снова |\n',
  }
  const { el, view, app, done } = await open(files)
  try {
    // The reviewed source link turns the whole blockquote into a rail.
    const rail = el.querySelector('.firstpair-reader__source-rail')
    assert.ok(rail); rail.click(); await settle()
    assert.deepEqual(app.opened.slice(-1), ['Cicero/Bilingual Sources/Letters#^p1'])
    await view.go({ mode: 'note', notePath: 'Cicero/Bilingual Sources/Letters' }); await settle()
    const cell = el.querySelector('td')
    assert.ok(cell.querySelector('em .firstpair-reader__word'), 'emphasis survives around the word button')
    assert.equal(cell.querySelector('a').getAttribute('href'), 'https://example.org', 'links survive')
    assert.equal(el.querySelectorAll('.firstpair-reader__column-toggles').length, 1, 'one bar for the whole note')
    const [english, russian] = el.querySelectorAll('.firstpair-reader__column-toggles input')
    english.checked = false; english.dispatchEvent(new globalThis.window.Event('change')); await settle()
    assert.equal(el.querySelectorAll('td.is-hidden').length, 2, 'English hidden in both passages')
    russian.checked = false; russian.dispatchEvent(new globalThis.window.Event('change')); await settle()
    assert.equal(russian.checked, true, 'the last language cannot be switched off')
    cell.querySelector('.firstpair-reader__word').click(); await settle(10)
    const drawer = el.querySelector('.firstpair-reader__drawer')
    assert.match(drawer.textContent, /neuter plural/); assert.match(drawer.textContent, /оружие/)
    const escape = new globalThis.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    el.querySelector('.firstpair-reader__frame').dispatchEvent(escape)
    assert.equal(drawer.hasAttribute('hidden'), true, 'Escape closes the drawer')
  } finally { done() }
})

test('a library: editions grouped by family, pages cut from Part notes by markers', async () => {
  const part = (id, body) => `<!-- lmr-page-start:${id} -->\n${body}\n<!-- lmr-page-end:${id} -->`
  const files = {
    'Lib/_data/mobile-library.json': { schema_version: 1, title: 'Library', editions: [
      { id: 'a', title: 'Alpha', version: '1.0', family: 'Main', data: 'Lib/_data/editions/a.json', note: 'Lib/A/Contents' },
      { id: 'b', title: 'Beta', version: '2.0', family: 'Other', data: 'Lib/_data/editions/b.json', note: 'Lib/B/Contents' }], sources: [], anthology: null },
    'Lib/_data/editions/a.json': { schema_version: 2, id: 'a', parts: [{ id: 'P001', title: 'Front', note: 'Lib/A/01' }], pages: [
      { id: 'a:C1', part_id: 'P001', title: 'First', note: 'Lib/A/01' }, { id: 'a:C2', part_id: 'P001', title: 'Second', note: 'Lib/A/01' }] },
    'Lib/_data/editions/b.json': { schema_version: 2, id: 'b', parts: [{ id: 'P001', title: 'Front', note: 'Lib/B/01' }], pages: [{ id: 'b:C1', part_id: 'P001', title: 'Only', note: 'Lib/B/01' }] },
    'Lib/A/01.md': `${part('a:C1', 'Alpha page one.')}\n\n${part('a:C2', 'Alpha page two.')}`,
    'Lib/B/01.md': part('b:C1', 'Beta page.'),
  }
  const { el, view, done } = await open(files)
  try {
    assert.equal(view.mode, 'library')
    assert.deepEqual(Array.from(el.querySelectorAll('h2')).map((h) => h.textContent), ['Main', 'Other'])
    el.querySelectorAll('.firstpair-reader__library button')[1].click(); await settle(8)
    assert.equal(view.mode, 'contents'); assert.equal(view.editionId, 'b')
    rail(el).Next.click(); await settle(8)
    assert.equal(el.querySelector('.firstpair-reader__markdown').textContent.trim(), 'Beta page.')
    rail(el).Up.click(); await settle(); rail(el).Up.click(); await settle(); rail(el).Up.click(); await settle()
    assert.equal(view.mode, 'library')
    el.querySelectorAll('.firstpair-reader__library button')[0].click(); await settle(8)
    await view.openPage('a:C2'); await settle(8)
    assert.equal(el.querySelector('.firstpair-reader__markdown').textContent.trim(), 'Alpha page two.', 'only the marked block')
  } finally { done() }
})

test('a code book: fragment cards show numbered lines from the code note', async () => {
  const files = {
    'DNS/_data/fragments.json': [{ id: 'f1', symbol: 'resolve', source_path: 'src/lib.rs', code_note: 'DNS/Code/src/lib.rs.source', start_line: 2, end_line: 3, summary: 'The resolver.' }],
    'DNS/Chapters/01-Intro.md': '# Intro\n\n```rgbdns-fragment\n{"id":"f1","codeNote":"DNS/Code/src/lib.rs.source","startLine":2,"endLine":3}\n```\n',
    'DNS/Code/src/lib.rs.source.md': '# lib.rs\n\n## Full Source\n\n```rust\nuse std;\nfn resolve() {\n  todo!()\n}\n```\n',
  }
  const { el, view, done } = await open(files)
  try {
    const card = el.querySelector('.firstpair-reader__fragment')
    assert.match(card.textContent, /resolve/); assert.match(card.textContent, /src\/lib\.rs:2-3/)
    card.querySelector('button').click(); await settle(8)
    const lines = Array.from(card.querySelectorAll('.firstpair-reader__fragment-line')).map((line) => line.textContent)
    assert.deepEqual(lines, ['2fn resolve() {', '3  todo!()'])
    // A source's own ``` blocks inside a longer ```` fence stay inside it.
    const fenced = view.plugin.constructor.__test.fencedLines('## Full Source\n\n````md\n# Doc\n```sh\nrun\n```\nafter\n````\ntrailing')
    assert.deepEqual(fenced, ['# Doc', '```sh', 'run', '```', 'after'])
  } finally { done() }
})

test('aligned columns on a phone become tabs that remember the chosen language', async () => {
  const files = {
    '_data/parallel-reader.json': { schema: 'firstpair-parallel-reader-v1', title: 'Tabs', sourceLanguage: { id: 'it', lang: 'it', label: 'Italiano' },
      translations: [{ id: 'en', lang: 'en', label: 'English', defaultVisible: true }, { id: 'ru', lang: 'ru', label: 'Русский', defaultVisible: true }],
      pages: [{ id: 'c1', title: 'Canto 1', path: '_data/chapters/c1.json' }] },
    '_data/chapters/c1.json': { schema: 'firstpair-aligned-chapter-v1', id: 'c1', title: 'Canto 1', units: [{ id: 'u1', source: ['Nel mezzo'], translations: { en: ['Midway'], ru: ['Земную'] } }] },
  }
  const { el, view, done } = await open(files, { width: 390, settings: { layout: 'columns' } })
  try {
    view.applyLayout()
    const tabs = Array.from(el.querySelectorAll('.firstpair-reader__cell-tab'))
    assert.deepEqual(tabs.map((tab) => tab.textContent), ['Italiano', 'Eng', 'Рус'])
    const visible = () => Array.from(el.querySelectorAll('.firstpair-reader__strip .firstpair-reader__cell')).filter((cell) => !cell.classList.contains('is-hidden')).map((cell) => cell.textContent)
    assert.deepEqual(visible(), ['Nel mezzo'])
    tabs[2].click(); await settle()
    assert.deepEqual(visible(), ['Земную'])
    assert.equal(view.plugin.settings.books[''].defaultColumn, 'ru:main', 'kept per book (root folder "")')
  } finally { done() }
})

test('editing is off by default; on, a selected span takes a text note in the shared ledger', async () => {
  const off = await open(BOOK)
  try {
    assert.equal(off.plugin.settings.editing, false)
    assert.equal(existsSync(join(off.root, 'Preferences')), false, 'a plain reading session writes nothing')
  } finally { off.done() }
  const { el, view, root, done } = await open(BOOK, { settings: { editing: true } })
  try {
    const win = globalThis.window
    const click = (node, detail = 0) => node.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, detail }))
    // The shared span editor: page toggle, then Words on a paragraph.
    el.querySelector('.firstpair-reader__edit-bar .lt-sentence-toggle').click(); await settle()
    const paragraph = Array.from(el.querySelectorAll('.firstpair-reader__markdown p')).find((p) => p.textContent.includes('A claim'))
    paragraph.querySelector('.firstpair-reader__words-toggle').click(); await settle()
    const editorEl = paragraph.nextElementSibling
    assert.ok(editorEl.classList.contains('lt-word-editor'), 'the shared word picker opens under the paragraph')
    const chip = (word) => Array.from(editorEl.querySelectorAll('.lt-word-token-select')).find((label) => label.textContent.trim() === word)
    const saveNote = async (words, text) => {
      editorEl.querySelector('.lt-clear-word-selection')?.click()
      for (const word of words) click(chip(word))
      await settle()
      editorEl.querySelector('.lt-action-note').click(); await settle()
      const dialog = el.ownerDocument.querySelector('.lt-note-dialog')
      if (!dialog) return false
      dialog.querySelector('textarea').value = text
      dialog.querySelector('.mod-cta').click(); await settle(12)
      return true
    }
    assert.equal(await saveNote(['link'], 'Cite the source here.'), true)
    const ledger = JSON.parse(readFileSync(join(root, 'Preferences/triptych-decisions.json'), 'utf8'))
    const note = Object.values(ledger.span_notes)[0]
    assert.equal(note.exact, 'link'); assert.equal(note.text, 'Cite the source here.'); assert.equal(note.fragment_key, 'reader/book/p1')
    assert.match(note.sentence_id, /^reader\/book\/p1:B\d{4}:[0-9a-f]{8}$/)
    assert.ok(existsSync(join(root, 'Preferences/triptych-decisions.sha256')), 'the integrity sidecar is written')
    assert.match(readFileSync(join(root, 'Preferences/EDITING-INSTRUCTIONS.md'), 'utf8'), /\*\*NOTE\*\*.*link.*Cite the source here/)
    await view.paintNotes(); await settle()
    const mark = paragraph.querySelector('mark.lt-phrase-mark')
    assert.equal(mark.textContent, 'link'); assert.equal(mark.style.background, 'var(--lt-span-0)', 'saved spans are coloured')
    assert.ok(chip('link').classList.contains('lt-token-in-span'), 'the chip shows the span too')
    assert.equal(editorEl.querySelectorAll('.lt-saved-row').length, 1)
    // Overlaps: up to three; a fourth is refused.
    assert.equal(await saveNote(['a', 'link'], 'two'), true)
    assert.equal(await saveNote(['link', 'to'], 'three'), true)
    assert.equal(await saveNote(['link', 'to', 'the'], 'four'), false, 'a fourth overlapping span is refused')
    assert.ok(globalThis.__notices.some((notice) => /Up to three/.test(notice)))
    // The same words again open the existing span instead of counting as a fourth.
    assert.equal(await saveNote(['link'], 'edited'), true)
    await view.paintNotes(); await settle()
    assert.ok(paragraph.querySelector('mark.lt-phrase-overlap').style.background.includes('repeating-linear-gradient'), 'overlaps are striped')
  } finally { done() }
})

/* ------------------------------------------------------- several books */

const RU = 'Жизнь и судьба'

// Two study books as peer folders of one vault, as the 1911 builder writes
// them: firstpair-reader.v2 with an aligned block, an optional hidden Chinese
// source with interlinear pinyin and glosses, and a plain shelf Home.md.
function studyBook(root, { title, lang, label, uiLang, author, subtitle, text }) {
  const at = (rest) => `${root}/${rest}`
  return {
    [at('_data/reader.json')]: {
      schema: 'firstpair-reader.v2', title, ui_lang: uiLang, author, subtitle,
      launcher: at('Home.md'), contents: at('Contents'),
      parts: [{ id: 'P1', title: 'Part 1', note: at('Book/Part 1') }],
      pages: [
        { id: 'p003', title: 'Page 3', part: 'P1', chapter: at('_data/pages/p003.json') },
        { id: 'p004', title: 'Page 4', part: 'P1', chapter: at('_data/pages/p004.json') },
      ],
      aligned: {
        schema: 'firstpair-parallel-reader-v1', title,
        sourceLanguage: { id: 'zh', lang: 'zh', label: '中文', position: 'left', optional: true, defaultVisible: false },
        translations: [{ id: lang, lang, label, defaultVisible: true }],
        interlinear: { layers: ['pinyin', 'gloss'] },
      },
    },
    [at('_data/pages/p003.json')]: { schema: 'firstpair-aligned-chapter-v1', id: 'p003', title: 'Page 3', units: [
      { id: 'b1', source: ['他来了。'], translations: { [lang]: [text[0]] }, words: [['他', 'tā', text[2]], ['来', 'lái', text[3]], ['了', 'le', '(done)'], ['。', '', '']] },
    ] },
    [at('_data/pages/p004.json')]: { schema: 'firstpair-aligned-chapter-v1', id: 'p004', title: 'Page 4', units: [
      { id: 'b2', source: ['走。'], translations: { [lang]: [text[1]] }, words: [['走', 'zǒu', 'go'], ['。', '', '']] },
    ] },
    [at('Home.md')]: '# Home\n\n[Open the Reader](firstpair:reader)\n',
    [at('Contents.md')]: '# Contents\n',
    [at('Book/Part 1.md')]: '# Part 1\n',
  }
}

const SHELF = {
  ...studyBook('1911', { title: '1911', lang: 'en', label: 'English', uiLang: 'en', text: ['He came.', 'Go.', 'he', 'come'] }),
  ...studyBook(RU, { title: RU, lang: 'ru', label: 'Русский', uiLang: 'ru', author: 'Василий Гроссман', subtitle: 'Роман', text: ['Он пришёл.', 'Иди.', 'он', 'прийти'] }),
  'Home.md': '# Books\n\n[Open the Reader](firstpair:reader)\n',
}

const shelfBooks = (el) => Array.from(el.querySelectorAll('.firstpair-reader__shelf-book'))
const cellLangs = (el) => Array.from(el.querySelector('.firstpair-reader__strip').querySelectorAll('.firstpair-reader__cell')).map((cell) => cell.getAttribute('lang'))
const toggleSource = async (el, window) => {
  const source = el.querySelector('.firstpair-reader__language--source input')
  source.checked = !source.checked; source.dispatchEvent(new window.Event('change')); await settle()
}
const languagesOf = (view) => ({ enabled: [...view.enabled], source: view.sourceShown, interlinear: view.interlinear })

test('one book in a folder opens as before: no shelf, Up stops at its contents', async () => {
  const { el, view, done } = await open(studyBook('1911', { title: '1911', lang: 'en', label: 'English', uiLang: 'en', text: ['He came.', 'Go.', 'he', 'come'] }))
  try {
    assert.equal(view.hasShelf(), false)
    assert.equal(view.mode, 'page')
    assert.deepEqual(cellLangs(el), ['en'])
    rail(el).Up.click(); await settle(); rail(el).Up.click(); await settle()
    assert.equal(view.mode, 'contents'); assert.equal(rail(el).Up.disabled, true)
  } finally { done() }
})

test('several books: a shelf, each book in its own interface language, Up returns to the shelf', async () => {
  const { window, el, view, plugin, done } = await open(SHELF)
  try {
    // No book read yet: the shelf, in English.
    assert.equal(view.mode, 'shelf')
    assert.equal(el.querySelector('h1').textContent, 'Shelf')
    assert.deepEqual(shelfBooks(el).map((b) => b.getAttribute('data-book')), ['1911', RU])
    assert.equal(shelfBooks(el)[1].querySelector('.firstpair-reader__shelf-author').textContent, 'Василий Гроссман')
    assert.equal(shelfBooks(el)[1].querySelector('.firstpair-reader__shelf-subtitle').textContent, 'Роман')
    assert.equal(shelfBooks(el)[0].querySelector('.firstpair-reader__shelf-languages').textContent, '中文 → English')
    assert.equal(shelfBooks(el)[1].querySelector('.firstpair-reader__shelf-languages').textContent, '中文 → Русский')
    assert.equal(rail(el).Up.disabled, true); assert.equal(rail(el).Next.disabled, true)
    assert.equal(el.querySelector('.firstpair-reader__toolbar').hidden, true)

    // The Russian book: its units, a Russian interface, its own pinyin and glosses.
    shelfBooks(el)[1].click(); await settle()
    assert.equal(view.bookKey, RU); assert.equal(view.mode, 'page')
    assert.deepEqual(cellLangs(el), ['ru'])
    assert.match(el.querySelector('.firstpair-reader__strip').textContent, /Он пришёл/)
    assert.deepEqual(Object.keys(rail(el)), ['Назад', 'Предыдущее слово', 'Вверх', 'Возврат', 'Вперёд', 'В начало', 'Оглавление', 'Следующее слово', 'Дальше'].filter((label) => Object.keys(rail(el)).includes(label)))
    assert.ok(rail(el)['Вверх'] && rail(el)['Оглавление'], 'rail tooltips in Russian')
    assert.equal(el.querySelector('.firstpair-reader__languages').getAttribute('aria-label'), 'Языки')
    await toggleSource(el, window)
    assert.deepEqual(cellLangs(el), ['zh', 'ru'])
    const words = el.querySelectorAll('.firstpair-reader__iword')
    assert.equal(words[0].querySelector('.firstpair-reader__ireading').textContent, 'tā')
    assert.equal(words[0].querySelector('.firstpair-reader__igloss').textContent, 'он')
    assert.match(el.querySelector('.firstpair-reader__interlinear-toggle').getAttribute('aria-label'), /Слои слов/)
    assert.match(el.querySelector('.firstpair-reader__layout-toggle').getAttribute('aria-label'), /Раскладка: Авто/)

    // Up: page → part → contents → shelf, which is in English again.
    rail(el)['Вверх'].click(); await settle()
    assert.equal(view.mode, 'part')
    rail(el)['Вверх'].click(); await settle()
    assert.equal(view.mode, 'contents'); assert.equal(rail(el)['Вверх'].disabled, false)
    rail(el)['Вверх'].click(); await settle()
    assert.equal(view.mode, 'shelf')
    assert.ok(rail(el).Up, 'the shelf rail is in English')
    // Back returns into the book it came from.
    rail(el).Back.click(); await settle()
    assert.equal(view.mode, 'contents'); assert.equal(view.bookKey, RU)
    assert.ok(rail(el)['Вверх'])
    rail(el)['Вверх'].click(); await settle()

    // Each book is saved under its root folder.
    assert.equal(plugin.data.lastBook, RU)
    assert.equal(plugin.data.books[RU].state.pageId, 'p003')
    assert.deepEqual(plugin.data.books[RU].state.enabled, ['ru'])
    assert.equal(plugin.data.books[RU].state.source, true)
    assert.equal(shelfBooks(el)[1].querySelector('.firstpair-reader__shelf-place').textContent, 'Continue: Page 3')
  } finally { done() }
})

test('switching books restores each book its own languages: 1911 → Жизнь и судьба → 1911', async () => {
  const { window, el, view, plugin, done } = await open(SHELF)
  try {
    // 1911: source on, interlinear Reading only (gloss → text → pinyin), page 4.
    shelfBooks(el)[0].click(); await settle()
    assert.deepEqual(languagesOf(view), { enabled: ['en'], source: false, interlinear: 'gloss' }, 'index defaults')
    await toggleSource(el, window)
    el.querySelector('.firstpair-reader__interlinear-toggle').click(); await settle()
    el.querySelector('.firstpair-reader__interlinear-toggle').click(); await settle()
    rail(el).Next.click(); await settle()
    assert.deepEqual(languagesOf(view), { enabled: ['en'], source: true, interlinear: 'pinyin' })
    assert.equal(view.pages[view.position].id, 'p004')
    const english = { ...languagesOf(view) }

    // To the Russian book through the shelf: its own defaults, nothing of 1911.
    view.showShelf(); await settle()
    shelfBooks(el)[1].click(); await settle()
    assert.deepEqual(languagesOf(view), { enabled: ['ru'], source: false, interlinear: 'gloss' }, 'no "en", no source, no pinyin carried over')
    assert.deepEqual(cellLangs(el), ['ru'])
    assert.equal(view.pages[view.position].id, 'p003', 'a book never read opens at its start')
    await toggleSource(el, window)
    assert.equal(el.querySelectorAll('.firstpair-reader__igloss').length > 0, true)
    const russian = { ...languagesOf(view) }

    // Back to 1911 through a link in its own Home note: page 4, its choices.
    const home = window.document.body.createDiv()
    home.innerHTML = '<p><a href="firstpair:reader">Open the Reader</a></p>'
    for (const processor of plugin.postProcessors) processor(home, { sourcePath: '1911/Home.md' })
    home.querySelector('button').click(); await settle()
    assert.equal(view.bookKey, '1911')
    assert.deepEqual(languagesOf(view), english)
    assert.equal(view.pages[view.position].id, 'p004')
    assert.deepEqual(cellLangs(el), ['zh', 'en'])
    assert.equal(el.querySelectorAll('.firstpair-reader__ireading').length > 0, true)
    assert.equal(el.querySelectorAll('.firstpair-reader__igloss').length, 0, 'Reading only, as left')
    assert.ok(rail(el).Up, 'English interface again')

    // And the Russian book again: its own choices, not 1911's.
    const ruHome = window.document.body.createDiv()
    ruHome.innerHTML = '<p><a href="firstpair:reader">Открыть</a></p>'
    for (const processor of plugin.postProcessors) processor(ruHome, { sourcePath: `${RU}/Home.md` })
    ruHome.querySelector('button').click(); await settle()
    assert.equal(view.bookKey, RU)
    assert.deepEqual(languagesOf(view), russian)
    assert.deepEqual(cellLangs(el), ['zh', 'ru'])
    assert.deepEqual(plugin.data.books['1911'].state.enabled, ['en'])
    assert.deepEqual(plugin.data.books[RU].state.enabled, ['ru'])
    assert.equal(plugin.data.books['1911'].state.interlinear, 'pinyin')
    assert.equal(plugin.data.books[RU].state.interlinear, 'gloss')

    // Back history is per book: in the Russian book, Back does not reach 1911.
    const back = () => rail(el)['Возврат'] ?? rail(el).Back
    for (let step = 0; step < 20 && !back().disabled; step += 1) {
      back().click(); await settle()
      assert.ok(view.mode === 'shelf' || view.bookKey === RU, `step ${step}: ${view.mode} ${view.bookKey}`)
    }
    assert.equal(back().disabled, true)
  } finally { done() }
})

test('notes and links open the book whose folder holds them; the shelf note opens the book read last', async () => {
  const { window, app, el, view, plugin, done } = await open(SHELF, { settings: { lastBook: '1911' } })
  try {
    assert.equal(view.mode, 'page'); assert.equal(view.bookKey, '1911', 'the book read last')
    // A part note inside the Cyrillic folder takes over its leaf in that book.
    const leaf = app.workspace.getLeaf(); leaf.type = 'markdown'; leaf.view = { file: { path: `${RU}/Book/Part 1.md` } }
    await plugin.takeOver({ path: `${RU}/Book/Part 1.md` }); await settle()
    assert.equal(leaf.type, 'firstpair-reader')
    assert.equal(leaf.view.bookKey, RU); assert.equal(leaf.view.mode, 'part')
    // The vault's own Home belongs to no book: it is never taken over.
    const plain = app.workspace.getLeaf(); plain.type = 'markdown'; plain.view = { file: { path: 'Home.md' } }
    await plugin.takeOver({ path: 'Home.md' }); await settle()
    assert.equal(plain.type, 'markdown')
    // Its Open the Reader link, with the shelf up, opens the book read last.
    await view.showShelf(); await settle()
    assert.equal(view.mode, 'shelf')
    const home = window.document.body.createDiv()
    home.innerHTML = '<p><a href="firstpair:reader">Open the Reader</a></p>'
    for (const processor of plugin.postProcessors) processor(home, { sourcePath: 'Home.md' })
    home.querySelector('button').click(); await settle()
    assert.equal(view.mode, 'page'); assert.equal(view.bookKey, '1911')
    // The shelf command.
    const command = plugin.commands.find((item) => item.id === 'open-shelf')
    assert.equal(command.name, 'Open the shelf')
    await command.callback(); await settle()
    assert.equal(view.mode, 'shelf')
    // A percent-encoded link to a note of the Russian book opens it there.
    await view.openFromShelf('1911'); await settle()
    await view.followLink(`${encodeURI(RU)}/Book/Part%201`, '1911/Home.md', el)
    assert.equal(view.bookKey, RU); assert.equal(view.mode, 'part')
  } finally { done() }
})

test('a 2.4.2 data.json is kept: its book opens where it was left, the other book from its defaults', async () => {
  const legacy = {
    layout: 'auto', railPosition: 'top', railPositionChosen: true, resume: true,
    state: { 1911: { mode: 'page', editionId: null, partId: 'P1', pageId: 'p004', scrollTop: 0, enabled: ['en'], source: true, interlinear: 'pinyin', columns: [{ lang: 'en', id: 'en', extra: false }], word: null } },
    choices: {}, hiddenColumns: {}, defaultColumn: { 1911: 'source' },
  }
  const { el, view, plugin, done } = await open(SHELF, { settings: legacy })
  try {
    assert.equal(view.bookKey, '1911', 'the 2.4.2 place names its book')
    assert.equal(view.pages[view.position].id, 'p004')
    assert.deepEqual(languagesOf(view), { enabled: ['en'], source: true, interlinear: 'pinyin' })
    assert.equal(view.bookData().defaultColumn, 'source')
    await view.saveState()
    assert.equal(plugin.data.books['1911'].state.pageId, 'p004')
    assert.equal(plugin.data.books['1911'].defaultColumn, 'source', 'migrated fields survive the first save')
    assert.equal(plugin.data.state['1911'].pageId, 'p004', 'the 2.4.x map is left as it was')
    assert.equal(plugin.data.railPosition, 'top')
    await view.showShelf(); await settle()
    shelfBooks(el)[1].click(); await settle()
    assert.deepEqual(languagesOf(view), { enabled: ['ru'], source: false, interlinear: 'gloss' })
  } finally { done() }
})
