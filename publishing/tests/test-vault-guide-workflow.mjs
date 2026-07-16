import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
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
  const validator = join(fixtureBook, 'scripts', 'check-obsidian-vault.py')
  const cover = join(fixtureBook, 'assets', 'cover.png')
  const headboard = join(fixtureBook, 'assets', 'headboard.png')
  const stageDir = join(harness, 'book-uploads', 'staging', 'fixture-book')
  const firstOpenPayload = {
    main: {
      id: '0531043c990df55e',
      type: 'split',
      children: [
        {
          id: '9999cbdea50fbe72',
          type: 'tabs',
          children: [
            {
              id: 'fb59b2571954a561',
              type: 'leaf',
              state: {
                type: 'markdown',
                state: { file: 'Home.md', mode: 'preview', source: false },
                icon: 'lucide-file',
                title: 'Home',
              },
            },
          ],
        },
      ],
      direction: 'vertical',
    },
    left: {
      id: 'fbb039bb5e18d3b2',
      type: 'split',
      children: [
        {
          id: 'f52d68d4d1bea7f2',
          type: 'tabs',
          children: [
            {
              id: 'a900cdd0c196c7e8',
              type: 'leaf',
              state: {
                type: 'file-explorer',
                state: { sortOrder: 'alphabetical', autoReveal: false },
                icon: 'lucide-folder-closed',
                title: 'Files',
              },
            },
            {
              id: 'cea44760eccde1a3',
              type: 'leaf',
              state: {
                type: 'search',
                state: {
                  query: '',
                  matchingCase: false,
                  explainSearch: false,
                  collapseAll: false,
                  extraContext: false,
                  sortOrder: 'alphabetical',
                },
                icon: 'lucide-search',
                title: 'Search',
              },
            },
            {
              id: '630f9c4a9ac0b16b',
              type: 'leaf',
              state: {
                type: 'bookmarks',
                state: {},
                icon: 'lucide-bookmark',
                title: 'Bookmarks',
              },
            },
          ],
        },
      ],
      direction: 'horizontal',
      width: 300,
    },
    right: {
      id: '1b7c9dc5a4742406',
      type: 'split',
      children: [
        {
          id: '7da908430128da70',
          type: 'tabs',
          children: [
            {
              id: '40b875ecfdd371ed',
              type: 'leaf',
              state: {
                type: 'outline',
                state: {
                  file: 'Home.md',
                  followCursor: false,
                  showSearch: false,
                  searchQuery: '',
                },
                icon: 'lucide-list',
                title: 'Outline of Home',
              },
            },
          ],
        },
      ],
      direction: 'horizontal',
      width: 300,
      collapsed: true,
    },
    active: 'fb59b2571954a561',
    lastOpenFiles: ['Home.md'],
  }
  const firstOpenWorkspace = `${JSON.stringify(firstOpenPayload, null, 2)}\n`
  assert.equal(Buffer.byteLength(firstOpenWorkspace), 2751)
  assert.equal(
    createHash('sha256').update(firstOpenWorkspace).digest('hex'),
    'a651c5e6434ee35446e0fd51a064063b3169c1f7b4e49b1b3213e8d933483fb6',
  )
  const personalDesktopWorkspace = '{"private":"desktop workspace must not ship"}\n'
  const personalMobileWorkspace = '{"private":"mobile workspace must not ship"}\n'
  const nestedWorkspace = '{"private":"nested workspace must not ship"}\n'
  const nestedMobileWorkspace = '{"private":"nested mobile workspace must not ship"}\n'
  const savedWorkspaces = '{"private":"saved layouts must not ship"}\n'

  await Promise.all([
    mkdir(join(harness, 'scripts'), { recursive: true }),
    mkdir(join(harness, 'api'), { recursive: true }),
    mkdir(join(harness, 'publishing', 'assets'), { recursive: true }),
    mkdir(join(harness, 'book-uploads'), { recursive: true }),
    mkdir(join(harness, 'public'), { recursive: true }),
    mkdir(chapters, { recursive: true }),
    mkdir(vaultData, { recursive: true }),
    mkdir(join(vault, '.git'), { recursive: true }),
    mkdir(join(vault, '.obsidian'), { recursive: true }),
    mkdir(join(vault, 'Nested'), { recursive: true }),
    mkdir(dirname(guide), { recursive: true }),
    mkdir(dirname(validator), { recursive: true }),
    mkdir(dirname(cover), { recursive: true }),
  ])
  await Promise.all([
    copyFile(
      join(repoRoot, 'scripts', 'publish-book-to-library.mjs'),
      join(harness, 'scripts', 'publish-book-to-library.mjs'),
    ),
    copyFile(
      join(repoRoot, 'scripts', 'archive-vault.py'),
      join(harness, 'scripts', 'archive-vault.py'),
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
    copyFile(
      join(repoRoot, 'publishing', 'python', 'pyproject.toml'),
      join(fixtureBook, 'pyproject.toml'),
    ),
    copyFile(
      join(repoRoot, 'publishing', 'python', 'uv.lock'),
      join(fixtureBook, 'uv.lock'),
    ),
  ])
  await Promise.all([
    writeFile(join(harness, 'public', 'catalog.json'), '{"books":[]}\n'),
    writeFile(join(harness, 'book-uploads', 'book-package-sources.json'), '{"books":{}}\n'),
    writeFile(
      join(fixtureBook, 'FIRSTPAIR.md'),
      '# FirstPair Library Contract\n\nslug: fixture-book\nshelf: other\n',
    ),
    writeFile(
      join(fixtureBook, 'book.build.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        bookRoot: '.',
        metadata: 'metadata.yaml',
        version: '1.2.3',
        dist: 'dist',
        headboardImage: 'assets/headboard.png',
        epub: { coverImage: 'assets/cover.png' },
      }, null, 2)}\n`,
    ),
    writeFile(cover, 'fixture cover\n'),
    writeFile(headboard, 'fixture headboard\n'),
    writeFile(
      join(fixtureBook, 'metadata.yaml'),
      `description: >-
  A complete fixture book whose folded YAML description
  must survive the preview-to-full transition.
author: Fixture Author
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
    writeFile(join(vault, 'Cicero’s résumé.md'), '# Unicode filename fixture\n'),
    writeFile(join(vault, '.DS_Store'), 'volatile finder state\n'),
    writeFile(join(vault, '.git', 'config'), 'private repository state\n'),
    writeFile(join(vault, '.obsidian', 'workspace.json'), personalDesktopWorkspace),
    writeFile(join(vault, '.obsidian', 'workspace-mobile.json'), personalMobileWorkspace),
    writeFile(join(vault, '.obsidian', 'workspaces.json'), savedWorkspaces),
    writeFile(join(vault, 'Nested', 'workspace.json'), nestedWorkspace),
    writeFile(join(vault, 'Nested', 'workspace-mobile.json'), nestedMobileWorkspace),
    writeFile(
      join(vault, '.obsidian', 'workspace-first-open.json'),
      firstOpenWorkspace,
    ),
    writeFile(join(vaultData, 'units.jsonl'), '{"id":"fixture-1"}\n'),
    writeFile(guide, '# Fixture Book Vault\n\nOpen `Home.md`.\n'),
    writeFile(
      validator,
      `#!/usr/bin/env python3
from pathlib import Path
import sys

vault = Path(sys.argv[1])
if (vault / "TAMPERED").exists():
    print("tampered vault fixture", file=sys.stderr)
    raise SystemExit(23)
if not (vault / "Home.md").is_file():
    print("missing fixture Home.md", file=sys.stderr)
    raise SystemExit(24)
print("fixture source-owned vault validation passed")
`,
    ),
  ])

  const vaultPublishArgs = [
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
  ]

  await writeFile(join(vault, 'TAMPERED'), 'fixture tamper marker\n')
  let tamperedError = null

  try {
    await run(process.execPath, [...vaultPublishArgs, '--dry-run'])
  } catch (error) {
    tamperedError = error
  }

  assert(tamperedError, 'tampered source-owned vault unexpectedly passed validation')
  assert.match(tamperedError.message, /tampered vault fixture/)
  assert.match(tamperedError.message, /source-owned vault validation failed \(23\)/)
  await assert.rejects(access(stageDir))
  await rm(join(vault, 'TAMPERED'))

  const staged = await run(process.execPath, vaultPublishArgs)
  const plan = JSON.parse(staged.stdout.toString('utf8'))
  const rawGuide = join(stageDir, 'fixture-book-vault-guide (1.2.3-deadbeef).md')
  const htmlGuide = join(stageDir, 'fixture-book-vault-guide (1.2.3-deadbeef).html')
  const vaultZip = join(stageDir, 'fixture-book-full-vault (1.2.3-deadbeef).zip')
  const sourceMap = JSON.parse(
    await readFile(join(harness, 'book-uploads', 'book-package-sources.json'), 'utf8'),
  ).books['fixture-book']

  assert.equal(plan.artifacts.vault.guideMarkdown, 'fixture-book-vault-guide (1.2.3-deadbeef).md')
  assert.equal(plan.artifacts.vault.guideHtml, 'fixture-book-vault-guide (1.2.3-deadbeef).html')
  assert.equal(plan.artifacts.vault.validation.runner, 'uv')
  assert.equal(plan.artifacts.vault.validation.validator, validator)
  assert.equal(plan.artifacts.cover.source, cover)
  assert.equal(plan.artifacts.headboard.source, headboard)
  assert.match(sourceMap.cover, /fixture-book-cover\.png$/)
  assert.match(sourceMap.headboard, /fixture-book-headboard\.png$/)
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

  const archiveEntries = JSON.parse(
    (
      await run('python3', [
        '-c',
        'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps([{"name": i.filename, "flag_bits": i.flag_bits, "date_time": i.date_time} for i in z.infolist()], ensure_ascii=False))',
        vaultZip,
      ])
    ).stdout.toString('utf8'),
  )
  const unicodeArchiveEntry = archiveEntries.find((entry) => entry.name.includes('résumé'))
  assert(unicodeArchiveEntry)
  assert.equal(unicodeArchiveEntry.name, 'Fixture Book Vault/Cicero’s résumé.md')
  assert.notEqual(unicodeArchiveEntry.flag_bits & 0x800, 0)
  assert.equal(archiveEntries[0].name, 'Fixture Book Vault/')
  assert.equal(new Set(archiveEntries.map((entry) => entry.name)).size, archiveEntries.length)
  assert(archiveEntries.every((entry) => entry.date_time.join('-') === '1980-1-1-0-0-0'))
  assert(!archiveEntries.some((entry) => entry.name.endsWith('/.DS_Store')))
  assert(!archiveEntries.some((entry) => entry.name.includes('/.git/')))
  assert(!archiveEntries.some((entry) => entry.name.endsWith('/workspace-first-open.json')))
  assert(!archiveEntries.some((entry) => entry.name.endsWith('/Nested/workspace.json')))
  assert(!archiveEntries.some((entry) => entry.name.endsWith('/Nested/workspace-mobile.json')))
  assert(!archiveEntries.some((entry) => entry.name.endsWith('/.obsidian/workspaces.json')))
  assert(archiveEntries.some((entry) => entry.name.endsWith('/.obsidian/workspace.json')))
  assert(archiveEntries.some((entry) => entry.name.endsWith('/.obsidian/workspace-mobile.json')))

  const [archivedDesktopWorkspace, archivedMobileWorkspace] = await Promise.all([
    run('unzip', ['-p', vaultZip, 'Fixture Book Vault/.obsidian/workspace.json']),
    run('unzip', ['-p', vaultZip, 'Fixture Book Vault/.obsidian/workspace-mobile.json']),
  ])
  assert.deepEqual(archivedDesktopWorkspace.stdout, archivedMobileWorkspace.stdout)
  assert.deepEqual(archivedDesktopWorkspace.stdout, Buffer.from(firstOpenWorkspace))
  assert.deepEqual(archivedMobileWorkspace.stdout, Buffer.from(firstOpenWorkspace))
  const archivedFirstOpenPayload = JSON.parse(archivedDesktopWorkspace.stdout.toString('utf8'))
  assert.deepEqual(archivedFirstOpenPayload, firstOpenPayload)
  assert.equal(archivedFirstOpenPayload.main.children[0].children[0].state.type, 'markdown')
  assert.deepEqual(archivedFirstOpenPayload.main.children[0].children[0].state.state, {
    file: 'Home.md',
    mode: 'preview',
    source: false,
  })
  assert.deepEqual(
    archivedFirstOpenPayload.left.children[0].children.map((leaf) => leaf.state.type),
    ['file-explorer', 'search', 'bookmarks'],
  )
  assert.equal(archivedFirstOpenPayload.right.children[0].children[0].state.type, 'outline')
  assert.equal(archivedFirstOpenPayload.right.collapsed, true)
  assert.equal(archivedFirstOpenPayload.active, 'fb59b2571954a561')
  assert.deepEqual(archivedFirstOpenPayload.lastOpenFiles, ['Home.md'])
  assert.notDeepEqual(archivedDesktopWorkspace.stdout, Buffer.from(personalDesktopWorkspace))
  assert.notDeepEqual(archivedMobileWorkspace.stdout, Buffer.from(personalMobileWorkspace))
  const archivedPayloads = (await run('unzip', ['-p', vaultZip])).stdout.toString('utf8')
  assert.doesNotMatch(archivedPayloads, /desktop workspace must not ship/)
  assert.doesNotMatch(archivedPayloads, /mobile workspace must not ship/)
  assert.doesNotMatch(archivedPayloads, /nested workspace must not ship/)
  assert.doesNotMatch(archivedPayloads, /nested mobile workspace must not ship/)
  assert.doesNotMatch(archivedPayloads, /saved layouts must not ship/)

  const repeatedVaultZip = join(work, 'fixture-vault-repeat.zip')
  await run('python3', [
    join(harness, 'scripts', 'archive-vault.py'),
    '--vault',
    vault,
    '--output',
    repeatedVaultZip,
    '--guide',
    guide,
  ])
  assert.deepEqual(await readFile(repeatedVaultZip), await readFile(vaultZip))

  const seedlessVault = join(work, 'Seedless Vault')
  const seedlessArchive = join(work, 'seedless-vault.zip')
  await mkdir(join(seedlessVault, '.obsidian'), { recursive: true })
  await Promise.all([
    writeFile(join(seedlessVault, 'Home.md'), '# Seedless fixture\n'),
    writeFile(
      join(seedlessVault, '.obsidian', 'workspace.json'),
      personalDesktopWorkspace,
    ),
    writeFile(
      join(seedlessVault, '.obsidian', 'workspace-mobile.json'),
      personalMobileWorkspace,
    ),
  ])
  await run('python3', [
    join(harness, 'scripts', 'archive-vault.py'),
    '--vault',
    seedlessVault,
    '--output',
    seedlessArchive,
  ])
  const seedlessEntries = JSON.parse(
    (
      await run('python3', [
        '-c',
        'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps(z.namelist()))',
        seedlessArchive,
      ])
    ).stdout.toString('utf8'),
  )
  assert(!seedlessEntries.some((entry) => entry.endsWith('/workspace.json')))
  assert(!seedlessEntries.some((entry) => entry.endsWith('/workspace-mobile.json')))
  assert(!seedlessEntries.some((entry) => entry.endsWith('/workspace-first-open.json')))
  const seedlessPayloads = (await run('unzip', ['-p', seedlessArchive])).stdout.toString('utf8')
  assert.doesNotMatch(seedlessPayloads, /desktop workspace must not ship/)
  assert.doesNotMatch(seedlessPayloads, /mobile workspace must not ship/)

  const directoryAliasVault = join(work, 'Directory Alias Vault')
  const directoryAliasArchive = join(work, 'directory-alias-vault.zip')
  const directoryAliasObsidian = join(directoryAliasVault, '.obsidian')
  await Promise.all([
    mkdir(join(directoryAliasObsidian, 'workspace.json', 'private', 'deep'), {
      recursive: true,
    }),
    mkdir(join(directoryAliasObsidian, 'workspace-mobile.json', 'private'), {
      recursive: true,
    }),
    mkdir(join(directoryAliasVault, 'Nested', 'workspace.json', 'private'), {
      recursive: true,
    }),
    mkdir(join(directoryAliasVault, 'Nested', 'workspace-mobile.json', 'private', 'deep'), {
      recursive: true,
    }),
  ])
  await Promise.all([
    writeFile(join(directoryAliasVault, 'Home.md'), '# Directory alias fixture\n'),
    writeFile(join(directoryAliasVault, 'ordinary.md'), '# This file must remain\n'),
    writeFile(
      join(directoryAliasObsidian, 'workspace-first-open.json'),
      firstOpenWorkspace,
    ),
    writeFile(
      join(directoryAliasObsidian, 'workspace.json', 'private', 'deep', 'desktop.txt'),
      'directory-shaped desktop workspace descendant must not ship\n',
    ),
    writeFile(
      join(directoryAliasObsidian, 'workspace-mobile.json', 'private', 'mobile.txt'),
      'directory-shaped mobile workspace descendant must not ship\n',
    ),
    writeFile(
      join(directoryAliasVault, 'Nested', 'workspace.json', 'private', 'desktop.txt'),
      'nested directory-shaped desktop workspace descendant must not ship\n',
    ),
    writeFile(
      join(
        directoryAliasVault,
        'Nested',
        'workspace-mobile.json',
        'private',
        'deep',
        'mobile.txt',
      ),
      'nested directory-shaped mobile workspace descendant must not ship\n',
    ),
  ])
  await run('python3', [
    join(harness, 'scripts', 'archive-vault.py'),
    '--vault',
    directoryAliasVault,
    '--output',
    directoryAliasArchive,
  ])
  const directoryAliasEntries = JSON.parse(
    (
      await run('python3', [
        '-c',
        'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps(z.namelist()))',
        directoryAliasArchive,
      ])
    ).stdout.toString('utf8'),
  )
  const canonicalDesktopAlias =
    'Directory Alias Vault/.obsidian/workspace.json'
  const canonicalMobileAlias =
    'Directory Alias Vault/.obsidian/workspace-mobile.json'
  assert.equal(
    directoryAliasEntries.filter((entry) => entry === canonicalDesktopAlias).length,
    1,
  )
  assert.equal(
    directoryAliasEntries.filter((entry) => entry === canonicalMobileAlias).length,
    1,
  )
  assert(!directoryAliasEntries.some((entry) => entry.includes('/workspace.json/')))
  assert(!directoryAliasEntries.some((entry) => entry.includes('/workspace-mobile.json/')))
  assert(directoryAliasEntries.includes('Directory Alias Vault/ordinary.md'))
  const [directoryAliasDesktop, directoryAliasMobile] = await Promise.all([
    run('unzip', ['-p', directoryAliasArchive, canonicalDesktopAlias]),
    run('unzip', ['-p', directoryAliasArchive, canonicalMobileAlias]),
  ])
  assert.deepEqual(directoryAliasDesktop.stdout, Buffer.from(firstOpenWorkspace))
  assert.deepEqual(directoryAliasMobile.stdout, Buffer.from(firstOpenWorkspace))
  assert.deepEqual(directoryAliasDesktop.stdout, directoryAliasMobile.stdout)
  const directoryAliasPayloads = (await run('unzip', ['-p', directoryAliasArchive])).stdout.toString(
    'utf8',
  )
  assert.doesNotMatch(directoryAliasPayloads, /workspace descendant must not ship/)

  await writeFile(
    join(seedlessVault, '.obsidian', 'workspace-first-open.json'),
    '{"lastOpenFiles":["Not Home.md"]}\n',
  )
  await assert.rejects(
    run('python3', [
      join(harness, 'scripts', 'archive-vault.py'),
      '--vault',
      seedlessVault,
      '--output',
      join(work, 'invalid-seed-vault.zip'),
    ]),
    /first-open workspace helper must be exactly the canonical complete Home workspace/,
  )

  await writeFile(
    join(seedlessVault, '.obsidian', 'workspace-first-open.json'),
    `${JSON.stringify(firstOpenPayload)}\n`,
  )
  await assert.rejects(
    run('python3', [
      join(harness, 'scripts', 'archive-vault.py'),
      '--vault',
      seedlessVault,
      '--output',
      join(work, 'noncanonical-seed-vault.zip'),
    ]),
    /first-open workspace helper must be exactly the canonical complete Home workspace/,
  )

  const missingHomeVault = join(work, 'Missing Home Vault')
  await mkdir(join(missingHomeVault, '.obsidian'), { recursive: true })
  await writeFile(
    join(missingHomeVault, '.obsidian', 'workspace-first-open.json'),
    firstOpenWorkspace,
  )
  await assert.rejects(
    run('python3', [
      join(harness, 'scripts', 'archive-vault.py'),
      '--vault',
      missingHomeVault,
      '--output',
      join(work, 'missing-home-vault.zip'),
    ]),
    /first-open workspace helper requires a regular root Home\.md/,
  )

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

  assert.equal(fullPlan.dryRun, true)
  assert.equal(fullPlan.actions.upload, false)
  assert.equal(fullPlan.actions.productionDeploy, false)
  assert.equal(fullPlan.catalogEntry.kicker, 'Finished book')
  assert.equal(fullPlan.catalogEntry.author, 'Fixture Author')
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
    assert.match(response.body, /@media \(max-width: 640px\)/)
    assert.match(response.body, /position: static/)
  } finally {
    globalThis.fetch = originalFetch
  }

  await rm(validator)
  const compatibilityDryRun = await run(process.execPath, [...vaultPublishArgs, '--dry-run'])
  const compatibilityPlan = JSON.parse(compatibilityDryRun.stdout.toString('utf8'))
  assert.equal(compatibilityPlan.artifacts.vault.validation, null)

  console.log('Vault-guide validation, render, stage, upload, route, and proxy fixtures passed')
} finally {
  await rm(work, { recursive: true, force: true })
}
