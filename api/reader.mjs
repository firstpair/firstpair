import { Readable } from 'node:stream'
import { readerBooks } from '../reader-map.mjs'

const books = new Map(readerBooks.map((book) => [book.slug, book]))
const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])
const libraryLinkStyle = `<style id="firstpair-library-link-style">
.firstpair-library-link {
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 2147483647;
  display: inline-flex;
  align-items: center;
  padding: 8px 12px;
  border: 1px solid rgba(20, 28, 42, 0.16);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #172033;
  box-shadow: 0 8px 24px rgba(20, 28, 42, 0.14);
  font: 600 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  text-decoration: none;
  backdrop-filter: blur(8px);
}
.firstpair-library-link:hover {
  background: #ffffff;
  color: #0b1220;
}
@media (prefers-color-scheme: dark) {
  .firstpair-library-link {
    border-color: rgba(255, 255, 255, 0.22);
    background: rgba(15, 23, 42, 0.88);
    color: #f8fafc;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
}
@media print {
  .firstpair-library-link {
    display: none !important;
  }
}
</style>`
const libraryLink = `<a class="firstpair-library-link" href="/" aria-label="Back to First Pair library">&larr; First Pair Library</a>`

function requestPathParts(requestUrl) {
  const url = new URL(requestUrl, 'https://firstpair.org')
  const path =
    url.searchParams.get('path') ?? url.pathname.replace(/^\/(?:api\/reader|read|learn)\/?/, '')

  return path
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part))
}

function requestArea(requestUrl) {
  const url = new URL(requestUrl, 'https://firstpair.org')

  if (url.searchParams.get('area') === 'tutorial' || url.pathname.startsWith('/learn/')) {
    return 'tutorial'
  }

  return null
}

function encodePathParts(parts) {
  return parts.map((part) => encodeURIComponent(part)).join('/')
}

function targetUrl(parts, search, areaOverride = null) {
  const [slug, area, ...rest] = parts
  const book = books.get(slug)

  if (!book) {
    return null
  }

  if (areaOverride === 'tutorial') {
    if (area || !book.tutorialSource) {
      return null
    }

    return { url: `${book.tutorialSource}${search}`, kind: 'html', book }
  }

  if (!area) {
    return { url: `${book.htmlSource}${search}`, kind: 'html', book }
  }

  if (area === 'guide') {
    if (rest.length > 0 || !book.vaultGuideSource) {
      return null
    }

    return { url: `${book.vaultGuideSource}${search}`, kind: 'html', book }
  }

  if (area !== 'chapters') {
    return null
  }

  if (rest.length === 0) {
    return { url: `${book.htmlChaptersSource}${search}`, kind: 'html', book }
  }

  return {
    url: `${book.htmlChaptersBase}/${encodePathParts(rest)}${search}`,
    kind: 'html',
    book,
  }
}

function contentSecurityPolicy(area = null) {
  const directives = [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "media-src 'self' data:",
    "font-src 'self' data:",
  ]

  if (area === 'tutorial') {
    // Interactive tutorials are self-contained single-file HTML driven by an
    // inline script; allow it only on /learn routes.
    directives.push("script-src 'self' 'unsafe-inline'")
  }

  return directives.join('; ')
}

function htmlTarget(url) {
  return new URL(url).pathname.endsWith('.html')
}

function injectLibraryLink(html) {
  if (html.includes('firstpair-library-link')) {
    return html
  }

  let nextHtml = html.replace(/<\/head\s*>/i, `${libraryLinkStyle}\n</head>`)

  if (nextHtml === html) {
    nextHtml = `${libraryLinkStyle}\n${nextHtml}`
  }

  const withBodyLink = nextHtml.replace(/<body\b([^>]*)>/i, `<body$1>\n${libraryLink}`)

  if (withBodyLink === nextHtml) {
    return `${libraryLink}\n${nextHtml}`
  }

  return withBodyLink
}

function setResponseHeaders(upstream, response, { modifiedHtml = false, area = null } = {}) {
  for (const [key, value] of upstream.headers.entries()) {
    const normalizedKey = key.toLowerCase()

    if (
      hopByHopHeaders.has(normalizedKey) ||
      normalizedKey === 'content-disposition' ||
      normalizedKey === 'content-security-policy' ||
      normalizedKey === 'content-encoding' ||
      normalizedKey === 'content-length' ||
      (modifiedHtml &&
        ['accept-ranges', 'content-range', 'etag', 'last-modified'].includes(normalizedKey))
    ) {
      continue
    }

    response.setHeader(key, value)
  }

  response.setHeader('Content-Disposition', 'inline')
  response.setHeader('Content-Security-Policy', contentSecurityPolicy(area))

  if (modifiedHtml) {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
  }
}

export default async function handler(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD')
    response.statusCode = 405
    response.end('Method not allowed')
    return
  }

  let parts

  try {
    parts = requestPathParts(request.url)
  } catch {
    response.statusCode = 400
    response.end('Malformed reader path')
    return
  }

  const url = new URL(request.url, 'https://firstpair.org')
  const upstreamSearch = new URLSearchParams(url.searchParams)
  upstreamSearch.delete('path')
  upstreamSearch.delete('area')

  const area = requestArea(request.url)
  const target = targetUrl(parts, upstreamSearch.size ? `?${upstreamSearch}` : '', area)

  if (!target) {
    response.statusCode = 404
    response.end('Reader page not found')
    return
  }

  const shouldModifyHtml = target.kind === 'html' && htmlTarget(target.url)
  const headers = {
    'accept-encoding': 'identity',
  }

  if (!shouldModifyHtml && request.headers.range) {
    headers.range = request.headers.range
  }

  const upstream = await fetch(target.url, {
    method: request.method,
    headers,
    redirect: 'follow',
  })

  response.statusCode = upstream.status
  setResponseHeaders(upstream, response, {
    modifiedHtml: shouldModifyHtml && upstream.ok,
    area,
  })

  if (request.method === 'HEAD' || !upstream.body) {
    response.end()
    return
  }

  if (shouldModifyHtml && upstream.ok) {
    const html = injectLibraryLink(await upstream.text())
    response.end(html)
    return
  }

  Readable.fromWeb(upstream.body).pipe(response)
}
