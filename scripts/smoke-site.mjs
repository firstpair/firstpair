import { chromium } from '@playwright/test'

const target = process.env.FIRSTPAIR_SITE_URL ?? 'http://127.0.0.1:5183/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await page.goto(target, { waitUntil: 'networkidle' })
await page.screenshot({ path: 'dist-prod/firstpair-site-smoke.png', fullPage: true })

const checks = await page.evaluate(() => {
  const links = [...document.querySelectorAll('a')].map((link) => link.getAttribute('href') ?? '')
  const readerLinks = [...document.querySelectorAll('a[href^="/read/"]')]
  const stage = document.querySelector('.press-stage')?.getBoundingClientRect()
  const cardCount = document.querySelectorAll('.book-card').length

  return {
    title: document.title,
    hasPdfLink: links.some((href) => /\/pdf\/?$/.test(href) || href.endsWith('.pdf')),
    hasEpubLink: links.some((href) => /\/epub\/?$/.test(href) || href.endsWith('.epub')),
    hasStablePdfLink: links.some((href) => /\/pdf\/?$/.test(href)),
    hasStableEpubLink: links.some((href) => /\/epub\/?$/.test(href)),
    hasBookPageLink: links.some((href) => href.startsWith('/books/')),
    hasHostedHtmlLink: links.some((href) => href.startsWith('/read/')),
    hasHostedChaptersLink: links.some((href) => href.startsWith('/read/') && href.includes('/chapters/')),
    hasHostedVaultGuideLink: links.some(
      (href) => href.startsWith('/read/') && href.endsWith('/guide/'),
    ),
    hasExternalHtmlDownloadLink: links.some(
      (href) => href.includes('public.blob.vercel-storage.com/books/') && href.includes('/html/'),
    ),
    hasExternalChapterDownloadLink: links.some(
      (href) => href.includes('public.blob.vercel-storage.com/books/') && href.includes('/chapters/'),
    ),
    hasExternalPdfDownloadLink: links.some(
      (href) => href.includes('public.blob.vercel-storage.com/books/') && href.includes('/pdf/'),
    ),
    hasExternalEpubDownloadLink: links.some(
      (href) => href.includes('public.blob.vercel-storage.com/books/') && href.includes('/epub/'),
    ),
    readerLinksOpenInNewTabs: readerLinks.every(
      (link) => link.target === '_blank' && link.relList.contains('noopener'),
    ),
    cardCount,
    stageWidth: Math.round(stage?.width ?? 0),
    stageHeight: Math.round(stage?.height ?? 0),
  }
})

await page.goto(new URL('/books/sail-rust-book/', target).href, { waitUntil: 'networkidle' })

const bookPageChecks = await page.evaluate(() => {
  const links = [...document.querySelectorAll('a')].map((link) => link.getAttribute('href') ?? '')
  const hero = document.querySelector('.book-detail__hero')?.getAttribute('style') ?? ''

  return {
    hasBookDetail: Boolean(document.querySelector('.book-detail')),
    title: document.querySelector('h1')?.textContent?.trim() ?? '',
    hasHeadboard: hero.includes('sail-rust-book-headboard.png'),
    hasDescription: (document.querySelector('.book-detail__copy p:not(.eyebrow)')?.textContent ?? '').includes('Sail'),
    hasStablePdfLink: links.includes('/sail-rust-book/pdf/'),
    hasStableEpubLink: links.includes('/sail-rust-book/epub/'),
    hasStableVaultLink: links.includes('/sail-rust-book/vault/'),
    hasReaderLink: links.includes('/read/sail-rust-book/'),
    hasChapterLink: links.includes('/read/sail-rust-book/chapters/'),
    hasVaultGuideLink: links.includes('/read/sail-rust-book/guide/'),
    hasPostLink: links.includes('https://firstpair.press/announcing-sail-rust-book'),
  }
})

await browser.close()

async function checkUrl(path) {
  const url = new URL(path, target).href
  let response = await fetch(url, { method: 'HEAD', redirect: 'follow' })

  if (response.status === 405 || response.status === 501) {
    response = await fetch(url, { method: 'GET', redirect: 'follow' })
  }

  return {
    path,
    url,
    status: response.status,
    ok: response.ok,
    contentDisposition: response.headers.get('content-disposition'),
  }
}

async function checkReaderBody(book, path) {
  const url = new URL(path, target).href
  const response = await fetch(url, {
    headers: {
      range: 'bytes=0-16383',
    },
    redirect: 'follow',
  })
  const body = await response.text()

  return {
    path,
    url,
    status: response.status,
    ok: response.ok,
    contentDisposition: response.headers.get('content-disposition'),
    bodyLength: body.length,
    hasBookTitle: body.includes(book.title),
    hasAppShell: body.includes('<div id="app"></div>'),
    hasLibraryLink: body.includes('First Pair Library') && body.includes('firstpair-library-link'),
  }
}

const catalogResponse = await fetch(new URL('catalog.json', target), { redirect: 'follow' })

if (!catalogResponse.ok) {
  throw new Error(`Catalog unavailable: ${catalogResponse.status}`)
}

const catalog = await catalogResponse.json()
const isLocalTarget = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(target)
const paths = catalog.books.flatMap((book) => {
  const htmlPath = isLocalTarget ? book.htmlSource : book.html
  const chaptersPath = isLocalTarget ? book.htmlChaptersSource : book.htmlChapters
  const guidePath = isLocalTarget
    ? (book.vaultGuideSource ?? book.vaultGuide)
    : book.vaultGuide
  const stableDeliverables = isLocalTarget
    ? []
    : [
        `/${book.slug}/pdf/`,
        `/${book.slug}/epub/`,
        book.vault ? `/${book.slug}/vault/` : null,
        book.cover ? `/${book.slug}/cover/` : null,
      ].filter(Boolean)

  return [
    book.homepage,
    book.pdf,
    book.epub,
    htmlPath,
    chaptersPath,
    book.cover,
    book.headboard,
    book.vault,
    guidePath,
    ...stableDeliverables,
  ].filter(Boolean)
})
const results = []

for (const path of paths) {
  results.push(await checkUrl(path))
}

const sampleReaderBook = catalog.books.find((book) => book.slug === 'lighthouse-republics') ?? catalog.books[0]
const sampleGuideBook = catalog.books.find((book) => book.vaultGuideSource)
const readerBodyChecks =
  isLocalTarget || !sampleReaderBook
    ? []
    : [
        await checkReaderBody(sampleReaderBook, sampleReaderBook.html),
        await checkReaderBody(sampleReaderBook, sampleReaderBook.htmlChapters),
        ...(sampleGuideBook
          ? [await checkReaderBody(sampleGuideBook, sampleGuideBook.vaultGuide)]
          : []),
      ]

const catalogChecks = {
  catalogCount: catalog.books.length,
  results,
  failed: results.filter((result) => !result.ok),
  downloadableReaders: isLocalTarget
    ? []
    : results.filter(
        (result) =>
          result.path.startsWith('/read/') &&
          /^attachment\b/i.test(result.contentDisposition ?? ''),
      ),
  readerBodyChecks,
  failedReaderBodies: readerBodyChecks.filter(
    (result) => !result.ok || !result.hasBookTitle || result.hasAppShell || !result.hasLibraryLink,
  ),
  hostedVaultGuideCount: catalog.books.filter((book) => book.vaultGuideSource).length,
}

if (checks.title !== 'First Pair') {
  throw new Error(`Unexpected title: ${checks.title}`)
}

if (!checks.hasPdfLink || !checks.hasEpubLink || !checks.hasHostedHtmlLink || !checks.hasHostedChaptersLink) {
  throw new Error(`Missing book artifact links: ${JSON.stringify(checks)}`)
}

if (!checks.hasStablePdfLink || !checks.hasStableEpubLink || !checks.hasBookPageLink) {
  throw new Error(`Missing stable library links: ${JSON.stringify(checks)}`)
}

if (checks.hasExternalHtmlDownloadLink || checks.hasExternalChapterDownloadLink) {
  throw new Error(`HTML reader links should stay on firstpair.org routes: ${JSON.stringify(checks)}`)
}

if (checks.hasExternalPdfDownloadLink || checks.hasExternalEpubDownloadLink) {
  throw new Error(`PDF/EPUB links should use stable FirstPair routes: ${JSON.stringify(checks)}`)
}

if (!checks.readerLinksOpenInNewTabs) {
  throw new Error(`HTML reader links should open in new tabs: ${JSON.stringify(checks)}`)
}

if (
  !bookPageChecks.hasBookDetail ||
  bookPageChecks.title !== 'Sail Rust Book' ||
  !bookPageChecks.hasHeadboard ||
  !bookPageChecks.hasDescription ||
  !bookPageChecks.hasStablePdfLink ||
  !bookPageChecks.hasStableEpubLink ||
  !bookPageChecks.hasStableVaultLink ||
  !bookPageChecks.hasReaderLink ||
  !bookPageChecks.hasChapterLink ||
  !bookPageChecks.hasVaultGuideLink ||
  !bookPageChecks.hasPostLink
) {
  throw new Error(`Book detail page smoke failed: ${JSON.stringify(bookPageChecks)}`)
}

if (catalogChecks.hostedVaultGuideCount > 0 && !checks.hasHostedVaultGuideLink) {
  throw new Error(`Missing hosted vault-guide link: ${JSON.stringify(checks)}`)
}

if (checks.cardCount < 6 || checks.stageWidth < 300 || checks.stageHeight < 400) {
  throw new Error(`Layout smoke failed: ${JSON.stringify(checks)}`)
}

if (catalogChecks.failed.length > 0) {
  throw new Error(`Catalog links failed: ${JSON.stringify(catalogChecks.failed)}`)
}

if (catalogChecks.downloadableReaders.length > 0) {
  throw new Error(
    `HTML readers should render inline: ${JSON.stringify(catalogChecks.downloadableReaders)}`,
  )
}

if (catalogChecks.failedReaderBodies.length > 0) {
  throw new Error(
    `HTML readers should return book content, not the app shell: ${JSON.stringify(
      catalogChecks.failedReaderBodies,
    )}`,
  )
}

console.log(JSON.stringify({ ...checks, bookPageChecks, ...catalogChecks }, null, 2))
