import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../vault/plugin/firstpair-reader/', import.meta.url)
const source = readFileSync(new URL('main.js', root), 'utf8')
// The view itself, without the shared modules the bundle embeds.
const view = readFileSync(new URL('main-source.js', root), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'))

test('standard Reader package is stable and offline', () => {
  assert.equal(manifest.id, 'firstpair-reader')
  assert.equal(manifest.isDesktopOnly, false)
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|WebSocket/)
  assert.doesNotMatch(source, /vault\.on\s*\(\s*["'](?:create|modify)/)
  assert.match(source, /firstpair:target:/)
  assert.match(source, /_data\/targets\.json/)
})

test('standard Reader preserves navigation and bounded local history', () => {
  const controls = ['Previous', 'Previous word', 'Up', 'Back', 'Forward', 'Top', 'TOC', 'Next word', 'Next']
  let cursor = -1
  for (const control of controls) {
    const position = source.indexOf(`"${control}"`)
    assert.ok(position > cursor, `${control} must be present in rail order`)
    cursor = position
  }
  assert.match(source, /new ReaderHistory\(\)/)
  assert.match(source, /HISTORY_LIMIT = 100/)
  assert.match(source, /rotate-ccw/)
  assert.match(source, /chevrons-left/)
  assert.match(source, /chevrons-right/)
  assert.match(source, /async stepWord\(direction\)/)
})

test('standard Reader supports data-driven multilingual editions offline', () => {
  assert.match(source, /_data\/parallel-reader\.json/)
  assert.match(source, /parallel\.translations/)
  assert.match(source, /defaultVisible/)
  assert.match(source, /firstpair-reader__language-toggle/)
  assert.match(source, /openDictionary/)
  assert.match(source, /dictionaryLookup/)
  assert.match(source, /unit\.translations/)
  assert.doesNotMatch(view, /Italian|English|Russian|Dante|Русский/)
})

test('standard Reader leads with the source text unless a title asks otherwise', () => {
  assert.match(source, /\[\.\.\.sources, \.\.\.shown\]/)
  assert.match(source, /translationsOf\(lang\)/)
  assert.match(source, /async rotate\(index\)/)
  assert.match(source, /async addColumn\(lang\)/)
  assert.match(source, /position === "right"/)
  assert.match(source, /firstpair-reader-dictionary-index-v1/)
  assert.match(source, /return async function lookup\(path, surface, lang = ""\)/)
  assert.match(source, /firstpair:page:/)
  assert.match(source, /firstpair:reader/)
  assert.match(source, /registerObsidianProtocolHandler\?\.\("firstpair-reader"/)
  assert.match(source, /orientation: portrait/)
  assert.match(source, /ResizeObserver/)
  assert.match(source, /firstpair-reader__page--stacked/)
  assert.match(source, /sizeDrawer\(\)/)
})

test('Reader 2 reads every FirstPair index format and stays read-only unless editing is on', () => {
  for (const format of ['firstpair-reader.v2', 'parallel-reader.json', 'mobile-library.json', 'fragments.json', 'schema_version === 1']) {
    assert.ok(source.includes(format), `${format} is understood`)
  }
  assert.match(view, /editing: false/)
  assert.match(view, /if \(!this\.plugin\.settings\.editing\) return;/)
  assert.doesNotMatch(view, /vault\.on\s*\(/)
  assert.match(view, /detachLeavesOfType/)
  assert.match(view, /HISTORY_LIMIT/)
})
