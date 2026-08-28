#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderVaultGuide } from './render-vault-guide.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'publishing', 'emacs', 'guides', 'master.md')
const destination = join(root, 'public', 'emacs', 'index.html')
const applicationModule = join(root, 'src', 'generated', 'emacs-handbook.ts')

await renderVaultGuide({
  source,
  destination,
  title: 'The FirstPair Guide to Reading Books in Emacs',
  resourcePaths: [root],
})

const rendered = await readFile(destination, 'utf8')
const html = `${rendered.replace(/[ \t]+$/gm, '').trimEnd()}\n`
await writeFile(destination, html)
const embeddedStyles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
  .map((match) => `<style>${match[1]}</style>`)
  .join('\n')
const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1]
if (!body) throw new Error('Emacs handbook has no HTML body')
await mkdir(dirname(applicationModule), { recursive: true })
await writeFile(
  applicationModule,
  `// Generated from publishing/emacs/guides/master.md. Do not edit.\nexport const emacsHandbookHtml = ${JSON.stringify(`${embeddedStyles}\n${body}`)}\n`,
)
const required = [
  'Install Emacs',
  'Open the book',
  'Install the reader once, for every FirstPair book',
  'Your first five minutes',
  'References open below the text',
  'The dictionary window',
  'Reading without the FirstPair reader',
  'Add the manuals to Info',
  'Updating a FirstPair bundle',
]
for (const heading of required) {
  if (!html.includes(heading)) throw new Error(`Emacs handbook is missing: ${heading}`)
}
console.log(destination)
console.log(applicationModule)
