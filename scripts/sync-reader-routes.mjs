import { readFile, writeFile } from 'node:fs/promises'

const root = new URL('..', import.meta.url).pathname
const catalogPath = `${root}/public/catalog.json`
const readerMapPath = `${root}/reader-map.mjs`
const vercelPath = `${root}/vercel.json`

function hostedHtmlPath(slug) {
  return `/read/${slug}/`
}

function hostedChaptersPath(slug) {
  return `/read/${slug}/chapters/`
}

function normalizeIndexUrl(url) {
  return url.endsWith('/index.html') ? url : `${url.replace(/\/$/, '')}/index.html`
}

function chapterBase(url) {
  return normalizeIndexUrl(url).replace(/\/index\.html$/, '')
}

function readerRoutes() {
  return [
    {
      src: '^/read(?:/(.*))?$',
      dest: '/api/reader?path=$1',
    },
    {
      src: '^/learn(?:/(.*))?$',
      dest: '/api/reader?path=$1&area=tutorial',
    },
    {
      handle: 'filesystem',
    },
    {
      src: '^/(.*)$',
      dest: '/index.html',
    },
  ]
}

function readerMap(books) {
  return books.map((book) => {
    const entry = {
      slug: book.slug,
      htmlSource: book.htmlSource,
      htmlChaptersSource: normalizeIndexUrl(book.htmlChaptersSource),
      htmlChaptersBase: chapterBase(book.htmlChaptersSource),
    }

    if (book.tutorialSource) {
      entry.tutorialSource = book.tutorialSource
    }

    return entry
  })
}

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
const previousVercel = JSON.parse(await readFile(vercelPath, 'utf8'))
const previousRewriteDestinations = new Map(
  (previousVercel.rewrites ?? []).map((rewrite) => [rewrite.source, rewrite.destination]),
)

for (const book of catalog.books) {
  if (!book.htmlSource?.startsWith('https://')) {
    const previousHtmlDestination = previousRewriteDestinations.get(`/read/${book.slug}/`)

    if (previousHtmlDestination?.startsWith('https://')) {
      book.htmlSource = previousHtmlDestination
    }
  }

  if (!book.htmlSource?.startsWith('https://')) {
    book.htmlSource = book.html
  }

  if (!book.htmlChaptersSource?.startsWith('https://')) {
    const previousChaptersDestination = previousRewriteDestinations.get(`/read/${book.slug}/chapters/`)

    if (previousChaptersDestination?.startsWith('https://')) {
      book.htmlChaptersSource = previousChaptersDestination
    }
  }

  if (!book.htmlChaptersSource?.startsWith('https://')) {
    book.htmlChaptersSource = book.htmlChapters
  }

  if (!book.htmlSource?.startsWith('https://')) {
    throw new Error(`missing external htmlSource for ${book.slug}`)
  }

  if (!book.htmlChaptersSource?.startsWith('https://')) {
    throw new Error(`missing external htmlChaptersSource for ${book.slug}`)
  }

  book.html = hostedHtmlPath(book.slug)
  book.htmlChapters = hostedChaptersPath(book.slug)
}

const vercel = JSON.parse(await readFile(vercelPath, 'utf8'))
delete vercel.headers
delete vercel.rewrites
vercel.routes = readerRoutes()

await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
await writeFile(
  readerMapPath,
  `export const readerBooks = ${JSON.stringify(readerMap(catalog.books), null, 2)}\n`,
)
await writeFile(vercelPath, `${JSON.stringify(vercel, null, 2)}\n`)

console.log(
  JSON.stringify(
    {
      books: catalog.books.map((book) => book.slug),
      readerRouteCount: vercel.routes.length,
    },
    null,
    2,
  ),
)
