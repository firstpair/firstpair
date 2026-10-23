<script setup>
// What one release did to its parent: counts by kind, Part by Part, and
// the changed passages, each opening its timeline.
import { computed, ref, watchEffect } from 'vue'
import { app, navigate } from '../lib/store.js'
import { unitsByIndex } from '../lib/data.js'

const book = app.book
const name = computed(() => app.route.t || book.transitions[book.transitions.length - 1].name)
const tr = computed(() => book.transitions.find((item) => item.name === name.value))
const kindFilter = ref('rewrite')
const shown = ref([])
const PAGE = 60

const events = computed(() => {
  const index = book.graph.transitions.indexOf(name.value)
  return book.graph.events.filter((event) => event[0] === index)
})
const byKind = computed(() => {
  const counts = {}
  for (const event of events.value) {
    const kind = book.graph.kinds[event[1]]
    counts[kind] = (counts[kind] || 0) + 1
  }
  return counts
})
const byPart = computed(() => {
  const child = book.edition(tr.value.to)
  const rows = new Map(child.parts.map((part) => [part.id, { part, kinds: {} }]))
  for (const event of events.value) {
    const unit = event[3][0] ?? event[2][0]
    const part = event[3].length ? book.graph.unit_part[unit] : null
    const row = part && rows.get(part)
    if (!row) continue
    const kind = book.graph.kinds[event[1]]
    row.kinds[kind] = (row.kinds[kind] || 0) + 1
  }
  return [...rows.values()]
})
const changed = computed(() => events.value.filter((event) => book.graph.kinds[event[1]] === kindFilter.value))

watchEffect(async () => {
  const list = changed.value.slice(0, PAGE)
  const texts = await unitsByIndex(book, list.flatMap((event) => [...event[2], ...event[3]]))
  shown.value = list.map((event) => ({
    event,
    before: event[2].map((idx) => texts.get(idx)?.text || '').join('\n\n'),
    after: event[3].map((idx) => texts.get(idx)?.text || '').join('\n\n'),
    unit: event[3][0] ?? event[2][0],
  }))
})
const KINDS = ['unchanged', 'rewrite', 'add', 'excision', 'split', 'fusion', 'complex']
</script>

<template>
  <section v-if="tr">
    <h2>{{ book.edition(tr.to).title }} {{ book.edition(tr.to).version }}
      <small class="muted">from {{ book.edition(tr.from).version }}</small></h2>
    <div class="toolbar">
      <button v-for="kind in KINDS" :key="kind" class="chip" :class="{ on: kindFilter === kind }" @click="kindFilter = kind">
        <i :class="`k-${kind}`" /> {{ kind }} {{ byKind[kind] || 0 }}</button>
      <button @click="navigate({ view: 'compare', e: [tr.from, tr.to], p: book.edition(tr.from).parts[1]?.id })">Compare the two</button>
    </div>
    <table class="part-table">
      <tr><th>Part</th><th v-for="kind in KINDS.slice(1)" :key="kind">{{ kind }}</th></tr>
      <tr v-for="row in byPart" :key="row.part.id">
        <td>{{ row.part.title }}</td>
        <td v-for="kind in KINDS.slice(1)" :key="kind" class="num">{{ row.kinds[kind] || '' }}</td>
      </tr>
    </table>
    <h3>{{ kindFilter }}: {{ changed.length }} <span v-if="changed.length > PAGE" class="muted">(first {{ PAGE }})</span></h3>
    <div v-for="item in shown" :key="item.event.join(':')" class="change" @click="navigate({ view: 'passage', u: String(item.unit) })">
      <p v-if="item.before" class="before">{{ item.before }}</p>
      <p v-if="item.after" class="after">{{ item.after }}</p>
    </div>
  </section>
</template>
