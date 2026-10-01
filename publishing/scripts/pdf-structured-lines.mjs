// A narrow exception to the one-word-column heuristic, never to page bounds.
// Require complete dependency-list syntax, not a font or punctuation ratio.
function text(xml) {
  return [...xml.matchAll(/<word\b[^>]*>([\s\S]*?)<\/word>/g)]
    .map((match) => match[1]).join(' ')
    .replace(/&(#x[\da-f]+|#\d+|quot|apos|amp|lt|gt);/gi, (entity, name) => {
      if (name[0] === '#') {
        const code = name[1].toLowerCase() === 'x'
          ? parseInt(name.slice(2), 16) : Number(name.slice(1))
        return code <= 0x10ffff ? String.fromCodePoint(code) : entity
      }
      return { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' }[name] ?? entity
    }).replace(/[\u200b-\u200d\ufeff]/g, '').trim()
}

function kind(value) {
  // A gutter may be emitted in the same line, or in a separate bbox block.
  const line = value.replace(/^\d+\s+/, '').replace(/^[+-]\s*/, '').trim()
  if (/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(?: dependencies = \[)?$/.test(line)) return 'anchor'
  if (/^dependencies\s*=\s*\[$/.test(line)) return 'anchor'
  if (/^"[A-Za-z0-9_.+-]+(?: [0-9][A-Za-z0-9_.+-]*)?",$/.test(line)) return 'item'
  if (/^\[\[package\]\]$/.test(line) || /^\]$/.test(line)) return 'syntax'
  if (/^[A-Za-z_][\w.-]*\s*=\s*"(?:[^"\\]|\\.)*"$/.test(line)) return 'syntax'
  if (!line && /^[+-]?$/.test(value)) return 'syntax'
  return null
}

export function isStructuredDependencyPage(lines, height) {
  const rows = lines.map((line) => ({ ...line, text: text(line.xml) }))
  const code = rows.filter((line) => kind(line.text))
  if (!code.some((line) => kind(line.text) === 'anchor') ||
      !code.some((line) => kind(line.text) === 'item')) return false
  const left = Math.min(...code.map((line) => line.xMin))
  const gutters = rows.filter((line) => /^\d+$/.test(line.text) && line.xMax < left &&
    line.yMin >= Math.min(...code.map((row) => row.yMin)) - 1 &&
    line.yMin <= Math.max(...code.map((row) => row.yMin)) + 1)
    .sort((a, b) => a.yMin - b.yMin)
  // Blank source lines have a number but no text bbox. Accept them only in a
  // consecutive, aligned gutter with at least two source-paired entries.
  const numbered = gutters.length >= 2 && gutters.every((line, i) =>
    Math.abs(line.xMax - gutters[0].xMax) < 1 &&
    (i === 0 || Number(line.text) === Number(gutters[i - 1].text) + 1)) &&
    gutters.filter((line) => code.some((source) => Math.abs(line.yMin - source.yMin) < 1)).length >= 2
  return rows.every((line) => {
    if (kind(line.text)) return true
    if (!/^\d+$/.test(line.text)) return false
    // Ignore only a paired gutter to the left of source, or the page footer.
    return (numbered && gutters.includes(line)) ||
      (line.yMin > height * 0.95 && rows.filter((row) => row.yMin > height * 0.95).length === 1)
  })
}
