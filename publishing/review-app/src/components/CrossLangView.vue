<script setup>
// English beside Russian, passage by passage.  The pairing is structural, as
// in the bilingual vaults: headings by anchor, prose by length, never a claim
// that one sentence translates another.  Each row shows how far its length
// ratio strays from the book's usual ratio, and how many extra paragraphs
// the translation uses; notes attach to words on either side.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { app, navigate, replaceRoute } from '../lib/store.js'
import { crosslang } from '../lib/data.js'
import { cellNotes } from '../lib/notes.js'
import DiffText from './DiffText.vue'
import NoteDialog from './NoteDialog.vue'

const book = app.book
const pairs = book.manifest.crosslang
const pairId = computed(() => app.route.x || pairs[0]?.id)
const data = ref(null)
const note = ref(null)
const onlyDrift = ref(false)

watch(pairId, async (id) => { data.value = await crosslang(book, id) }, { immediate: true })
const parts = computed(() => (data.value ? data.value.parts : []))
const part = computed(() => Number(app.route.p ?? 1))
const pages = computed(() => {
  if (!data.value) return []
  return data.value.pages
    .map((page, index) => ({ ...page, index }))
    .filter((page) => page.part === part.value)
    .map((page) => {
      const leftText = page.left.map(([, text]) => text).join('\n\n')
      const rightText = page.right.map(([, text]) => text).join('\n\n')
      const drift = leftText.length >= 80 && rightText.length
        ? Math.abs(Math.log((rightText.length / leftText.length) / data.value.length_ratio)) * 100 : null
      return { ...page, leftText, rightText, drift, extra: Math.max(0, page.right.length - page.left.length), heading: [...page.left, ...page.right].every(([k]) => k === 'heading') }
    })
    .filter((page) => !onlyDrift.value || (page.drift ?? 0) >= 35)
})
const severity = (drift) => (drift == null ? '' : drift >= 70 ? 'bad' : drift >= 35 ? 'warn' : '')
const fragmentKey = (page) => `review/xl/${pairId.value}/${page.index}`

function openNote(page, side, existing = null) {
  const spec = side === 'left' ? data.value.left : data.value.right
  note.value = {
    fragmentKey: fragmentKey(page), edition: spec.id, editionTitle: spec.title,
    text: side === 'left' ? page.leftText : page.rightText, title: parts.value[part.value]?.[0] || '', note: existing,
  }
}

function goPart(step) {
  const next = part.value + step
  if (next >= 0 && next < parts.value.length) navigate({ view: 'crosslang', x: pairId.value, p: String(next) })
}
function onKey(event) {
  if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || note.value) return
  if (event.key === 'ArrowLeft') goPart(-1)
  if (event.key === 'ArrowRight') goPart(1)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <section>
    <div class="toolbar sticky">
      <select :value="pairId" @change="replaceRoute({ x: $event.target.value, p: '1' })">
        <option v-for="p in pairs" :key="p.id" :value="p.id">{{ p.left.title }} ↔ {{ p.right.title }}</option>
      </select>
      <label><input v-model="onlyDrift" type="checkbox" /> Only rows whose length strays 35%+</label>
      <span class="spacer" />
      <button :disabled="part <= 0" title="Previous Part (←)" @click="goPart(-1)">‹</button>
      <select :value="part" @change="navigate({ view: 'crosslang', x: pairId, p: $event.target.value })">
        <option v-for="(titles, i) in parts" :key="i" :value="i">{{ titles[0] }} · {{ titles[1] }}</option>
      </select>
      <button :disabled="part >= parts.length - 1" title="Next Part (→)" @click="goPart(1)">›</button>
    </div>
    <p v-if="!data" class="muted">Loading…</p>
    <div v-else class="grid" style="--cols: 2">
      <div class="grid-head"><div>{{ data.left.title }}</div><div>{{ data.right.title }}</div></div>
      <div v-for="page in pages" :key="page.index" class="grid-row" :class="{ heading: page.heading }">
        <div class="cell">
          <div class="cell-text"><DiffText :text="page.leftText" :notes="cellNotes(app.ledger, fragmentKey(page), data.left.id, page.leftText)"
            @note="(n) => openNote(page, 'left', n[0])" /></div>
          <div class="cell-tools"><button class="mini" @click="openNote(page, 'left')">Note</button></div>
        </div>
        <div class="cell">
          <div class="cell-text"><DiffText :text="page.rightText" :notes="cellNotes(app.ledger, fragmentKey(page), data.right.id, page.rightText)"
            @note="(n) => openNote(page, 'right', n[0])" /></div>
          <div class="cell-tools">
            <span v-if="page.drift != null" class="metric" :class="severity(page.drift)" title="How far this row's length ratio strays from the book's usual ratio">L {{ Math.round(page.drift) }}%</span>
            <span v-if="page.extra" class="metric" title="Extra paragraphs in the translation">P +{{ page.extra }}</span>
            <button class="mini" @click="openNote(page, 'right')">Note</button>
          </div>
        </div>
      </div>
    </div>
    <NoteDialog v-if="note" v-bind="note" @close="note = null" />
  </section>
</template>
