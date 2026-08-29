import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../vault/plugin/firstpair-reader/', import.meta.url)
const source = readFileSync(new URL('main.js', root), 'utf8')
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
  const controls = ['Previous', 'Up', 'Back', 'Top', 'TOC', 'Next']
  let cursor = -1
  for (const control of controls) {
    const position = source.indexOf(`"${control}"`)
    assert.ok(position > cursor, `${control} must be present in rail order`)
    cursor = position
  }
  assert.match(source, /new ReaderHistory\(\)/)
  assert.match(source, /limit = 64/)
  assert.match(source, /rotate-ccw/)
})

test('standard Reader supports data-driven multilingual editions offline', () => {
  assert.match(source, /_data\/parallel-reader\.json/)
  assert.match(source, /parallel\.translations/)
  assert.match(source, /defaultVisible/)
  assert.match(source, /firstpair-reader__language-toggle/)
  assert.match(source, /openDictionary/)
  assert.match(source, /loadDictionary/)
  assert.match(source, /unit\.translations/)
  assert.doesNotMatch(source, /Italian|English|Russian|Dante/)
})

test('standard Reader leads with the source text unless a title asks otherwise', () => {
  assert.match(source, /\[this\.parallel\.sourceLanguage, \.\.\.translations\]/)
  assert.match(source, /position === "right"/)
  assert.match(source, /firstpair-reader-dictionary-index-v1/)
  assert.match(source, /async lookup\(path, word\)/)
  assert.match(source, /firstpair:page:/)
  assert.match(source, /firstpair:reader/)
  assert.match(source, /registerObsidianProtocolHandler\("firstpair-reader"/)
  assert.match(source, /orientation: portrait/)
  assert.match(source, /ResizeObserver/)
  assert.match(source, /firstpair-reader__page--stacked/)
  assert.match(source, /sizeDrawer\(\)/)
})
