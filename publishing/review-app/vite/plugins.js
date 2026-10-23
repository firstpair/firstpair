// Vite plugins for the FirstPair review app.
//
// firstpairShared  serves the shared reader modules under
//                  publishing/vault/plugin as ES modules.  They are CommonJS
//                  (the Obsidian plugins bundle them that way); relative
//                  require() calls become imports and module.exports the
//                  default export, so both worlds run the same files.
// reviewData       serves a book's exported data folder at /data during
//                  development; a production build copies it into dist/data
//                  only when asked (REVIEW_INCLUDE_DATA=1), so the full
//                  texts never ship by accident.
// reviewDecisions  a development-only file API at /api/fs, confined to one
//                  folder, that the shared ledger store writes through.

import fs from 'node:fs'
import path from 'node:path'

const REQUIRE_RE = /require\((["'])(\.{1,2}\/[^"']+)\1\)/g

export function firstpairShared(root) {
  const base = path.resolve(root) + path.sep
  return {
    name: 'firstpair-shared-cjs',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0]
      if (!file.startsWith(base) || !file.endsWith('.js') || !/module\.exports/.test(code)) return null
      const imports = []
      const body = code.replace(REQUIRE_RE, (_match, _quote, spec) => {
        const name = `__firstpair_require_${imports.length}`
        imports.push(`import ${name} from ${JSON.stringify(spec.endsWith('.js') ? spec : `${spec}.js`)};`)
        return name
      })
      return {
        code: `${imports.join('\n')}\nconst module = { exports: {} };\nconst exports = module.exports;\n${body}\nexport default module.exports;\n`,
        map: null,
      }
    },
  }
}

function contentType(file) {
  if (file.endsWith('.json')) return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

export function reviewData(dir, { includeInBuild = false } = {}) {
  const root = dir ? path.resolve(dir) : null
  let outDir = 'dist'
  return {
    name: 'firstpair-review-data',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      if (!root) return
      server.middlewares.use('/data', (req, res, next) => {
        const relative = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '')
        const file = path.resolve(root, relative)
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next()
        res.setHeader('Content-Type', contentType(file))
        res.setHeader('Cache-Control', 'no-cache')
        fs.createReadStream(file).pipe(res)
      })
    },
    // A deployed build carries the data encrypted (REVIEW_PASSPHRASE); plain
    // data ships only when REVIEW_ALLOW_PLAINTEXT=1 says so explicitly.
    async closeBundle() {
      if (!root || !includeInBuild) return
      const target = path.join(outDir, 'data')
      if (process.env.REVIEW_PASSPHRASE) {
        const { encryptFolder } = await import('../scripts/encrypt-data.mjs')
        const result = await encryptFolder(root, target, process.env.REVIEW_PASSPHRASE)
        this.info?.(`encrypted ${result.files} data files (${(result.bytes / 1e6).toFixed(1)} MB)`)
        return
      }
      if (process.env.REVIEW_ALLOW_PLAINTEXT !== '1') {
        throw new Error('refusing to put unencrypted book data in a build: set REVIEW_PASSPHRASE')
      }
      fs.cpSync(root, target, { recursive: true })
    },
  }
}

export function reviewDecisions(dir) {
  const root = dir ? path.resolve(dir) : null
  const inside = (relative) => {
    const target = path.resolve(root, String(relative || ''))
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`outside the decisions folder: ${relative}`)
    return target
  }
  return {
    name: 'firstpair-review-decisions',
    apply: 'serve',
    configureServer(server) {
      if (!root) return
      fs.mkdirSync(root, { recursive: true })
      server.middlewares.use('/api/fs', (req, res) => {
        const reply = (status, body) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        if (req.method === 'GET') return reply(200, { ok: true, root: path.basename(root) })
        if (req.method !== 'POST') return reply(405, { error: 'POST only' })
        let raw = ''
        req.on('data', (chunk) => { raw += chunk })
        req.on('end', () => {
          try {
            const { op, path: relative, data, to } = JSON.parse(raw || '{}')
            const target = inside(relative)
            if (op === 'exists') return reply(200, { value: fs.existsSync(target) })
            if (op === 'read') return reply(200, { value: fs.readFileSync(target, 'utf8') })
            if (op === 'write') {
              fs.mkdirSync(path.dirname(target), { recursive: true })
              fs.writeFileSync(target, String(data))
              return reply(200, { value: true })
            }
            if (op === 'rename') {
              const destination = inside(to)
              fs.mkdirSync(path.dirname(destination), { recursive: true })
              fs.renameSync(target, destination)
              return reply(200, { value: true })
            }
            if (op === 'remove') {
              fs.rmSync(target, { force: true })
              return reply(200, { value: true })
            }
            if (op === 'mkdir') {
              fs.mkdirSync(target, { recursive: true })
              return reply(200, { value: true })
            }
            return reply(400, { error: `unknown op ${op}` })
          } catch (error) {
            return reply(400, { error: String(error.message || error) })
          }
        })
      })
    },
  }
}
