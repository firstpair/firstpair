import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { isStructuredDependencyPage } from '../scripts/pdf-structured-lines.mjs'

const checker = new URL('../scripts/check-pdf-layout.mjs', import.meta.url).pathname
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
const row = (value, i, xMin = 100, xMax = 210) => ({
  xml: `<word>${escape(value)}</word>`, xMin, xMax, yMin: 60 + i * 9, yMax: 67 + i * 9,
})
const dependencyLines = ['@@ -10,7 +10,7 @@ dependencies = [',
  ' "once_cell",', '- "windows-sys 0.52.0",', '+ "windows-sys 0.61.2",',
  ']', '[[package]]', '+name = "sail-native-resource-ffi"', '+version = "0.1.0"']

test('complete dependency diff, entities, zero-width text and separate gutters', () => {
  const code = dependencyLines.map((s, i) => {
    const line = row([...s].join('\u200b'), i >= 4 ? i + 1 : i)
    return { ...line, yMax: line.yMax + 1.4 }
  })
  const gutters = Array.from({ length: 9 }, (_, i) => row(String(364 + i), i, 70, 85))
  assert.equal(isStructuredDependencyPage([...gutters, ...code], 800), true)
  assert.equal(isStructuredDependencyPage(dependencyLines.map((s, i) => row(`${i + 1} ${s}`, i)), 800), true)
  assert.equal(isStructuredDependencyPage([row('dependencies = [', 0),
    { ...row('"arrow",', 1), xml: '<word>&#34;ar&#x200b;row&#34;,</word>' }], 800), true)
})

test('no exemption for prose, verse, plain word lists, or malformed wrapped source', () => {
  for (const words of [['the', 'narrow', 'column'], ['soft', 'rain', 'falls'],
    ['apple', 'pear', 'plum'], ['dependencies = [', '"a', 'broken_name",', ']'],
    ['dependencies = [', '"arrow",', 'this', 'is', 'broken'],
    ['dependencies = [', '"arrow",', '123']]) {
    assert.equal(isStructuredDependencyPage(words.map((s, i) => row(s, i)), 800), false)
  }
})

test('PDF integration retains narrow-column, overflow and blank-raster rejection', () => {
  const work = mkdtempSync(join(tmpdir(), 'firstpair-layout-test-'))
  try {
    const header = '#set page(width: 612pt, height: 792pt, margin: 72pt)\n#set text(size: 7pt)\n#set par(leading: 1pt)\n'
    const lines = (values) => `#for value in ${JSON.stringify(values).replace('[', '(').replace(/\]$/, ')')} { text(value); linebreak() }`
    const cases = [
      ['structured', lines(['dependencies = [', ...Array(60).fill('"arrow",'), ']']), null],
      ['prose', lines(Array(60).fill('narrow')), 'one-word column'],
      ['poem', lines(Array.from({ length: 60 }, (_, i) => ['soft', 'rain', 'falls'][i % 3])), 'one-word column'],
      ['word-list', lines(Array.from({ length: 60 }, (_, i) => ['apple', 'pear', 'plum'][i % 3])), 'one-word column'],
      ['wrapped-code', lines(['dependencies = [', ...Array(30).fill(['"a', 'broken_name",']).flat(), ']']), 'one-word column'],
      ['overflow', '#set text(size: 20pt)\n#place(dx: -75pt)[overflowingtext]', 'outside the page bounds'],
      ['blank', '#box(width: 1pt, height: 1pt)[]', 'visually blank'],
    ]
    for (const [name, body, failure] of cases) {
      const input = join(work, `${name}.typ`), pdf = join(work, `${name}.pdf`)
      writeFileSync(input, header + body)
      const compile = spawnSync('typst', ['compile', input, pdf], { encoding: 'utf8' })
      assert.equal(compile.status, 0, compile.stderr)
      const check = spawnSync(process.execPath, [checker, pdf], { encoding: 'utf8' })
      assert.equal(check.status, failure ? 1 : 0, `${name}: ${check.stderr}`)
      if (failure) assert.ok(check.stderr.includes(failure), check.stderr)
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})
