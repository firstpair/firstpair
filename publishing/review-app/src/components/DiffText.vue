<script setup>
// One text with its diff marks (shared diff-view classes) and its saved span
// notes (shared span colours: overlapping spans differ, shared words stripe).
import { computed } from 'vue'
import { diffView, reviewState, spanEditor, t } from '../lib/shared.js'
import { codePointIndex } from '../lib/notes.js'

const props = defineProps({
  text: { type: String, default: '' },
  ranges: { type: Array, default: () => [] },   // [start, end, kind, category?, target?] (JS indices)
  editions: { type: Array, default: () => [] }, // edition ids, for share colours
  notes: { type: Array, default: () => [] },    // span-note records (code points)
})
const emit = defineEmits(['note'])

const titleFor = (kind, category) => {
  const base = kind === 'del' ? 'removed' : kind === 'ins' ? 'added' : kind === 'uniq' ? 'only here'
    : kind.startsWith('share:') ? `shared with ${kind.slice(6)} only` : 'shared with some'
  return category ? `${base} · ${t(`diff_cat_${category}`)}` : base
}

const segments = computed(() => {
  const text = props.text || ''
  const toIndex = codePointIndex(text)
  const colors = props.notes.length ? reviewState.spanColors(text, props.notes) : new Map()
  const notes = props.notes
    .map((note) => {
      const at = reviewState.resolveAnnotation(text, note)
      return at ? { note, start: toIndex(at.start), end: toIndex(at.end) } : null
    })
    .filter(Boolean)
  const cuts = new Set([0, text.length])
  for (const [s, e] of props.ranges) { cuts.add(s); cuts.add(e) }
  for (const n of notes) { cuts.add(n.start); cuts.add(n.end) }
  const points = [...cuts].filter((x) => x >= 0 && x <= text.length).sort((a, b) => a - b)
  const out = []
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [s, e] = [points[i], points[i + 1]]
    if (s === e) continue
    const range = props.ranges.find(([rs, re]) => rs <= s && e <= re)
    const covering = notes.filter((n) => n.start <= s && e <= n.end)
    const piece = { text: text.slice(s, e), cls: '', title: '', style: '', notes: covering.map((n) => n.note) }
    if (range && text.slice(s, e).trim()) {
      piece.cls = diffView.kindClasses(range[2], props.editions, range[3]).join(' ')
      piece.title = range[4] ? `${titleFor(range[2], range[3])} · moved` : titleFor(range[2], range[3])
    }
    if (covering.length) {
      piece.style = `background:${spanEditor.spanFill(covering.map((n) => spanEditor.fillToken(n.note, colors)))}`
      piece.cls += ' lt-phrase-mark'
    }
    out.push(piece)
  }
  return out
})
</script>

<template>
  <span class="diff-text"><template v-for="(piece, i) in segments" :key="i"><span
    v-if="piece.cls || piece.style" :class="piece.cls" :style="piece.style" :title="piece.title"
    @click.stop="piece.notes.length && emit('note', piece.notes)">{{ piece.text }}</span><template v-else>{{ piece.text }}</template></template></span>
</template>
