// The book's exported data (firstpair.review.v1), fetched once and cached.
//
// manifest.json and graph.json load at start; an edition's Part file loads
// the first time any view needs one of its paragraphs.  Paragraphs are
// referred to by their index in graph.units everywhere in the app.

import { encrypted, fetchJson } from './vault-crypto.js'

const BASE = `${import.meta.env.BASE_URL}data/`
const cache = new Map()

// Plain JSON in development; decrypted per file in an encrypted deployment.
function json(path) {
  if (!cache.has(path)) {
    cache.set(path, encrypted() ? fetchJson(path) : fetch(BASE + path).then((response) => {
      if (!response.ok) throw new Error(`${path}: ${response.status}`)
      return response.json()
    }))
  }
  return cache.get(path)
}

export async function loadBook() {
  const [manifest, graph] = await Promise.all([json('manifest.json'), json('graph.json')])
  if (manifest.schema !== 'firstpair.review.v1') throw new Error(`unsupported data: ${manifest.schema}`)
  const editionIndex = new Map(manifest.editions.map((edition, index) => [edition.id, index]))
  const lineageOf = new Map()
  graph.lineages.forEach((members, lineage) => {
    for (const unit of members) {
      if (!lineageOf.has(unit)) lineageOf.set(unit, [])
      lineageOf.get(unit).push(lineage)
    }
  })
  const eventsOf = new Map()
  graph.events.forEach((event, index) => {
    for (const unit of [...event[2], ...event[3]]) {
      if (!eventsOf.has(unit)) eventsOf.set(unit, [])
      eventsOf.get(unit).push(index)
    }
  })
  const transitions = graph.transitions.map((name) => {
    const [from, to] = name.split('>')
    return { name, from, to }
  })
  return {
    manifest, graph, editionIndex, lineageOf, eventsOf, transitions,
    edition: (id) => manifest.editions[editionIndex.get(id)],
    editionOf: (unit) => manifest.editions[graph.unit_edition[unit]],
  }
}

// Rows of one Part: { idx, kind, text, chapter }.
export async function partUnits(book, editionId, partId) {
  const edition = book.edition(editionId)
  const part = edition && edition.parts.find((item) => item.id === partId)
  if (!part) return []
  const rows = await json(part.file)
  return rows.map(([idx, kind, text, chapter]) => ({ idx, kind, text, chapter }))
}

// Text rows for any paragraphs, loading only the Parts that hold them.
export async function unitsByIndex(book, indices) {
  const wanted = new Map()
  for (const idx of indices) {
    const edition = book.editionOf(idx)
    const key = `${edition.id}\u001f${book.graph.unit_part[idx]}`
    if (!wanted.has(key)) wanted.set(key, [edition.id, book.graph.unit_part[idx]])
  }
  const found = new Map()
  for (const [editionId, partId] of wanted.values()) {
    for (const row of await partUnits(book, editionId, partId)) found.set(row.idx, row)
  }
  return found
}

export async function editionUnits(book, editionId) {
  const edition = book.edition(editionId)
  const all = []
  for (const part of edition.parts) {
    for (const row of await partUnits(book, editionId, part.id)) all.push({ ...row, part: part.id })
  }
  return all
}

export function lemmas(book, lang) {
  const file = book.manifest.lemmas && book.manifest.lemmas[lang]
  return file ? json(file) : Promise.resolve(null)
}

export function crosslang(book, id) {
  const pair = book.manifest.crosslang.find((item) => item.id === id)
  return pair ? json(pair.file).then((data) => ({ ...pair, ...data })) : Promise.resolve(null)
}
