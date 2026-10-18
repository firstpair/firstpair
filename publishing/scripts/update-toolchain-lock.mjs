#!/usr/bin/env node
// Record the installed publishing toolchain in toolchain.lock.json.
// install-toolchain.sh runs this after updating every tool to its latest
// release, so the lock always names the exact versions a build used and
// verify-toolchain.mjs can confirm a build ran with them.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const publishingDir = dirname(scriptDir)
const firstpairRoot = dirname(publishingDir)
const lockPath = join(publishingDir, 'toolchain.lock.json')
const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
const neatroffRoot = process.env.NEATROFF_ROOT ?? join(process.env.HOME, 'src', 'neatroff_make')
const utmacRoot = process.env.UTMAC_DIR ?? join(firstpairRoot, '.tools', 'utmac')

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env })
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.error}`)
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
}

function versionOf(kind, name, specification) {
  let command = specification.command
  if (kind === 'formula' && !command.includes('/')) {
    const candidate = join(run('brew', ['--prefix', name]), 'bin', basename(command))
    if (existsSync(candidate)) command = candidate
  }
  const output = run(command, specification.args)
  const match = output.match(/\d+\.\d+(?:\.\d+)?/)
  if (!match) throw new Error(`no version in output of ${command}: ${output}`)
  return match[0]
}

lock.generatedAt = new Date().toISOString().slice(0, 10)
lock.policy = 'Latest releases. install-toolchain.sh updates every tool and rewrites this file; it records the versions a build used and is not a pin.'
for (const [kind, table] of [['formula', lock.homebrew.formulae], ['cask', lock.homebrew.casks]]) {
  for (const [name, specification] of Object.entries(table)) {
    // Flexible entries (calibre) record the installed version without
    // requiring a match at verification time.
    specification.version = versionOf(kind, name, specification)
  }
}

const mermaid = join(firstpairRoot, 'node_modules', '.bin', 'mmdc')
lock.nodePackages['@mermaid-js/mermaid-cli'] = run(mermaid, ['--version'])

const python = run('uv', ['python', 'find', '--no-project', '--managed-python'])
lock.python = {
  versionManager: 'uv',
  environmentManager: 'uv',
  helperVersion: run(python, ['-c', 'import platform; print(platform.python_version())']),
  policy: 'uv alone manages Python and keeps the newest stable CPython. A source repository may pin a version with .python-version; otherwise uv selects the newest installed interpreter.',
}

const commit = (path) => run('git', ['rev-parse', 'HEAD'], path)
lock.neatroff.root.commit = commit(neatroffRoot)
for (const component of Object.keys(lock.neatroff.components)) {
  lock.neatroff.components[component] = commit(join(neatroffRoot, component))
}
lock.utmac.commit = commit(utmacRoot)

writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
console.log(`Recorded toolchain in ${lockPath}`)
