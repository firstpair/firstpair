// Where decisions are saved.  The shared ledger store writes through an
// Obsidian-style adapter (exists, read, write, rename, remove, mkdir); two
// adapters provide it here:
//
//   dev     the Vite dev server's /api/fs, confined to REVIEW_DECISIONS
//           (book/review in this repository);
//   folder  a folder picked in Chrome (File System Access API), which works
//           the same when the app is served from Vercel.  The folder handle
//           is remembered in IndexedDB; Chrome asks again for permission.

export async function devStorage() {
  try {
    const response = await fetch('/api/fs')
    if (!response.ok) return null
    const info = await response.json()
    if (!info.ok) return null
  } catch {
    return null
  }
  const call = async (op, path, extra = {}) => {
    const response = await fetch('/api/fs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, path, ...extra }),
    })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || `${op} failed`)
    return body.value
  }
  return {
    kind: 'dev',
    label: 'repository (book/review)',
    adapter: {
      exists: (path) => call('exists', path),
      read: (path) => call('read', path),
      write: (path, data) => call('write', path, { data }),
      rename: (from, to) => call('rename', from, { to }),
      remove: (path) => call('remove', path),
      mkdir: (path) => call('mkdir', path),
    },
  }
}

const DB = 'firstpair-review'

function idb(mode, action) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore('handles')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const store = open.result.transaction('handles', mode).objectStore('handles')
      const request = action(store)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }
  })
}

function folderAdapter(root) {
  const split = (path) => String(path).split('/').filter(Boolean)
  const dir = async (parts, create = false) => {
    let handle = root
    for (const part of parts) handle = await handle.getDirectoryHandle(part, { create })
    return handle
  }
  const file = async (path, create = false) => {
    const parts = split(path)
    const name = parts.pop()
    return (await dir(parts, create)).getFileHandle(name, { create })
  }
  const read = async (path) => (await (await file(path)).getFile()).text()
  const write = async (path, data) => {
    const writable = await (await file(path, true)).createWritable()
    await writable.write(data)
    await writable.close()
  }
  const remove = async (path) => {
    const parts = split(path)
    const name = parts.pop()
    try {
      await (await dir(parts)).removeEntry(name)
    } catch (error) {
      if (error.name !== 'NotFoundError') throw error
    }
  }
  return {
    async exists(path) {
      const parts = split(path)
      const name = parts.pop()
      try {
        const parent = await dir(parts)
        try { await parent.getFileHandle(name); return true } catch { /* not a file */ }
        await parent.getDirectoryHandle(name)
        return true
      } catch {
        return false
      }
    },
    read,
    write,
    async rename(from, to) {
      const source = await file(from)
      const target = split(to)
      const name = target.pop()
      if (typeof source.move === 'function') {
        await source.move(await dir(target, true), name)
        return
      }
      await write(to, await read(from))
      await remove(from)
    },
    remove,
    async mkdir(path) {
      await dir(split(path), true)
    },
  }
}

export async function rememberedFolder() {
  if (typeof indexedDB === 'undefined') return null
  const handle = await idb('readonly', (store) => store.get('decisions')).catch(() => null)
  if (!handle) return null
  const state = await handle.queryPermission({ mode: 'readwrite' })
  return { kind: 'folder', label: handle.name, handle, granted: state === 'granted', adapter: folderAdapter(handle) }
}

export async function pickFolder() {
  if (typeof window.showDirectoryPicker !== 'function') {
    throw new Error('this browser cannot save into a folder; use Chrome, Edge, or Arc')
  }
  const handle = await window.showDirectoryPicker({ id: 'firstpair-review', mode: 'readwrite' })
  await idb('readwrite', (store) => store.put(handle, 'decisions'))
  return { kind: 'folder', label: handle.name, handle, granted: true, adapter: folderAdapter(handle) }
}

export async function grant(storage) {
  if (storage.kind !== 'folder') return true
  const state = await storage.handle.requestPermission({ mode: 'readwrite' })
  storage.granted = state === 'granted'
  return storage.granted
}
