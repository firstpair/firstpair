// The browser engine must mark exactly what publishing/vault/edition_diffs.py
// marks, so the app and the vaults agree.  Each case runs through both.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { pairDiff, setDiff, scanPair, classifier, SequenceMatcher } from '../src/lib/engine.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const vault = path.resolve(here, '../../vault')

const CASES = [
  ['Венеция была старой республикой, и она пала.', 'Венеция была древней республикой: и она пала.'],
  ['Я берусь рассказать об отношениях двух республик: одной новой, ещё пахнущей лесом.',
    'Я берусь рассказать об отношениях двух республик — одной новой, ещё пахнувшей свежим тёсом.'],
  ['He came home late in the evening.', 'He came home, when it had grown dark, to his own porch by the river.'],
  ['One two three four five six seven eight nine ten. Then the end.', 'Then the end. One two three four five six seven eight nine ten.'],
  ['', 'Only new words here.'],
  ['Same text.', 'Same text.'],
  ['a b a b a b c', 'b a b c a b'],
]

function python(cases, functionWords) {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(vault)})
from edition_diffs import page_diffs
cases, fw = json.load(sys.stdin)
out = []
for a, b, c in cases:
    out.append(page_diffs({"a": a, "b": b, "c": c}, ["a", "b", "c"], function_words=fw))
print(json.dumps(out))
`
  const input = JSON.stringify([cases, functionWords])
  return JSON.parse(execFileSync('python3', ['-c', script], { input }).toString())
}

test('pairwise and set diffs match edition_diffs.py', () => {
  const functionWords = ['и', 'в', 'на', 'the', 'to', 'his', 'it', 'had', 'by']
  const cls = classifier({ functionWords })
  const triples = CASES.map(([a, b]) => [a, b, `${a} ${b}`.slice(0, 60)])
  const expected = python(triples, functionWords)
  triples.forEach(([a, b, c], index) => {
    const entry = expected[index]
    const ab = pairDiff(a, b, cls)
    const want = entry['a|b'] || { a: [], b: [] }
    assert.deepEqual(ab.left, want.a, `left ranges, case ${index}`)
    assert.deepEqual(ab.right, want.b, `right ranges, case ${index}`)
    const set = setDiff([a, b, c])
    const wantSet = entry['a|b|c'] || { a: [], b: [], c: [] }
    const rename = (ranges) => ranges.map(([s, e, k]) => [s, e, k.replace('share:0', 'share:a').replace('share:1', 'share:b').replace('share:2', 'share:c')])
    assert.deepEqual(rename(set[0]), wantSet.a, `set a, case ${index}`)
    assert.deepEqual(rename(set[1]), wantSet.b, `set b, case ${index}`)
  })
})

test('SequenceMatcher follows difflib on repeated tokens', () => {
  const script = 'import difflib,json,sys; a,b=json.load(sys.stdin); print(json.dumps(difflib.SequenceMatcher(None,a,b,autojunk=False).get_opcodes()))'
  for (const [a, b] of [['abcabba'.split(''), 'cbabac'.split('')], ['xxxyyyxxx'.split(''), 'yyyxxxyyy'.split('')]]) {
    const want = JSON.parse(execFileSync('python3', ['-c', script], { input: JSON.stringify([a, b]) }).toString())
    assert.deepEqual(new SequenceMatcher(a, b).getOpcodes(), want)
  }
})

test('a substitution recurring on three rows is a rule, and conflicts are counted', () => {
  const rows = [0, 1, 2, 3].map((i) => ({ key: `r${i}`, part: 'P1', left: `Он сказал нежели ${i} раз.`, right: `Он сказал чем ${i} раз.` }))
  rows.push({ key: 'r9', part: 'P2', left: 'Это чем дальше.', right: 'Это нежели дальше.' })
  const { rules, summary } = scanPair(rows)
  assert.equal(rules[0].from, 'нежели')
  assert.equal(rules[0].count, 4)
  assert.equal(rules[0].reverseCount, 1)
  assert.equal(summary.P1.lexical, 4)
})
