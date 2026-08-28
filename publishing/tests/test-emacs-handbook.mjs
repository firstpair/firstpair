import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
const markdown = readFileSync(new URL('publishing/emacs/guides/master.md', root), 'utf8')
const html = readFileSync(new URL('public/emacs/index.html', root), 'utf8')
const generated = readFileSync(new URL('src/generated/emacs-handbook.ts', root), 'utf8')

const sections = [
  'Install Emacs',
  'Open the book',
  'Install the reader once, for every FirstPair book',
  'Your first five minutes',
  'References open below the text',
  'The dictionary window',
  'Rearranging windows',
  'Reading without the FirstPair reader',
  'Add the manuals to Info',
  'Re-rendering the edition',
  'Make personal notes without fighting updates',
  'Updating a FirstPair bundle',
  'Troubleshooting',
]

test('canonical Emacs handbook is comprehensive and the site page is current', () => {
  for (const section of sections) {
    assert.match(markdown, new RegExp(`## ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.ok(html.includes(section), `rendered handbook is missing ${section}`)
  }
  assert.match(html, /M-x firstpair-read/)
  assert.match(html, /package-vc-install/)
  assert.match(html, /install-info/)
  assert.doesNotMatch(html, /<link\b[^>]*rel=["']stylesheet["']/i)
  assert.ok(generated.includes('M-x firstpair-read'), 'generated module lacks the handbook body')
})
