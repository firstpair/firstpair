import { spawn } from 'node:child_process'
import { access, mkdir, readFile } from 'node:fs/promises'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const root = dirname(scriptDir)
const defaultStylesheet = join(root, 'publishing', 'assets', 'vault-guide.css')

function run(command, args) {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'inherit', 'inherit'],
    })

    child.on('error', reject)
    child.on('close', (code) => resolveProcess(code))
  })
}

export async function renderVaultGuide({
  source,
  destination,
  title,
  resourcePaths = [],
  stylesheet = defaultStylesheet,
}) {
  const sourcePath = resolve(source)
  const destinationPath = resolve(destination)
  const guideTitle = title?.trim() || basename(sourcePath, '.md')

  await Promise.all([access(sourcePath), access(stylesheet)])
  await mkdir(dirname(destinationPath), { recursive: true })

  const resources = [...new Set([dirname(sourcePath), ...resourcePaths.map((path) => resolve(path))])]
  const args = [
    '--from',
    'markdown+smart+wikilinks_title_after_pipe',
    '--to',
    'html5',
    '--standalone',
    '--embed-resources',
    '--section-divs',
    '--metadata',
    `title=${guideTitle}`,
    '--metadata',
    'lang=en-US',
    '--resource-path',
    resources.join(delimiter),
    '--css',
    stylesheet,
    '--output',
    destinationPath,
    sourcePath,
  ]
  const code = await run('pandoc', args)

  if (code !== 0) {
    throw new Error(`pandoc failed (${code}) while rendering vault guide: ${sourcePath}`)
  }

  const html = await readFile(destinationPath, 'utf8')

  if (!/^<!DOCTYPE html>/i.test(html) || !/<html\b/i.test(html) || !/<body\b/i.test(html)) {
    throw new Error(`vault guide is not a standalone HTML document: ${destinationPath}`)
  }

  if (!/<style\b/i.test(html) || /<link\b[^>]*rel=["']stylesheet["']/i.test(html)) {
    throw new Error(`vault guide stylesheet was not embedded: ${destinationPath}`)
  }

  return destinationPath
}

async function main() {
  const [source, destination, ...rest] = process.argv.slice(2)

  if (!source || !destination) {
    console.error(
      'usage: node scripts/render-vault-guide.mjs <guide.md> <guide.html> [--title <title>] [--resource-path <dir>]',
    )
    process.exit(2)
  }

  let title = ''
  const resourcePaths = []

  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index]
    const value = rest[index + 1]

    if (!['--title', '--resource-path'].includes(option) || !value) {
      throw new Error(`invalid vault-guide renderer option: ${option}`)
    }

    if (option === '--title') {
      title = value
    } else {
      resourcePaths.push(value)
    }

    index += 1
  }

  const output = await renderVaultGuide({ source, destination, title, resourcePaths })
  console.log(output)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack ?? error)
    process.exit(1)
  })
}
