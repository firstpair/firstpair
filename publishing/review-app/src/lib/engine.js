// Word diffs between editions, computed in the browser.
//
// A faithful port of publishing/vault/edition_diffs.py (firstpair.edition-
// diffs.v2) so the app and the vaults mark the same words the same way:
// Python difflib's SequenceMatcher (no junk, no autojunk), the same tokens,
// the same change categories, set diffs, in-row moves, and recurring
// one-word substitution rules.  Offsets here are JavaScript string indices;
// the app renders them directly.

export const CATEGORIES = ['punct', 'inflect', 'function', 'lexical', 'restructure', 'rewrite', 'content', 'moved']
const TOKEN_RE = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*|[^\p{L}\p{N}_\s]/gu
const WORD_RE = /[\p{L}\p{N}_]/u
export const RULE_MIN_ROWS = 3
const MOVE_MIN_WORDS = 6
const MOVE_OVERLAP = 0.5

export function tokens(text) {
  const out = []
  for (const match of String(text).matchAll(TOKEN_RE)) {
    out.push([match.index, match.index + match[0].length, match[0].toLowerCase()])
  }
  return out
}

// Python difflib.SequenceMatcher with isjunk=None, autojunk=False.
export class SequenceMatcher {
  constructor(a, b) {
    this.a = a
    this.b = b
    this.b2j = new Map()
    b.forEach((item, index) => {
      const list = this.b2j.get(item)
      if (list) list.push(index)
      else this.b2j.set(item, [index])
    })
    this.matchingBlocks = null
  }

  findLongestMatch(alo, ahi, blo, bhi) {
    const { a, b, b2j } = this
    let besti = alo
    let bestj = blo
    let bestsize = 0
    let j2len = new Map()
    for (let i = alo; i < ahi; i += 1) {
      const next = new Map()
      for (const j of b2j.get(a[i]) || []) {
        if (j < blo) continue
        if (j >= bhi) break
        const k = (j2len.get(j - 1) || 0) + 1
        next.set(j, k)
        if (k > bestsize) {
          besti = i - k + 1
          bestj = j - k + 1
          bestsize = k
        }
      }
      j2len = next
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti -= 1
      bestj -= 1
      bestsize += 1
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize += 1
    }
    return [besti, bestj, bestsize]
  }

  getMatchingBlocks() {
    if (this.matchingBlocks) return this.matchingBlocks
    const la = this.a.length
    const lb = this.b.length
    const queue = [[0, la, 0, lb]]
    const blocks = []
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop()
      const [i, j, k] = this.findLongestMatch(alo, ahi, blo, bhi)
      if (k) {
        blocks.push([i, j, k])
        if (alo < i && blo < j) queue.push([alo, i, blo, j])
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi])
      }
    }
    blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2])
    const collapsed = []
    let [i1, j1, k1] = [0, 0, 0]
    for (const [i2, j2, k2] of blocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2
      else {
        if (k1) collapsed.push([i1, j1, k1])
        ;[i1, j1, k1] = [i2, j2, k2]
      }
    }
    if (k1) collapsed.push([i1, j1, k1])
    collapsed.push([la, lb, 0])
    this.matchingBlocks = collapsed
    return collapsed
  }

  getOpcodes() {
    let i = 0
    let j = 0
    const answer = []
    for (const [ai, bj, size] of this.getMatchingBlocks()) {
      let tag = ''
      if (i < ai && j < bj) tag = 'replace'
      else if (i < ai) tag = 'delete'
      else if (j < bj) tag = 'insert'
      if (tag) answer.push([tag, i, ai, j, bj])
      i = ai + size
      j = bj + size
      if (size) answer.push(['equal', ai, i, bj, j])
    }
    return answer
  }

  ratio() {
    const matches = this.getMatchingBlocks().reduce((sum, block) => sum + block[2], 0)
    const total = this.a.length + this.b.length
    return total ? (2 * matches) / total : 1
  }
}

// lemmas: { word: lemma } (words missing map to themselves); functionWords:
// the language's small words.
export function classifier({ lemmas = null, functionWords = [] } = {}) {
  const fn = new Set(functionWords.map((word) => word.toLowerCase()))
  const lemma = (token) => (lemmas && WORD_RE.test(token) && lemmas[token]) || token
  const words = (toks) => toks.filter((t) => WORD_RE.test(t[2])).map((t) => lemma(t[2]))
  const content = (toks) => words(toks).filter((w) => !fn.has(w))
  function category(tag, left, right) {
    const wl = words(left)
    const wr = words(right)
    if (!wl.length && !wr.length) return 'punct'
    if (tag === 'replace' && wl.length === wr.length && wl.every((w, i) => w === wr[i])) return 'inflect'
    if ([...wl, ...wr].every((w) => fn.has(w))) return 'function'
    if (tag === 'replace') {
      const shared = wl.some((w) => wr.includes(w))
      if (wl.length <= 2 && wr.length <= 2 && !shared) return 'lexical'
      return shared ? 'restructure' : 'rewrite'
    }
    return Math.max(wl.length, wr.length) > 3 ? 'content' : 'lexical'
  }
  return { lemma, words, content, category, functionWords: fn }
}

function sameKind(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

function ranges(text, toks, kinds) {
  const out = []
  toks.forEach(([start, end], index) => {
    const kind = kinds[index]
    if (!kind) return
    const tail = Array.isArray(kind) ? kind : [kind]
    const last = out[out.length - 1]
    if (last && sameKind(last.slice(2), tail) && !text.slice(last[1], start).trim()) last[1] = end
    else out.push([start, end, ...tail])
  })
  return out
}

function overlap(words, other) {
  if (!words.length || !other.length) return 0
  const counts = new Map()
  for (const w of other) counts.set(w, (counts.get(w) || 0) + 1)
  let shared = 0
  for (const w of words) {
    const n = counts.get(w) || 0
    if (n) {
      shared += 1
      counts.set(w, n - 1)
    }
  }
  return shared / words.length
}

function runs(kinds, wanted) {
  const out = []
  let start = null
  ;[...kinds, null].forEach((kind, index) => {
    const hit = kind && kind[0] === wanted && (kind[1] === 'content' || kind[1] === 'rewrite')
    if (hit && start === null) start = index
    else if (!hit && start !== null) {
      out.push([start, index])
      start = null
    }
  })
  return out
}

// Two texts: ranges for each side ([start, end, 'del'|'ins', category]) and
// the one-word substitutions that rules are mined from.
export function pairDiff(left, right, cls = classifier()) {
  const lt = tokens(left)
  const rt = tokens(right)
  const matcher = new SequenceMatcher(lt.map((t) => t[2]), rt.map((t) => t[2]))
  const lk = new Array(lt.length).fill(null)
  const rk = new Array(rt.length).fill(null)
  const subs = []
  for (const [tag, i1, i2, j1, j2] of matcher.getOpcodes()) {
    if (tag === 'equal') continue
    const a = lt.slice(i1, i2)
    const b = rt.slice(j1, j2)
    const category = cls.category(tag, a, b)
    for (let i = i1; i < i2; i += 1) lk[i] = ['del', category]
    for (let j = j1; j < j2; j += 1) rk[j] = ['ins', category]
    if (tag === 'replace' && category === 'lexical') {
      const wl = cls.words(a)
      const wr = cls.words(b)
      if (wl.length === 1 && wr.length === 1 && !(cls.functionWords.has(wl[0]) && cls.functionWords.has(wr[0]))) {
        subs.push({ from: wl[0], to: wr[0], left: [a[0][0], a[a.length - 1][1]], right: [b[0][0], b[b.length - 1][1]] })
      }
    }
  }
  for (const [gs, ge] of runs(lk, 'del')) {
    const gone = cls.content(lt.slice(gs, ge))
    if (gone.length < MOVE_MIN_WORDS) continue
    for (const [ns, ne] of runs(rk, 'ins')) {
      if (overlap(gone, cls.content(rt.slice(ns, ne))) >= MOVE_OVERLAP) {
        for (let i = gs; i < ge; i += 1) lk[i] = ['del', 'moved']
        for (let j = ns; j < ne; j += 1) rk[j] = ['ins', 'moved']
        break
      }
    }
  }
  return {
    left: ranges(left, lt, lk),
    right: ranges(right, rt, rk),
    subs,
    same: matcher.getOpcodes().every((op) => op[0] === 'equal'),
  }
}

// Three or more texts: each text's words found in no other ('uniq'), shared
// with exactly one other ('share:<index>'), or with some but not all ('part').
export function setDiff(texts) {
  const toks = texts.map(tokens)
  const survives = texts.map(() => texts.map(() => null))
  texts.forEach((_, i) => {
    texts.forEach((__, j) => {
      if (j <= i) return
      const keepI = new Set()
      const keepJ = new Set()
      const matcher = new SequenceMatcher(toks[i].map((t) => t[2]), toks[j].map((t) => t[2]))
      for (const [a, b, size] of matcher.getMatchingBlocks()) {
        for (let k = 0; k < size; k += 1) {
          keepI.add(a + k)
          keepJ.add(b + k)
        }
      }
      survives[i][j] = keepI
      survives[j][i] = keepJ
    })
  })
  return texts.map((text, i) => {
    const others = texts.map((_, j) => j).filter((j) => j !== i)
    const kinds = toks[i].map((_, index) => {
      const found = others.filter((j) => survives[i][j].has(index))
      if (found.length === others.length) return null
      if (!found.length) return 'uniq'
      if (found.length === 1) return `share:${found[0]}`
      return 'part'
    })
    return ranges(text, toks[i], kinds)
  })
}

// A whole book for one pair: rows of { key, part, left, right } text.
// Returns recurring substitutions (rules) and words changed per Part and
// category (summary), counted on the later side, plus pure omissions.
export function scanPair(rows, cls = classifier(), minRows = RULE_MIN_ROWS) {
  const found = new Map()
  const summary = {}
  const wordCount = (text) => (text.match(/[\p{L}\p{N}]+/gu) || []).length
  for (const row of rows) {
    if (!row.left && !row.right) continue
    const diff = pairDiff(row.left || '', row.right || '', cls)
    const bucket = (summary[row.part] ||= {})
    for (const [s, e, , category] of diff.right) {
      bucket[category] = (bucket[category] || 0) + (wordCount((row.right || '').slice(s, e)) || (category === 'punct' ? 1 : 0))
    }
    for (const [s, e, , category] of diff.left) {
      if (category !== 'content') continue
      bucket.content = (bucket.content || 0) + wordCount((row.left || '').slice(s, e))
    }
    for (const sub of diff.subs) {
      const id = `${sub.from}\u001f${sub.to}`
      if (!found.has(id)) found.set(id, { from: sub.from, to: sub.to, hits: [] })
      found.get(id).hits.push({ key: row.key, part: row.part, left: sub.left, right: sub.right })
    }
  }
  const recurring = [...found.values()].filter((rule) => new Set(rule.hits.map((h) => h.key)).size >= minRows)
  const byId = new Map(recurring.map((rule) => [`${rule.from}\u001f${rule.to}`, rule]))
  const rules = recurring
    .map((rule) => {
      const reverse = found.get(`${rule.to}\u001f${rule.from}`)
      return {
        from: rule.from,
        to: rule.to,
        count: rule.hits.length,
        rows: new Set(rule.hits.map((h) => h.key)).size,
        reverseCount: reverse ? reverse.hits.length : 0,
        reverseIsRule: byId.has(`${rule.to}\u001f${rule.from}`),
        hits: rule.hits,
      }
    })
    .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
  return { rules, summary }
}

// Display segments: [{ text, cls }] from ranges, for Vue to render.
export function segments(text, rangeList, classFor) {
  const out = []
  let cursor = 0
  for (const range of [...rangeList].sort((a, b) => a[0] - b[0])) {
    const [start, end] = range
    if (start < cursor) continue
    if (start > cursor) out.push({ text: text.slice(cursor, start), range: null })
    out.push({ text: text.slice(start, end), range, cls: classFor ? classFor(range) : '' })
    cursor = end
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), range: null })
  return out
}
