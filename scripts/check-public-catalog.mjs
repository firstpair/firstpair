import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const publicDir = join(root, 'public')
const catalogPath = join(publicDir, 'catalog.json')
const vercelPath = join(root, 'vercel.json')

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
const vercel = JSON.parse(await readFile(vercelPath, 'utf8'))
const routeDestinations = new Map(
  (vercel.routes ?? []).filter((route) => route.src).map((route) => [route.src, route.dest]),
)
const hasReaderProxyRoute = routeDestinations.get('^/read(?:/(.*))?$') === '/api/reader?path=$1'
const hasTutorialProxyRoute =
  routeDestinations.get('^/learn(?:/(.*))?$') === '/api/reader?path=$1&area=tutorial'
const hasDeliverableProxyRoute =
  routeDestinations.get('^/([A-Za-z0-9-]+)/(pdf|epub|vault|cover)/?$') ===
  '/api/deliverable?slug=$1&format=$2'
const hasFilesystemRoute = (vercel.routes ?? []).some((route) => route.handle === 'filesystem')
const hasAppFallbackRoute = routeDestinations.get('^/(.*)$') === '/index.html'
const { readerBooks } = await import('../reader-map.mjs')
const { deliverableBooks } = await import('../deliverable-map.mjs')
const readerMapEntries = new Map(readerBooks.map((book) => [book.slug, book]))
const deliverableMapEntries = new Map(deliverableBooks.map((book) => [book.slug, book]))
const catalogSlugs = new Set(catalog.books.map((book) => book.slug))
const publicEntries = await readdir(publicDir)
const publicBookSlugs = []

for (const entry of publicEntries) {
  const entryPath = join(publicDir, entry)

  if ((await stat(entryPath)).isDirectory()) {
    publicBookSlugs.push(entry)
  }
}

publicBookSlugs.sort()

const missingFromCatalog = publicBookSlugs.filter((slug) => !catalogSlugs.has(slug))
const staleCatalogEntries = [...catalogSlugs].filter((slug) => !publicBookSlugs.includes(slug))
const requiredFields = ['pdf', 'epub', 'html', 'htmlChapters', 'htmlSource', 'htmlChaptersSource']
const missingFields = Object.fromEntries(
  requiredFields.map((field) => [
    field,
    catalog.books.filter((book) => !book[field]).map((book) => book.slug),
  ]),
)
const missingLocalPaths = []
const invalidReaderRoutes = []
const staleReaderMap = []
const invalidSourceUrls = []
const invalidTutorialRoutes = []
const invalidVaultGuideRoutes = []
const invalidPreviewSources = []
const invalidPostUrls = []
const validShelves = new Set(['history', 'music', 'technology', 'publishing', 'querygraph', 'other'])
const invalidShelves = []
const staleDeliverableMap = []

for (const book of catalog.books) {
  if (book.shelf && !validShelves.has(book.shelf)) {
    invalidShelves.push({ slug: book.slug, shelf: book.shelf })
  }

  if ((book.homepage || book.tags?.includes('preview')) && book.source) {
    invalidPreviewSources.push({ slug: book.slug, source: book.source })
  }

  if (book.html !== `/read/${book.slug}/`) {
    invalidReaderRoutes.push({ slug: book.slug, field: 'html', path: book.html })
  }

  if (book.htmlChapters !== `/read/${book.slug}/chapters/`) {
    invalidReaderRoutes.push({ slug: book.slug, field: 'htmlChapters', path: book.htmlChapters })
  }

  // Tutorial is an optional deliverable. When present, the hosted route and its
  // backing Blob source must both be set and consistent.
  if (book.tutorial || book.tutorialSource) {
    if (book.tutorial !== `/learn/${book.slug}/`) {
      invalidTutorialRoutes.push({ slug: book.slug, field: 'tutorial', path: book.tutorial })
    }

    if (!book.tutorialSource?.startsWith('https://')) {
      invalidSourceUrls.push({ slug: book.slug, field: 'tutorialSource', url: book.tutorialSource })
    }
  }

  // New vault guides use the reader proxy just like book HTML. Legacy
  // Markdown Blob links remain valid during migration, but any entry with a
  // vaultGuideSource must expose the canonical hosted route.
  if (book.vaultGuide || book.vaultGuideSource) {
    if (book.vaultGuideSource) {
      if (book.vaultGuide !== `/read/${book.slug}/guide/`) {
        invalidVaultGuideRoutes.push({
          slug: book.slug,
          field: 'vaultGuide',
          path: book.vaultGuide,
        })
      }

      if (!book.vaultGuideSource.startsWith('https://')) {
        invalidSourceUrls.push({
          slug: book.slug,
          field: 'vaultGuideSource',
          url: book.vaultGuideSource,
        })
      } else if (
        !URL.canParse(book.vaultGuideSource) ||
        !new URL(book.vaultGuideSource).pathname.toLowerCase().endsWith('.html')
      ) {
        invalidVaultGuideRoutes.push({
          slug: book.slug,
          field: 'vaultGuideSource',
          path: book.vaultGuideSource,
        })
      }
    } else if (!book.vaultGuide?.startsWith('https://')) {
      invalidVaultGuideRoutes.push({
        slug: book.slug,
        field: 'vaultGuide',
        path: book.vaultGuide,
      })
    }
  }

  if (book.vault && !book.vault.startsWith('https://')) {
    invalidSourceUrls.push({ slug: book.slug, field: 'vault', url: book.vault })
  }

  if (book.headboard) {
    if (book.headboard.startsWith('/')) {
      const publicPath = join(publicDir, book.headboard.replace(/^\/+/, ''))

      try {
        await stat(publicPath)
      } catch {
        missingLocalPaths.push({ slug: book.slug, field: 'headboard', path: book.headboard })
      }
    } else if (!book.headboard.startsWith('https://')) {
      invalidSourceUrls.push({ slug: book.slug, field: 'headboard', url: book.headboard })
    }
  }

  if (book.post && !book.post.startsWith('https://firstpair.press/')) {
    invalidPostUrls.push({ slug: book.slug, post: book.post })
  }

  for (const field of ['htmlSource', 'htmlChaptersSource']) {
    if (!book[field]?.startsWith('https://')) {
      invalidSourceUrls.push({ slug: book.slug, field, url: book[field] })
    }
  }

  const expectedChaptersIndex = book.htmlChaptersSource
  const expectedChaptersBase = expectedChaptersIndex.replace(/\/index\.html$/, '')

  const readerMapEntry = readerMapEntries.get(book.slug)
  const expectedTutorialSource = book.tutorialSource ?? undefined
  const expectedVaultGuideSource = book.vaultGuideSource ?? undefined

  if (
    !readerMapEntry ||
    readerMapEntry.htmlSource !== book.htmlSource ||
    readerMapEntry.htmlChaptersSource !== expectedChaptersIndex ||
    readerMapEntry.htmlChaptersBase !== expectedChaptersBase ||
    (readerMapEntry.tutorialSource ?? undefined) !== expectedTutorialSource ||
    (readerMapEntry.vaultGuideSource ?? undefined) !== expectedVaultGuideSource
  ) {
    staleReaderMap.push({
      slug: book.slug,
      expected: {
        htmlSource: book.htmlSource,
        htmlChaptersSource: expectedChaptersIndex,
        htmlChaptersBase: expectedChaptersBase,
        tutorialSource: expectedTutorialSource,
        vaultGuideSource: expectedVaultGuideSource,
      },
      actual: readerMapEntry,
    })
  }

  const deliverableMapEntry = deliverableMapEntries.get(book.slug)
  const expectedDeliverables = {
    slug: book.slug,
    title: book.title,
    pdf: book.pdf,
    epub: book.epub,
    ...(book.vault ? { vault: book.vault } : {}),
    ...(book.cover ? { cover: book.cover } : {}),
  }

  if (
    !deliverableMapEntry ||
    JSON.stringify(deliverableMapEntry) !== JSON.stringify(expectedDeliverables)
  ) {
    staleDeliverableMap.push({
      slug: book.slug,
      expected: expectedDeliverables,
      actual: deliverableMapEntry,
    })
  }

  for (const field of ['homepage', ...requiredFields]) {
    const value = book[field]

    if (!value || !value.startsWith('/')) {
      continue
    }

    if (value.startsWith('/read/') || value.startsWith('/learn/')) {
      continue
    }

    const publicPath = join(publicDir, value.replace(/^\/+/, ''))

    try {
      await stat(publicPath)
    } catch {
      missingLocalPaths.push({ slug: book.slug, field, path: value })
    }
  }
}

const hasMissingFields = Object.values(missingFields).some((slugs) => slugs.length > 0)

if (
  missingFromCatalog.length ||
  staleCatalogEntries.length ||
  hasMissingFields ||
  missingLocalPaths.length ||
  invalidReaderRoutes.length ||
  invalidTutorialRoutes.length ||
  invalidVaultGuideRoutes.length ||
  invalidPreviewSources.length ||
  invalidPostUrls.length ||
  invalidShelves.length ||
  staleReaderMap.length ||
  staleDeliverableMap.length ||
  invalidSourceUrls.length ||
  !hasReaderProxyRoute ||
  !hasTutorialProxyRoute ||
  !hasDeliverableProxyRoute ||
  !hasFilesystemRoute ||
  !hasAppFallbackRoute
) {
  console.error(
    JSON.stringify(
      {
        missingFromCatalog,
        staleCatalogEntries,
        missingFields,
        missingLocalPaths,
        invalidReaderRoutes,
        invalidTutorialRoutes,
        invalidVaultGuideRoutes,
        invalidPreviewSources,
        invalidPostUrls,
        invalidShelves,
        staleReaderMap,
        staleDeliverableMap,
        invalidSourceUrls,
        hasReaderProxyRoute,
        hasTutorialProxyRoute,
        hasDeliverableProxyRoute,
        hasFilesystemRoute,
        hasAppFallbackRoute,
      },
      null,
      2,
    ),
  )
  process.exit(1)
}

console.log(
  JSON.stringify(
    {
      publicBooks: publicBookSlugs,
      catalogBooks: catalog.books.map((book) => book.slug),
      count: catalog.books.length,
    },
    null,
    2,
  ),
)
