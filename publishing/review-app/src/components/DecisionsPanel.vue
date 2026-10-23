<script setup>
// Where decisions are saved, and the digest they make: the same
// Preferences/triptych-decisions.json (with its .sha256 check) and
// EDITING-INSTRUCTIONS.md as the Obsidian vaults.
import { computed } from 'vue'
import { allowFolder, app, chooseFolder, digest } from '../lib/store.js'
import { reviewState } from '../lib/shared.js'

const count = computed(() => (app.ledger ? reviewState.reviewChoiceCount(app.ledger) : 0))
</script>

<template>
  <section>
    <h2>Decisions</h2>
    <p v-if="app.storage && app.storage.kind === 'dev'">
      Saving to this repository: <code>book/review/Preferences/triptych-decisions.json</code>, its
      <code>.sha256</code>, and <code>EDITING-INSTRUCTIONS.md</code>.
    </p>
    <template v-else>
      <p>Choose a folder to save decisions in. Chrome will remember it and ask once per visit to allow saving.</p>
      <p>
        <button class="primary" @click="chooseFolder">{{ app.storage ? 'Choose another folder' : 'Choose a folder' }}</button>
        <button v-if="app.storage && !app.ledger && !app.ledgerError" @click="allowFolder">Allow saving to {{ app.storage.label }}</button>
      </p>
    </template>
    <p v-if="app.ledgerError" class="error">{{ app.ledgerError }}</p>
    <p v-if="app.ledger" class="muted">{{ count }} saved choices · revision {{ app.ledger.revision }}</p>
    <pre v-if="app.ledger" class="digest">{{ digest() }}</pre>
  </section>
</template>
