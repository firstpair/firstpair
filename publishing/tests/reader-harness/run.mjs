import { chromium, devices } from '@playwright/test'
const out = process.env.SHOTS ?? 'publishing/tests/reader-harness/shots'
import { mkdirSync } from 'node:fs'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const report = []
async function run(name, contextOptions, url, steps) {
  const context = await browser.newContext(contextOptions)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(url)
  await page.waitForSelector('.firstpair-reader__strip', { timeout: 15000 })
  await page.evaluate(() => localStorage.clear())
  try { await steps(page, name) } catch (error) { report.push({ name, failed: String(error).split('\n')[0] }) }
  report.push({ name, errors })
  await context.close()
}
const state = async (page) => page.evaluate(() => {
  const d = document.querySelector('.firstpair-reader__drawer'); const r = d.getBoundingClientRect()
  const cells = [...document.querySelectorAll('.firstpair-reader__strip')][0].querySelectorAll('.firstpair-reader__cell')
  const cr = [...cells].map((c) => { const b = c.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)] })
  const pageEl = document.querySelector('.firstpair-reader__page')
  return { hidden: d.hasAttribute('hidden'), drawer: [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.height)], cells: cr, layout: pageEl.className.replace('firstpair-reader__page firstpair-reader__page--parallel', '').trim(), label: document.querySelector('.firstpair-reader__layout-toggle')?.textContent, win: window.innerWidth }
})
const word = async (page, text) => page.locator('.firstpair-reader__word', { hasText: new RegExp(`^${text}$`) }).first().click()

await run('desktop', { viewport: { width: 1400, height: 900 } }, 'http://localhost:8765/harness/index.html', async (page, name) => {
  await page.screenshot({ path: `${out}/${name}-1-open.png` })
  await word(page, 'mezzo'); await page.waitForTimeout(300)
  report.push({ name, step: 'word clicked, 3 columns', ...(await state(page)) })
  await page.screenshot({ path: `${out}/${name}-2-drawer.png` })
  await page.locator('.firstpair-reader__drawer-close').click(); await page.waitForTimeout(200)
  report.push({ name, step: 'after Close', ...(await state(page)) })
  // English off: reserved column, drawer over the empty track
  await page.locator('.firstpair-reader__language-toggle input').nth(1).click(); await page.waitForTimeout(300)
  await word(page, 'mezzo'); await page.waitForTimeout(300)
  report.push({ name, step: 'English off + word', ...(await state(page)) })
  await page.screenshot({ path: `${out}/${name}-3-reserved.png` })
  await page.locator('.firstpair-reader__layout-toggle').click(); await page.waitForTimeout(200)
  await page.locator('.firstpair-reader__layout-toggle').click(); await page.waitForTimeout(300)
  report.push({ name, step: 'stacked', ...(await state(page)) })
  await page.screenshot({ path: `${out}/${name}-4-stacked.png` })
  await page.locator('.firstpair-reader__layout-toggle').click(); await page.waitForTimeout(200)
  await page.locator('.firstpair-reader__layout-toggle').click(); await page.waitForTimeout(300)
  await word(page, 'selva'); await page.waitForTimeout(300)
  report.push({ name, step: 'back to columns, new word', ...(await state(page)) })
  await page.screenshot({ path: `${out}/${name}-5-columns-again.png` })
})
const iphone = devices['iPhone 13']
await run('phone-portrait', { ...iphone }, 'http://localhost:8765/harness/index.html?mobile', async (page, name) => {
  await page.screenshot({ path: `${out}/${name}-1-open.png` })
  report.push({ name, step: 'open', ...(await state(page)) })
  await word(page, 'mezzo'); await page.waitForTimeout(300)
  report.push({ name, step: 'word', ...(await state(page)) })
  await page.screenshot({ path: `${out}/${name}-2-drawer.png` })
  await page.locator('.firstpair-reader__drawer-close').tap(); await page.waitForTimeout(200)
  report.push({ name, step: 'after Close (tap)', ...(await state(page)) })
  await page.locator('.firstpair-reader__layout-toggle').tap(); await page.waitForTimeout(300)
  report.push({ name, step: 'layout tapped once', ...(await state(page)) })
  await page.screenshot({ path: `${out}/${name}-3-columns.png` })
})
await run('phone-landscape', { ...iphone, viewport: { width: 844, height: 390 } }, 'http://localhost:8765/harness/index.html?mobile', async (page, name) => {
  report.push({ name, step: 'open', ...(await state(page)) })
  await word(page, 'mezzo'); await page.waitForTimeout(300)
  report.push({ name, step: 'word', ...(await state(page)) })
  await page.screenshot({ path: `${out}/${name}-2-drawer.png` })
  await page.locator('.firstpair-reader__drawer-close').tap(); await page.waitForTimeout(200)
  report.push({ name, step: 'after Close (tap)', ...(await state(page)) })
})
await browser.close()
console.log(JSON.stringify(report, null, 1))
