import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const root = dirname(scriptDir)

const booleanFlags = new Set([
  'dry-run',
  'stage-only',
  'no-upload',
  'no-icloud',
  'no-check',
  'no-build',
  'no-smoke',
  'no-deploy',
  'smoke',
  'full',
  'verbose',
  'help',
])
const valueFlags = new Set([
  'slug',
  'title',
  'description',
  'source',
  'shelf',
  'kicker',
  'accent',
  'tags',
  'tag',
  'icloud-dir',
  'tutorial',
])

function usage() {
  console.error(`usage: npm run library:publish -- <book-dir> [options]

Publishes a built book directory into the First Pair library.

The input may be a dist directory or a repo/book directory containing one of:
  book.build.json (the configured dist is preferred)
  dist/
  build/dist/
  book/
  docs/book/dist/
  docs/book/build/dist/
  docs/books/<slug>/dist/

A book may split its build output into dist-preview/ and dist-full/ (each a
publish-complete directory with a VERSION.md carrying "edition: preview|full").
Without --full the preview edition is selected; --full selects the full edition.
Publishing the FULL edition over an existing PREVIEW listing REQUIRES --full.

Options:
  --full                    Select/authorize the full edition. Required to
                            replace a book's existing preview listing.
  --slug <slug>             Catalog slug. Defaults to FIRSTPAIR.md, then build metadata.
  --shelf <shelf>           Catalog shelf. Defaults to FIRSTPAIR.md.
  --title <title>           Catalog title. Defaults to metadata/VERSION.
  --description <text>      Catalog description for new or updated entry.
  --source <url>            Source repository URL.
  --kicker <text>           Catalog kicker. Defaults to "Finished book".
  --accent <#hex>           Catalog accent color.
  --tags <a,b,c>            Catalog tags. Defaults to "finished".
  --tag <tag>               Add one tag. May be repeated.
  --tutorial <file>         Optional tutorial HTML file to upload.
  --icloud-dir <dir>        Defaults to "$HOME/icloud/books".
  --stage-only              Only refresh book-uploads/staging and source map.
  --no-upload               Alias for --stage-only.
  --no-icloud               Do not copy versioned PDF/EPUB to iCloud Books.
  --no-check                Skip npm run check:catalog.
  --no-build                Skip npm run prod:build.
  --no-smoke                Skip local preview smoke test after build.
  --no-deploy               Skip Vercel production deploy and live check.
  --smoke                   Run smoke test even if --no-build is set.
  --dry-run                 Show the resolved plan without writing or uploading.
  --verbose                 Pass --verbose to the Blob uploader.
`)
}

function parseArgs(argv) {
  const options = {
    tags: [],
  }
  const positional = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }

    const withoutPrefix = arg.slice(2)
    const equalsIndex = withoutPrefix.indexOf('=')
    const key = equalsIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, equalsIndex)
    const inlineValue = equalsIndex === -1 ? null : withoutPrefix.slice(equalsIndex + 1)

    if (booleanFlags.has(key)) {
      options[key] = inlineValue === null ? true : inlineValue !== 'false'
      continue
    }

    if (!valueFlags.has(key)) {
      throw new Error(`unknown option: --${key}`)
    }

    const value = inlineValue ?? argv[index + 1]

    if (!value || value.startsWith('--')) {
      throw new Error(`missing value for --${key}`)
    }

    if (inlineValue === null) {
      index += 1
    }

    if (key === 'tags') {
      options.tags.push(...value.split(',').map((tag) => tag.trim()).filter(Boolean))
    } else if (key === 'tag') {
      options.tags.push(value)
    } else {
      options[key] = value
    }
  }

  return { options, positional }
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT' && fallback !== undefined) {
      return fallback
    }
    throw error
  }
}

async function writeJsonAtomic(path, value) {
  await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`)
  await rename(`${path}.tmp`, path)
}

function parseKeyValue(text) {
  const values = {}

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line)

    if (!match) {
      continue
    }

    values[match[1].trim()] = cleanScalar(match[2])
  }

  return values
}

function cleanScalar(value) {
  const trimmed = value.trim()
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))

  return quoted ? trimmed.slice(1, -1) : trimmed
}

async function readKeyValueFile(path) {
  try {
    return parseKeyValue(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

async function firstPairContract(inputDir, options) {
  const contractPath = join(inputDir, 'FIRSTPAIR.md')
  const hasBuildConfig = await exists(join(inputDir, 'book.build.json'))
  const hasContract = await exists(contractPath)
  const contract = await readKeyValueFile(contractPath)

  if (hasBuildConfig && !hasContract) {
    throw new Error(
      `source repository is missing required FirstPair deployment metadata: ${contractPath}`,
    )
  }

  if (hasContract) {
    for (const key of ['slug', 'shelf']) {
      if (!contract[key]) {
        throw new Error(`FIRSTPAIR.md is missing required metadata: ${key}`)
      }
    }

    for (const key of ['slug', 'shelf']) {
      if (slugify(contract[key]) !== contract[key]) {
        throw new Error(`FIRSTPAIR.md ${key} must be a lowercase URL-safe slug`)
      }
    }
  }

  for (const key of ['slug', 'shelf']) {
    if (options[key] && contract[key] && options[key] !== contract[key]) {
      throw new Error(
        `--${key} ${options[key]} conflicts with FIRSTPAIR.md ${key}: ${contract[key]}`,
      )
    }
  }

  return contract
}

async function scoreDistCandidate(path) {
  let entries

  try {
    const candidateStat = await stat(path)

    if (!candidateStat.isDirectory()) {
      return null
    }

    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return null
  }

  const names = new Set(entries.map((entry) => entry.name))
  const hasFile = (extension) => entries.some((entry) => entry.isFile() && entry.name.endsWith(extension))
  const hasDir = (suffix) => entries.some((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
  const score =
    (names.has('VERSION.md') ? 16 : 0) +
    (hasFile('.epub') ? 8 : 0) +
    (hasFile('.pdf') ? 8 : 0) +
    (hasFile('.html') ? 6 : 0) +
    (hasDir('-chapters') ? 6 : 0)

  return { path, score }
}

async function configuredDistCandidates(inputDir, wantFull) {
  let config
  try {
    config = JSON.parse(await readFile(join(inputDir, 'book.build.json'), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw new Error(`could not read book.build.json under ${inputDir}: ${error.message}`)
  }

  const candidates = []
  if (config.editions) {
    const order = wantFull ? ['full', 'preview'] : ['preview', 'full']
    for (const edition of order) {
      const override = config.editions[edition]
      if (!override) continue
      const bookRoot = override.bookRoot ?? config.bookRoot ?? '.'
      candidates.push(resolve(inputDir, override.dist ?? config.dist ?? join(bookRoot, 'dist')))
    }
  } else {
    const bookRoot = config.bookRoot ?? '.'
    candidates.push(resolve(inputDir, config.dist ?? join(bookRoot, 'dist')))
  }
  return candidates
}

async function resolveDistDir(inputDir, wantFull, slug) {
  // Prefer the safe edition by default: dist-preview unless --full is passed.
  // A book may split its output into dist-preview/ and dist-full/ (each a
  // publish-complete dir). Fall back to a generic dist/ for books that don't.
  const editionDirs = wantFull ? ['dist-full', 'dist-preview'] : ['dist-preview', 'dist-full']
  const ordered = await configuredDistCandidates(inputDir, wantFull)

  for (const base of [inputDir, join(inputDir, 'book')]) {
    for (const dir of editionDirs) {
      ordered.push(join(base, dir))
    }
  }

  ordered.push(
    inputDir,
    join(inputDir, 'book'),
    join(inputDir, 'dist'),
    join(inputDir, 'build', 'dist'),
    join(inputDir, 'book', 'dist'),
    join(inputDir, 'book', 'build', 'dist'),
    join(inputDir, 'docs', 'book', 'dist'),
    join(inputDir, 'docs', 'book', 'build', 'dist'),
  )

  if (slug) {
    ordered.push(
      join(inputDir, 'docs', 'books', slug, 'dist'),
      join(inputDir, 'docs', 'books', slug, 'build', 'dist'),
    )
  } else {
    const booksDir = join(inputDir, 'docs', 'books')
    const bookEntries = await readdir(booksDir, { withFileTypes: true }).catch(() => [])
    for (const entry of bookEntries.filter((candidate) => candidate.isDirectory())) {
      ordered.push(
        join(booksDir, entry.name, 'dist'),
        join(booksDir, entry.name, 'build', 'dist'),
      )
    }
  }

  const seen = new Set()

  // Return the first viable dist in preference order (edition-aware), rather
  // than the highest-scoring one, so --full deterministically selects dist-full.
  for (const candidate of ordered) {
    const resolved = resolve(candidate)

    if (seen.has(resolved)) {
      continue
    }

    seen.add(resolved)

    const score = await scoreDistCandidate(resolved)

    if (score && score.score > 0) {
      return resolved
    }
  }

  throw new Error(`could not find a book dist directory under ${inputDir}`)
}

function editionOf(distDir, version) {
  if (version.edition === 'full' || version.edition === 'preview') {
    return version.edition
  }

  const name = basename(distDir)

  if (name.includes('full')) {
    return 'full'
  }

  if (name.includes('preview')) {
    return 'preview'
  }

  return 'full'
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function titleFromSlug(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function firstValue(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())
}

function normalizeVersionAliases(version) {
  const primary = firstValue(version.primary_format, version.public_format)
  const primaryValue = (kind) => primary ? version[`${kind}_${primary}`] : null

  return {
    ...version,
    primary_format: primary,
    pdf_file: firstValue(version.pdf_file, version.stable_pdf, primaryValue('pdf_file')),
    epub_file: firstValue(version.epub_file, version.stable_epub, primaryValue('epub_file')),
    pdf_link: firstValue(version.pdf_link, version.versioned_pdf, primaryValue('pdf_link')),
    epub_link: firstValue(
      version.epub_link,
      version.kindle_link,
      version.versioned_epub,
      primaryValue('epub_link'),
    ),
  }
}

function preferredAccent(slug) {
  const accents = [
    '#476a7c',
    '#7c5147',
    '#52734d',
    '#755a7f',
    '#7a6a3e',
    '#416f68',
    '#6b5b95',
    '#8a4f3d',
  ]
  const digest = createHash('sha256').update(slug).digest()

  return accents[digest[0] % accents.length]
}

async function metadataFor(inputDir, distDir) {
  const candidates = [
    join(inputDir, 'metadata.yaml'),
    join(inputDir, 'metadata.yml'),
    join(inputDir, 'docs', 'book', 'metadata.yaml'),
    join(inputDir, 'docs', 'book', 'metadata.yml'),
    join(dirname(distDir), 'metadata.yaml'),
    join(dirname(distDir), 'metadata.yml'),
    join(distDir, 'metadata.yaml'),
    join(distDir, 'metadata.yml'),
  ]
  const metadata = {}

  for (const candidate of candidates) {
    Object.assign(metadata, await readKeyValueFile(candidate))
  }

  return metadata
}

async function listEntries(dir) {
  return readdir(dir, { withFileTypes: true })
}

async function artifactByName(distDir, name) {
  if (!name) {
    return null
  }

  const path = join(distDir, name)

  if (await exists(path)) {
    return path
  }

  return null
}

async function symlinkTo(distDir, targetName, extension) {
  const entries = await listEntries(distDir)

  for (const entry of entries) {
    if (!entry.name.endsWith(extension) || entry.name === targetName) {
      continue
    }

    const path = join(distDir, entry.name)
    const linkStat = await lstat(path)

    if (!linkStat.isSymbolicLink()) {
      continue
    }

    const target = await readlink(path)

    if (basename(target) === targetName) {
      return entry.name
    }
  }

  return null
}

async function firstRegularArtifact(distDir, extension, preferredNames = []) {
  for (const preferredName of preferredNames.filter(Boolean)) {
    const path = await artifactByName(distDir, preferredName)

    if (path) {
      return basename(path)
    }
  }

  const entries = await listEntries(distDir)
  const files = []

  for (const entry of entries) {
    if (!entry.name.endsWith(extension)) {
      continue
    }

    const path = join(distDir, entry.name)
    const linkStat = await lstat(path)

    if (!linkStat.isSymbolicLink() && linkStat.isFile()) {
      files.push(entry.name)
    }
  }

  files.sort((left, right) => {
    const leftVersioned = left.includes('(') ? 1 : 0
    const rightVersioned = right.includes('(') ? 1 : 0

    return leftVersioned - rightVersioned || left.localeCompare(right)
  })

  return files[0] ?? null
}

async function resolveFileArtifact({
  distDir,
  version,
  slug,
  extension,
  fileKeys,
  linkKeys,
  preferredStable,
}) {
  const stableName = await firstRegularArtifact(
    distDir,
    extension,
    [
      ...fileKeys.map((key) => version[key]),
      ...preferredStable,
      `${slug}${extension}`,
    ],
  )

  if (!stableName) {
    throw new Error(`missing ${extension} artifact in ${distDir}`)
  }

  let linkName = firstValue(...linkKeys.map((key) => version[key]))

  if (!linkName || !(await exists(join(distDir, linkName)))) {
    linkName = await symlinkTo(distDir, stableName, extension)
  }

  return {
    sourcePath: join(distDir, stableName),
    stableName,
    versionedName: linkName ?? stableName,
    versioned: Boolean(linkName),
  }
}

async function resolveChaptersDir(distDir, version, slug) {
  const preferred = firstValue(version.html_chapters_dir, `${slug}-chapters`)

  if (preferred && (await exists(join(distDir, preferred)))) {
    return {
      sourcePath: join(distDir, preferred),
      stableName: preferred,
    }
  }

  const entries = await listEntries(distDir)
  const dirs = []

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const path = join(distDir, entry.name)

    if (await exists(join(path, 'index.html'))) {
      dirs.push(entry.name)
    }
  }

  dirs.sort((left, right) => {
    const leftScore = left.endsWith('-chapters') ? 0 : 1
    const rightScore = right.endsWith('-chapters') ? 0 : 1

    return leftScore - rightScore || left.localeCompare(right)
  })

  if (!dirs[0]) {
    throw new Error(`missing chapter HTML directory with index.html in ${distDir}`)
  }

  return {
    sourcePath: join(distDir, dirs[0]),
    stableName: dirs[0],
  }
}

async function resolveTutorial(inputDir, distDir, tutorialValue) {
  if (!tutorialValue) {
    return null
  }

  const candidates = [
    isAbsolute(tutorialValue) ? tutorialValue : resolve(process.cwd(), tutorialValue),
    join(distDir, tutorialValue),
    join(inputDir, tutorialValue),
  ]

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return {
        sourcePath: candidate,
        stableName: basename(candidate),
      }
    }
  }

  throw new Error(`tutorial file not found: ${tutorialValue}`)
}

function toPosixPath(path) {
  return path.split(sep).join('/')
}

function repoRelative(path) {
  return toPosixPath(relative(root, path))
}

async function sourceUrlFromGit(inputDir) {
  const gitRoot = await commandOutput('git', ['-C', inputDir, 'rev-parse', '--show-toplevel']).catch(
    () => null,
  )

  if (!gitRoot) {
    return null
  }

  const remote = await commandOutput('git', ['-C', gitRoot, 'remote', 'get-url', 'origin']).catch(
    () => null,
  )

  if (!remote) {
    return null
  }

  if (/^git@github\.com:/.test(remote)) {
    return remote.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '')
  }

  if (/^https:\/\/github\.com\//.test(remote)) {
    return remote.replace(/\.git$/, '')
  }

  return remote
}

async function commandOutput(command, args) {
  const output = []
  const errors = []
  const { code } = await runProcess(command, args, {
    stdio: 'pipe',
    onStdout: (chunk) => output.push(chunk),
    onStderr: (chunk) => errors.push(chunk),
  })

  if (code !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${errors.join('')}`)
  }

  return output.join('').trim()
}

function runProcess(command, args, options = {}) {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
    })

    if (options.onStdout && child.stdout) {
      child.stdout.on('data', (chunk) => options.onStdout(String(chunk)))
    }

    if (options.onStderr && child.stderr) {
      child.stderr.on('data', (chunk) => options.onStderr(String(chunk)))
    }

    child.on('error', reject)
    child.on('close', (code) => resolveProcess({ code }))
  })
}

async function runChecked(command, args, options = {}) {
  const display = [command, ...args].join(' ')
  console.error(`$ ${display}`)

  const { code } = await runProcess(command, args, options)

  if (code !== 0) {
    throw new Error(`command failed (${code}): ${display}`)
  }
}

function upsertCatalogEntry(catalog, entry) {
  const index = catalog.books.findIndex((book) => book.slug === entry.slug)

  if (index === -1) {
    catalog.books.push(entry)
    return entry
  }

  catalog.books[index] = {
    ...catalog.books[index],
    ...entry,
  }

  return catalog.books[index]
}

function catalogEntryFromPlan(plan, existing = {}) {
  const source = plan.explicit.source ? plan.source : (existing.source ?? plan.source)
  const entry = {
    slug: plan.slug,
    title: plan.explicit.title ? plan.title : (existing.title ?? plan.title),
    kicker: plan.explicit.kicker ? plan.kicker : (existing.kicker ?? plan.kicker),
    description: plan.explicit.description
      ? plan.description
      : (existing.description ?? plan.description),
    accent: plan.explicit.accent ? plan.accent : (existing.accent ?? plan.accent),
    pdf: existing.pdf ?? '',
    epub: existing.epub ?? '',
    html: `/read/${plan.slug}/`,
    htmlChapters: `/read/${plan.slug}/chapters/`,
    htmlSource: existing.htmlSource ?? '',
    htmlChaptersSource: existing.htmlChaptersSource ?? '',
    tags: plan.explicit.tags ? plan.tags : (existing.tags ?? plan.tags),
  }

  if (plan.shelf) {
    entry.shelf = plan.explicit.shelf ? plan.shelf : (existing.shelf ?? plan.shelf)
  }

  // check:catalog forbids a `source` field on preview entries (those with a
  // homepage or a 'preview' tag). Omit it for the preview edition so a preview
  // publish passes the catalog check.
  const isPreviewListing =
    plan.edition === 'preview' ||
    Boolean(existing.homepage) ||
    (entry.tags ?? []).includes('preview')

  if (source && !isPreviewListing) {
    entry.source = source
  } else {
    delete entry.source
  }

  if (existing.homepage) {
    entry.homepage = existing.homepage
  }

  return entry
}

function readmeFor(plan, catalogEntry) {
  const source = catalogEntry.source ?? plan.source
  const sourceText = source
    ? `\nThe source repository owns the manuscript, metadata, version manifest, build\npipeline, and canonical generated artifacts:\n\n[${source}](${source})\n`
    : '\nThe source repository owns the manuscript, metadata, version manifest, build\npipeline, and canonical generated artifacts. Record the upstream URL in\n`public/catalog.json` when it becomes available.\n'

  return `# ${catalogEntry.title}

${catalogEntry.description}

## Current Public Editions

- [PDF](${catalogEntry.pdf})
- [EPUB](${catalogEntry.epub})
- [Read online](/read/${plan.slug}/)
- [Chapter reader](/read/${plan.slug}/chapters/)
${plan.tutorial ? `- [Interactive tutorial](/learn/${plan.slug}/)\n` : ''}
${sourceText}`
}

function readmeWithUpdatedLinks(plan, catalogEntry, existingText) {
  if (!existingText) {
    return readmeFor(plan, catalogEntry)
  }

  let text = existingText
  text = text.replace(/(\[[^\]]*PDF[^\]]*\]\()([^)]+)(\))/i, `$1${catalogEntry.pdf}$3`)
  text = text.replace(/(\[[^\]]*EPUB[^\]]*\]\()([^)]+)(\))/i, `$1${catalogEntry.epub}$3`)

  return text === existingText ? readmeFor(plan, catalogEntry) : text
}

async function refreshStaging(plan, dryRun) {
  if (dryRun) {
    return
  }

  await rm(plan.stageDir, { recursive: true, force: true })
  await mkdir(plan.stageDir, { recursive: true })
  await copyFile(plan.pdf.sourcePath, join(plan.stageDir, plan.pdf.stableName))
  await copyFile(plan.epub.sourcePath, join(plan.stageDir, plan.epub.stableName))
  await copyFile(plan.html.sourcePath, join(plan.stageDir, plan.html.stableName))
  await cp(plan.chapters.sourcePath, join(plan.stageDir, plan.chapters.stableName), {
    recursive: true,
    dereference: true,
  })

  if (plan.tutorial) {
    await copyFile(plan.tutorial.sourcePath, join(plan.stageDir, plan.tutorial.stableName))
  }
}

async function refreshSourceMap(plan, dryRun) {
  const sourcesPath = join(root, 'book-uploads', 'book-package-sources.json')
  const sources = await readJson(sourcesPath, { books: {} })

  sources.books ??= {}
  sources.books[plan.slug] = {
    pdf: repoRelative(join(plan.stageDir, plan.pdf.stableName)),
    epub: repoRelative(join(plan.stageDir, plan.epub.stableName)),
    html: repoRelative(join(plan.stageDir, plan.html.stableName)),
    htmlChapters: repoRelative(join(plan.stageDir, plan.chapters.stableName)),
  }

  if (plan.tutorial) {
    sources.books[plan.slug].tutorial = repoRelative(join(plan.stageDir, plan.tutorial.stableName))
  }

  if (!dryRun) {
    await writeJsonAtomic(sourcesPath, sources)
  }

  return sources.books[plan.slug]
}

async function refreshCatalog(plan, dryRun) {
  const catalogPath = join(root, 'public', 'catalog.json')
  const catalog = await readJson(catalogPath)
  const existing = catalog.books.find((book) => book.slug === plan.slug) ?? {}
  const entry = catalogEntryFromPlan(plan, existing)

  upsertCatalogEntry(catalog, entry)

  if (!dryRun) {
    await writeJsonAtomic(catalogPath, catalog)
    await mkdir(plan.publicDir, { recursive: true })
  }

  return entry
}

async function writePublicReadme(plan, dryRun) {
  const catalogPath = join(root, 'public', 'catalog.json')
  const catalog = await readJson(catalogPath)
  const entry = catalog.books.find((book) => book.slug === plan.slug)

  if (!entry) {
    throw new Error(`missing catalog entry after upload: ${plan.slug}`)
  }

  if (!entry.pdf || !entry.epub) {
    throw new Error(`catalog entry is missing uploaded PDF/EPUB URLs for ${plan.slug}`)
  }

  if (!dryRun) {
    await mkdir(plan.publicDir, { recursive: true })
    const readmePath = join(plan.publicDir, 'README.md')
    const existingReadme = await readFile(readmePath, 'utf8').catch(() => '')
    await writeFile(readmePath, readmeWithUpdatedLinks(plan, entry, existingReadme))
  }
}

async function copyIcloud(plan, dryRun) {
  if (!plan.copyIcloud) {
    return []
  }

  const destinations = [
    {
      source: plan.pdf.sourcePath,
      path: join(plan.icloudDir, plan.pdf.versionedName),
      versioned: plan.pdf.versioned,
    },
    {
      source: plan.epub.sourcePath,
      path: join(plan.icloudDir, plan.epub.versionedName),
      versioned: plan.epub.versioned,
    },
  ]

  if (!dryRun && !(await exists(plan.icloudDir))) {
    throw new Error(`iCloud Books destination does not exist: ${plan.icloudDir}`)
  }

  for (const destination of destinations) {
    if (!destination.versioned) {
      console.error(`warning: using stable name for iCloud copy: ${basename(destination.path)}`)
    }

    if (!dryRun) {
      await copyFile(destination.source, destination.path)
      const sourceBytes = await readFile(destination.source)
      const destinationBytes = await readFile(destination.path)

      if (!sourceBytes.equals(destinationBytes)) {
        throw new Error(`iCloud copy did not match source: ${destination.path}`)
      }
    }
  }

  return destinations
}

async function waitForUrl(url, timeoutMs) {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)

      if (response.ok) {
        return true
      }
    } catch {
      // keep waiting
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }

  return false
}

async function runSmoke() {
  const url = 'http://127.0.0.1:5183/'
  const alreadyRunning = await waitForUrl(url, 1000)
  let preview = null

  if (!alreadyRunning) {
    console.error('$ npm run preview')
    preview = spawn('npm', ['run', 'preview'], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    preview.stdout.on('data', (chunk) => process.stderr.write(chunk))
    preview.stderr.on('data', (chunk) => process.stderr.write(chunk))

    if (!(await waitForUrl(url, 30000))) {
      preview.kill('SIGTERM')
      throw new Error(`preview server did not become ready at ${url}`)
    }
  }

  try {
    await runChecked('npm', ['run', 'smoke:site'], {
      env: {
        ...process.env,
        FIRSTPAIR_SITE_URL: url,
      },
    })
  } finally {
    if (preview) {
      preview.kill('SIGTERM')
    }
  }
}

async function runLiveCatalogCheck(plan) {
  const localCatalog = await readJson(join(root, 'public', 'catalog.json'))
  const localBook = localCatalog.books.find((book) => book.slug === plan.slug)

  if (!localBook) {
    throw new Error(`missing local catalog entry for ${plan.slug}`)
  }

  const liveUrl = 'https://firstpair.org/catalog.json'
  const deadline = Date.now() + 3 * 60 * 1000
  let lastLiveBook = null

  while (Date.now() < deadline) {
    const response = await fetch(`${liveUrl}?t=${Date.now()}`, {
      cache: 'no-store',
    }).catch(() => null)

    if (response?.ok) {
      const liveCatalog = await response.json()
      const liveBook = liveCatalog.books.find((book) => book.slug === plan.slug)
      lastLiveBook = liveBook

      if (
        liveBook?.pdf === localBook.pdf &&
        liveBook?.epub === localBook.epub &&
        liveBook?.htmlSource === localBook.htmlSource &&
        liveBook?.htmlChaptersSource === localBook.htmlChaptersSource
      ) {
        console.error(`live catalog matches local entry for ${plan.slug}`)
        return
      }
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 5000))
  }

  throw new Error(
    `live catalog did not update for ${plan.slug} within 180s\n${JSON.stringify(
      {
        expected: {
          pdf: localBook.pdf,
          epub: localBook.epub,
          htmlSource: localBook.htmlSource,
          htmlChaptersSource: localBook.htmlChaptersSource,
        },
        actual: lastLiveBook && {
          pdf: lastLiveBook.pdf,
          epub: lastLiveBook.epub,
          htmlSource: lastLiveBook.htmlSource,
          htmlChaptersSource: lastLiveBook.htmlChaptersSource,
        },
      },
      null,
      2,
    )}`,
  )
}

async function deployProduction(plan) {
  await runChecked('vercel', ['deploy', '--prod', '--yes'])
  await runLiveCatalogCheck(plan)
}

async function buildPlan(inputDir, options) {
  const firstpair = await firstPairContract(inputDir, options)
  const contractSlug = options.slug ?? firstpair.slug
  const distDir = await resolveDistDir(inputDir, options.full, contractSlug)
  const version = normalizeVersionAliases(await readKeyValueFile(join(distDir, 'VERSION.md')))
  const edition = editionOf(distDir, version)
  const metadata = await metadataFor(inputDir, distDir)
  const source = options.source ?? (await sourceUrlFromGit(inputDir))
  const stem = firstValue(
    contractSlug,
    version.title_stem,
    metadata.title_stem,
    version.html_title,
    version.title,
    metadata.title,
    basename(dirname(distDir)),
    basename(inputDir),
  )
  const slug = slugify(contractSlug ?? version.title_stem ?? metadata.title_stem ?? stem)
  const shelf = options.shelf ?? firstpair.shelf
  const title = firstValue(options.title, version.html_title, version.title, metadata.title, titleFromSlug(slug))
  const subtitle = firstValue(version.subtitle, metadata.subtitle)
  const description = firstValue(
    options.description,
    `${subtitle ? `${title}: ${subtitle}` : title}, delivered as PDF, EPUB, and hosted web readers.`,
  )
  const tags = options.tags.length ? [...new Set(options.tags)] : ['finished']
  const pdf = await resolveFileArtifact({
    distDir,
    version,
    slug,
    extension: '.pdf',
    fileKeys: ['pdf_file'],
    linkKeys: ['pdf_link'],
    preferredStable: [`${slug}.pdf`, `${version.title_stem}.pdf`, `${metadata.title_stem}.pdf`],
  })
  const epub = await resolveFileArtifact({
    distDir,
    version,
    slug,
    extension: '.epub',
    fileKeys: ['epub_file'],
    linkKeys: ['epub_link', 'kindle_link'],
    preferredStable: [`${slug}.epub`, `${version.title_stem}.epub`, `${metadata.title_stem}.epub`],
  })
  const html = await resolveFileArtifact({
    distDir,
    version,
    slug,
    extension: '.html',
    fileKeys: ['html_file'],
    linkKeys: ['html_link'],
    preferredStable: [`${slug}.html`, `${version.title_stem}.html`, `${metadata.title_stem}.html`],
  })
  const chapters = await resolveChaptersDir(distDir, version, slug)
  const tutorial = await resolveTutorial(inputDir, distDir, options.tutorial ?? version.tutorial_file)

  return {
    inputDir,
    distDir,
    version,
    metadata,
    edition,
    slug,
    shelf,
    title,
    description,
    source,
    kicker: options.kicker ?? (edition === 'preview' ? 'Preview edition' : 'Finished book'),
    accent: options.accent ?? preferredAccent(slug),
    tags,
    pdf,
    epub,
    html,
    chapters,
    tutorial,
    stageDir: join(root, 'book-uploads', 'staging', slug),
    publicDir: join(root, 'public', slug),
    icloudDir: resolve(options['icloud-dir'] ?? join(homedir(), 'icloud', 'books')),
    copyIcloud: !options['no-icloud'],
    stageOnly: Boolean(options['stage-only'] || options['no-upload']),
    runCheck: !options['no-check'],
    runBuild: !options['no-build'],
    runSmoke: options.smoke || (!options['no-smoke'] && !options['no-build']),
    runDeploy: !options['no-deploy'],
    explicit: {
      title: Boolean(options.title),
      description: Boolean(options.description),
      source: Boolean(options.source),
      shelf: Boolean(options.shelf || firstpair.shelf),
      kicker: Boolean(options.kicker),
      accent: Boolean(options.accent),
      tags: options.tags.length > 0,
    },
    verbose: Boolean(options.verbose),
  }
}

function printablePlan(plan, sourceMap = null, icloudCopies = []) {
  return {
    slug: plan.slug,
    shelf: plan.shelf,
    title: plan.title,
    distDir: plan.distDir,
    edition: plan.edition,
    stageDir: repoRelative(plan.stageDir),
    publicDir: repoRelative(plan.publicDir),
    source: plan.source,
    artifacts: {
      pdf: {
        source: plan.pdf.sourcePath,
        staged: repoRelative(join(plan.stageDir, plan.pdf.stableName)),
        icloudName: plan.pdf.versionedName,
      },
      epub: {
        source: plan.epub.sourcePath,
        staged: repoRelative(join(plan.stageDir, plan.epub.stableName)),
        icloudName: plan.epub.versionedName,
      },
      html: {
        source: plan.html.sourcePath,
        staged: repoRelative(join(plan.stageDir, plan.html.stableName)),
      },
      htmlChapters: {
        source: plan.chapters.sourcePath,
        staged: repoRelative(join(plan.stageDir, plan.chapters.stableName)),
      },
      tutorial: plan.tutorial
        ? {
            source: plan.tutorial.sourcePath,
            staged: repoRelative(join(plan.stageDir, plan.tutorial.stableName)),
          }
        : null,
    },
    sourceMap,
    icloudCopies: icloudCopies.map((copy) => copy.path),
    actions: {
      stageOnly: plan.stageOnly,
      upload: !plan.stageOnly,
      copyIcloud: plan.copyIcloud && !plan.stageOnly,
      checkCatalog: plan.runCheck && !plan.stageOnly,
      prodBuild: plan.runBuild && !plan.stageOnly,
      smoke: plan.runSmoke && !plan.stageOnly,
      productionDeploy: plan.runDeploy && !plan.stageOnly,
    },
  }
}

async function main() {
  const { options, positional } = parseArgs(process.argv.slice(2))

  if (options.help) {
    usage()
    return
  }

  if (positional.length !== 1) {
    usage()
    process.exit(2)
  }

  const inputDir = resolve(positional[0])
  const inputStat = await stat(inputDir).catch(() => null)

  if (!inputStat?.isDirectory()) {
    throw new Error(`book directory does not exist: ${inputDir}`)
  }

  const plan = await buildPlan(inputDir, options)
  const dryRun = Boolean(options['dry-run'])

  // Safety gate: never replace a preview listing with the full edition unless
  // --full is passed. See AGENTS.md ("Preview → full publishing").
  const gateCatalog = await readJson(join(root, 'public', 'catalog.json'), { books: [] })
  const gateEntry = gateCatalog.books.find((book) => book.slug === plan.slug)
  const existingIsPreview = Boolean(
    gateEntry &&
      (/preview/i.test(gateEntry.kicker ?? '') || (gateEntry.homepage ?? '').includes('/preview/')),
  )

  if (plan.edition === 'full' && existingIsPreview && !options.full) {
    fail(
      `Refusing to publish the FULL edition of "${plan.slug}" over its existing preview listing.\n` +
        `The library currently lists "${plan.slug}" as a preview` +
        `${gateEntry?.kicker ? ` ("${gateEntry.kicker}")` : ''}. Publishing the full book will\n` +
        `replace that public listing and push the complete text to the library and iCloud.\n` +
        `Re-run with --full to confirm you intend to push the complete book.`,
    )
  }

  await refreshStaging(plan, dryRun)
  const sourceMap = await refreshSourceMap(plan, dryRun)

  if (plan.stageOnly) {
    console.log(JSON.stringify(printablePlan(plan, sourceMap), null, 2))
    return
  }

  await refreshCatalog(plan, dryRun)

  if (dryRun) {
    console.log(JSON.stringify(printablePlan(plan, sourceMap), null, 2))
    return
  }

  const uploadArgs = ['scripts/upload-book-package.mjs', plan.slug]

  if (plan.verbose) {
    uploadArgs.push('--verbose')
  }

  await runChecked(process.execPath, uploadArgs)
  await runChecked(process.execPath, ['scripts/sync-reader-routes.mjs'])
  await writePublicReadme(plan, dryRun)
  const icloudCopies = await copyIcloud(plan, dryRun)

  if (plan.runCheck) {
    await runChecked('npm', ['run', 'check:catalog'])
  }

  if (plan.runBuild) {
    await runChecked('npm', ['run', 'prod:build'])
  }

  if (plan.runSmoke) {
    await runSmoke()
  }

  if (plan.runDeploy) {
    await deployProduction(plan)
  }

  console.log(JSON.stringify(printablePlan(plan, sourceMap, icloudCopies), null, 2))
}

main().catch((error) => {
  fail(error?.stack ?? error)
})
