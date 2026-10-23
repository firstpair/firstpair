// Encrypt a book's exported data folder for a deployed build.
//
//   REVIEW_PASSPHRASE=… node scripts/encrypt-data.mjs <data dir> <out dir>
//
// Every file is compressed (raw DEFLATE) and encrypted with AES-256-GCM
// under a key derived from the passphrase by PBKDF2-SHA-256 (600,000
// iterations, random salt).  Each file is written as <name>.enc: a 12-byte
// random IV followed by the ciphertext and tag.  encryption.json records the
// parameters and an encrypted check value, so the app can tell a wrong
// passphrase from damaged data.  Nothing readable about the texts is left in
// the output: file names are those of the export (edition and Part ids).

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { webcrypto as crypto } from 'node:crypto'

export const ITERATIONS = 600_000
const CHECK = 'firstpair-review'

async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes))
  const out = new Uint8Array(iv.length + sealed.length)
  out.set(iv)
  out.set(sealed, iv.length)
  return out
}

export async function encryptFolder(source, target, passphrase) {
  if (!passphrase || passphrase.length < 20) throw new Error('REVIEW_PASSPHRASE must be at least 20 characters')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(passphrase, salt)
  let files = 0
  let bytes = 0
  const walk = async (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { await walk(full); continue }
      const relative = path.relative(source, full)
      const sealed = await seal(key, zlib.deflateRawSync(fs.readFileSync(full), { level: 9 }))
      const destination = path.join(target, `${relative}.enc`)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, sealed)
      files += 1
      bytes += sealed.length
    }
  }
  fs.mkdirSync(target, { recursive: true })
  await walk(source)
  const check = await seal(key, new TextEncoder().encode(CHECK))
  fs.writeFileSync(path.join(target, 'encryption.json'), JSON.stringify({
    cipher: 'AES-256-GCM', compression: 'deflate-raw', kdf: 'PBKDF2-SHA-256',
    iterations: ITERATIONS,
    salt: Buffer.from(salt).toString('base64'),
    check: Buffer.from(check).toString('base64'),
  }, null, 1))
  return { files, bytes }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [source, target] = process.argv.slice(2)
  const result = await encryptFolder(path.resolve(source), path.resolve(target), process.env.REVIEW_PASSPHRASE)
  console.log(JSON.stringify(result))
}
