<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { app, back, boot, forward, lockAgain, navigate, unlockWith } from './lib/store.js'
import ReleaseMap from './components/ReleaseMap.vue'
import ReleaseReport from './components/ReleaseReport.vue'
import CompareView from './components/CompareView.vue'
import PassageTimeline from './components/PassageTimeline.vue'
import RulesView from './components/RulesView.vue'
import CrossLangView from './components/CrossLangView.vue'
import DecisionsPanel from './components/DecisionsPanel.vue'

const views = { map: ReleaseMap, release: ReleaseReport, compare: CompareView, passage: PassageTimeline, rules: RulesView, crosslang: CrossLangView, decisions: DecisionsPanel }
const current = computed(() => views[app.route.view] || ReleaseMap)
const tabs = [
  ['map', 'Releases'],
  ['compare', 'Compare'],
  ['rules', 'Rules'],
  ['crosslang', 'English ↔ Russian'],
  ['decisions', 'Decisions'],
]

// Arrow keys outside text fields: Back/Forward with Alt (as in a browser);
// plain arrows are left to the views (previous/next Part).
function onKey(event) {
  if (!event.altKey || event.metaKey || event.ctrlKey) return
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return
  if (event.key === 'ArrowLeft') { event.preventDefault(); back() }
  if (event.key === 'ArrowRight') { event.preventDefault(); forward() }
}
onMounted(() => { void boot(); window.addEventListener('keydown', onKey) })

const passphrase = ref('')
const remember = ref(false)
const unlocking = ref(false)
const wrong = ref(false)
async function submit() {
  unlocking.value = true
  wrong.value = !(await unlockWith(passphrase.value, remember.value))
  unlocking.value = false
  if (!wrong.value) passphrase.value = ''
}
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <header class="bar">
    <div class="nav">
      <button :disabled="!app.canBack" title="Back (Alt ←)" @click="back">← Back</button>
      <button :disabled="!app.canForward" title="Forward (Alt →)" @click="forward">Forward →</button>
    </div>
    <strong class="title">{{ app.book ? app.book.manifest.title : 'FirstPair Review' }}</strong>
    <nav class="tabs">
      <button v-for="[view, label] in tabs" :key="view" :class="{ on: app.route.view === view || (view === 'map' && app.route.view === 'release') || (view === 'compare' && app.route.view === 'passage') }"
        @click="navigate({ view })">{{ label }}</button>
    </nav>
    <button v-if="app.book && app.encrypted" class="mini" title="Forget the key on this device and lock" @click="lockAgain">Lock</button>
    <span class="save" :class="{ ok: app.ledger }" @click="navigate({ view: 'decisions' })">
      {{ app.ledger ? `Saving to ${app.storage.label}` : app.storage ? 'Allow saving…' : 'Choose where to save…' }}
    </span>
  </header>
  <main class="main">
    <form v-if="app.locked" class="unlock" @submit.prevent="submit">
      <h2>This review is encrypted</h2>
      <p class="muted">Enter the passphrase. It never leaves this browser; the texts are decrypted here.</p>
      <input v-model="passphrase" type="password" autocomplete="current-password" autofocus placeholder="Passphrase" />
      <label><input v-model="remember" type="checkbox" /> Remember on this device</label>
      <p v-if="wrong" class="error">That passphrase does not open this review.</p>
      <button class="primary" :disabled="!passphrase || unlocking">{{ unlocking ? 'Unlocking…' : 'Unlock' }}</button>
    </form>
    <p v-else-if="app.error" class="error">{{ app.error }}</p>
    <p v-else-if="!app.book" class="muted">Loading the book…</p>
    <component :is="current" v-else :key="app.route.view" />
  </main>
  <div class="notices"><p v-for="(notice, i) in app.notices" :key="i">{{ notice }}</p></div>
</template>
