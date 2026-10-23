// Span notes on a text cell, in the shared ledger format: what a cell's
// notes are, how to describe a new one, and where they sit in the text.

import { reviewState } from './shared.js'

export function sentenceId(fragmentKey, edition, text) {
  return `${fragmentKey}:${edition}:${reviewState.sentenceFingerprint(text || '')}`
}

export function cellNotes(ledger, fragmentKey, edition, text) {
  if (!ledger) return []
  const sid = sentenceId(fragmentKey, edition, text)
  return Object.values(ledger.span_notes || {})
    .filter((note) => note.fragment_key === fragmentKey && note.sentence_id === sid)
    .map((note) => ({ ...note, action: 'note' }))
}

export function noteDetails({ fragmentKey, edition, editionTitle, text, title, selector }) {
  const sid = sentenceId(fragmentKey, edition, text)
  return {
    id: reviewState.spanNoteKey(fragmentKey, edition, sid, selector.start, selector.end, selector.exact),
    fragment_key: fragmentKey,
    set: 'review',
    lineage: fragmentKey,
    incipit: title || '',
    edition,
    edition_title: editionTitle || edition,
    unit: fragmentKey,
    sentence_id: sid,
    sentence_fingerprint: reviewState.sentenceFingerprint(text || ''),
    selector,
    token_keys: selector.token_keys || [],
  }
}

// Code-point offset -> JavaScript string index, for one text.
export function codePointIndex(text) {
  const map = [0]
  let index = 0
  for (const char of text) {
    index += char.length
    map.push(index)
  }
  return (cp) => map[Math.min(Math.max(0, cp), map.length - 1)]
}
