import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
const rootPath = fileURLToPath(root)
const markdown = readFileSync(new URL('publishing/emacs/guides/master.md', root), 'utf8')
const html = readFileSync(new URL('public/emacs/index.html', root), 'utf8')
const generated = readFileSync(new URL('src/generated/emacs-handbook.ts', root), 'utf8')
const launcher = readFileSync(new URL('publishing/emacs/reader-launcher.sh', root), 'utf8')
const publicLauncher = readFileSync(new URL('public/emacs/firstpair.sh', root), 'utf8')
const danteLauncher = readFileSync(new URL('public/emacs/dante.sh', root), 'utf8')

const sections = [
  'Install Emacs',
  'Open the book',
  'Install the reader once, for every FirstPair book',
  'Your first five minutes',
  'References open below the text',
  'The dictionary window',
  'Rearranging windows',
  'Reading without the FirstPair reader',
  'Add the manuals to Info',
  'Re-rendering the edition',
  'Make personal notes without fighting updates',
  'Updating a FirstPair bundle',
  'Troubleshooting',
]

test('canonical Emacs handbook is comprehensive and the site page is current', () => {
  for (const section of sections) {
    assert.match(markdown, new RegExp(`## ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.ok(html.includes(section), `rendered handbook is missing ${section}`)
  }
  assert.match(html, /M-x firstpair-read/)
  assert.match(html, /package-vc-install/)
  assert.match(html, /install-info/)
  assert.doesNotMatch(html, /<link\b[^>]*rel=["']stylesheet["']/i)
  assert.ok(generated.includes('M-x firstpair-read'), 'generated module lacks the handbook body')
  assert.equal(publicLauncher, launcher, 'public FirstPair launcher differs from its canonical source')
  assert.equal(danteLauncher, launcher, 'public Dante launcher differs from its canonical source')
  assert.match(html, /firstpair\.sh/)
  assert.ok(!existsSync(join(rootPath, 'public', 'emacs', 'update-reader.sh')), 'obsolete updater URL remains public')
})

test('public Reader release record matches the tar and source version', () => {
  const archive = readFileSync(new URL('public/emacs/firstpair-reader.tar', root))
  const sidecar = readFileSync(new URL('public/emacs/firstpair-reader.tar.sha256', root), 'utf8')
  const source = readFileSync(new URL('publishing/emacs/lisp/firstpair-reader.el', root), 'utf8')
  const version = /^;; Version: (\S+)$/m.exec(source)?.[1]
  const digest = createHash('sha256').update(archive).digest('hex')
  assert.match(sidecar, new RegExp(`^# version ${version}\\n`))
  assert.match(sidecar, new RegExp(`^${digest}  firstpair-reader\\.tar$`, 'm'))
})

test('Dante launcher skips the tar when the installed version is current', () => {
  const work = mkdtempSync(join(tmpdir(), 'firstpair-dante-launcher-'))
  try {
    const books = join(work, 'books')
    const bundle = join(books, 'Dante-Emacs')
    const bin = join(work, 'bin')
    const curlLog = join(work, 'curl.log')
    const emacsLog = join(work, 'emacs.log')
    const release = join(work, 'release.sha256')
    mkdirSync(join(bundle, 'data'), { recursive: true })
    mkdirSync(bin)
    writeFileSync(join(bundle, 'data', 'bundle.json'), '{"schema":"firstpair-emacs-bundle-v1"}\n')
    writeFileSync(release, `# version 1.26\n${'a'.repeat(64)}  firstpair-reader.tar\n`)
    copyFileSync(join(rootPath, 'publishing', 'emacs', 'reader-launcher.sh'), join(books, 'dante.sh'))
    writeFileSync(join(bin, 'curl'), `#!/bin/sh
out=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) shift; out=$1 ;;
    *) url=$1 ;;
  esac
  shift
done
printf '%s\\n' "$url" >> "$CURL_LOG"
[ "$url" = "$FIRSTPAIR_READER_RELEASE_URL" ] || exit 97
cp "$RELEASE_FIXTURE" "$out"
`)
    writeFileSync(join(bin, 'emacs'), `#!/bin/sh
case " $* " in
  *" --batch "*) printf '%s' 1.26; exit 0 ;;
esac
printf '%s\\n' "$FIRSTPAIR_BUNDLE" > "$EMACS_LOG"
`)
    writeFileSync(join(bin, 'pgrep'), '#!/bin/sh\nexit 1\n')
    for (const path of [join(books, 'dante.sh'), join(bin, 'curl'), join(bin, 'emacs'), join(bin, 'pgrep')]) chmodSync(path, 0o755)

    const result = spawnSync('sh', ['./dante.sh'], {
      cwd: books,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        CURL_LOG: curlLog,
        EMACS_LOG: emacsLog,
        RELEASE_FIXTURE: release,
        FIRSTPAIR_READER_RELEASE_URL: 'mock://reader-release',
        FIRSTPAIR_READER_URL: 'mock://reader-tar',
      },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /already installed; skipping the package download/)
    assert.equal(readFileSync(curlLog, 'utf8'), 'mock://reader-release\n')
    assert.equal(readFileSync(emacsLog, 'utf8').trim(), realpathSync(bundle))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})
