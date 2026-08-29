// Opens the FirstPair Reader plugin in jsdom against an aligned fixture vault
// with a sharded dictionary: renders a chapter, taps a word, switches layouts,
// follows Home links, and survives a vault that is still syncing.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import Module from 'node:module'

const require = createRequire(import.meta.url)
const mock = require('./obsidian-mock.cjs')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'obsidian') return require.resolve('./obsidian-mock.cjs')
  return originalResolve.call(this, request, ...rest)
}
// The plugin is CommonJS inside an ESM repository: compile it by hand.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const pluginPath = fileURLToPath(new URL('../vault/plugin/firstpair-reader/main.js', import.meta.url))
const pluginModule = new Module(pluginPath)
pluginModule.filename = pluginPath
pluginModule.paths = Module._nodeModulePaths(fileURLToPath(new URL('.', import.meta.url)))
pluginModule._compile(readFileSync(pluginPath, 'utf8'), pluginPath + '.cjs')
const PluginClass = pluginModule.exports

function fixtureVault() {
  const root = mkdtempSync(join(tmpdir(), 'firstpair-reader-dom-'))
  const write = (path, value) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value)) }
  write('_data/parallel-reader.json', {
    schema: 'firstpair-parallel-reader-v1', title: 'Fixture', unit: 'tercet',
    sourceLanguage: { id: 'it', lang: 'it', label: 'Italiano', position: 'left' },
    translations: [{ id: 'ru', lang: 'ru', label: 'Русский', defaultVisible: true }, { id: 'en', lang: 'en', label: 'English', defaultVisible: true }],
    dictionaries: { en: { path: '_data/dictionaries/it-en/index.json' }, ru: { path: '_data/dictionaries/it-ru.json' } },
    pages: [{ id: 'c-01', title: 'Canto 1', path: '_data/chapters/c-01.json' }, { id: 'c-02', title: 'Canto 2', path: '_data/chapters/c-02.json' }],
  })
  write('_data/chapters/c-01.json', { schema: 'firstpair-aligned-chapter-v1', id: 'c-01', title: 'Canto 1', units: [
    { id: 'u1', source: ['Nel mezzo del cammin', 'mi ritrovai'], translations: { ru: ['Земную жизнь', 'я очутился'], en: ['Midway upon', 'I found myself'] } },
    { id: 'u2', source: ['ché la diritta via'], translations: { ru: ['утратив'], en: ['For the straightforward'] } },
  ] })
  write('_data/chapters/c-02.json', { schema: 'firstpair-aligned-chapter-v1', id: 'c-02', title: 'Canto 2', units: [{ id: 'u3', source: ['Lo giorno se n’andava'], translations: { ru: ['День уходил'], en: ['Day was departing'] } }] })
  write('_data/dictionaries/it-en/index.json', { schema: 'firstpair-reader-dictionary-index-v1', sourceLanguage: 'it', targetLanguage: 'en', prefixLength: 2, entryCount: 2, shards: { m: 'm.json', ca: 'ca.json' } })
  write('_data/dictionaries/it-en/m.json', { schema: 'firstpair-reader-dictionary-v1', entries: { mezzo: [{ headword: 'mezzo', partOfSpeech: 'noun', definitions: ['middle', 'half'], grammar: 'masculine singular' }] } })
  write('_data/dictionaries/it-en/ca.json', { schema: 'firstpair-reader-dictionary-v1', entries: { cammin: [{ headword: 'cammino', partOfSpeech: 'noun', definitions: ['journey'], grammar: 'apocopic' }] } })
  write('_data/dictionaries/it-ru.json', { schema: 'firstpair-reader-dictionary-v1', entries: { mezzo: [{ headword: 'mezzo', partOfSpeech: 'noun', definitions: ['середина'] }] } })
  return root
}

function makeApp(root, window) {
  const fs = require('node:fs')
  const files = new Map()
  const vault = {
    getAbstractFileByPath(path) { const full = join(root, path); if (!fs.existsSync(full)) return null; if (!files.has(path)) files.set(path, { path }); return files.get(path) },
    async read(file) { return fs.readFileSync(join(root, file.path), 'utf8') },
  }
  const opened = []
  const leaves = []
  const workspace = {
    getLeavesOfType(type) { return leaves.filter((leaf) => leaf.type === type) },
    getLeaf() { const container = window.document.body.createDiv(); Object.defineProperty(container, 'clientWidth', { value: window.__width ?? 1200 }); const leaf = { app, containerEl: container, async setViewState(state) { leaf.type = state.type; leaf.view = plugin.views[state.type](leaf); await leaf.view.onOpen() }, async openFile(file) { opened.push(file.path) } }; leaves.push(leaf); return leaf },
    revealLeaf() {},
  }
  const app = { vault, workspace, opened, settingsContainer: window.document.body.createDiv() }
  const plugin = new PluginClass(app)
  return { app, plugin }
}

async function openReader(root, window) {
  const { app, plugin } = makeApp(root, window)
  await plugin.onload()
  await plugin.activate()
  const leaf = app.workspace.getLeavesOfType('firstpair-reader')[0]
  return { app, plugin, view: leaf.view, root: leaf.containerEl }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test('renders an aligned chapter with the source first and a sharded dictionary', async () => {
  const window = mock.makeWindow(); globalThis.window = window; globalThis.document = window.document; globalThis.getComputedStyle = window.getComputedStyle.bind(window); globalThis.ResizeObserver = window.ResizeObserver
  const vaultRoot = fixtureVault()
  try {
    const { view, root, app } = await openReader(vaultRoot, window)
    Object.defineProperty(root.querySelector('.firstpair-reader'), 'clientWidth', { value: 1200 }); view.applyLayout()
    const strips = root.querySelectorAll('.firstpair-reader__strip')
    assert.equal(strips.length, 2)
    const cells = strips[0].querySelectorAll('.firstpair-reader__cell')
    assert.deepEqual(Array.from(cells).map((cell) => cell.getAttribute('lang')), ['it', 'ru', 'en'])
    assert.equal(cells[0].querySelectorAll('.firstpair-reader__word').length > 0, true)
    assert.equal(strips[0].getAttribute('data-translations'), '2')
    assert.ok(root.querySelector('.firstpair-reader__page--columns'), 'wide pane uses columns')

    const word = Array.from(cells[0].querySelectorAll('.firstpair-reader__word')).find((button) => button.textContent === 'mezzo')
    word.click(); await settle(); await settle()
    const drawer = root.querySelector('.firstpair-reader__drawer')
    assert.equal(drawer.hasAttribute('hidden'), false)
    const text = drawer.textContent
    assert.match(text, /middle; half/)
    assert.match(text, /середина/)
    assert.match(text, /masculine singular/)

    const cammin = Array.from(cells[0].querySelectorAll('.firstpair-reader__word')).find((button) => button.textContent === 'cammin')
    cammin.click(); await settle(); await settle()
    assert.match(drawer.textContent, /journey/)
    assert.match(drawer.textContent, /No exact headword entry/)

    const layout = root.querySelector('.firstpair-reader__layout-toggle')
    assert.match(layout.getAttribute('aria-label'), /Auto/)
    layout.click(); await settle()
    assert.match(layout.getAttribute('aria-label'), /Columns/)
    layout.click(); await settle()
    assert.match(layout.getAttribute('aria-label'), /Stacked/)
    assert.ok(root.querySelector('.firstpair-reader__page--stacked'))
    assert.equal(root.querySelector('.firstpair-reader__page--columns'), null)
    assert.equal(view.plugin.settings.layout, 'stacked')

    const next = Array.from(root.querySelectorAll('.firstpair-reader__rail button')).find((button) => button.getAttribute('aria-label') === 'Next')
    next.click(); await settle(); await settle()
    assert.match(root.querySelector('h1').textContent, /Canto 2/)

    // Home links become buttons that open the Reader on a page.
    const home = window.document.body.createDiv()
    home.innerHTML = '<p><a href="firstpair:reader">Open the Reader</a> <a href="firstpair:page:c-01">Canto 1</a> <a href="https://example.org">web</a></p>'
    for (const processor of view.plugin.postProcessors) processor(home)
    assert.equal(home.querySelectorAll('a').length, 1)
    const buttons = home.querySelectorAll('button.firstpair-reader__link')
    assert.equal(buttons.length, 2)
    buttons[1].click(); await settle(); await settle()
    assert.match(root.querySelector('h1').textContent, /Canto 1/)
    assert.equal(app.workspace.getLeavesOfType('firstpair-reader').length, 1)

    // Reserved drawer column: with English off, three tracks remain and the
    // drawer opens over the empty one; unreserved, the columns spread.
    const english = Array.from(root.querySelectorAll('.firstpair-reader__language-toggle input')).at(-1)
    english.checked = false; english.dispatchEvent(new window.Event('change')); await settle(); await settle()
    let strip = root.querySelector('.firstpair-reader__strip')
    assert.equal(strip.querySelectorAll('.firstpair-reader__cell').length, 2)
    assert.equal(strip.style.getPropertyValue('--firstpair-columns'), '3')
    view.plugin.settingTab.display()
    const toggle = app.settingsContainer.querySelector('input[type="checkbox"]')
    assert.equal(toggle.checked, true)
    toggle.checked = false; toggle.dispatchEvent(new window.Event('change')); await settle(); await settle()
    assert.equal(view.plugin.settings.reserveDrawerColumn, false)
    strip = root.querySelector('.firstpair-reader__strip')
    assert.equal(strip.style.getPropertyValue('--firstpair-columns'), '2')
    const select = app.settingsContainer.querySelector('select')
    select.value = 'columns'; select.dispatchEvent(new window.Event('change')); await settle()
    assert.equal(view.plugin.settings.layout, 'columns')
    assert.ok(root.querySelector('.firstpair-reader__page--columns'))

    // Dictionary languages follow the shown translations (English is off),
    // or answer in all languages with the shown ones first.
    const mezzo = () => Array.from(root.querySelectorAll('.firstpair-reader__word')).find((button) => button.textContent === 'mezzo')
    mezzo().click(); await settle(); await settle()
    let headings = Array.from(drawer.querySelectorAll('h3')).map((h) => h.textContent)
    assert.deepEqual(headings, ['Русский'])
    const languages = Array.from(app.settingsContainer.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === 'all'))
    languages.value = 'all'; languages.dispatchEvent(new window.Event('change')); await settle()
    mezzo().click(); await settle(); await settle()
    headings = Array.from(drawer.querySelectorAll('h3')).map((h) => h.textContent)
    assert.deepEqual(headings, ['Русский', 'English'])

    // A standing dictionary column opens with the page, has no Close button,
    // and keeps the last entry across page turns.
    const keep = app.settingsContainer.querySelectorAll('input[type="checkbox"]')[1]
    keep.checked = true; keep.dispatchEvent(new window.Event('change')); await settle(); await settle()
    assert.equal(drawer.hasAttribute('hidden'), false)
    mezzo().click(); await settle(); await settle()
    assert.equal(drawer.querySelector('button'), null)
    assert.match(drawer.textContent, /middle; half/)
    next.click(); await settle(); await settle()
    assert.match(root.querySelector('h1').textContent, /Canto 2/)
    assert.equal(drawer.hasAttribute('hidden'), false)
    assert.match(drawer.textContent, /middle; half/)
  } finally { rmSync(vaultRoot, { recursive: true, force: true }) }
})

test('a phone held upright stacks automatically', async () => {
  const window = mock.makeWindow(); window.__portrait = true; globalThis.window = window; globalThis.document = window.document; globalThis.getComputedStyle = window.getComputedStyle.bind(window); globalThis.ResizeObserver = window.ResizeObserver
  mock.Platform.isMobile = true
  const vaultRoot = fixtureVault()
  try {
    const { root } = await openReader(vaultRoot, window)
    assert.ok(root.querySelector('.firstpair-reader__page--stacked'))
  } finally { mock.Platform.isMobile = false; rmSync(vaultRoot, { recursive: true, force: true }) }
})

test('a bottom dictionary band in stacked layout shortens the text when kept open', async () => {
  const window = mock.makeWindow(); window.__portrait = true; globalThis.window = window; globalThis.document = window.document; globalThis.getComputedStyle = window.getComputedStyle.bind(window); globalThis.ResizeObserver = window.ResizeObserver
  mock.Platform.isMobile = true
  const vaultRoot = fixtureVault()
  try {
    const { view, root, app } = await openReader(vaultRoot, window)
    await view.plugin.saveSettings({ drawerPosition: 'bottom', keepDrawerOpen: true }); view.plugin.refreshViews(true); await settle(); await settle()
    const frame = root.querySelector('.firstpair-reader__frame'); Object.defineProperty(frame, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, right: 390, bottom: 800, width: 390, height: 800 }) })
    view.sizeDrawer()
    const drawer = root.querySelector('.firstpair-reader__drawer')
    assert.equal(drawer.hasAttribute('hidden'), false)
    assert.ok(drawer.classList.contains('firstpair-reader__drawer--bottom'))
    assert.equal(drawer.style.height, '264px'); assert.equal(drawer.style.bottom, '0px'); assert.equal(drawer.style.width, '390px')
    assert.equal(root.querySelector('.firstpair-reader').style.height, 'calc(100% - 264px)')
    assert.ok(drawer.querySelector('.firstpair-reader__drawer-grip'), 'grip present')
    await view.plugin.saveSettings({ drawerHeight: 0.5 }); view.sizeDrawer()
    assert.equal(drawer.style.height, '400px')
    await view.plugin.saveSettings({ keepDrawerOpen: false }); view.closeDrawer()
    assert.equal(drawer.hasAttribute('hidden'), true)
    assert.equal(root.querySelector('.firstpair-reader').style.height, '')
  } finally { mock.Platform.isMobile = false; rmSync(vaultRoot, { recursive: true, force: true }) }
})

test('a vault still syncing shows an error with Retry, never a blank view', async () => {
  const window = mock.makeWindow(); globalThis.window = window; globalThis.document = window.document; globalThis.getComputedStyle = window.getComputedStyle.bind(window); globalThis.ResizeObserver = window.ResizeObserver
  const vaultRoot = fixtureVault()
  try {
    writeFileSync(join(vaultRoot, '_data/parallel-reader.json'), '{"schema": "firstpair-parallel-reader-v1", "pages": [')
    const { root } = await openReader(vaultRoot, window)
    assert.match(root.textContent, /could not open this vault/)
    assert.ok(root.querySelector('.firstpair-reader__error button'))
    // A missing dictionary shard is reported in the drawer.
    rmSync(join(vaultRoot, '_data/dictionaries/it-en/m.json'))
    const { root: root2 } = await openReader(fixtureVaultRepair(vaultRoot), window)
    const word = Array.from(root2.querySelectorAll('.firstpair-reader__word')).find((button) => button.textContent === 'mezzo')
    word.click(); await settle(); await settle()
    assert.match(root2.querySelector('.firstpair-reader__drawer').textContent, /not in the vault yet/)
  } finally { rmSync(vaultRoot, { recursive: true, force: true }) }
})

function fixtureVaultRepair(root) {
  const fresh = fixtureVault()
  const fs = require('node:fs')
  fs.copyFileSync(join(fresh, '_data/parallel-reader.json'), join(root, '_data/parallel-reader.json'))
  rmSync(fresh, { recursive: true, force: true })
  return root
}
