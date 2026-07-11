#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const publishingDir = dirname(scriptDir)
const lock = JSON.parse(readFileSync(join(publishingDir, 'toolchain.lock.json'), 'utf8'))
const quiet = process.argv.includes('--quiet')
const neatroffRoot = process.env.NEATROFF_ROOT ?? join(process.env.HOME, 'src', 'neatroff_make')
const utmacRoot = process.env.UTMAC_DIR ?? join(dirname(dirname(scriptDir)), '.tools', 'utmac')
const failures = []

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
  })
}

function checkVersion(kind, name, specification) {
  const result = run(specification.command, specification.args)
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()

  if (result.error || result.status !== 0) {
    failures.push(`${kind} ${name}: command failed: ${specification.command}`)
    return
  }

  if (!output.includes(specification.version)) {
    failures.push(
      `${kind} ${name}: expected ${specification.version}, got ${output.split(/\r?\n/, 1)[0]}`,
    )
    return
  }

  if (!quiet) {
    console.log(`${kind} ${name}: ${specification.version}`)
  }
}

function gitCommit(path) {
  const result = run('git', ['rev-parse', 'HEAD'], path)
  return result.status === 0 ? result.stdout.trim() : null
}

for (const [name, specification] of Object.entries(lock.homebrew.formulae)) {
  checkVersion('formula', name, specification)
}

for (const [name, specification] of Object.entries(lock.homebrew.casks)) {
  checkVersion('cask', name, specification)
}

for (const [name, expected] of Object.entries(lock.nodePackages ?? {})) {
  const command = name === '@mermaid-js/mermaid-cli'
    ? join(dirname(dirname(scriptDir)), 'node_modules', '.bin', 'mmdc')
    : null
  if (!command) {
    failures.push(`no verifier configured for Node package ${name}`)
    continue
  }
  const result = run(command, ['--version'])
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (result.status !== 0 || output !== expected) {
    failures.push(`Node package ${name}: expected ${expected}, got ${output || 'missing'}`)
  } else if (!quiet) {
    console.log(`Node package ${name}: ${expected}`)
  }
}

for (const command of lock.requiredCommands) {
  const result = run('/usr/bin/env', ['sh', '-c', `command -v "$1" >/dev/null 2>&1`, 'sh', command])
  if (result.status !== 0) {
    failures.push(`required command missing: ${command}`)
  } else if (!quiet) {
    console.log(`command ${command}: present`)
  }
}

const rootCommit = gitCommit(neatroffRoot)
if (rootCommit !== lock.neatroff.root.commit) {
  failures.push(
    `neatroff root: expected ${lock.neatroff.root.commit}, got ${rootCommit ?? 'missing checkout'}`,
  )
} else if (!quiet) {
  console.log(`neatroff root: ${rootCommit}`)
}

for (const [component, expected] of Object.entries(lock.neatroff.components)) {
  const actual = gitCommit(join(neatroffRoot, component))
  if (actual !== expected) {
    failures.push(`neatroff ${component}: expected ${expected}, got ${actual ?? 'missing checkout'}`)
  } else if (!quiet) {
    console.log(`neatroff ${component}: ${actual}`)
  }
}

const utmacCommit = gitCommit(utmacRoot)
if (utmacCommit !== lock.utmac.commit) {
  failures.push(`utmac: expected ${lock.utmac.commit}, got ${utmacCommit ?? 'missing checkout'}`)
} else if (!quiet) {
  console.log(`utmac: ${utmacCommit}`)
}

if (failures.length > 0) {
  console.error('Publishing toolchain verification failed:')
  for (const failure of failures) {
    console.error(`  - ${failure}`)
  }
  process.exit(1)
}

if (quiet) {
  console.log('Publishing toolchain matches publishing/toolchain.lock.json')
}
