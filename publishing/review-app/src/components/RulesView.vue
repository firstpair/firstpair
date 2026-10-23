<script setup>
// For any two editions of one language, across the whole book: where the
// edits are (Part by Part, by kind) and the one-word substitutions that
// recur, each with Accept / Reject.  Drawn by the shared diff-view module,
// so it reads like Review in FirstPair Triptych; decisions go to the shared
// ledger and its digest.
import { computed, onMounted, ref, watch } from 'vue'
import { app, navigate, replaceRoute, updateLedger } from '../lib/store.js'
import { pairRows } from '../lib/align.js'
import { lemmas } from '../lib/data.js'
import { diffView, reviewState, ruleId, t } from '../lib/shared.js'

const book = app.book
const results = new Map()
const left = computed(() => app.route.a || 'ru-4.2.3')
const right = computed(() => app.route.b || 'ru-4.3.0')
const pair = computed(() => `${left.value}|${right.value}`)
const progress = ref(0)
const result = ref(null)
const heatEl = ref(null)
const rulesEl = ref(null)
const editions = book.manifest.editions
const sameLang = computed(() => editions.filter((e) => e.lang === book.edition(left.value).lang))

async function scan() {
  result.value = results.get(pair.value) || null
  if (result.value) return draw()
  progress.value = 0.01
  const rows = await pairRows(book, left.value, right.value, (share) => { progress.value = share })
  const lang = book.edition(left.value).lang
  const table = await lemmas(book, lang)
  const worker = new Worker(new URL('../lib/scan.worker.js', import.meta.url), { type: 'module' })
  const scanned = await new Promise((resolve, reject) => {
    worker.onmessage = (event) => resolve(event.data)
    worker.onerror = reject
    worker.postMessage({ rows, lemmas: table, functionWords: (book.manifest.function_words || {})[lang] || [] })
  })
  worker.terminate()
  const partOf = new Map(rows.map((row) => [row.key, row.part]))
  scanned.partOf = partOf
  results.set(pair.value, scanned)
  result.value = scanned
  progress.value = 0
  draw()
}

function asDiffs(scanned) {
  const rules = scanned.rules.map((rule) => ({
    id: ruleId(pair.value, rule.from, rule.to),
    from: rule.from, to: rule.to, count: rule.count, pages: rule.rows,
    reverse: rule.reverseIsRule ? ruleId(pair.value, rule.to, rule.from) : null,
    reverse_count: rule.reverseCount,
    occurrences: rule.hits.map((hit) => [hit.key]),
  }))
  return { rules: { [pair.value]: rules }, summary: { [pair.value]: scanned.summary } }
}

function draw() {
  if (!result.value || !heatEl.value) return
  const diffs = asDiffs(result.value)
  const parts = book.edition(left.value).parts
  heatEl.value.replaceChildren()
  rulesEl.value.replaceChildren()
  diffView.renderSummary(heatEl.value, diffs, pair.value, {
    t, parts,
    onOpenPart: (part) => navigate({ view: 'compare', e: [left.value, right.value], p: part.id }),
  })
  diffView.renderRules(rulesEl.value, diffs, pair.value, {
    t,
    decisions: app.ledger ? reviewState.ruleDecisionMap(app.ledger) : {},
    pageTitle: (key) => {
      const part = parts.find((p) => p.id === result.value.partOf.get(key))
      return `${part ? part.title : ''} · ${key.split(':').pop()}`
    },
    onOpen: (key) => navigate({ view: 'compare', e: [left.value, right.value], p: result.value.partOf.get(key), h: key }),
    onDecide: async (rule, decision) => {
      await updateLedger((ledger) => reviewState.setRuleDecision(ledger, rule, pair.value, decision))
      draw()
    },
  })
}

watch(pair, scan)
watch(() => app.ledger, draw)
onMounted(scan)
const counts = computed(() => (result.value ? {
  rules: result.value.rules.length,
  conflicts: result.value.rules.filter((r) => r.reverseCount).length,
} : null))
</script>

<template>
  <section>
    <div class="toolbar">
      <select :value="left" @change="replaceRoute({ a: $event.target.value })">
        <option v-for="e in editions" :key="e.id" :value="e.id">{{ e.family }} {{ e.version }}</option>
      </select>
      <span>→</span>
      <select :value="right" @change="replaceRoute({ b: $event.target.value })">
        <option v-for="e in sameLang" :key="e.id" :value="e.id">{{ e.family }} {{ e.version }}</option>
      </select>
      <span v-if="progress" class="muted">Aligning the whole book… {{ Math.round(progress * 100) }}%</span>
      <span v-else-if="counts" class="muted">{{ counts.rules }} rules, {{ counts.conflicts }} also run the other way</span>
    </div>
    <h2>Where the edits are</h2>
    <p class="muted">Words changed in each Part of {{ book.edition(left).version }}, by kind. Click a Part to compare it.</p>
    <div ref="heatEl" />
    <h2>Edit rules</h2>
    <p class="muted">One-word substitutions that recur on three or more passages. Accept applies one everywhere; Reject keeps the earlier word. A rule that also runs the other way is flagged.</p>
    <div ref="rulesEl" />
  </section>
</template>
