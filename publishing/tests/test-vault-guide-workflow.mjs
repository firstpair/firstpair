import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renderVaultGuide } from '../../scripts/render-vault-guide.mjs'

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const work = await mkdtemp(join(tmpdir(), 'firstpair-vault-guide-test-'))

function run(command, args) {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []

    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      const result = {
        code,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }

      if (code === 0) {
        resolveProcess(result)
      } else {
        reject(new Error(`${command} failed (${code}):\n${result.stderr}`))
      }
    })
  })
}

try {
  const source = join(work, 'VAULT-GUIDE.md')
  const destination = join(work, 'vault-guide.html')

  await writeFile(
    source,
    `# Fixture Vault Guide

Open \`Home.md\`, then use [[Book Map|the book map]].

| Artifact | Purpose |
| --- | --- |
| Vault | Editorial graph |
`,
  )

  await renderVaultGuide({
    source,
    destination,
    title: 'Fixture Book — Obsidian Vault Guide',
  })

  const html = await readFile(destination, 'utf8')

  assert.match(html, /^<!DOCTYPE html>/)
  assert.match(html, /<title>Fixture Book — Obsidian Vault Guide<\/title>/)
  assert.match(html, /<h1[^>]*>Fixture Vault Guide<\/h1>/)
  assert.match(html, /<table>/)
  assert.match(html, /href="Book Map" class="wikilink"/)
  assert.match(html, /max-width: 52rem/)
  assert.doesNotMatch(html, /<link\b[^>]*rel=["']stylesheet["']/i)

  const harness = join(work, 'firstpair')
  const fixtureBook = join(work, 'fixture-book')
  const dist = join(fixtureBook, 'dist')
  const chapters = join(dist, 'fixture-book-chapters')
  const vault = join(fixtureBook, 'dist-obsidian', 'Fixture Book Vault')
  const vaultData = join(vault, 'Fixture Book', '_data')
  const guide = join(fixtureBook, 'docs', 'OBSIDIAN-VAULT.md')

  await Promise.all([
    mkdir(join(harness, 'scripts'), { recursive: true }),
    mkdir(join(harness, 'api'), { recursive: true }),
    mkdir(join(harness, 'publishing', 'assets'), { recursive: true }),
    mkdir(join(harness, 'book-uploads'), { recursive: true }),
    mkdir(join(harness, 'public'), { recursive: true }),
    mkdir(chapters, { recursive: true }),
    mkdir(vaultData, { recursive: true }),
    mkdir(dirname(guide), { recursive: true }),
  ])
  await Promise.all([
    copyFile(
      join(repoRoot, 'scripts', 'publish-book-to-library.mjs'),
      join(harness, 'scripts', 'publish-book-to-library.mjs'),
    ),
    copyFile(
      join(repoRoot, 'scripts', 'render-vault-guide.mjs'),
      join(harness, 'scripts', 'render-vault-guide.mjs'),
    ),
    copyFile(
      join(repoRoot, 'scripts', 'upload-book-package.mjs'),
      join(harness, 'scripts', 'upload-book-package.mjs'),
    ),
    copyFile(
      join(repoRoot, 'scripts', 'sync-reader-routes.mjs'),
      join(harness, 'scripts', 'sync-reader-routes.mjs'),
    ),
    copyFile(
      join(repoRoot, 'scripts', 'check-public-catalog.mjs'),
      join(harness, 'scripts', 'check-public-catalog.mjs'),
    ),
    copyFile(join(repoRoot, 'api', 'reader.mjs'), join(harness, 'api', 'reader.mjs')),
    copyFile(
      join(repoRoot, 'publishing', 'assets', 'vault-guide.css'),
      join(harness, 'publishing', 'assets', 'vault-guide.css'),
    ),
  ])
  await Promise.all([
    writeFile(join(harness, 'public', 'catalog.json'), '{"books":[]}\n'),
    writeFile(join(harness, 'book-uploads', 'book-package-sources.json'), '{"books":{}}\n'),
    writeFile(
      join(fixtureBook, 'metadata.yaml'),
      `description: >
  A complete fixture book whose folded YAML description
  must survive the preview-to-full transition.
`,
    ),
    writeFile(
      join(dist, 'VERSION.md'),
      `title: Fixture Book
title_stem: fixture-book
version: 1.2.3
version_stamp: 1.2.3-deadbeef
edition: full
pdf_file: fixture-book.pdf
epub_file: fixture-book.epub
html_file: fixture-book.html
html_chapters_dir: fixture-book-chapters
`,
    ),
    writeFile(join(dist, 'fixture-book.pdf'), '%PDF-1.4 fixture\n'),
    writeFile(join(dist, 'fixture-book.epub'), 'fixture epub\n'),
    writeFile(join(dist, 'fixture-book.html'), '<!doctype html><title>Fixture Book</title>\n'),
    writeFile(join(chapters, 'index.html'), '<!doctype html><title>Fixture chapters</title>\n'),
    writeFile(join(vault, 'Home.md'), '# Fixture vault\n'),
    writeFile(join(vaultData, 'units.jsonl'), '{"id":"fixture-1"}\n'),
    writeFile(guide, '# Fixture Book Vault\n\nOpen `Home.md`.\n'),
  ])

  const staged = await run(process.execPath, [
    join(harness, 'scripts', 'publish-book-to-library.mjs'),
    fixtureBook,
    '--slug',
    'fixture-book',
    '--source',
    'https://example.com/fixture-book',
    '--vault-dir',
    vault,
    '--vault-guide',
    guide,
    '--stage-only',
    '--no-icloud',
    '--no-build',
    '--no-smoke',
    '--no-deploy',
  ])
  const plan = JSON.parse(staged.stdout.toString('utf8'))
  const stageDir = join(harness, 'book-uploads', 'staging', 'fixture-book')
  const rawGuide = join(stageDir, 'fixture-book-vault-guide (1.2.3-deadbeef).md')
  const htmlGuide = join(stageDir, 'fixture-book-vault-guide (1.2.3-deadbeef).html')
  const vaultZip = join(stageDir, 'fixture-book-full-vault (1.2.3-deadbeef).zip')
  const sourceMap = JSON.parse(
    await readFile(join(harness, 'book-uploads', 'book-package-sources.json'), 'utf8'),
  ).books['fixture-book']

  assert.equal(plan.artifacts.vault.guideMarkdown, 'fixture-book-vault-guide (1.2.3-deadbeef).md')
  assert.equal(plan.artifacts.vault.guideHtml, 'fixture-book-vault-guide (1.2.3-deadbeef).html')
  assert.equal(await readFile(rawGuide, 'utf8'), await readFile(guide, 'utf8'))
  assert.match(await readFile(htmlGuide, 'utf8'), /<h1[^>]*>Fixture Book Vault<\/h1>/)
  assert.match(sourceMap.vaultGuideMarkdown, /\.md$/)
  assert.match(sourceMap.vaultGuideHtml, /\.html$/)

  const archivedGuide = await run('unzip', [
    '-p',
    vaultZip,
    'Fixture Book Vault/README.md',
  ])
  assert.deepEqual(archivedGuide.stdout, await readFile(guide))

  await symlink(join(repoRoot, 'node_modules'), join(harness, 'node_modules'), 'dir')
  await mkdir(join(harness, 'public', 'fixture-book'), { recursive: true })
  await writeFile(join(harness, 'public', 'fixture-book', 'README.md'), '# Fixture Book\n')
  await writeFile(
    join(harness, 'public', 'catalog.json'),
    `${JSON.stringify(
      {
        books: [
          {
            slug: 'fixture-book',
            title: 'Fixture Book',
            kicker: 'Preview edition',
            description: 'A preview-only description.',
            accent: '#123456',
            homepage: '/fixture-book/preview/',
            pdf: 'https://example.com/preview.pdf',
            epub: 'https://example.com/preview.epub',
            html: '/read/fixture-book/',
            htmlChapters: '/read/fixture-book/chapters/',
            htmlSource: 'https://example.com/preview.html',
            htmlChaptersSource: 'https://example.com/preview-chapters/index.html',
            tags: ['preview', 'fixture-topic'],
          },
        ],
      },
      null,
      2,
    )}\n`,
  )

  const fullDryRun = await run(process.execPath, [
    join(harness, 'scripts', 'publish-book-to-library.mjs'),
    fixtureBook,
    '--slug',
    'fixture-book',
    '--source',
    'https://example.com/fixture-book',
    '--full',
    '--vault-dir',
    vault,
    '--vault-guide',
    guide,
    '--dry-run',
    '--no-icloud',
    '--no-build',
    '--no-smoke',
    '--no-deploy',
  ])
  const fullPlan = JSON.parse(fullDryRun.stdout.toString('utf8'))

  assert.equal(fullPlan.catalogEntry.kicker, 'Finished book')
  assert.equal(
    fullPlan.catalogEntry.description,
    'A complete fixture book whose folded YAML description must survive the preview-to-full transition.',
  )
  assert.equal(fullPlan.catalogEntry.source, 'https://example.com/fixture-book')
  assert.equal(Object.hasOwn(fullPlan.catalogEntry, 'homepage'), false)
  assert.deepEqual(fullPlan.catalogEntry.tags, ['finished', 'fixture-topic'])

  await writeFile(
    join(harness, 'public', 'catalog.json'),
    `${JSON.stringify(
      {
        books: [
          {
            slug: 'fixture-book',
            title: 'Fixture Book',
            kicker: 'Finished book',
            description: 'A fixture.',
            accent: '#123456',
            pdf: 'https://example.com/fixture.pdf',
            epub: 'https://example.com/fixture.epub',
            html: '/read/fixture-book/',
            htmlChapters: '/read/fixture-book/chapters/',
            htmlSource: 'https://example.com/fixture.html',
            htmlChaptersSource: 'https://example.com/chapters/index.html',
            vault: 'https://example.com/fixture-vault.zip',
            vaultGuide: '/read/fixture-book/guide/',
            vaultGuideSource: 'https://example.com/fixture-guide.html',
            tags: ['finished'],
          },
        ],
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(join(harness, 'vercel.json'), '{}\n')

  const upload = await run(process.execPath, [
    join(harness, 'scripts', 'upload-book-package.mjs'),
    'fixture-book',
    '--dry-run',
  ])
  const uploadSummary = JSON.parse(upload.stdout.toString('utf8'))
  assert.match(uploadSummary.units.vaultGuide.localPath, /\.html$/)
  assert.equal(uploadSummary.units.vaultGuide.url, null)

  await run(process.execPath, [join(harness, 'scripts', 'sync-reader-routes.mjs')])
  await run(process.execPath, [join(harness, 'scripts', 'check-public-catalog.mjs')])
  const readerMap = await readFile(join(harness, 'reader-map.mjs'), 'utf8')
  assert.match(readerMap, /"vaultGuideSource": "https:\/\/example\.com\/fixture-guide\.html"/)

  const originalFetch = globalThis.fetch
  let fetchedUrl = ''
  globalThis.fetch = async (url) => {
    fetchedUrl = String(url)
    return new Response(
      '<!DOCTYPE html><html><head><title>Fixture Book</title></head><body><h1>Fixture guide</h1></body></html>',
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  }

  try {
    const { default: readerHandler } = await import(
      `${pathToFileURL(join(harness, 'api', 'reader.mjs')).href}?fixture=1`
    )
    const responseHeaders = new Map()
    const response = {
      statusCode: 0,
      body: '',
      setHeader(name, value) {
        responseHeaders.set(name.toLowerCase(), value)
      },
      end(body = '') {
        this.body = String(body)
      },
    }

    await readerHandler(
      {
        method: 'GET',
        url: '/api/reader?path=fixture-book/guide/',
        headers: {},
      },
      response,
    )

    assert.equal(fetchedUrl, 'https://example.com/fixture-guide.html')
    assert.equal(response.statusCode, 200)
    assert.equal(responseHeaders.get('content-disposition'), 'inline')
    assert.match(responseHeaders.get('content-type'), /text\/html/)
    assert.match(response.body, /firstpair-library-link/)
    assert.match(response.body, /First Pair Library/)
  } finally {
    globalThis.fetch = originalFetch
  }

  console.log('Vault-guide render, stage, upload, route, and proxy fixtures passed')
} finally {
  await rm(work, { recursive: true, force: true })
}
