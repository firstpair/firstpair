import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
const markdown = readFileSync(new URL('publishing/vault/guides/master.md', root), 'utf8')
const html = readFileSync(new URL('public/obsidian/index.html', root), 'utf8')

const sections = [
  'Install Obsidian',
  'Your first five minutes',
  'Notes, links, and the graph',
  'The FirstPair Reader',
  'Optional local plugins',
  'Make personal notes without fighting updates',
  'Desktop, mobile, and preview vaults',
  'Sync and backup',
  'Updating a FirstPair vault',
  'Troubleshooting',
  'Publishing with Omnighost',
]

test('canonical handbook is comprehensive and the site page is current', () => {
  for (const section of sections) {
    assert.match(markdown, new RegExp(`## ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.ok(html.includes(section), `rendered handbook is missing ${section}`)
  }
  assert.match(html, /href="https:\/\/firstpair\.org\/read\/omnighost\/"/)
  assert.match(html, /href="https:\/\/obsidian\.md\/download"/)
  assert.match(markdown, /Previous page \| Previous word \| Up \| Back \| Top \| TOC \| Next word \| Next page/)
  assert.match(html, /Previous word/)
  assert.match(html, /Next word/)
  assert.doesNotMatch(html, /<link\b[^>]*rel=["']stylesheet["']/i)
})
