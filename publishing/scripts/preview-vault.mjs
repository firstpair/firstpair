#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { chromium } from '@playwright/test'


function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}


function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(
      /!?(?:\[\[)([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g,
      (_match, target, label) => `<a href="#">${label ?? target}</a>`,
    )
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}


function renderMarkdown(markdown) {
  const blocks = []
  let paragraph = []
  const flush = () => {
    if (paragraph.length) blocks.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      flush()
      const level = heading[1].length
      blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
    } else if (/^[-*]\s+/.test(line)) {
      flush()
      blocks.push(`<p class="list">• ${inlineMarkdown(line.replace(/^[-*]\s+/, ''))}</p>`)
    } else if (!line.trim()) {
      flush()
    } else if (!line.startsWith('<!--')) {
      paragraph.push(line.trim())
    }
  }
  flush()
  return blocks.join('\n')
}


function document(title, markdown) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title><style>
  :root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;background:#ece8df;color:#24231f;font:17px/1.58 Georgia,serif}
  main{width:min(100% - 32px,780px);margin:0 auto;padding:40px 0 72px}h1,h2,h3{font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.15;margin:1.5em 0 .55em}h1{font-size:clamp(2rem,6vw,3.4rem);margin-top:0}h2{font-size:1.55rem;border-top:1px solid #b9b1a2;padding-top:1em}a{color:#67451f;text-decoration-thickness:2px;text-underline-offset:3px;overflow-wrap:anywhere}code{overflow-wrap:anywhere;background:#ddd5c7;padding:.12em .3em;border-radius:4px}.list{padding-left:1.25em}@media(max-width:480px){body{font-size:16px}main{width:min(100% - 24px,780px);padding-top:24px}}
  @media(prefers-color-scheme:dark){body{background:#1e1d1a;color:#eee8dd}a{color:#e4b979}code{background:#34312b}h2{border-color:#554f45}}
  </style><main>${renderMarkdown(markdown)}</main>`
}


async function main() {
  const [vaultArg, outputArg] = process.argv.slice(2)
  if (!vaultArg || !outputArg) throw new Error('usage: preview-vault.mjs VAULT OUTPUT_DIRECTORY')
  const vault = resolve(vaultArg)
  const output = resolve(outputArg)
  await mkdir(output, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const results = []
  try {
    for (const note of ['Home.md', 'Guide.md']) {
      const markdown = await readFile(join(vault, note), 'utf8')
      if (!markdown.trim()) throw new Error(`${note} is empty`)
      for (const [viewport, size] of Object.entries({ desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } })) {
        const page = await browser.newPage({ viewport: size })
        await page.setContent(document(`${basename(vault)} — ${note}`, markdown), { waitUntil: 'load' })
        const metrics = await page.evaluate(() => ({
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          links: document.querySelectorAll('a').length,
          headings: document.querySelectorAll('h1,h2,h3').length,
        }))
        const screenshot = `${note.replace('.md', '').toLowerCase()}-${viewport}.png`
        await page.screenshot({ path: join(output, screenshot), fullPage: true })
        await page.close()
        if (metrics.horizontalOverflow || metrics.headings === 0 || (note === 'Home.md' && metrics.links === 0)) {
          throw new Error(`${note}/${viewport} failed visual structure: ${JSON.stringify(metrics)}`)
        }
        results.push({ note, viewport, screenshot, ...metrics })
      }
    }
  } finally {
    await browser.close()
  }
  const report = { schema: 'firstpair-vault-visual-qa-v1', vault, passed: true, results }
  await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}


await main()
