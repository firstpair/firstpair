// Encrypted data (scripts/encrypt-data.mjs): the passphrase derives an
// AES-256-GCM key (PBKDF2-SHA-256, 600,000 iterations); each file is a
// 12-byte IV and the ciphertext of its raw-DEFLATE-compressed JSON.  The key
// is non-extractable; "remember on this device" keeps it in IndexedDB, where
// the browser stores the key object itself, never the passphrase.

const BASE = `${import.meta.env.BASE_URL}data/`
const DB = 'firstpair-review-keys'
let key = null

const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

export async function encryptionInfo() {
  try {
    const response = await fetch(`${BASE}encryption.json`, { cache: 'no-cache' })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

function db(mode, action) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore('keys')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const request = action(open.result.transaction('keys', mode).objectStore('keys'))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }
  })
}

async function decryptBytes(candidate, sealed) {
  const iv = sealed.slice(0, 12)
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, candidate, sealed.slice(12)))
}

async function verified(candidate, info) {
  try {
    const plain = await decryptBytes(candidate, fromBase64(info.check))
    return new TextDecoder().decode(plain) === 'firstpair-review'
  } catch {
    return false
  }
}

export async function unlock(info, passphrase, remember) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  const candidate = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(info.salt), iterations: info.iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  )
  if (!(await verified(candidate, info))) return false
  key = candidate
  if (remember) await db('readwrite', (store) => store.put({ salt: info.salt, key: candidate }, 'data')).catch(() => {})
  return true
}

export async function rememberedKey(info) {
  const saved = await db('readonly', (store) => store.get('data')).catch(() => null)
  if (!saved || saved.salt !== info.salt || !(await verified(saved.key, info))) return false
  key = saved.key
  return true
}

export async function forget() {
  key = null
  await db('readwrite', (store) => store.delete('data')).catch(() => {})
}

export function encrypted() {
  return key !== null
}

export async function fetchJson(path) {
  const response = await fetch(`${BASE}${path}.enc`)
  if (!response.ok) throw new Error(`${path}: ${response.status}`)
  const plain = await decryptBytes(key, new Uint8Array(await response.arrayBuffer()))
  const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return JSON.parse(await new Response(stream).text())
}
