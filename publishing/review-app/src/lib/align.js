// Compare rows: editions of one language aligned through their lineages.
//
// The first edition anchors: each of its paragraphs in the chosen Part is a
// row, and every other edition contributes the paragraphs that share a
// lineage with it.  Paragraphs of another edition that no anchor reaches,
// but that fall between ones it does, become rows of their own just after
// their predecessor: additions stay where they were written.

import { partUnits, unitsByIndex } from './data.js'

export async function compareRows(book, editionIds, partId) {
  const [anchor, ...others] = editionIds
  const { graph } = book
  const anchorUnits = await partUnits(book, anchor, partId)
  const placed = new Set()
  const rows = anchorUnits.map((unit) => ({ key: graph.units[unit.idx], cells: { [anchor]: [unit.idx] } }))
  others.forEach((editionId) => {
    const want = book.editionIndex.get(editionId)
    rows.forEach((row) => {
      const members = new Set()
      for (const lineage of book.lineageOf.get(row.cells[anchor][0]) || []) {
        for (const member of graph.lineages[lineage]) {
          if (graph.unit_edition[member] === want && !placed.has(member)) members.add(member)
        }
      }
      const list = [...members].sort((a, b) => a - b)
      list.forEach((member) => placed.add(member))
      row.cells[editionId] = list
    })
    const reached = rows.flatMap((row) => row.cells[editionId] || [])
    if (!reached.length) return
    const lo = Math.min(...reached)
    const hi = Math.max(...reached)
    for (let unit = lo; unit <= hi; unit += 1) {
      if (placed.has(unit) || graph.unit_edition[unit] !== want) continue
      let at = -1
      rows.forEach((row, index) => {
        if ((row.cells[editionId] || []).some((member) => member < unit)) at = index
      })
      rows.splice(at + 1, 0, { key: graph.units[unit], cells: { [editionId]: [unit] } })
      placed.add(unit)
    }
  })
  const texts = await unitsByIndex(book, rows.flatMap((row) => Object.values(row.cells).flat()))
  for (const row of rows) {
    row.text = {}
    const kinds = []
    for (const editionId of editionIds) {
      const units = (row.cells[editionId] || []).map((idx) => texts.get(idx)).filter(Boolean)
      row.text[editionId] = units.map((unit) => unit.text).join('\n\n')
      kinds.push(...units.map((unit) => unit.kind))
      if (units[0] && units[0].chapter && !row.chapter) row.chapter = units[0].chapter
    }
    row.kind = kinds.length && kinds.every((kind) => kind === 'heading') ? 'heading' : 'paragraph'
  }
  return rows
}

// Every row of a whole book for two editions, for rules and the heat map.
export async function pairRows(book, left, right, onProgress = () => {}) {
  const parts = book.edition(left).parts
  const out = []
  for (const [index, part] of parts.entries()) {
    for (const row of await compareRows(book, [left, right], part.id)) {
      out.push({ key: row.key, part: part.id, left: row.text[left], right: row.text[right] })
    }
    onProgress((index + 1) / parts.length)
  }
  return out
}
