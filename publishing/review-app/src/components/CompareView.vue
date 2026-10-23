<script setup>
// Two to four editions of one language, Part by Part, aligned through their
// lineages.  Two editions show the pair diff (what the later removed and
// added, filterable by kind); three or four show the set diff, narrowed by
// the history lens.  Prefer a version per row, attach notes to words, and
// click a text to see that passage's whole history.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { app, navigate, replaceRoute, updateLedger } from '../lib/store.js'
import { compareRows } from '../lib/align.js'
import { lemmas } from '../lib/data.js'
import { classifier, pairDiff, setDiff, CATEGORIES } from '../lib/engine.js'
import { diffView, t } from '../lib/shared.js'
import { cellNotes } from '../lib/notes.js'
import DiffText from './DiffText.vue'
import NoteDialog from './NoteDialog.vue'

const book = app.book
const saved = (key, fallback) => { try { return JSON.parse(localStorage.getItem(`fp-review:${key}`)) ?? fallback } catch { return fallback } }
const remember = (key, value) => { try { localStorage.setItem(`fp-review:${key}`, JSON.stringify(value)) } catch { /* private window */ } }

const editionIds = computed(() => {
  const ids = (app.route.e || []).filter((id) => book.editionIndex.has(id))
  return ids.length >= 2 ? ids : ['ru-4.2.3', 'ru-4.3.0'].filter((id) => book.editionIndex.has(id))
})
const anchor = computed(() => book.edition(editionIds.value[0]))
const partId = computed(() => app.route.p || anchor.value.parts[0].id)
const partIndex = computed(() => anchor.value.parts.findIndex((part) => part.id === partId.value))
const lang = computed(() => anchor.value.lang)

const showDiff = ref(saved('diff', true))
const hidden = ref(saved('hidden', {}))
const lens = ref(saved('lens', 'all'))
watch(showDiff, (v) => remember('diff', v))
watch(hidden, (v) => remember('hidden', v), { deep: true })
watch(lens, (v) => remember('lens', v))

const rows = ref([])
const loading = ref(true)
const note = ref(null)
let cls = classifier()

async function load() {
  loading.value = true
  const table = await lemmas(book, lang.value)
  cls = classifier({ lemmas: table, functionWords: (book.manifest.function_words || {})[lang.value] || [] })
  rows.value = await compareRows(book, editionIds.value, partId.value)
  loading.value = false
  if (app.route.h) {
    await nextTick()
    document.getElementById(`row-${app.route.h}`)?.scrollIntoView({ block: 'center' })
  }
}
watch([editionIds, partId], load, { immediate: true })

const mode = computed(() => (editionIds.value.length === 2 ? 'pair' : 'set'))

function rowDiff(row) {
  if (!showDiff.value) return {}
  const ids = editionIds.value
  if (mode.value === 'pair') {
    const [a, b] = ids
    if (!row.text[a] || !row.text[b]) return {}
    const diff = pairDiff(row.text[a], row.text[b], cls)
    return { [a]: diff.left, [b]: diff.right }
  }
  const present = ids.filter((id) => row.text[id])
  if (present.length < 2) return {}
  const ranges = setDiff(present.map((id) => row.text[id]))
  const out = {}
  present.forEach((id, i) => {
    out[id] = ranges[i].map(([s, e, kind]) => [s, e, kind.startsWith('share:') ? `share:${present[Number(kind.slice(6))]}` : kind])
  })
  return out
}

function visible(ranges, edition) {
  return diffView.visibleRanges(ranges || [], {
    hiddenCategories: mode.value === 'pair' ? hidden.value : {},
    lens: mode.value === 'set' ? lens.value : null,
    lensEditions: editionIds.value,
    edition,
  })
}

const diffs = computed(() => rows.value.map(rowDiff))

const fragmentKey = (row) => `review/compare/${row.key}`
const editionName = (id) => {
  const e = book.edition(id)
  return e.title.includes(e.version) ? e.title : `${e.title} ${e.version}`
}
const preferred = (row) => app.ledger?.decisions?.[fragmentKey(row)]?.preferred || ''
async function prefer(row, edition) {
  const key = fragmentKey(row)
  await updateLedger((ledger) => {
    const next = structuredClone(ledger)
    const current = next.decisions[key] || {}
    if (current.preferred === edition) delete current.preferred
    else Object.assign(current, { preferred: edition, set: 'review', lineage: row.key, updated_at: new Date().toISOString() })
    if (Object.keys(current).filter((k) => !['set', 'lineage', 'updated_at'].includes(k)).length) next.decisions[key] = current
    else delete next.decisions[key]
    return next
  })
}

function openNote(row, edition, existing = null) {
  note.value = {
    fragmentKey: fragmentKey(row), edition, editionTitle: editionName(edition),
    text: row.text[edition], title: row.chapter || anchor.value.parts[partIndex.value]?.title || '', note: existing,
  }
}

function timeline(row, edition) {
  const unit = row.cells[edition]?.[0]
  if (unit !== undefined) navigate({ view: 'passage', u: String(unit) })
}

function goPart(step) {
  const next = anchor.value.parts[partIndex.value + step]
  if (next) navigate({ ...app.route, view: 'compare', e: editionIds.value, p: next.id, h: '' })
}
function onKey(event) {
  if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || note.value) return
  if (event.key === 'ArrowLeft') goPart(-1)
  if (event.key === 'ArrowRight') goPart(1)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const sameLang = computed(() => book.manifest.editions.filter((e) => e.lang === lang.value))
function setEdition(slot, id) {
  const ids = [...editionIds.value]
  if (id) ids[slot] = id
  else ids.splice(slot, 1)
  const ordered = book.manifest.editions.map((e) => e.id).filter((x) => ids.includes(x))
  replaceRoute({ e: ordered, p: book.edition(ordered[0]).parts.some((p) => p.id === partId.value) ? partId.value : book.edition(ordered[0]).parts[0].id })
}
</script>

<template>
  <section>
    <div class="toolbar sticky">
      <template v-for="(id, slot) in editionIds" :key="slot">
        <select :value="id" @change="setEdition(slot, $event.target.value)">
          <option v-for="e in sameLang" :key="e.id" :value="e.id">{{ e.family }} {{ e.version }}</option>
        </select>
        <button v-if="editionIds.length > 2" class="x" title="Remove" @click="setEdition(slot, '')">×</button>
      </template>
      <select v-if="editionIds.length < 4" value="" @change="setEdition(editionIds.length, $event.target.value)">
        <option value="">+ edition</option>
        <option v-for="e in sameLang.filter((x) => !editionIds.includes(x.id))" :key="e.id" :value="e.id">{{ e.family }} {{ e.version }}</option>
      </select>
      <span class="spacer" />
      <button :disabled="partIndex <= 0" title="Previous Part (←)" @click="goPart(-1)">‹</button>
      <select :value="partId" @change="navigate({ view: 'compare', e: editionIds, p: $event.target.value })">
        <option v-for="part in anchor.parts" :key="part.id" :value="part.id">{{ part.title }}</option>
      </select>
      <button :disabled="partIndex >= anchor.parts.length - 1" title="Next Part (→)" @click="goPart(1)">›</button>
    </div>
    <div class="toolbar">
      <label><input v-model="showDiff" type="checkbox" /> Diff</label>
      <template v-if="showDiff && mode === 'pair'">
        <button v-for="category in CATEGORIES" :key="category" class="chip" :class="{ on: !hidden[category] }"
          @click="hidden = { ...hidden, [category]: !hidden[category] }">{{ t(`diff_cat_${category}`) }}</button>
      </template>
      <template v-if="showDiff && mode === 'set'">
        <span class="muted">History</span>
        <select v-model="lens">
          <option value="all">All differences</option>
          <option value="rewritten">Settled text the latest rewrote</option>
          <option value="reverts">The latest went back to the first</option>
          <option value="new">New in the latest only</option>
        </select>
      </template>
    </div>
    <p v-if="loading" class="muted">Aligning…</p>
    <div v-else class="grid" :style="{ '--cols': editionIds.length }">
      <div class="grid-head">
        <div v-for="id in editionIds" :key="id">{{ book.edition(id).family }} {{ book.edition(id).version }}</div>
      </div>
      <div v-for="(row, r) in rows" :id="`row-${row.key}`" :key="row.key" class="grid-row"
        :class="{ heading: row.kind === 'heading', hl: app.route.h === row.key }">
        <div v-for="id in editionIds" :key="id" class="cell" :class="{ empty: !row.text[id], preferred: preferred(row) === id }">
          <template v-if="row.text[id]">
            <div class="cell-text" @click="timeline(row, id)">
              <DiffText :text="row.text[id]" :ranges="visible(diffs[r][id], id)" :editions="editionIds"
                :notes="cellNotes(app.ledger, fragmentKey(row), id, row.text[id])"
                @note="(notes) => openNote(row, id, notes[0])" />
            </div>
            <div class="cell-tools">
              <input type="checkbox" :checked="preferred(row) === id" title="Prefer this version" @change="prefer(row, id)" />
              <button class="mini" title="Note on words" @click="openNote(row, id)">Note</button>
            </div>
          </template>
          <span v-else class="muted">—</span>
        </div>
      </div>
    </div>
    <NoteDialog v-if="note" v-bind="note" @close="note = null" />
  </section>
</template>
