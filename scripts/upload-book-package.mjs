import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative } from 'node:path'
import { head, put } from '@vercel/blob'

const slug = process.argv[2]
const dryRun = process.argv.includes('--dry-run')
const verbose = process.argv.includes('--verbose')

if (!slug) {
  console.error('usage: npm run books:upload -- <book-slug> [--dry-run]')
  process.exit(2)
}

const root = new URL('..', import.meta.url).pathname
const publicDir = join(root, 'public')
const uploadsDir = join(root, 'book-uploads')
const catalogPath = join(publicDir, 'catalog.json')
const sourcesPath = join(uploadsDir, 'book-package-sources.json')
const manifestPath = join(uploadsDir, 'blob-manifest.json')

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
const sources = JSON.parse(await readFile(sourcesPath, 'utf8'))
const book = catalog.books.find((entry) => entry.slug === slug)
const sourceBook = sources.books?.[slug]

if (!book) {
  console.error(`unknown catalog slug: ${slug}`)
  process.exit(1)
}

if (!sourceBook) {
  console.error(`missing upload source map for catalog slug: ${slug}`)
  process.exit(1)
}

function parseEnv(text) {
  const values = {}

  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue
    }

    const index = line.indexOf('=')
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    value = value.replace(/^['"]|['"]$/g, '')
    values[key] = value
  }

  return values
}

const localEnv = parseEnv(
  await readFile(join(root, '.env.local'), 'utf8').catch(() => ''),
)
const oidcToken = process.env.VERCEL_OIDC_TOKEN ?? localEnv.VERCEL_OIDC_TOKEN
const storeId =
  process.env.BLOB_STORE_ID ??
  process.env.VERCEL_BLOB_STORE_ID ??
  localEnv.BLOB_STORE_ID ??
  localEnv.VERCEL_BLOB_STORE_ID
const readWriteToken = process.env.BLOB_READ_WRITE_TOKEN ?? localEnv.BLOB_READ_WRITE_TOKEN

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

async function sha256(path) {
  const hash = createHash('sha256')
  hash.update(await readFile(path))
  return hash.digest('hex')
}

async function fileInfo(path) {
  const [digest, fileStat] = await Promise.all([sha256(path), stat(path)])

  return {
    path,
    sha256: digest,
    size: fileStat.size,
  }
}

async function walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const path = join(dir, entry.name)
    const linkStat = await lstat(path)

    if (linkStat.isSymbolicLink()) {
      continue
    }

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(path)))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }

  return files.sort()
}

function contentType(path) {
  if (path.endsWith('.pdf')) return 'application/pdf'
  if (path.endsWith('.epub')) return 'application/epub+zip'
  if (path.endsWith('.html')) return 'text/html; charset=utf-8'
  if (path.endsWith('.css')) return 'text/css; charset=utf-8'
  if (path.endsWith('.json')) return 'application/json; charset=utf-8'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.zip')) return 'application/zip'
  if (path.endsWith('.md')) return 'text/markdown; charset=utf-8'
  return 'application/octet-stream'
}

function blobCommandOptions(extra = {}) {
  const options = { ...extra }

  if (readWriteToken) {
    options.token = readWriteToken
  } else if (oidcToken && storeId) {
    options.oidcToken = oidcToken
    options.storeId = storeId
  }

  return options
}

function scrubSecretText(value) {
  return String(value)
    .replaceAll(oidcToken ?? '', '[redacted-oidc-token]')
    .replaceAll(readWriteToken ?? '', '[redacted-rw-token]')
    .replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
}

async function findExistingBlob(pathname, expectedSize) {
  try {
    const blob = await head(pathname, blobCommandOptions())

    if (blob.size !== expectedSize) {
      throw new Error(
        `existing blob size mismatch for ${pathname}: expected ${expectedSize}, got ${blob.size}`,
      )
    }

    console.error(`found existing blob ${pathname}`)

    return { url: blob.url, skipped: true, dryRun: false }
  } catch (error) {
    if (error?.name === 'BlobNotFoundError' || error?.constructor?.name === 'BlobNotFoundError') {
      return null
    }

    throw new Error(`Blob lookup failed for ${pathname}:\n${scrubSecretText(error?.stack ?? error)}`)
  }
}

async function blobPut(path, pathname, expectedSize) {
  if (dryRun) {
    return { url: null, skipped: false, dryRun: true }
  }

  const existing = await findExistingBlob(pathname, expectedSize)

  if (existing) {
    return existing
  }

  const body = await readFile(path)
  const isLargeObject = body.byteLength >= 8 * 1024 * 1024
  const options = blobCommandOptions({
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: false,
    abortSignal: AbortSignal.timeout(10 * 60 * 1000),
    contentType: contentType(path),
    multipart: !path.endsWith('.html') && isLargeObject,
  })

  if (isLargeObject) {
    let lastProgressBucket = -1

    options.onUploadProgress = ({ percentage }) => {
      const bucket = Math.floor(percentage / 25)

      if (bucket > lastProgressBucket || percentage === 100) {
        lastProgressBucket = bucket
        console.error(`upload progress ${pathname} ${percentage}%`)
      }
    }
  }

  console.error(`uploading blob ${pathname}`)

  try {
    const blob = await put(pathname, body, options)

    return { url: blob.url, skipped: false, dryRun: false }
  } catch (error) {
    throw new Error(`Blob upload failed for ${path}:\n${scrubSecretText(error?.stack ?? error)}`)
  }
}

function objectKey(file) {
  return `${file.sha256}:${file.size}`
}

function displayPath(path) {
  const relativePath = relative(root, path)
  return relativePath.startsWith('..') ? path : relativePath
}

function sourcePath(value) {
  if (typeof value === 'string') {
    return { path: isAbsolute(value) ? value : join(root, value) }
  }

  if (value && typeof value.path === 'string') {
    return {
      path: isAbsolute(value.path) ? value.path : join(root, value.path),
      name: value.name,
    }
  }

  return null
}

function filePathname(kind, file, preferredName) {
  const name = preferredName ?? basename(file.path)
  return `books/${slug}/${kind}/${file.sha256.slice(0, 16)}-${name}`
}

function chapterDigest(files) {
  const hash = createHash('sha256')

  for (const file of files) {
    hash.update(file.relativePath)
    hash.update('\0')
    hash.update(file.sha256)
    hash.update('\0')
  }

  return hash.digest('hex')
}

async function uploadFileUnit(manifest, kind, source) {
  const file = await fileInfo(source.path)
  const key = objectKey(file)
  const existing = manifest.objects[key]

  if (existing) {
    return {
      kind,
      localPath: displayPath(source.path),
      sha256: file.sha256,
      size: file.size,
      pathname: existing.pathname,
      url: existing.url,
      skipped: true,
    }
  }

  const pathname = filePathname(kind, file, source.name)
  const uploaded = await blobPut(source.path, pathname, file.size)
  const record = {
    kind,
    localPath: displayPath(source.path),
    sha256: file.sha256,
    size: file.size,
    pathname,
    url: uploaded.url,
    skipped: uploaded.dryRun ? false : uploaded.skipped,
  }

  if (!dryRun) {
    manifest.objects[key] = {
      pathname,
      url: uploaded.url,
      size: file.size,
    }
  }

  return record
}

async function uploadChapterUnit(manifest, localDir) {
  const files = []

  for (const path of await walkFiles(localDir)) {
    files.push({
      ...(await fileInfo(path)),
      relativePath: relative(localDir, path),
    })
  }

  const digest = chapterDigest(files)
  const prefix = `books/${slug}/chapters/${digest.slice(0, 16)}`
  const existing = manifest.chapterPackages[digest]
  const records = []

  if (existing) {
    const existingFiles = existing.files.map((file) => ({
      ...file,
      localPath: displayPath(join(localDir, file.relativePath)),
    }))

    if (!dryRun) {
      existing.files = existingFiles
    }

    return {
      kind: 'htmlChapters',
      localPath: displayPath(localDir),
      sha256: digest,
      pathnamePrefix: existing.pathnamePrefix,
      url: existing.url,
      skipped: true,
      files: existingFiles,
    }
  }

  for (const file of files) {
    const pathname = `${prefix}/${file.relativePath}`
    const uploaded = await blobPut(file.path, pathname, file.size)
    records.push({
      localPath: displayPath(file.path),
      relativePath: file.relativePath,
      sha256: file.sha256,
      size: file.size,
      pathname,
      url: uploaded.url,
      skipped: uploaded.dryRun ? false : uploaded.skipped,
    })
  }

  const index = records.find((file) => file.relativePath === 'index.html')
  const record = {
    kind: 'htmlChapters',
    localPath: displayPath(localDir),
    sha256: digest,
    pathnamePrefix: prefix,
    url: index?.url ?? null,
    skipped: false,
    files: records,
  }

  if (!dryRun) {
    manifest.chapterPackages[digest] = {
      pathnamePrefix: prefix,
      url: record.url,
      files: records,
    }
  }

  return record
}

const manifest = await readJson(manifestPath, {
  version: 1,
  updatedAt: null,
  books: {},
  objects: {},
  chapterPackages: {},
})

const units = {}

for (const field of ['pdf', 'epub', 'html']) {
  const source = sourcePath(sourceBook[field])

  if (!source) {
    throw new Error(`book package source field ${field} is missing for ${slug}`)
  }

  units[field] = await uploadFileUnit(manifest, field, source)
}

const tutorialSource = sourcePath(sourceBook.tutorial)

if (tutorialSource) {
  units.tutorial = await uploadFileUnit(manifest, 'tutorial', tutorialSource)
}

const coverSource = sourcePath(sourceBook.cover)

if (coverSource) {
  units.cover = await uploadFileUnit(manifest, 'cover', coverSource)
}

const headboardSource = sourcePath(sourceBook.headboard)

if (headboardSource) {
  units.headboard = await uploadFileUnit(manifest, 'headboard', headboardSource)
}

const vaultSource = sourcePath(sourceBook.vault)

if (vaultSource) {
  units.vault = await uploadFileUnit(manifest, 'vault', vaultSource)
}

const vaultGuideHtmlSource = sourcePath(sourceBook.vaultGuideHtml)
const vaultGuideMarkdownSource = sourcePath(sourceBook.vaultGuideMarkdown)
const legacyVaultGuideSource = sourcePath(sourceBook.vaultGuide)

if (vaultGuideHtmlSource) {
  if (!vaultGuideHtmlSource.path.toLowerCase().endsWith('.html')) {
    throw new Error(`vaultGuideHtml must point to rendered HTML for ${slug}`)
  }

  if (!vaultGuideMarkdownSource) {
    throw new Error(`vaultGuideMarkdown is required beside vaultGuideHtml for ${slug}`)
  }

  if (!vaultGuideMarkdownSource.path.toLowerCase().endsWith('.md')) {
    throw new Error(`vaultGuideMarkdown must point to Markdown for ${slug}`)
  }

  await stat(vaultGuideMarkdownSource.path)
  units.vaultGuide = await uploadFileUnit(manifest, 'vault-guide', vaultGuideHtmlSource)
} else if (legacyVaultGuideSource) {
  // Migration compatibility for packages staged before rendered guides were
  // introduced. A fresh library:publish --vault run replaces this with the
  // hosted route + HTML source contract below.
  units.vaultGuide = await uploadFileUnit(manifest, 'vault-guide', legacyVaultGuideSource)
}

const chaptersSource = sourcePath(sourceBook.htmlChapters)

if (!chaptersSource) {
  throw new Error(`book package source field htmlChapters is missing for ${slug}`)
}

units.htmlChapters = await uploadChapterUnit(manifest, chaptersSource.path)

manifest.books[slug] = {
  updatedAt: new Date().toISOString(),
  dryRun,
  units,
}
manifest.updatedAt = new Date().toISOString()

if (!dryRun) {
  book.pdf = units.pdf.url
  book.epub = units.epub.url
  book.htmlSource = units.html.url
  book.htmlChaptersSource = units.htmlChapters.url
  book.html = `/read/${slug}/`
  book.htmlChapters = `/read/${slug}/chapters/`

  if (units.tutorial) {
    book.tutorialSource = units.tutorial.url
    book.tutorial = `/learn/${slug}/`
  }

  if (units.cover) {
    book.cover = units.cover.url
  }

  if (units.headboard) {
    book.headboard = units.headboard.url
  }

  if (units.vault) {
    book.vault = units.vault.url
  }

  if (units.vaultGuide) {
    if (vaultGuideHtmlSource) {
      book.vaultGuide = `/read/${slug}/guide/`
      book.vaultGuideSource = units.vaultGuide.url
    } else {
      book.vaultGuide = units.vaultGuide.url
    }
  }

  await mkdir(uploadsDir, { recursive: true })
  await writeFile(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`)
  await rename(`${manifestPath}.tmp`, manifestPath)
  await writeFile(`${catalogPath}.tmp`, `${JSON.stringify(catalog, null, 2)}\n`)
  await rename(`${catalogPath}.tmp`, catalogPath)
}

const result = manifest.books[slug]
const summary = {
  updatedAt: result.updatedAt,
  dryRun: result.dryRun,
  units: Object.fromEntries(
    Object.entries(result.units).map(([kind, unit]) => [
      kind,
      {
        localPath: unit.localPath,
        sha256: unit.sha256,
        size: unit.size,
        pathname: unit.pathname,
        pathnamePrefix: unit.pathnamePrefix,
        url: unit.url,
        skipped: unit.skipped,
        fileCount: unit.files?.length,
        uploadedFileCount: unit.skipped
          ? 0
          : unit.files?.filter((file) => !file.skipped).length,
      },
    ]),
  ),
}

console.log(JSON.stringify(verbose ? result : summary, null, 2))
