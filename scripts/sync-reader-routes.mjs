import { readFile, writeFile } from 'node:fs/promises'

const root = new URL('..', import.meta.url).pathname
const catalogPath = `${root}/public/catalog.json`
const readerMapPath = `${root}/reader-map.mjs`
const deliverableMapPath = `${root}/deliverable-map.mjs`
const vercelPath = `${root}/vercel.json`

function hostedHtmlPath(slug) {
  return `/read/${slug}/`
}

function hostedChaptersPath(slug) {
  return `/read/${slug}/chapters/`
}

function hostedGuidePath(slug) {
  return `/read/${slug}/guide/`
}

function hostedEmacsGuidePath(slug) {
  return `/read/${slug}/emacs-guide/`
}

// A version of a title (a language edition, say) lives one segment deeper:
// /read/<slug>/<version>/…, /<slug>/<version>/<format>/.
function versionPrefix(slug, versionId) {
  return `${slug}/${versionId}`
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
      src: '^/([A-Za-z0-9-]+)/(pdf|epub|vault|mobile-vault|emacs|cover)/?$',
      dest: '/api/deliverable?slug=$1&format=$2',
    },
    {
      src: '^/([A-Za-z0-9-]+)/([A-Za-z0-9-]+)/(pdf|epub|vault|mobile-vault|emacs|cover)/?$',
      dest: '/api/deliverable?slug=$1&version=$2&format=$3',
    },
    {
      src: '^/obsidian/?$',
      dest: '/obsidian/index.html',
    },
    {
      src: '^/emacs/?$',
      dest: '/emacs/index.html',
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

    if (book.vaultGuideSource) {
      entry.vaultGuideSource = book.vaultGuideSource
    }

    if (book.emacsGuideSource) {
      entry.emacsGuideSource = book.emacsGuideSource
    }

    if (book.versions?.length) {
      entry.versions = Object.fromEntries(book.versions.map((version) => {
        const item = {
          htmlSource: version.htmlSource,
          htmlChaptersSource: normalizeIndexUrl(version.htmlChaptersSource),
          htmlChaptersBase: chapterBase(version.htmlChaptersSource),
        }
        if (version.vaultGuideSource) item.vaultGuideSource = version.vaultGuideSource
        if (version.emacsGuideSource) item.emacsGuideSource = version.emacsGuideSource
        return [version.id, item]
      }))
    }

    return entry
  })
}

function deliverableMap(books) {
  return books.map((book) => {
    const entry = {
      slug: book.slug,
      title: book.title,
      pdf: book.pdf,
      epub: book.epub,
    }

    if (book.vault) {
      entry.vault = book.vault
    }

    if (book.mobileVault) {
      entry.mobileVault = book.mobileVault
    }

    if (book.emacs) {
      entry.emacs = book.emacs
    }

    if (book.cover) {
      entry.cover = book.cover
    }

    if (book.versions?.length) {
      entry.versions = Object.fromEntries(book.versions.map((version) => {
        const item = { pdf: version.pdf, epub: version.epub }
        for (const field of ['vault', 'mobileVault', 'emacs', 'cover']) if (version[field]) item[field] = version[field]
        return [version.id, item]
      }))
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

  if (book.tutorialSource?.startsWith('https://')) {
    book.tutorial = `/learn/${book.slug}/`
  }

  if (book.vaultGuideSource?.startsWith('https://')) {
    book.vaultGuide = hostedGuidePath(book.slug)
  } else if (book.vaultGuide?.startsWith('/read/')) {
    throw new Error(`missing external vaultGuideSource for ${book.slug}`)
  }

  if (book.emacsGuideSource?.startsWith('https://')) {
    book.emacsGuide = hostedEmacsGuidePath(book.slug)
  } else if (book.emacsGuide) {
    throw new Error(`missing external emacsGuideSource for ${book.slug}`)
  }

  for (const version of book.versions ?? []) {
    const prefix = versionPrefix(book.slug, version.id)
    if (!version.htmlSource?.startsWith('https://')) throw new Error(`missing external htmlSource for ${prefix}`)
    if (!version.htmlChaptersSource?.startsWith('https://')) throw new Error(`missing external htmlChaptersSource for ${prefix}`)
    version.html = hostedHtmlPath(prefix)
    version.htmlChapters = hostedChaptersPath(prefix)
    if (version.vaultGuideSource?.startsWith('https://')) version.vaultGuide = hostedGuidePath(prefix)
    else if (version.vaultGuide) throw new Error(`missing external vaultGuideSource for ${prefix}`)
    if (version.emacsGuideSource?.startsWith('https://')) version.emacsGuide = hostedEmacsGuidePath(prefix)
    else if (version.emacsGuide) throw new Error(`missing external emacsGuideSource for ${prefix}`)
  }
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
await writeFile(
  deliverableMapPath,
  `export const deliverableBooks = ${JSON.stringify(deliverableMap(catalog.books), null, 2)}\n`,
)
await writeFile(vercelPath, `${JSON.stringify(vercel, null, 2)}\n`)

console.log(
  JSON.stringify(
    {
      books: catalog.books.map((book) => book.slug),
      readerRouteCount: vercel.routes.length,
      deliverableCount: catalog.books.length,
    },
    null,
    2,
  ),
)
