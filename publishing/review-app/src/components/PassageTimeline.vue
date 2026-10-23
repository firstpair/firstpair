<script setup>
// One passage through every release that has it, in edition order, each
// version diffed against the previous one in the same language, with the
// alignment step between them (kept, rewritten, split, merged...).
import { computed, ref, watchEffect } from 'vue'
import { app, navigate } from '../lib/store.js'
import { lemmas, unitsByIndex } from '../lib/data.js'
import { classifier, pairDiff } from '../lib/engine.js'
import DiffText from './DiffText.vue'

const book = app.book
const unit = computed(() => Number(app.route.u))
const cards = ref([])
const loading = ref(true)

const members = computed(() => {
  const set = new Set()
  for (const lineage of book.lineageOf.get(unit.value) || []) {
    for (const member of book.graph.lineages[lineage]) set.add(member)
  }
  if (!set.size) set.add(unit.value)
  return [...set].sort((a, b) => book.graph.unit_edition[a] - book.graph.unit_edition[b] || a - b)
})

function stepKind(prev, next) {
  for (const index of book.eventsOf.get(next) || []) {
    const event = book.graph.events[index]
    if (event[2].includes(prev) && event[3].includes(next)) return book.graph.kinds[event[1]]
  }
  return ''
}

watchEffect(async () => {
  loading.value = true
  const texts = await unitsByIndex(book, members.value)
  const tables = {}
  const out = []
  let previousByLang = {}
  for (const idx of members.value) {
    const edition = book.editionOf(idx)
    const row = texts.get(idx)
    if (!row) continue
    if (!(edition.lang in tables)) tables[edition.lang] = await lemmas(book, edition.lang)
    const prev = previousByLang[edition.lang]
    let ranges = []
    let kind = ''
    if (prev) {
      const cls = classifier({ lemmas: tables[edition.lang], functionWords: (book.manifest.function_words || {})[edition.lang] || [] })
      ranges = pairDiff(prev.text, row.text, cls).right
      kind = stepKind(prev.idx, idx)
    }
    out.push({ idx, edition, text: row.text, ranges, kind, focus: idx === unit.value })
    previousByLang[edition.lang] = { idx, text: row.text }
  }
  cards.value = out
  loading.value = false
})
const part = (idx) => book.graph.unit_part[idx]
</script>

<template>
  <section>
    <h2>Passage history <small class="muted">{{ members.length }} versions</small></h2>
    <p v-if="loading" class="muted">Loading…</p>
    <article v-for="card in cards" :key="card.idx" class="card" :class="{ focus: card.focus }">
      <header>
        <strong>{{ card.edition.family }} {{ card.edition.version }}</strong>
        <span class="muted">{{ card.edition.title }}</span>
        <span v-if="card.kind" class="step" :class="`k-${card.kind}`">{{ card.kind }}</span>
        <button class="mini" @click="navigate({ view: 'compare', e: [card.edition.id, ...(cards.find((c) => c.edition.lang === card.edition.lang && c.idx !== card.idx) ? [cards.find((c) => c.edition.lang === card.edition.lang && c.idx !== card.idx).edition.id] : [])], p: part(card.idx), h: book.graph.units[card.idx] })">Open in Compare</button>
      </header>
      <p><DiffText :text="card.text" :ranges="card.ranges" /></p>
    </article>
  </section>
</template>
