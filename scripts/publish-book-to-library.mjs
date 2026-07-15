import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  access,
  copyFile,
  cp,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
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
import { renderVaultGuide } from './render-vault-guide.mjs'

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
  'vault',
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
  'vault-dir',
  'vault-guide',
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
  --vault                   Deliver a companion editorial vault when one was
                            built for this edition. Auto-discovers a proper
                            vault under <book>/dist-obsidian/ (a preview-named
                            vault for the preview edition, the non-preview
                            vault for the full edition), zips it to a
                            versioned name, and copies it to iCloud beside the
                            book, together with the raw Markdown guide. The
                            guide is also embedded in the vault as README.md
                            and rendered to standalone HTML for /read/.../guide/.
                            A source-owned check-obsidian-vault.py runs first,
                            including for --dry-run, when the source provides it.
  --vault-dir <dir>         Explicit vault directory (implies --vault).
  --vault-guide <file>      Explicit vault guide (default: a docs/*VAULT*.md).
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
  const lines = text.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line)

    if (!match) {
      continue
    }

    const key = match[1].trim()
    const scalar = cleanScalar(match[2])

    const blockStyle = /^([>|])(?:[+-])?$/.exec(scalar)

    if (blockStyle) {
      const block = []
      let cursor = index + 1

      while (cursor < lines.length && (!lines[cursor].trim() || /^\s+/.test(lines[cursor]))) {
        block.push(lines[cursor])
        cursor += 1
      }

      const indents = block
        .filter((blockLine) => blockLine.trim())
        .map((blockLine) => /^\s*/.exec(blockLine)[0].length)
      const indent = indents.length ? Math.min(...indents) : 0
      const normalized = block.map((blockLine) => blockLine.slice(indent))

      values[key] = blockStyle[1] === '|'
        ? normalized.join('\n').trim()
        : normalized
            .join('\n')
            .trim()
            .split(/\n{2,}/)
            .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' '))
            .join('\n\n')
      index = cursor - 1
      continue
    }

    values[key] = scalar
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
  const existingTags = Array.isArray(existing.tags) ? existing.tags : []
  const existingIsPreview =
    Boolean(existing.homepage) ||
    /preview/i.test(existing.kicker ?? '') ||
    existingTags.some((tag) => String(tag).toLowerCase() === 'preview')
  const replacesPreview = plan.edition === 'full' && existingIsPreview
  const tags = replacesPreview && !plan.explicit.tags
    ? [...new Set([
        ...plan.tags,
        ...existingTags.filter((tag) => String(tag).toLowerCase() !== 'preview'),
      ])]
    : (plan.explicit.tags ? plan.tags : (existing.tags ?? plan.tags))
  const entry = {
    slug: plan.slug,
    title: plan.explicit.title ? plan.title : (existing.title ?? plan.title),
    kicker: plan.explicit.kicker || replacesPreview
      ? plan.kicker
      : (existing.kicker ?? plan.kicker),
    description: plan.explicit.description
      ? plan.description
      : (replacesPreview ? plan.description : (existing.description ?? plan.description)),
    accent: plan.explicit.accent ? plan.accent : (existing.accent ?? plan.accent),
    pdf: existing.pdf ?? '',
    epub: existing.epub ?? '',
    html: `/read/${plan.slug}/`,
    htmlChapters: `/read/${plan.slug}/chapters/`,
    htmlSource: existing.htmlSource ?? '',
    htmlChaptersSource: existing.htmlChaptersSource ?? '',
    tags: plan.edition === 'full'
      ? tags.filter((tag) => String(tag).toLowerCase() !== 'preview')
      : tags,
  }

  if (plan.shelf) {
    entry.shelf = plan.explicit.shelf ? plan.shelf : (existing.shelf ?? plan.shelf)
  }

  // check:catalog forbids a `source` field on preview entries (those with a
  // homepage or a 'preview' tag). Omit it for the preview edition so a preview
  // publish passes the catalog check.
  const isPreviewListing =
    plan.edition === 'preview' ||
    (!replacesPreview && Boolean(existing.homepage)) ||
    (entry.tags ?? []).some((tag) => String(tag).toLowerCase() === 'preview')

  if (source && !isPreviewListing) {
    entry.source = source
  } else {
    // upsertCatalogEntry merges over the previous record, so an explicit
    // undefined is required to clear a stale full-edition source on preview.
    entry.source = undefined
  }

  if (existing.homepage) {
    // Likewise, replacing a preview must actively clear its static landing
    // page instead of merely omitting homepage from the incoming object.
    entry.homepage = replacesPreview ? undefined : existing.homepage
  }

  return entry
}

function stableDeliverablePath(slug, format) {
  return `/${slug}/${format}/`
}

function readmeFor(plan, catalogEntry) {
  const source = catalogEntry.source ?? plan.source
  const vaultLinks =
    catalogEntry.vault || catalogEntry.vaultGuide
      ? `${catalogEntry.vault ? `- [Download the Obsidian vault](${stableDeliverablePath(plan.slug, 'vault')})\n` : ''}${catalogEntry.vaultGuide ? `- [Read the Obsidian vault guide](${catalogEntry.vaultGuide})\n` : ''}`
      : ''
  const sourceText = source
    ? `\nThe source repository owns the manuscript, metadata, version manifest, build\npipeline, and canonical generated artifacts:\n\n[${source}](${source})\n`
    : '\nThe source repository owns the manuscript, metadata, version manifest, build\npipeline, and canonical generated artifacts. Record the upstream URL in\n`public/catalog.json` when it becomes available.\n'

  return `# ${catalogEntry.title}

${catalogEntry.description}

## Current Public Editions

- [PDF](${stableDeliverablePath(plan.slug, 'pdf')})
- [EPUB](${stableDeliverablePath(plan.slug, 'epub')})
- [Read online](/read/${plan.slug}/)
- [Chapter reader](/read/${plan.slug}/chapters/)
${plan.tutorial ? `- [Interactive tutorial](/learn/${plan.slug}/)\n` : ''}
${vaultLinks}
${sourceText}`
}

function readmeWithUpdatedLinks(plan, catalogEntry, existingText) {
  if (!existingText) {
    return readmeFor(plan, catalogEntry)
  }

  if (
    plan.edition === 'full' &&
    /Preview landing page|Preview PDF|Read preview online|publishes only the preview/i.test(
      existingText,
    )
  ) {
    return readmeFor(plan, catalogEntry)
  }

  let text = existingText
  text = text.replace(
    /(\[[^\]]*PDF[^\]]*\]\()([^)]+)(\))/i,
    `$1${stableDeliverablePath(plan.slug, 'pdf')}$3`,
  )
  text = text.replace(
    /(\[[^\]]*EPUB[^\]]*\]\()([^)]+)(\))/i,
    `$1${stableDeliverablePath(plan.slug, 'epub')}$3`,
  )
  const vaultLinks = []
  if (catalogEntry.vault) {
    vaultLinks.push(`- [Download the Obsidian vault](${stableDeliverablePath(plan.slug, 'vault')})`)
  }
  if (catalogEntry.vaultGuide) {
    vaultLinks.push(`- [Read the Obsidian vault guide](${catalogEntry.vaultGuide})`)
  }
  if (vaultLinks.length) {
    const block = `${vaultLinks.join('\n')}\n`
    if (/\[[^\]]*(?:Obsidian vault|vault guide)[^\]]*\]\(/i.test(text)) {
      text = text.replace(
        /(?:- \[[^\]]*(?:Obsidian vault|vault guide)[^\]]*\]\([^)]+\)\n?)+/i,
        block,
      )
    } else {
      text = text.replace(
        /(- \[Chapter reader\]\([^)]+\)\n)/i,
        `$1${block}`,
      )
    }
  }

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

  if (plan.cover) {
    sources.books[plan.slug].cover = repoRelative(join(plan.stageDir, plan.cover.stableName))
  }

  if (plan.headboard) {
    sources.books[plan.slug].headboard = repoRelative(
      join(plan.stageDir, plan.headboard.stableName),
    )
  }

  if (plan.vault) {
    sources.books[plan.slug].vault = repoRelative(join(plan.stageDir, plan.vault.zipName))
    if (plan.vault.guideName) {
      sources.books[plan.slug].vaultGuideMarkdown = repoRelative(
        join(plan.stageDir, plan.vault.guideName),
      )
      sources.books[plan.slug].vaultGuideHtml = repoRelative(
        join(plan.stageDir, plan.vault.guideHtmlName),
      )
    }
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

// A "proper" editorial vault has a root Home.md and a <book>/_data ledger
// directory with unit rows. This keeps --vault from shipping a stray folder.
async function isProperVault(dir) {
  if (!(await exists(join(dir, 'Home.md')))) {
    return false
  }
  let entries
  try {
    entries = await listEntries(dir)
  } catch {
    return false
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    if (await exists(join(dir, entry.name, '_data', 'units.jsonl'))) {
      return true
    }
  }
  return false
}

function ancestorCandidates(path, limit = 6) {
  const candidates = []
  let current = resolve(path)

  for (let depth = 0; depth < limit; depth += 1) {
    candidates.push(current)
    const parent = dirname(current)

    if (parent === current) {
      break
    }

    current = parent
  }

  return candidates
}

async function sourceRepositoryRoot(inputDir, distDir, vaultDir) {
  const gitRoots = []

  for (const candidate of [inputDir, distDir, vaultDir]) {
    const gitRoot = await commandOutput(
      'git',
      ['-C', candidate, 'rev-parse', '--show-toplevel'],
    ).catch(() => null)

    if (gitRoot && !gitRoots.includes(resolve(gitRoot))) {
      gitRoots.push(resolve(gitRoot))
    }
  }

  for (const gitRoot of gitRoots) {
    if (await exists(join(gitRoot, 'scripts', 'check-obsidian-vault.py'))) {
      return gitRoot
    }
  }

  if (gitRoots[0]) {
    return gitRoots[0]
  }

  const candidates = [
    ...new Set(
      [inputDir, distDir, vaultDir].flatMap((candidate) => ancestorCandidates(candidate)),
    ),
  ]

  for (const candidate of candidates) {
    if (await exists(join(candidate, 'scripts', 'check-obsidian-vault.py'))) {
      return candidate
    }
  }

  return resolve(inputDir)
}

async function validateSourceOwnedVault(inputDir, distDir, vaultDir) {
  const sourceRoot = await sourceRepositoryRoot(inputDir, distDir, vaultDir)
  const validator = join(sourceRoot, 'scripts', 'check-obsidian-vault.py')
  const validatorStat = await stat(validator).catch(() => null)

  if (!validatorStat) {
    return null
  }

  if (!validatorStat.isFile()) {
    throw new Error(`source-owned vault validator is not a regular file: ${validator}`)
  }

  const readable = await access(validator, fsConstants.R_OK).then(
    () => true,
    () => false,
  )
  const executable = await access(validator, fsConstants.X_OK).then(
    () => true,
    () => false,
  )

  if (!readable && !executable) {
    throw new Error(`source-owned vault validator is not readable or executable: ${validator}`)
  }

  const pinnedUvProject =
    (await exists(join(sourceRoot, 'pyproject.toml'))) &&
    (await exists(join(sourceRoot, 'uv.lock')))
  let command
  let args
  let runner

  if (pinnedUvProject) {
    command = 'uv'
    args = [
      'run',
      '--project',
      sourceRoot,
      '--locked',
      '--no-dev',
      'python',
      validator,
      vaultDir,
    ]
    runner = 'uv'
  } else if (executable) {
    command = validator
    args = [vaultDir]
    runner = 'executable'
  } else {
    command = 'python3'
    args = [validator, vaultDir]
    runner = 'python3'
  }

  const display = [command, ...args].join(' ')
  console.error(`$ ${display}`)
  const { code } = await runProcess(command, args, {
    cwd: sourceRoot,
    env: {
      ...process.env,
      FIRSTPAIR_VAULT_VALIDATION: '1',
      PYTHONDONTWRITEBYTECODE: '1',
    },
    stdio: 'pipe',
    onStdout: (chunk) => process.stderr.write(chunk),
    onStderr: (chunk) => process.stderr.write(chunk),
  })

  if (code !== 0) {
    throw new Error(
      `source-owned vault validation failed (${code}) for ${vaultDir}\n` +
        `validator: ${validator}`,
    )
  }

  return {
    validator,
    sourceRoot,
    runner,
  }
}

async function discoverVaultDir(bookDir, edition) {
  const base = join(bookDir, 'dist-obsidian')
  let entries
  try {
    entries = await listEntries(base)
  } catch {
    return null
  }
  const matches = []
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const isPreview = /preview/i.test(entry.name)
    if ((edition === 'preview') !== isPreview) {
      continue
    }
    const dir = join(base, entry.name)
    if (await isProperVault(dir)) {
      matches.push(dir)
    }
  }
  if (matches.length === 1) {
    return matches[0]
  }
  if (matches.length > 1) {
    throw new Error(
      `multiple ${edition} vaults under ${base}; pass --vault-dir to choose:\n` +
        matches.map((m) => `  ${m}`).join('\n'),
    )
  }
  return null
}

async function discoverVaultGuide(inputDir, bookDir) {
  const explicit = [
    join(inputDir, 'docs', 'OBSIDIAN-VAULT.md'),
    join(bookDir, 'docs', 'OBSIDIAN-VAULT.md'),
  ]
  for (const candidate of explicit) {
    if (await exists(candidate)) {
      return candidate
    }
  }
  for (const dir of [join(inputDir, 'docs'), join(bookDir, 'docs')]) {
    let entries
    try {
      entries = await listEntries(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isFile() && /vault/i.test(entry.name) && entry.name.endsWith('.md')) {
        return join(dir, entry.name)
      }
    }
  }
  return null
}

async function resolveVault(inputDir, distDir, edition, version, slug, options) {
  const wantVault = Boolean(options.vault || options['vault-dir'])
  if (!wantVault) {
    return null
  }
  const bookDir = dirname(distDir)
  const dir = options['vault-dir']
    ? resolve(isAbsolute(options['vault-dir']) ? options['vault-dir'] : join(inputDir, options['vault-dir']))
    : await discoverVaultDir(bookDir, edition)
  if (!dir) {
    throw new Error(
      `--vault was requested but no proper ${edition} vault was found under ` +
        `${join(bookDir, 'dist-obsidian')}. Build one first, or pass --vault-dir.`,
    )
  }
  if (options['vault-dir'] && !(await isProperVault(dir))) {
    throw new Error(`--vault-dir is not a proper editorial vault: ${dir}`)
  }
  const validation = await validateSourceOwnedVault(inputDir, distDir, dir)
  const stamp = firstValue(version.version_stamp, version.version) ?? 'current'
  const zipName = `${slug}-${edition}-vault (${stamp}).zip`

  let guideSource = null
  let guideName = null
  let guideHtmlName = null
  const guide = options['vault-guide']
    ? resolve(isAbsolute(options['vault-guide']) ? options['vault-guide'] : join(inputDir, options['vault-guide']))
    : await discoverVaultGuide(inputDir, bookDir)
  if (guide && (await exists(guide))) {
    guideSource = guide
    guideName = `${slug}-vault-guide (${stamp}).md`
    guideHtmlName = `${slug}-vault-guide (${stamp}).html`
  }

  return { dir, zipName, guideSource, guideName, guideHtmlName, validation }
}

// Zip the vault directory into destinationZip. Uses the system `zip` so the
// archive opens as a plain folder; volatile Obsidian state is excluded.
async function zipVault(vaultDir, destinationZip, guideSource = null) {
  await rm(destinationZip, { force: true })
  await mkdir(dirname(destinationZip), { recursive: true })
  const { code } = await runProcess(
    'zip',
    [
      '-r',
      '-q',
      '-X',
      destinationZip,
      basename(vaultDir),
      '-x',
      '*.DS_Store',
      '-x',
      '*/.git/*',
      '-x',
      '*/workspace.json',
    ],
    { cwd: dirname(vaultDir), stdio: 'inherit' },
  )
  if (code !== 0) {
    throw new Error(`zip failed (${code}) for vault: ${vaultDir}`)
  }

  if (!guideSource) {
    return
  }

  // Do not mutate the generated vault merely to include its publication
  // guide. Add the canonical Markdown as <vault>/README.md from a temporary
  // mirror, then extract and byte-check that member before delivery.
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'firstpair-vault-guide-'))
  const vaultRootName = basename(vaultDir)
  const temporaryVaultRoot = join(temporaryRoot, vaultRootName)
  const archiveGuide = `${vaultRootName}/README.md`

  try {
    await mkdir(temporaryVaultRoot, { recursive: true })
    await copyFile(guideSource, join(temporaryVaultRoot, 'README.md'))

    const { code: appendCode } = await runProcess(
      'zip',
      ['-r', '-q', '-X', destinationZip, vaultRootName],
      { cwd: temporaryRoot, stdio: 'inherit' },
    )

    if (appendCode !== 0) {
      throw new Error(`zip failed (${appendCode}) while embedding vault guide: ${guideSource}`)
    }

    const verifyRoot = join(temporaryRoot, 'verify')
    const { code: extractCode } = await runProcess(
      'unzip',
      ['-q', '-o', destinationZip, archiveGuide, '-d', verifyRoot],
      { stdio: 'inherit' },
    )

    if (extractCode !== 0) {
      throw new Error(`could not verify embedded vault guide: ${archiveGuide}`)
    }

    const [sourceBytes, archiveBytes] = await Promise.all([
      readFile(guideSource),
      readFile(join(verifyRoot, vaultRootName, 'README.md')),
    ])

    if (!sourceBytes.equals(archiveBytes)) {
      throw new Error(`embedded vault guide did not match source: ${archiveGuide}`)
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

// Stage source-owned visual companions and (when requested) the vault package
// before the source-map and upload run. Runs after refreshStaging, which resets
// stageDir.
async function stageCompanions(plan, dryRun) {
  if (dryRun) {
    return
  }
  if (plan.cover) {
    await copyFile(plan.cover.sourcePath, join(plan.stageDir, plan.cover.stableName))
  }
  if (plan.headboard) {
    await copyFile(plan.headboard.sourcePath, join(plan.stageDir, plan.headboard.stableName))
  }
  if (plan.vault) {
    await zipVault(
      plan.vault.dir,
      join(plan.stageDir, plan.vault.zipName),
      plan.vault.guideSource,
    )
    if (plan.vault.guideName) {
      await copyFile(plan.vault.guideSource, join(plan.stageDir, plan.vault.guideName))
      await renderVaultGuide({
        source: plan.vault.guideSource,
        destination: join(plan.stageDir, plan.vault.guideHtmlName),
        title: `${plan.title} — Obsidian Vault Guide`,
        resourcePaths: [plan.vault.dir],
      })
    }
  }
}

// Copy the already-staged companions to iCloud beside the book.
async function copyCompanionsToIcloud(plan, dryRun) {
  const delivered = []
  if (plan.vault) {
    delivered.push({
      role: 'vault',
      source: join(plan.stageDir, plan.vault.zipName),
      path: join(plan.icloudDir, plan.vault.zipName),
    })
    if (plan.vault.guideName) {
      delivered.push({
        role: 'guide-markdown',
        source: join(plan.stageDir, plan.vault.guideName),
        path: join(plan.icloudDir, plan.vault.guideName),
      })
    }
  }
  if (dryRun || !plan.copyIcloud) {
    return delivered
  }
  if (delivered.length && !(await exists(plan.icloudDir))) {
    throw new Error(`iCloud Books destination does not exist: ${plan.icloudDir}`)
  }
  for (const delivery of delivered) {
    await copyFile(delivery.source, delivery.path)
    const [sourceBytes, deliveredBytes] = await Promise.all([
      readFile(delivery.source),
      readFile(delivery.path),
    ])

    if (!sourceBytes.equals(deliveredBytes)) {
      throw new Error(`iCloud companion copy did not match source: ${delivery.path}`)
    }
  }
  return delivered
}

function resolveConfiguredAssetPath(name, inputDir, distDir) {
  return name
    .replaceAll('${repoRoot}', inputDir)
    .replaceAll('${distDir}', distDir)
    .replaceAll('${buildDir}', dirname(distDir))
}

async function coverNamesFromBuildConfig(inputDir, distDir) {
  const config = await readJson(join(inputDir, 'book.build.json'), null)
  if (!config) {
    return []
  }

  return [
    config.coverImage,
    config.pdf?.coverImage,
    config.epub?.coverImage,
    config.cover,
  ]
    .filter(Boolean)
    .map((name) => resolveConfiguredAssetPath(name, inputDir, distDir))
}

async function headboardNamesFromBuildConfig(inputDir, distDir) {
  const config = await readJson(join(inputDir, 'book.build.json'), null)
  if (!config?.headboardImage) {
    return []
  }

  return [resolveConfiguredAssetPath(config.headboardImage, inputDir, distDir)]
}

const browserImageExtensions = new Set([
  '.avif',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp',
])

async function resolveCover(inputDir, distDir, metadata, slug) {
  const named = [
    metadata.cover_image,
    metadata.cover,
    ...(await coverNamesFromBuildConfig(inputDir, distDir)),
  ].filter(Boolean)
  const candidates = []
  for (const name of named) {
    candidates.push(
      isAbsolute(name) ? name : join(inputDir, name),
      join(dirname(distDir), name),
    )
  }
  candidates.push(join(distDir, 'cover.png'), join(dirname(distDir), 'cover.png'))
  for (const candidate of candidates) {
    // `book.build.json#cover` is often a Markdown front-matter fragment used
    // to render the book body. It is not a library-card image. Prefer the
    // explicit PDF/EPUB cover images above and refuse non-image fallbacks.
    if (
      browserImageExtensions.has(extname(candidate).toLowerCase()) &&
      await exists(candidate)
    ) {
      return { sourcePath: candidate, stableName: `${slug}-cover${extname(candidate)}` }
    }
  }
  return null
}

async function resolveHeadboard(inputDir, distDir, metadata, slug) {
  const named = [
    metadata.headboard_image,
    metadata.headboard,
    ...(await headboardNamesFromBuildConfig(inputDir, distDir)),
  ].filter(Boolean)
  const candidates = []
  for (const name of named) {
    candidates.push(
      isAbsolute(name) ? name : join(inputDir, name),
      join(dirname(distDir), name),
    )
  }
  candidates.push(join(distDir, 'headboard.png'), join(dirname(distDir), 'headboard.png'))
  for (const candidate of candidates) {
    if (
      browserImageExtensions.has(extname(candidate).toLowerCase()) &&
      await exists(candidate)
    ) {
      return { sourcePath: candidate, stableName: `${slug}-headboard${extname(candidate)}` }
    }
  }
  return null
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
  const comparedFields = [
    'title',
    'kicker',
    'description',
    'accent',
    'shelf',
    'source',
    'homepage',
    'tags',
    'pdf',
    'epub',
    'htmlSource',
    'htmlChaptersSource',
    'cover',
    'headboard',
    'vault',
    'vaultGuide',
    'vaultGuideSource',
  ]
  const deadline = Date.now() + 3 * 60 * 1000
  let lastLiveBook = null
  let lastGuideCheck = null

  while (Date.now() < deadline) {
    const response = await fetch(`${liveUrl}?t=${Date.now()}`, {
      cache: 'no-store',
    }).catch(() => null)

    if (response?.ok) {
      const liveCatalog = await response.json()
      const liveBook = liveCatalog.books.find((book) => book.slug === plan.slug)
      lastLiveBook = liveBook

      const fieldsMatch = liveBook && comparedFields.every(
        (field) => JSON.stringify(liveBook[field] ?? null) === JSON.stringify(localBook[field] ?? null),
      )

      if (fieldsMatch) {
        if (localBook.vaultGuideSource) {
          const guideResponse = await fetch(
            new URL(localBook.vaultGuide, 'https://firstpair.org').href,
            { cache: 'no-store' },
          ).catch(() => null)
          const guideBody = guideResponse?.ok ? await guideResponse.text() : ''
          lastGuideCheck = {
            status: guideResponse?.status ?? null,
            contentType: guideResponse?.headers.get('content-type') ?? null,
            contentDisposition: guideResponse?.headers.get('content-disposition') ?? null,
            rendered: /<h1\b/i.test(guideBody),
            hasLibraryLink:
              guideBody.includes('First Pair Library') &&
              guideBody.includes('firstpair-library-link'),
          }

          if (
            !guideResponse?.ok ||
            !lastGuideCheck.contentType?.includes('text/html') ||
            /^attachment\b/i.test(lastGuideCheck.contentDisposition ?? '') ||
            !lastGuideCheck.rendered ||
            !lastGuideCheck.hasLibraryLink
          ) {
            await new Promise((resolveWait) => setTimeout(resolveWait, 5000))
            continue
          }
        }

        console.error(`live catalog and hosted readers match local entry for ${plan.slug}`)
        return
      }
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 5000))
  }

  throw new Error(
    `live catalog did not update for ${plan.slug} within 180s\n${JSON.stringify(
      {
        expected: Object.fromEntries(comparedFields.map((field) => [field, localBook[field]])),
        actual:
          lastLiveBook &&
          Object.fromEntries(comparedFields.map((field) => [field, lastLiveBook[field]])),
        guideCheck: lastGuideCheck,
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
    version.description,
    metadata.description,
    `${subtitle ? `${title}: ${subtitle}` : title}, delivered as PDF, EPUB, and hosted web readers.`,
  )
  const tags = options.tags.length
    ? [...new Set(options.tags)]
    : [edition === 'preview' ? 'preview' : 'finished']
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
  const vault = await resolveVault(inputDir, distDir, edition, version, slug, options)
  const cover = await resolveCover(inputDir, distDir, metadata, slug)
  const headboard = await resolveHeadboard(inputDir, distDir, metadata, slug)

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
    vault,
    cover,
    headboard,
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

function printablePlan(
  plan,
  sourceMap = null,
  icloudCopies = [],
  vaultCopies = [],
  catalogEntry = null,
  dryRun = false,
) {
  return {
    slug: plan.slug,
    shelf: plan.shelf,
    title: plan.title,
    distDir: plan.distDir,
    edition: plan.edition,
    stageDir: repoRelative(plan.stageDir),
    publicDir: repoRelative(plan.publicDir),
    source: plan.source,
    dryRun,
    catalogEntry,
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
      vault: plan.vault
        ? {
            source: plan.vault.dir,
            zip: plan.vault.zipName,
            guideMarkdown: plan.vault.guideName,
            guideHtml: plan.vault.guideHtmlName,
            validation: plan.vault.validation,
          }
        : null,
      cover: plan.cover
        ? {
            source: plan.cover.sourcePath,
            staged: repoRelative(join(plan.stageDir, plan.cover.stableName)),
          }
        : null,
      headboard: plan.headboard
        ? {
            source: plan.headboard.sourcePath,
            staged: repoRelative(join(plan.stageDir, plan.headboard.stableName)),
          }
        : null,
    },
    sourceMap,
    icloudCopies: icloudCopies.map((copy) => copy.path),
    vaultCopies: vaultCopies.map((copy) => copy.path),
    actions: {
      stageOnly: plan.stageOnly,
      upload: !dryRun && !plan.stageOnly,
      copyIcloud: !dryRun && plan.copyIcloud && !plan.stageOnly,
      deliverVault: !dryRun && Boolean(plan.vault) && !plan.stageOnly,
      checkCatalog: !dryRun && plan.runCheck && !plan.stageOnly,
      prodBuild: !dryRun && plan.runBuild && !plan.stageOnly,
      smoke: !dryRun && plan.runSmoke && !plan.stageOnly,
      productionDeploy: !dryRun && plan.runDeploy && !plan.stageOnly,
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
      (
        /preview/i.test(gateEntry.kicker ?? '') ||
        Boolean(gateEntry.homepage) ||
        gateEntry.tags?.some((tag) => String(tag).toLowerCase() === 'preview')
      ),
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
  await stageCompanions(plan, dryRun)
  const sourceMap = await refreshSourceMap(plan, dryRun)

  if (plan.stageOnly) {
    console.log(JSON.stringify(printablePlan(plan, sourceMap, [], [], null, dryRun), null, 2))
    return
  }

  const catalogEntry = await refreshCatalog(plan, dryRun)

  if (dryRun) {
    const vaultPreview = await copyCompanionsToIcloud(plan, dryRun)
    console.log(
      JSON.stringify(
        printablePlan(plan, sourceMap, [], vaultPreview, catalogEntry, dryRun),
        null,
        2,
      ),
    )
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
  const vaultCopies = await copyCompanionsToIcloud(plan, dryRun)

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

  console.log(JSON.stringify(printablePlan(plan, sourceMap, icloudCopies, vaultCopies), null, 2))
}

main().catch((error) => {
  fail(error?.stack ?? error)
})
