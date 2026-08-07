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
