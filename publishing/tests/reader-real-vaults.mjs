// Opt-in QA: open FirstPair Reader 2 against real vaults on this machine.
//
//   node publishing/tests/reader-real-vaults.mjs "<vault>" ["<vault>" ...]
//
// Each vault is read from disk (never written).  Markdown is rendered with
// `marked` plus Obsidian-style wikilinks and code-block processors, so links,
// footnotes, fragment cards, and dictionary words are exercised.  The report
// is JSON on stdout; the exit code is non-zero if any vault fails.
import { createRequire } from 'node:module'
import Module from 'node:module'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const mock = require('./obsidian-mock.cjs')
const { marked } = require('marked')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'obsidian') return require.resolve('./obsidian-mock.cjs')
  return originalResolve.call(this, request, ...rest)
}

let activePlugin = null
mock.Plugin.prototype.registerMarkdownCodeBlockProcessor = function (language, fn) {
  (this.codeProcessors ||= {})[language] = fn
}
mock.Plugin.prototype.registerEvent = function () {}
mock.Component = class { load() {} unload() {} addChild(child) { return child } register() {} }
mock.Notice = class { constructor(message) { (globalThis.__notices ||= []).push(String(message)) } }
mock.normalizePath = (value) => value
mock.MarkdownRenderer.render = async (app, markdown, element) => {
  const linked = markdown
    .replace(/!\[\[([^\]]+)\]\]/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (m, target, label) => `<a class="internal-link" data-href="${target}" href="${target}">${label}</a>`)
    .replace(/\[\[([^\]]+)\]\]/g, (m, target) => `<a class="internal-link" data-href="${target}" href="${target}">${target}</a>`)
  element.innerHTML = marked.parse(linked)
  for (const code of Array.from(element.querySelectorAll('pre > code[class^="language-"]'))) {
    const language = code.className.replace('language-', '')
    const processor = activePlugin?.codeProcessors?.[language]
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

const settle = async (count = 4) => { for (let i = 0; i < count; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)) }

function makeApp(root, window) {
  const entries = new Map()
  const entry = (path) => {
    const full = join(root, path)
    if (!existsSync(full)) return null
    if (!entries.has(path)) entries.set(path, statSync(full).isDirectory() ? { path, children: [] } : { path, name: basename(path) })
    return entries.get(path)
  }
  let markdownIndex = null
  const allMarkdown = () => {
    if (markdownIndex) return markdownIndex
    markdownIndex = []
    const walk = (dir) => {
      for (const name of readdirSync(join(root, dir))) {
        if (name.startsWith('.')) continue
        const rel = dir ? `${dir}/${name}` : name
        if (statSync(join(root, rel)).isDirectory()) walk(rel)
        else if (name.endsWith('.md')) markdownIndex.push(rel)
      }
    }
    walk('')
    return markdownIndex
  }
  const vault = {
    getAbstractFileByPath: (path) => entry(path),
    read: async (file) => readFileSync(join(root, file.path), 'utf8'),
    cachedRead: async (file) => readFileSync(join(root, file.path), 'utf8'),
    getResourcePath: (file) => `app://local/${file.path}`,
    adapter: {
      exists: async (path) => existsSync(join(root, path)),
      read: async (path) => readFileSync(join(root, path), 'utf8'),
      list: async (path) => {
        const dir = path === '/' ? '' : path
        const names = readdirSync(join(root, dir))
        const rel = (name) => (dir ? `${dir}/${name}` : name)
        return {
          files: names.filter((name) => statSync(join(root, rel(name))).isFile()).map(rel),
          folders: names.filter((name) => statSync(join(root, rel(name))).isDirectory()).map(rel),
        }
      },
    },
  }
  const opened = []
  const leaves = []
  const metadataCache = {
    getFirstLinkpathDest(linkpath) {
      const clean = linkpath.replace(/\.md$/, '')
      if (existsSync(join(root, `${clean}.md`))) return { path: `${clean}.md` }
      const hit = allMarkdown().find((path) => path.replace(/\.md$/, '').endsWith(`/${clean}`) || path.replace(/\.md$/, '') === clean)
      return hit ? { path: hit } : null
    },
  }
  const workspace = {
    getLeavesOfType: (type) => leaves.filter((leaf) => leaf.type === type),
    getLeaf() {
      const container = window.document.body.createDiv()
      const leaf = { app, containerEl: container, async setViewState(state) { leaf.type = state.type; leaf.view = plugin.views[state.type](leaf); await leaf.view.onOpen() }, async openFile(file) { opened.push(file.path) } }
      leaves.push(leaf)
      return leaf
    },
    revealLeaf() {},
    openLinkText: async (link) => { opened.push(link) },
    getActiveViewOfType: () => null,
  }
  const app = { vault, workspace, metadataCache, opened, settingsContainer: window.document.body.createDiv() }
  const plugin = new PluginClass(app)
  return { app, plugin }
}

const buttons = (root) => Object.fromEntries(Array.from(root.querySelectorAll('.firstpair-reader__rail button')).map((b) => [b.getAttribute('aria-label'), b]))

async function check(vaultPath) {
  const window = mock.makeWindow()
  Object.assign(globalThis, { window, document: window.document, getComputedStyle: window.getComputedStyle.bind(window), ResizeObserver: window.ResizeObserver })
  globalThis.__notices = []
  const { app, plugin } = makeApp(vaultPath, window)
  activePlugin = plugin
  const report = { vault: basename(vaultPath), checks: {}, problems: [] }
  const problem = (message) => report.problems.push(message)
  const t0 = Date.now()
  await plugin.onload()
  await plugin.activate()
  await settle()
  const leaf = app.workspace.getLeavesOfType('firstpair-reader')[0]
  const view = leaf.view
  const root = leaf.containerEl
  const error = root.querySelector('.firstpair-reader__error')
  if (error) { problem(`open: ${error.textContent.slice(0, 200)}`); return report }
  const model = plugin.model
  report.format = model.format
  report.title = model.title
  report.openMs = Date.now() - t0
  report.checks.mode = view.mode
  if (model.format === 'library') {
    report.checks.editions = model.editions.length
    const first = root.querySelector('.firstpair-reader__library button')
    first.click(); await settle(8)
    report.checks.editionContents = view.mode === 'contents' && root.querySelectorAll('.firstpair-reader__toc-page').length
  }
  report.pages = view.pages.length
  report.parts = view.book.parts.length
  // Open the first page from the contents (or the current page) and read it.
  if (view.mode !== 'page') { await view.openPage(view.pages[0].id); await settle(8) }
  const text = () => root.querySelector('.firstpair-reader__page').textContent
  report.checks.firstPageChars = text().length
  if (!text().trim()) problem('first page renders empty')
  if (root.querySelector('.firstpair-reader__error')) problem(`page: ${root.querySelector('.firstpair-reader__error').textContent.slice(0, 200)}`)
  // Next twice, Up, TOC, Back.
  let rail = buttons(root)
  for (let i = 0; i < 2 && !rail.Next.disabled; i += 1) { rail.Next.click(); await settle(8); rail = buttons(root) }
  report.checks.afterNext = view.pages[view.position].id
  if (root.querySelector('.firstpair-reader__error')) problem(`next: ${root.querySelector('.firstpair-reader__error').textContent.slice(0, 200)}`)
  const pageBeforeUp = view.position
  rail.Up.click(); await settle(8)
  report.checks.up = view.mode
  if (view.mode !== 'part') problem(`Up from a page went to ${view.mode}`)
  buttons(root).TOC.click(); await settle(8)
  report.checks.toc = view.mode
  const current = root.querySelector('.firstpair-reader__toc-page.is-current')
  report.checks.tocMarksCurrent = Boolean(current)
  buttons(root).Back.click(); await settle(8)
  buttons(root).Back.click(); await settle(8)
  report.checks.backReturns = view.mode === 'page' && view.position === pageBeforeUp
  if (!report.checks.backReturns) problem(`Back did not return to the page (mode ${view.mode}, position ${view.position})`)
  // Every page renders (spot check up to 40 evenly spaced).
  const step = Math.max(1, Math.floor(view.pages.length / 40))
  let rendered = 0
  for (let index = 0; index < view.pages.length; index += step) {
    await view.go({ mode: 'page', position: index }, false); await settle(6)
    const failure = root.querySelector('.firstpair-reader__error')
    if (failure) { problem(`page ${view.pages[index].id}: ${failure.textContent.slice(0, 160)}`); break }
    if (!text().trim()) problem(`page ${view.pages[index].id} is empty`)
    rendered += 1
  }
  report.checks.pagesRendered = rendered
  // Words and dictionary.
  const word = root.querySelector('.firstpair-reader__word')
  if (word) {
    word.click(); await settle(10)
    const drawer = root.querySelector('.firstpair-reader__drawer')
    report.checks.dictionary = drawer.hasAttribute('hidden') ? 'hidden' : drawer.textContent.slice(0, 120)
  }
  // Fragment cards.
  let card = null
  for (let index = 0; index < view.pages.length && !card; index += 1) {
    await view.go({ mode: 'page', position: index }, false); await settle(6)
    card = root.querySelector('.firstpair-reader__fragment')
    if (!model.fragments) break
  }
  if (card) {
    card.querySelector('button').click(); await settle(10)
    report.checks.fragmentLines = card.querySelectorAll('.firstpair-reader__fragment-line').length
    if (!report.checks.fragmentLines) problem(`fragment excerpt empty: ${card.textContent.slice(0, 160)}`)
  }
  // Source notes with dictionary words (Cicero).
  if (model.words?.notes) {
    const note = readdirSync(join(vaultPath, model.words.notes)).find((name) => name.endsWith('.md'))
    if (note) {
      await view.go({ mode: 'note', notePath: `${model.words.notes}${note.replace(/\.md$/, '')}` }); await settle(10)
      const sourceWord = root.querySelector('.firstpair-reader__word')
      report.checks.sourceNoteWords = root.querySelectorAll('.firstpair-reader__word').length
      report.checks.columnToggles = root.querySelectorAll('.firstpair-reader__column-toggles input').length
      if (sourceWord) { sourceWord.click(); await settle(10); report.checks.sourceDictionary = root.querySelector('.firstpair-reader__drawer').textContent.slice(0, 120) }
    }
  }
  // Note takeover mapping for the static fallback.
  const book = view.book
  const sample = book.pages.find((page) => page.note)
  if (sample) report.checks.takeover = plugin.__proto__.constructor.__test.contract.targetForNote(book, sample.note + '.md')
  report.notices = globalThis.__notices.slice(0, 5)
  return report
}

const reports = []
for (const vault of process.argv.slice(2)) {
  try {
    reports.push(await check(vault))
  } catch (error) {
    reports.push({ vault: basename(vault), problems: [`crash: ${error.stack?.split('\n').slice(0, 4).join(' | ')}`] })
  }
}
console.log(JSON.stringify(reports, null, 1))
process.exitCode = reports.some((report) => report.problems?.length) ? 1 : 0
