<script setup>
// Every edition by family, each release with what it did to its parent.
// Pick two to four editions of one language to compare them.
import { computed, ref } from 'vue'
import { app, navigate } from '../lib/store.js'

const book = app.book
const picked = ref([])
const KIND_ORDER = ['rewrite', 'add', 'excision', 'split', 'fusion', 'complex']

const stats = computed(() => {
  const out = new Map()
  for (const [transition, kind] of book.graph.events) {
    const name = book.graph.transitions[transition]
    if (!out.has(name)) out.set(name, { total: 0, kinds: {} })
    const entry = out.get(name)
    entry.total += 1
    const label = book.graph.kinds[kind]
    entry.kinds[label] = (entry.kinds[label] || 0) + 1
  }
  return out
})
const parentOf = computed(() => new Map(book.transitions.map((tr) => [tr.to, tr])))
const families = computed(() => book.manifest.families.map((family) => ({
  family,
  editions: book.manifest.editions.filter((edition) => edition.family === family),
})).filter((row) => row.editions.length))

function change(edition) {
  const tr = parentOf.value.get(edition.id)
  if (!tr) return null
  const entry = stats.value.get(tr.name)
  const changed = entry ? entry.total - (entry.kinds.unchanged || 0) : 0
  return { tr, entry, changed, share: entry ? changed / entry.total : 0 }
}

const lang = computed(() => picked.value.length ? book.edition(picked.value[0]).lang : null)
function toggle(edition) {
  const at = picked.value.indexOf(edition.id)
  if (at >= 0) picked.value.splice(at, 1)
  else if (picked.value.length < 4 && (!lang.value || lang.value === edition.lang)) picked.value.push(edition.id)
}
function compare() {
  const ordered = book.manifest.editions.map((e) => e.id).filter((id) => picked.value.includes(id))
  navigate({ view: 'compare', e: ordered, p: book.edition(ordered[0]).parts[1]?.id || book.edition(ordered[0]).parts[0].id })
}
</script>

<template>
  <section>
    <div class="toolbar">
      <span class="muted">Pick two to four editions of one language:</span>
      <span v-for="id in picked" :key="id" class="chip on">{{ book.edition(id).title }} {{ book.edition(id).version }}</span>
      <button class="primary" :disabled="picked.length < 2" @click="compare">Compare {{ picked.length || '' }}</button>
      <button v-if="picked.length" @click="picked = []">Clear</button>
    </div>
    <div v-for="row in families" :key="row.family" class="family">
      <h3>{{ row.family }}</h3>
      <div class="releases">
        <div v-for="edition in row.editions" :key="edition.id" class="release"
          :class="{ picked: picked.includes(edition.id), dim: lang && lang !== edition.lang }">
          <button class="release-name" @click="toggle(edition)">
            <strong>{{ edition.version }}</strong>
            <span>{{ edition.title }}</span>
            <small>{{ edition.units }} passages · {{ edition.lang }}</small>
          </button>
          <button v-if="change(edition)" class="release-change" :title="`What ${edition.version} did to ${change(edition).tr.from}`"
            @click="navigate({ view: 'release', t: change(edition).tr.name })">
            <span class="bar-track"><span v-for="kind in KIND_ORDER" :key="kind" :class="`k-${kind}`"
              :style="{ width: `${100 * ((change(edition).entry.kinds[kind] || 0) / change(edition).entry.total)}%` }" /></span>
            <small>{{ Math.round(100 * change(edition).share) }}% changed from {{ book.edition(change(edition).tr.from).version }}</small>
          </button>
        </div>
      </div>
    </div>
    <p class="legend"><span v-for="kind in KIND_ORDER" :key="kind"><i :class="`k-${kind}`" /> {{ kind }}</span></p>
  </section>
</template>
