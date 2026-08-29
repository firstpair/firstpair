import { deliverableBooks } from '../deliverable-map.mjs'

const books = new Map(deliverableBooks.map((book) => [book.slug, book]))
const fieldByFormat = {
  pdf: 'pdf',
  epub: 'epub',
  vault: 'vault',
  'mobile-vault': 'mobileVault',
  emacs: 'emacs',
  cover: 'cover',
}

function requestParams(requestUrl) {
  const url = new URL(requestUrl, 'https://firstpair.org')
  const querySlug = url.searchParams.get('slug')
  const queryFormat = url.searchParams.get('format')
  const queryVersion = url.searchParams.get('version')

  if (querySlug || queryFormat) {
    return { slug: querySlug, format: queryFormat, version: queryVersion }
  }

  const parts = url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part))

  // /<slug>/<format>/ or, for a version of the title, /<slug>/<version>/<format>/
  if (parts.length >= 3) return { slug: parts[0], version: parts[1], format: parts[2] }
  const [slug, format] = parts
  return { slug, format, version: null }
}

export default async function handler(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD')
    response.statusCode = 405
    response.end('Method not allowed')
    return
  }

  const { slug, format, version } = requestParams(request.url)
  const field = fieldByFormat[format]

  if (!slug || !field) {
    response.statusCode = 400
    response.end('Expected /<book-slug>/(pdf|epub|vault|mobile-vault|emacs|cover)/ or /<book-slug>/<version>/(pdf|epub|vault|mobile-vault|emacs|cover)/')
    return
  }

  const book = books.get(slug)
  const holder = version ? book?.versions?.[version] : book
  const target = holder?.[field]

  if (!target) {
    response.statusCode = 404
    response.end('Deliverable not found')
    return
  }

  if (!URL.canParse(target)) {
    response.statusCode = 502
    response.end('Deliverable target is not an absolute URL')
    return
  }

  response.statusCode = 302
  response.setHeader('Location', target)
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'text/plain; charset=utf-8')

  if (request.method === 'HEAD') {
    response.end()
    return
  }

  response.end(`Redirecting to the current ${format.toUpperCase()} for ${book.title}.\n`)
}
