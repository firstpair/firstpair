#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderVaultGuide } from './render-vault-guide.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'publishing', 'vault', 'guides', 'master.md')
const destination = join(root, 'public', 'obsidian', 'index.html')
const applicationModule = join(root, 'src', 'generated', 'obsidian-handbook.ts')

await renderVaultGuide({
  source,
  destination,
  title: 'The FirstPair Guide to Reading Books in Obsidian',
  resourcePaths: [root],
})

const rendered = await readFile(destination, 'utf8')
const html = `${rendered.replace(/[ \t]+$/gm, '').trimEnd()}\n`
await writeFile(destination, html)
const embeddedStyles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
  .map((match) => `<style>${match[1]}</style>`)
  .join('\n')
const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1]
if (!body) throw new Error('Obsidian handbook has no HTML body')
await mkdir(dirname(applicationModule), { recursive: true })
await writeFile(
  applicationModule,
  `// Generated from publishing/vault/guides/master.md. Do not edit.\nexport const obsidianHandbookHtml = ${JSON.stringify(`${embeddedStyles}\n${body}`)}\n`,
)
const required = [
  'Install Obsidian',
  'Your first five minutes',
  'The FirstPair Reader',
  'Desktop, mobile, and preview vaults',
  'Updating a FirstPair vault',
  'Publishing with Omnighost',
]
for (const heading of required) {
  if (!html.includes(heading)) throw new Error(`Obsidian handbook is missing: ${heading}`)
}
console.log(destination)
console.log(applicationModule)
