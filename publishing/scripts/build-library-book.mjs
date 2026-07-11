#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const firstpairRoot = dirname(dirname(scriptDir))

function usage() {
  console.error(`usage: build-library-book.sh [preview|full|both] [options]

Options:
  --repo-root <dir>       Source repository root (default: current directory)
  --config <file>         Config path (default: <repo-root>/book.build.json)
  --edition <mode>        preview, full, or both
  --dist <dir>            Override dist for a single-edition build
  --print-plan            Resolve configuration without building
  --help                  Show this help

book.build.json is the canonical configuration. Environment variables are
supported only for process/tool compatibility and are not a second config API.`)
}

function parseArgs(argv) {
  const options = {}
  const positional = []
  const valueFlags = new Set(['repo-root', 'config', 'edition', 'dist'])
  const booleanFlags = new Set(['print-plan', 'help'])

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const [key, inline] = arg.slice(2).split('=', 2)
    if (booleanFlags.has(key)) {
      options[key] = true
      continue
    }
    if (!valueFlags.has(key)) throw new Error(`unknown option: --${key}`)
    const value = inline ?? argv[++index]
    if (!value) throw new Error(`missing value for --${key}`)
    options[key] = value
  }

  if (positional.length > 1) throw new Error(`unexpected arguments: ${positional.join(' ')}`)
  if (positional[0]) options.edition ??= positional[0]
  return options
}

function run(command, args, options = {}) {
  const display = options.display ?? [command, ...args].join(' ')
  if (!options.quiet) console.error(`$ ${display}`)
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: options.stdio ?? 'inherit',
  })

  if (result.error || result.status !== 0) {
    const detail = options.stdio === 'pipe' ? `${result.stderr ?? ''}`.trim() : ''
    throw new Error(`${display} failed${detail ? `: ${detail}` : ''}`)
  }
  return options.stdio === 'pipe' ? `${result.stdout ?? ''}`.trim() : ''
}

function commandOutput(command, args, cwd) {
  return run(command, args, { cwd, quiet: true, stdio: 'pipe' })
}

function deepMerge(base, override) {
  if (Array.isArray(override)) return [...override]
  if (!override || typeof override !== 'object') return override ?? base
  const result = { ...(base ?? {}) }
  for (const [key, value] of Object.entries(override)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? deepMerge(result[key], value)
      : value
  }
  return result
}

function parseKeyValue(text) {
  const result = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line)
    if (match) result[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, '$2')
  }
  return result
}

function expand(value, context) {
  if (typeof value !== 'string') return value
  return value.replace(/\$\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, key) => {
    if (context[key] === undefined) throw new Error(`unknown config placeholder: ${match}`)
    return String(context[key])
  })
}

function resolvePath(value, context) {
  if (!value) return null
  const expanded = expand(value, context)
  return isAbsolute(expanded) ? expanded : resolve(context.repoRoot, expanded)
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`
}

function hookList(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function hookEnvironment(config, context, extra = {}) {
  const configured = {}
  for (const [key, value] of Object.entries(config.environment ?? {})) {
    configured[key] = expand(String(value), context)
  }
  return {
    ...process.env,
    PATH: `${join(firstpairRoot, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    TMPDIR: context.tmpDir,
    CALIBRE_CONFIG_DIRECTORY: join(context.tmpDir, 'calibre-config'),
    ...configured,
    ...extra,
  }
}

function runHook(hook, config, context) {
  if (typeof hook === 'string') hook = { run: hook }
  const cwd = resolvePath(hook.cwd ?? '.', context)
  const environment = hookEnvironment(config, context, Object.fromEntries(
    Object.entries(hook.env ?? {}).map(([key, value]) => [key, expand(String(value), context)]),
  ))

  if (hook.python) {
    const project = resolvePath(hook.project ?? '.', context)
    const python = commandOutput(join(scriptDir, 'ensure-python-env.sh'), [project], context.repoRoot)
    const pythonArgs = [resolvePath(hook.python, context), ...(hook.args ?? []).map((arg) => expand(arg, context))]
    run(python, pythonArgs, { cwd, env: environment })
    return
  }

  if (!hook.run) throw new Error('hook must define run or python')
  const script = expand(hook.run, context)
  run('/bin/bash', ['-euo', 'pipefail', '-c', script], {
    cwd,
    env: environment,
    display: script,
  })
}

function runHooks(hooks, config, context) {
  for (const hook of hookList(hooks)) runHook(hook, config, context)
}

function readCargoVersion(path) {
  const text = readFileSync(path, 'utf8')
  let inPackage = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[(workspace\.package|package)\]\s*$/.test(line)) {
      inPackage = true
      continue
    }
    if (/^\s*\[/.test(line)) inPackage = false
    if (inPackage) {
      const match = /^\s*version\s*=\s*["']([^"']+)/.exec(line)
      if (match) return match[1]
    }
  }
  return null
}

function detectVersion(config, context) {
  if (typeof config.version === 'string') return expand(config.version, context)
  const specification = config.version ?? {}
  const source = specification.source
  const file = specification.file ? resolvePath(specification.file, context) : null

  if (source === 'literal') return String(specification.value)
  if (source === 'file') return readFileSync(file, 'utf8').trim()
  if (source === 'cargo') return readCargoVersion(file ?? join(context.repoRoot, 'Cargo.toml'))
  if (source === 'package') {
    return JSON.parse(readFileSync(file ?? join(context.repoRoot, 'package.json'), 'utf8')).version
  }

  for (const candidate of [
    join(context.bookRoot, 'VERSION'),
    join(context.repoRoot, 'VERSION'),
    join(context.repoRoot, 'Cargo.toml'),
    join(context.repoRoot, 'package.json'),
  ]) {
    if (!existsSync(candidate)) continue
    if (basename(candidate) === 'Cargo.toml') return readCargoVersion(candidate)
    if (basename(candidate) === 'package.json') return JSON.parse(readFileSync(candidate, 'utf8')).version
    return readFileSync(candidate, 'utf8').trim()
  }
  throw new Error('could not detect a book version; configure version in book.build.json')
}

function sourceCommit(config, context) {
  try {
    const commit = commandOutput('git', ['rev-parse', '--short=8', 'HEAD'], context.repoRoot)
    if (commit) return commit
  } catch {
    // A content stamp below is the deterministic fallback for non-Git/no-commit trees.
  }

  const hash = createHash('sha256')
  hash.update(readFileSync(context.configPath))
  const sources = config.sourceFiles ?? [config.manuscript, config.metadata, config.cover].filter(Boolean)
  for (const source of sources) {
    const path = resolvePath(source, context)
    if (path && existsSync(path)) {
      hash.update(relative(context.repoRoot, path))
      hash.update(readFileSync(path))
    }
  }
  return `content-${hash.digest('hex').slice(0, 12)}`
}

function pandocBaseArgs(config, context) {
  const args = []
  const pandoc = config.pandoc ?? {}
  if (pandoc.reader) args.push('--from', pandoc.reader)
  if (pandoc.toc !== false) args.push('--toc')
  if (pandoc.tocDepth) args.push(`--toc-depth=${pandoc.tocDepth}`)
  if (pandoc.numberSections !== false) args.push('--number-sections')
  if (context.metadata) args.push('--metadata-file', context.metadata)
  args.push('--metadata', `date=${context.builtDate}`)
  const resources = (pandoc.resourcePaths ?? [context.buildDir, context.bookRoot, context.repoRoot])
    .map((entry) => resolvePath(entry, context))
  args.push('--resource-path', resources.join(':'))
  args.push(...(pandoc.commonArgs ?? []).map((arg) => expand(String(arg), context)))
  return args
}

function renderCover(config, context) {
  if (!context.cover) return null
  let text = readFileSync(context.cover, 'utf8')
  const replacements = {
    KINDLE_NAME: context.kindleName,
    BOOK_NAME: context.kindleName,
    TITLE: context.title,
    SUBTITLE: context.subtitle,
    AUTHOR: context.author,
    VERSION: context.version,
    VERSION_STAMP: context.versionStamp,
  }
  for (const [key, value] of Object.entries(replacements)) {
    text = text.replaceAll(`{{${key}}}`, value ?? '')
  }
  const path = join(context.tmpDir, 'cover.rendered.md')
  writeFileSync(path, text)
  return path
}

function runPandoc(args, config, context) {
  mkdirSync(join(context.tmpDir, 'pandoc'), { recursive: true })
  run('pandoc', args, {
    cwd: join(context.tmpDir, 'pandoc'),
    env: hookEnvironment(config, context),
  })
}

function buildTypstPdf(variant, config, context) {
  const output = join(context.distDir, `${variant.stem}.pdf`)
  const body = join(context.tmpDir, `${variant.name}.body.pdf`)
  const pdfConfig = config.pdf ?? {}
  const args = [
    context.manuscript,
    '-o', body,
    '--pdf-engine=typst',
    ...pandocBaseArgs(config, context),
    ...(pdfConfig.includeInHeader ?? []).flatMap((path) => ['--include-in-header', resolvePath(path, context)]),
    ...Object.entries(pdfConfig.variables ?? {}).flatMap(([key, value]) => ['-V', `${key}=${expand(String(value), context)}`]),
    ...(pdfConfig.args ?? []).map((arg) => expand(String(arg), context)),
    ...(variant.args ?? []).map((arg) => expand(String(arg), context)),
  ]
  runPandoc(args, config, context)

  if (context.renderedCover && pdfConfig.separateCover !== false) {
    const coverPdf = join(context.tmpDir, `${variant.name}.cover.pdf`)
    runPandoc([
      context.renderedCover,
      '-o', coverPdf,
      '--pdf-engine=typst',
      ...(pdfConfig.coverArgs ?? []).map((arg) => expand(String(arg), context)),
    ], config, context)
    run('pdfunite', [coverPdf, body, output], { cwd: context.repoRoot })
  } else {
    copyFileSync(body, output)
  }
  return output
}

function buildNeatroffPdf(variant, config, context) {
  const root = process.env.NEATROFF_ROOT ?? join(homedir(), 'src', 'neatroff_make')
  const utmac = process.env.UTMAC_DIR ?? join(firstpairRoot, '.tools', 'utmac')
  const source = variant.source ? resolvePath(variant.source, context) : join(context.tmpDir, `${variant.name}.utmac.tr`)
  const output = join(context.distDir, `${variant.stem}.pdf`)

  if (!variant.source) {
    run(join(scriptDir, 'setup-utmac.sh'), [utmac], { cwd: firstpairRoot })
    const python = commandOutput(
      join(scriptDir, 'ensure-python-env.sh'),
      [join(firstpairRoot, 'publishing', 'python')],
      firstpairRoot,
    )
    run(python, [join(scriptDir, 'md-to-utmac.py'), context.manuscript, source], {
      cwd: context.repoRoot,
      env: hookEnvironment(config, context),
    })
  }

  const pipeline = [
    `${shellQuote(join(root, 'neatroff', 'roff'))} -M${shellQuote(utmac)} -mu-en -mus ${shellQuote(source)}`,
    `${shellQuote(join(root, 'neatpost', 'pdf'))} > ${shellQuote(output)}`,
  ].join(' | ')
  run('/bin/bash', ['-euo', 'pipefail', '-c', pipeline], { cwd: context.repoRoot, display: pipeline })
  if (variant.trimLeadingBlankPages !== false) trimLeadingBlankPages(output, context)
  return output
}

function trimLeadingBlankPages(pdf, context) {
  const info = commandOutput('pdfinfo', [pdf], context.repoRoot)
  let pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1])
  let firstContentPage = 1

  while (firstContentPage < pages) {
    const text = commandOutput(
      'pdftotext',
      ['-f', String(firstContentPage), '-l', String(firstContentPage), pdf, '-'],
      context.repoRoot,
    )
    if (text.trim()) break
    firstContentPage += 1
  }

  if (firstContentPage === 1) return
  const splitDir = join(context.tmpDir, 'trim-neatroff')
  mkdirSync(splitDir, { recursive: true })
  run('pdfseparate', [
    '-f', String(firstContentPage),
    '-l', String(pages),
    pdf,
    join(splitDir, 'page-%d.pdf'),
  ], { cwd: context.repoRoot })
  const inputs = []
  for (let page = firstContentPage; page <= pages; page += 1) {
    inputs.push(join(splitDir, `page-${page}.pdf`))
  }
  const trimmed = join(context.tmpDir, 'neatroff-trimmed.pdf')
  run('pdfunite', [...inputs, trimmed], { cwd: context.repoRoot })
  copyFileSync(trimmed, pdf)
  console.error(`Trimmed ${firstContentPage - 1} leading blank Neatroff page(s) from ${basename(pdf)}`)
}

function cleanVersionedArtifacts(context) {
  if (!existsSync(context.distDir)) return
  for (const entry of readdirSync(context.distDir)) {
    if (entry.startsWith(`${context.stem} (`) && lstatSync(join(context.distDir, entry)).isSymbolicLink()) {
      rmSync(join(context.distDir, entry), { recursive: true, force: true })
    }
  }
}

function ensureSymlink(targetName, linkPath) {
  rmSync(linkPath, { recursive: true, force: true })
  symlinkSync(targetName, linkPath)
}

function buildEpub(config, context) {
  const output = join(context.distDir, `${context.stem}.epub`)
  const epub = config.epub ?? {}
  const sources = context.renderedCover && epub.includeRenderedCover !== false
    ? [context.renderedCover, context.manuscript]
    : [context.manuscript]
  const args = [
    ...sources,
    '-o', output,
    '--to=epub3',
    ...pandocBaseArgs(config, context),
  ]
  if (context.css) args.push('--css', context.css)
  if (epub.titlePage !== true) args.push('--epub-title-page=false')
  if (epub.coverImage) args.push('--epub-cover-image', resolvePath(epub.coverImage, context))
  args.push(...(epub.args ?? []).map((arg) => expand(String(arg), context)))
  runPandoc(args, config, context)
  return output
}

function buildHtml(config, context) {
  const env = hookEnvironment(config, context, {
    REPO_ROOT: context.repoRoot,
    BOOK_ROOT: relative(context.repoRoot, context.bookRoot),
    BOOK_DIST_DIR: context.distDir,
    BOOK_BUILD_DIR: context.buildDir,
    BOOK_METADATA: context.metadata,
    BOOK_HTML_COVER: context.renderedCover ?? '',
    BOOK_HTML_MANUSCRIPT: context.manuscript,
    BOOK_HTML_CSS: context.css ?? '',
    BOOK_STEM: context.stem,
    BOOK_VISIBLE_TITLE: context.title,
    BOOK_VERSION: context.version,
    BOOK_VERSION_STAMP: context.versionStamp,
    BOOK_PUBDATE: context.builtDate,
    BOOK_HTML_RESOURCE_PATH: (config.pandoc?.resourcePaths ?? [context.buildDir, context.bookRoot, context.repoRoot])
      .map((entry) => resolvePath(entry, context)).join(':'),
    BOOK_HTML_READER: config.pandoc?.reader ?? 'markdown+smart',
    BOOK_HTML_TOC_DEPTH: String(config.pandoc?.tocDepth ?? 2),
    BOOK_HTML_SPLIT_LEVEL: String(config.html?.splitLevel ?? 1),
    BOOK_HTML_LUA_FILTER: config.html?.luaFilter ? resolvePath(config.html.luaFilter, context) : '',
  })
  run(join(scriptDir, 'emit-html-book.sh'), [], { cwd: context.repoRoot, env })
}

function ebookConvert() {
  try {
    return commandOutput('/usr/bin/env', ['sh', '-c', 'command -v ebook-convert'], process.cwd())
  } catch {
    const app = '/Applications/calibre.app/Contents/MacOS/ebook-convert'
    if (existsSync(app)) return app
    throw new Error('ebook-convert is unavailable')
  }
}

function writeManifest(config, context, variants) {
  const lines = [
    ['title', context.title],
    ['subtitle', context.subtitle],
    ['author', context.author],
    ['title_stem', context.stem],
    ['edition', context.edition],
    ['version', context.version],
    ['version_stamp', context.versionStamp],
    ['source_commit', context.sourceCommit],
    ['built_at', context.builtAt],
    ['toolchain_lock', relative(context.repoRoot, join(firstpairRoot, 'publishing', 'toolchain.lock.json'))],
    ['primary_format', context.primaryFormat],
    ['kindle_name', context.kindleName],
    ['kindle_link', `${context.kindleName}.epub`],
    ['pdf_file', `${context.stem}.pdf`],
    ['epub_file', `${context.stem}.epub`],
    ['html_file', `${context.stem}.html`],
    ['html_chapters_dir', `${context.stem}-chapters`],
    ['html_title', context.title],
    ['pdf_link', `${context.versionedStem}.pdf`],
    ['epub_link', `${context.versionedStem}.epub`],
    ['html_link', `${context.versionedStem}.html`],
    ['html_chapters_link', `${context.versionedStem}-chapters`],
  ]

  if (config.mobi !== false && existsSync(join(context.distDir, `${context.stem}.mobi`))) {
    lines.push(['mobi_file', `${context.stem}.mobi`])
  }
  if (config.tutorial) lines.push(['tutorial_file', basename(resolvePath(config.tutorial, context))])

  for (const variant of variants) {
    lines.push([`pdf_file_${variant.name}`, `${variant.stem}.pdf`])
    lines.push([`pdf_link_${variant.name}`, `${variant.stem} (${context.versionStamp}).pdf`])
  }

  const text = `${lines.filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${String(value).replace(/[\r\n]+/g, ' ')}`)
    .join('\n')}\n`
  writeFileSync(join(context.distDir, 'VERSION.md'), text)
}

function editionConfigs(config, mode) {
  if (!config.editions) {
    const edition = config.edition ?? 'full'
    if (mode && mode !== edition && mode !== 'both') {
      throw new Error(`single-edition book is ${edition}; it does not provide ${mode}`)
    }
    return [[edition, { ...config, edition }]]
  }
  const selected = mode === 'both' ? Object.keys(config.editions) : [mode ?? config.defaultEdition ?? 'preview']
  return selected.map((edition) => {
    if (!config.editions[edition]) throw new Error(`book.build.json has no ${edition} edition`)
    const merged = deepMerge(config, config.editions[edition])
    delete merged.editions
    return [edition, { ...merged, edition }]
  })
}

function buildEdition(config, baseContext, distOverride) {
  const tmpDir = mkdtempSync(join(tmpdir(), `firstpair-${config.edition}-`))
  const preliminary = {
    ...baseContext,
    edition: config.edition,
    tmpDir,
  }

  try {
    preliminary.bookRoot = resolvePath(config.bookRoot ?? '.', preliminary)
    preliminary.buildDir = resolvePath(config.buildDir ?? join(config.bookRoot ?? '.', 'build', 'firstpair'), preliminary)
    preliminary.distDir = distOverride
      ? resolve(baseContext.repoRoot, distOverride)
      : resolvePath(config.dist ?? join(config.bookRoot ?? '.', 'dist'), preliminary)
    mkdirSync(preliminary.buildDir, { recursive: true })
    if (config.cleanDist) rmSync(preliminary.distDir, { recursive: true, force: true })
    mkdirSync(preliminary.distDir, { recursive: true })
    mkdirSync(join(tmpDir, 'calibre-config'), { recursive: true })

    runHooks(config.hooks?.prepare, config, preliminary)

    preliminary.manuscript = resolvePath(config.manuscript, preliminary)
    preliminary.metadata = resolvePath(config.metadata, preliminary)
    preliminary.cover = resolvePath(config.cover, preliminary)
    preliminary.css = resolvePath(config.css, preliminary)
    for (const [label, path] of [['manuscript', preliminary.manuscript], ['metadata', preliminary.metadata]]) {
      if (!path || !existsSync(path)) throw new Error(`missing ${label}: ${path ?? '(not configured)'}`)
    }
    if (preliminary.cover && !existsSync(preliminary.cover)) throw new Error(`missing cover: ${preliminary.cover}`)
    if (preliminary.css && !existsSync(preliminary.css)) throw new Error(`missing CSS: ${preliminary.css}`)

    const metadata = parseKeyValue(readFileSync(preliminary.metadata, 'utf8'))
    preliminary.title = config.title ?? metadata.title
    preliminary.subtitle = config.subtitle ?? metadata.subtitle ?? ''
    preliminary.author = config.author ?? metadata.author ?? metadata.creator ?? ''
    preliminary.stem = config.stem ?? metadata.title_stem
    if (!preliminary.title || !preliminary.stem) throw new Error('metadata/config must define title and title_stem/stem')
    preliminary.version = detectVersion(config, preliminary)
    preliminary.sourceCommit = sourceCommit(config, preliminary)
    preliminary.versionStamp = expand(
      config.versionStamp ?? '${version}-${sourceCommit}',
      preliminary,
    )
    preliminary.builtAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    preliminary.builtDate = preliminary.builtAt.slice(0, 10)
    preliminary.kindleName = expand(
      config.kindleName ?? '${stem} (${versionStamp})',
      preliminary,
    )
    preliminary.versionedStem = expand(
      config.versionedStem ?? '${stem} (${versionStamp})',
      preliminary,
    )
    preliminary.renderedCover = renderCover(config, preliminary)

    const variants = (config.pdfFormats ?? [{ name: 'typst', renderer: 'typst', primary: true }])
      .map((variant, index, all) => ({
        ...variant,
        name: variant.name ?? variant.renderer,
        stem: expand(variant.stem ?? ((variant.primary || all.length === 1) ? '${stem}' : `\${stem}-${variant.name ?? variant.renderer}`), preliminary),
      }))
    const primary = variants.find((variant) => variant.primary) ?? variants[0]
    preliminary.primaryFormat = config.primaryFormat ?? primary.name
    cleanVersionedArtifacts(preliminary)

    for (const variant of variants) {
      if (variant.renderer === 'typst') buildTypstPdf(variant, config, preliminary)
      else if (variant.renderer === 'neatroff') buildNeatroffPdf(variant, config, preliminary)
      else if (variant.renderer === 'hook') {
        runHook({ run: variant.run }, config, { ...preliminary, pdfOutput: join(preliminary.distDir, `${variant.stem}.pdf`) })
      } else {
        throw new Error(`unsupported PDF renderer: ${variant.renderer}`)
      }
      if (!existsSync(join(preliminary.distDir, `${variant.stem}.pdf`))) {
        throw new Error(`PDF renderer did not create ${variant.stem}.pdf`)
      }
    }

    const primaryPdf = join(preliminary.distDir, `${primary.stem}.pdf`)
    const stablePdf = join(preliminary.distDir, `${preliminary.stem}.pdf`)
    if (primaryPdf !== stablePdf) copyFileSync(primaryPdf, stablePdf)
    runHooks(config.hooks?.postPdf, config, { ...preliminary, pdf: stablePdf })

    const epub = buildEpub(config, preliminary)
    runHooks(config.hooks?.postEpub, config, { ...preliminary, epub })
    buildHtml(config, preliminary)

    if (config.mobi !== false) {
      run(ebookConvert(), [epub, join(preliminary.distDir, `${preliminary.stem}.mobi`)], {
        cwd: preliminary.repoRoot,
        env: hookEnvironment(config, preliminary),
      })
    }

    if (config.tutorial) {
      const tutorial = resolvePath(config.tutorial, preliminary)
      if (!existsSync(tutorial)) throw new Error(`missing tutorial artifact: ${tutorial}`)
      const tutorialTarget = join(preliminary.distDir, basename(tutorial))
      if (tutorial !== tutorialTarget) copyFileSync(tutorial, tutorialTarget)
    }

    ensureSymlink(`${preliminary.stem}.pdf`, join(preliminary.distDir, `${preliminary.versionedStem}.pdf`))
    ensureSymlink(`${preliminary.stem}.epub`, join(preliminary.distDir, `${preliminary.versionedStem}.epub`))
    ensureSymlink(`${preliminary.stem}.epub`, join(preliminary.distDir, `${preliminary.kindleName}.epub`))
    ensureSymlink(`${preliminary.stem}.html`, join(preliminary.distDir, `${preliminary.versionedStem}.html`))
    ensureSymlink(`${preliminary.stem}-chapters`, join(preliminary.distDir, `${preliminary.versionedStem}-chapters`))
    for (const variant of variants) {
      ensureSymlink(`${variant.stem}.pdf`, join(preliminary.distDir, `${variant.stem} (${preliminary.versionStamp}).pdf`))
    }

    writeManifest(config, preliminary, variants)
    runHooks(config.hooks?.postBuild, config, preliminary)
    runHooks(config.validators, config, preliminary)
    run(join(scriptDir, 'verify-library-book.sh'), [preliminary.distDir], { cwd: preliminary.repoRoot })
    run(join(scriptDir, 'check-version-marker.sh'), [preliminary.distDir], { cwd: preliminary.repoRoot })
    console.log(`Built and verified ${preliminary.title} (${preliminary.edition}) in ${preliminary.distDir}`)
    return preliminary
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

try {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    usage()
    process.exit(0)
  }
  const repoRoot = resolve(options['repo-root'] ?? process.cwd())
  const configPath = resolve(repoRoot, options.config ?? 'book.build.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  if (config.schemaVersion !== 1) throw new Error('book.build.json must set schemaVersion to 1')
  if (options.edition && !['preview', 'full', 'both'].includes(options.edition)) {
    throw new Error(`invalid edition mode: ${options.edition}`)
  }

  run(join(scriptDir, 'verify-toolchain.mjs'), ['--quiet'], { cwd: firstpairRoot })
  const baseContext = { repoRoot, configPath, firstpairRoot }
  const bootstrapContext = {
    ...baseContext,
    bookRoot: resolve(repoRoot, config.bookRoot ?? '.'),
    buildDir: resolve(repoRoot, config.buildDir ?? join(config.bookRoot ?? '.', 'build', 'firstpair')),
    distDir: resolve(repoRoot, config.dist ?? join(config.bookRoot ?? '.', 'dist')),
    tmpDir: mkdtempSync(join(tmpdir(), 'firstpair-prebuild-')),
  }

  try {
    runHooks(config.hooks?.prebuild, config, bootstrapContext)
  } finally {
    rmSync(bootstrapContext.tmpDir, { recursive: true, force: true })
  }

  const editions = editionConfigs(config, options.edition)
  if (options['print-plan']) {
    console.log(JSON.stringify({
      repoRoot,
      configPath,
      editions: editions.map(([edition, editionConfig]) => ({
        edition,
        bookRoot: resolve(repoRoot, editionConfig.bookRoot ?? '.'),
        dist: resolve(repoRoot, options.dist ?? editionConfig.dist ?? join(editionConfig.bookRoot ?? '.', 'dist')),
        manuscript: editionConfig.manuscript,
      })),
    }, null, 2))
    process.exit(0)
  }

  if (options.dist && editions.length !== 1) throw new Error('--dist requires a single edition')
  for (const [, editionConfig] of editions) buildEdition(editionConfig, baseContext, options.dist)
} catch (error) {
  console.error(`build-library-book: ${error.message}`)
  process.exit(1)
}
