// Deploy the built review app (dist/, with encrypted data) to Vercel through
// the REST API, behind Vercel Authentication on every deployment.
//
//   npm run build   (with REVIEW_DATA, REVIEW_INCLUDE_DATA=1, REVIEW_PASSPHRASE)
//   node scripts/deploy-vercel.mjs
//
// Token: VERCEL_TOKEN, else ~/.config/firstpair/vercel-token.  Team:
// VERCEL_TEAM_ID, else the FirstPair site's team (.vercel/project.json).
// Project: VERCEL_PROJECT (default firstpair-review).  The API is used
// directly because the CLI's networking does not pass this machine's proxy;
// curl does, so requests go through curl.
//
// Before any upload the script turns on Vercel Authentication for all
// deployments (production included) and refuses to continue if Vercel does
// not confirm it, and it refuses a dist/ that holds unencrypted data.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const app = path.resolve(here, '..')
const dist = path.join(app, 'dist')
const API = 'https://api.vercel.com'

const token = process.env.VERCEL_TOKEN
  || fs.readFileSync(path.join(os.homedir(), '.config/firstpair/vercel-token'), 'utf8').trim()
const site = path.resolve(app, '../../.vercel/project.json')
const team = process.env.VERCEL_TEAM_ID || JSON.parse(fs.readFileSync(site, 'utf8')).orgId
const projectName = process.env.VERCEL_PROJECT || 'firstpair-review'

function api(method, route, body = null, extraHeaders = {}, dataFile = null) {
  const url = `${API}${route}${route.includes('?') ? '&' : '?'}teamId=${team}`
  const args = ['-sS', '-m', '600', '-X', method, url, '-H', `Authorization: Bearer ${token}`, '-w', '\n%{http_code}']
  for (const [key, value] of Object.entries(extraHeaders)) args.push('-H', `${key}: ${value}`)
  if (dataFile) args.push('--data-binary', `@${dataFile}`)
  else if (body) args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(body))
  const out = execFileSync('curl', args, { maxBuffer: 64 * 1024 * 1024 }).toString()
  const at = out.lastIndexOf('\n')
  const status = Number(out.slice(at + 1))
  let json = null
  try { json = JSON.parse(out.slice(0, at)) } catch { json = { raw: out.slice(0, at) } }
  return { status, json }
}

function files(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? files(full, base) : [{ full, file: path.relative(base, full).split(path.sep).join('/') }]
  })
}

// ---------------------------------------------------------------- checks

if (!fs.existsSync(path.join(dist, 'data/encryption.json'))) {
  throw new Error('dist/ has no encrypted data; build with REVIEW_INCLUDE_DATA=1 and REVIEW_PASSPHRASE')
}
const plain = files(path.join(dist, 'data')).filter((f) => !f.file.endsWith('.enc') && f.file !== 'encryption.json')
if (plain.length) throw new Error(`dist/data holds unencrypted files: ${plain.slice(0, 3).map((f) => f.file).join(', ')}`)

const user = api('GET', '/v2/user')
if (user.status !== 200) throw new Error(`Vercel token rejected (${user.status}); create a token at vercel.com/account/settings/tokens`)

// ---------------------------------------------------------------- project

let project = api('GET', `/v9/projects/${projectName}`)
if (project.status === 404) {
  project = api('POST', '/v11/projects', { name: projectName, framework: null })
  if (project.status >= 300) throw new Error(`could not create project: ${JSON.stringify(project.json)}`)
  console.log(`created project ${projectName}`)
}
const projectId = project.json.id

const protect = api('PATCH', `/v9/projects/${projectId}`, { ssoProtection: { deploymentType: 'all' } })
const protection = protect.json && protect.json.ssoProtection
if (protect.status >= 300 || !protection || protection.deploymentType !== 'all') {
  throw new Error(`Vercel did not confirm protection of all deployments: ${JSON.stringify(protect.json).slice(0, 300)}`)
}
console.log('Vercel Authentication: all deployments')

// ---------------------------------------------------------------- upload

const list = files(dist)
list.push({ full: path.join(app, 'vercel.json'), file: 'vercel.json' })
const manifest = []
for (const [index, item] of list.entries()) {
  const bytes = fs.readFileSync(item.full)
  const sha = crypto.createHash('sha1').update(bytes).digest('hex')
  const upload = api('POST', '/v2/files', null, {
    'Content-Type': 'application/octet-stream', 'x-vercel-digest': sha, 'Content-Length': String(bytes.length),
  }, item.full)
  if (upload.status >= 300) throw new Error(`upload ${item.file}: ${JSON.stringify(upload.json)}`)
  manifest.push({ file: item.file, sha, size: bytes.length })
  if ((index + 1) % 50 === 0) console.log(`uploaded ${index + 1}/${list.length}`)
}

const deployment = api('POST', '/v13/deployments?forceNew=1', {
  name: projectName,
  project: projectId,
  target: 'production',
  files: manifest,
  projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null },
})
if (deployment.status >= 300) throw new Error(`deployment: ${JSON.stringify(deployment.json).slice(0, 400)}`)
let state = deployment.json
for (let tries = 0; tries < 120 && !['READY', 'ERROR', 'CANCELED'].includes(state.readyState); tries += 1) {
  execFileSync('sleep', ['3'])
  state = api('GET', `/v13/deployments/${deployment.json.id}`).json
}
if (state.readyState !== 'READY') throw new Error(`deployment ended ${state.readyState}`)
const aliases = (state.alias || []).map((a) => `https://${a}`)
console.log(JSON.stringify({ url: `https://${state.url}`, aliases, files: manifest.length }, null, 1))

// Anonymous requests must not reach the app.
for (const url of [`https://${state.url}`, ...aliases]) {
  const code = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-m', '30', `${url}/data/encryption.json`]).toString()
  console.log(`anonymous ${url}: HTTP ${code}${code === '200' ? '  <-- NOT PROTECTED' : ''}`)
}
