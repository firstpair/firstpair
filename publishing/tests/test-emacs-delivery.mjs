import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const work = await mkdtemp(join(tmpdir(), 'firstpair-emacs-delivery-'))

function run(command, args, options = {}) {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      resolveProcess({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') })
    })
  })
}

async function ok(command, args, options) {
  const result = await run(command, args, options)
  if (result.code !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.code}):\n${result.stderr}`)
  return result
}

async function initializePushedRepository(repository, remote) {
  await ok('git', ['init', '--bare', remote])
  await ok('git', ['init', '--initial-branch=main', repository])
  await ok('git', ['-C', repository, 'config', 'user.name', 'FirstPair Test'])
  await ok('git', ['-C', repository, 'config', 'user.email', 'firstpair-test@example.invalid'])
  await ok('git', ['-C', repository, 'add', '--all'])
  await ok('git', ['-C', repository, 'commit', '-q', '-m', 'Create fixture'])
  await ok('git', ['-C', repository, 'remote', 'add', 'origin', remote])
  await ok('git', ['-C', repository, 'push', '-q', '--set-upstream', 'origin', 'main'])
}

try {
  const harness = join(work, 'firstpair')
  const book = join(work, 'fixture-book')
  const dist = join(book, 'dist')

  await mkdir(join(harness, 'scripts'), { recursive: true })
  await mkdir(join(harness, 'api'), { recursive: true })
  await mkdir(join(harness, 'publishing', 'assets'), { recursive: true })
  await mkdir(join(harness, 'publishing', 'scripts'), { recursive: true })
  await mkdir(join(harness, 'book-uploads'), { recursive: true })
  await mkdir(join(harness, 'public'), { recursive: true })
  for (const name of ['publish-book-to-library.mjs', 'archive-emacs-bundle.py', 'archive-vault.py', 'render-vault-guide.mjs', 'upload-book-package.mjs', 'sync-reader-routes.mjs', 'check-public-catalog.mjs']) {
    await cp(join(repoRoot, 'scripts', name), join(harness, 'scripts', name))
  }
  await cp(join(repoRoot, 'api', 'reader.mjs'), join(harness, 'api', 'reader.mjs'))
  await cp(join(repoRoot, 'publishing', 'assets', 'vault-guide.css'), join(harness, 'publishing', 'assets', 'vault-guide.css'))
  await cp(join(repoRoot, 'publishing', 'scripts', 'git_publish_preflight.py'), join(harness, 'publishing', 'scripts', 'git_publish_preflight.py'))
  await cp(join(repoRoot, 'publishing', 'scripts', 'firstpair-emacs'), join(harness, 'publishing', 'scripts', 'firstpair-emacs'))
  await cp(join(repoRoot, 'publishing', 'emacs'), join(harness, 'publishing', 'emacs'), {
    recursive: true,
    filter: (source) => !/__pycache__|\/dist(\/|$)/.test(source),
  })
  await cp(join(repoRoot, 'publishing', 'vault'), join(harness, 'publishing', 'vault'), {
    recursive: true,
    filter: (source) => !/__pycache__/.test(source),
  })
  await writeFile(join(harness, 'public', 'catalog.json'), '{"books":[]}\n')
  await writeFile(join(harness, 'book-uploads', 'book-package-sources.json'), '{"books":{}}\n')
  await writeFile(join(harness, 'vercel.json'), '{"routes":[]}\n')

  // A minimal preview book: dist artifacts plus an Emacs bundle declaration.
  await mkdir(join(dist, 'fixture-book-chapters'), { recursive: true })
  await writeFile(join(book, 'FIRSTPAIR.md'), '# FirstPair Library Contract\n\nslug: fixture-book\nshelf: other\n')
  await writeFile(join(book, 'chapter.md'), '# Proem\n\nAtticus wrote: *Ubi nihil erit, quod scribas, id ipsum scribito.* He meant it.\n')
  await writeFile(join(book, 'second.md'), '# Book I\n\nMore text.\n')
  await writeFile(join(book, 'records.jsonl'), `${JSON.stringify({ id: 'quote-att-4-8a', work_title: 'Letters to Atticus', citation: '4.8a', latin: 'Ubi nihil erit, quod scribas, id ipsum scribito.', english: 'When you have nothing to write, write and say so.', book_sources: ['chapter.md'], aliases: ['Ubi nihil erit, quod scribas, id ipsum scribito.'] })}\n`)
  await writeFile(join(book, 'vault.build.json'), `${JSON.stringify({
    schemaVersion: 1,
    slug: 'fixture-book',
    title: 'Fixture Book',
    profile: 'history',
    sourceCommit: 'HEAD',
    reader: [
      { id: 'proem', title: 'Proem', source: 'chapter.md', preview: true },
      { id: 'book-1', title: 'Book I', source: 'second.md' },
    ],
    products: { desktop: { output: 'candidate/desktop' } },
    emacs: {
      direntry: { name: 'fixture-book', description: 'A fixture.' },
      lexicon: { language: 'latin', mode: 'none' },
      records: [{ id: 'passages', source: 'records.jsonl', label: '{work_title} {citation}', section: 'Passages', referencedBy: 'book_sources', referenceMatch: 'source', anchors: ['aliases'], blocks: [{ field: 'latin', label: 'Latin', style: 'quotation', language: 'latin' }, { field: 'english', label: 'English', style: 'quotation' }] }],
      products: {
        desktop: { output: 'dist-emacs/Fixture Book Emacs' },
        preview: { output: 'dist-emacs/Fixture Book Emacs Preview', edition: 'preview' },
      },
    },
  }, null, 2)}\n`)
  await writeFile(join(dist, 'VERSION.md'), 'title: Fixture Book\ntitle_stem: fixture-book\nversion: 1.2.3\nversion_stamp: 1.2.3-deadbeef\nedition: preview\npdf_file: fixture-book.pdf\nepub_file: fixture-book.epub\nhtml_file: fixture-book.html\nhtml_chapters_dir: fixture-book-chapters\n')
  await writeFile(join(dist, 'fixture-book.pdf'), '%PDF-1.4 fixture\n')
  await writeFile(join(dist, 'fixture-book.epub'), 'fixture epub\n')
  await writeFile(join(dist, 'fixture-book.html'), '<!DOCTYPE html><title>Fixture</title>\n')
  await writeFile(join(dist, 'fixture-book-chapters', 'index.html'), '<!DOCTYPE html><title>Chapters</title>\n')
  await writeFile(join(book, '.gitignore'), 'dist-emacs/\n')

  await initializePushedRepository(book, join(work, 'book.git'))
  await initializePushedRepository(harness, join(work, 'firstpair.git'))
  const head = (await ok('git', ['-C', book, 'rev-parse', 'HEAD'])).stdout.trim()

  const builder = join(harness, 'publishing', 'scripts', 'firstpair-emacs')
  await ok(builder, ['build', join(book, 'vault.build.json'), '--product', 'preview', '--offline'])
  await ok(builder, ['build', join(book, 'vault.build.json'), '--product', 'desktop', '--offline'])
  const previewBundle = join(book, 'dist-emacs', 'Fixture Book Emacs Preview')

  const publisher = join(harness, 'scripts', 'publish-book-to-library.mjs')
  const dryRun = await ok(process.execPath, [publisher, book, '--emacs', '--dry-run', '--no-build', '--no-smoke', '--no-deploy', '--no-icloud'], { cwd: harness })
  const plan = JSON.parse(dryRun.stdout)
  assert.equal(plan.edition, 'preview')
  assert.equal(await realpath(plan.artifacts.emacs.source), await realpath(previewBundle))
  assert.equal(plan.artifacts.emacs.zip, `fixture-book-preview-emacs (1.2.3-${head.slice(0, 8)}).zip`)
  assert.equal(plan.artifacts.emacs.guideMarkdown, `fixture-book-emacs-guide (1.2.3-${head.slice(0, 8)}).md`)
  assert.equal(plan.artifacts.emacs.validation.sourceCommit, head)
  assert.equal(plan.sourceMap.emacs, `book-uploads/staging/fixture-book/${plan.artifacts.emacs.zip}`)
  assert.ok(plan.vaultCopies.some((path) => path.endsWith(plan.artifacts.emacs.zip)), 'iCloud plan lists the Emacs archive')

  // The desktop bundle is the wrong edition for a preview publish.
  const wrongEdition = await run(process.execPath, [publisher, book, '--emacs-dir', join(book, 'dist-emacs', 'Fixture Book Emacs'), '--dry-run', '--no-build', '--no-smoke', '--no-deploy'], { cwd: harness })
  assert.notEqual(wrongEdition.code, 0)
  assert.match(wrongEdition.stderr, /full edition, but the preview edition/)

  // Staging archives the bundle and renders its guide.
  const staged = await ok(process.execPath, [publisher, book, '--emacs', '--stage-only', '--no-icloud'], { cwd: harness })
  const stagedPlan = JSON.parse(staged.stdout)
  const stageDir = join(harness, 'book-uploads', 'staging', 'fixture-book')
  const zipPath = join(stageDir, stagedPlan.artifacts.emacs.zip)
  await stat(zipPath)
  const listing = (await ok('unzip', ['-Z1', zipPath])).stdout.split('\n').filter(Boolean)
  assert.ok(listing.every((entry) => entry.startsWith('Fixture Book Emacs Preview/')), 'single root folder')
  for (const member of ['init.el', 'install.sh', 'fixture-book.info', 'fixture-book-refs.info', 'lisp/firstpair-reader.el', 'FIRSTPAIR-EMACS-MANIFEST.json', 'README.md']) {
    assert.ok(listing.includes(`Fixture Book Emacs Preview/${member}`), `archive contains ${member}`)
  }
  assert.ok(!listing.some((entry) => /\.elc$|\.DS_Store|firstpair-check\.el/.test(entry)))
  const guideHtml = await readFile(join(stageDir, stagedPlan.artifacts.emacs.guideHtml), 'utf8')
  assert.match(guideHtml, /<title>Fixture Book — Emacs Guide<\/title>/)
  assert.match(guideHtml, /firstpair-read/)
  const sources = JSON.parse(await readFile(join(harness, 'book-uploads', 'book-package-sources.json'), 'utf8'))
  assert.equal(sources.books['fixture-book'].emacs, `book-uploads/staging/fixture-book/${stagedPlan.artifacts.emacs.zip}`)
  assert.ok(sources.books['fixture-book'].emacsGuideHtml.endsWith('.html'))

  // A tampered bundle must stop the plan before staging.
  await writeFile(join(previewBundle, 'dir'), 'tampered\n')
  const tampered = await run(process.execPath, [publisher, book, '--emacs', '--dry-run', '--no-build', '--no-smoke', '--no-deploy'], { cwd: harness })
  assert.notEqual(tampered.code, 0)
  assert.match(tampered.stderr, /validation failed|differ from the sealed manifest/)

  console.log('emacs delivery workflow: ok')
} finally {
  await rm(work, { recursive: true, force: true })
}
