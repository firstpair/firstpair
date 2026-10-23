<script setup>
// A span note on one cell: pick words with the shared word picker (the same
// module FirstPair Triptych and Reader 2 use), then write the note.
import { nextTick, onMounted, ref } from 'vue'
import { reviewState, spanEditor } from '../lib/shared.js'
import { noteDetails, sentenceId } from '../lib/notes.js'
import { app, updateLedger } from '../lib/store.js'

const props = defineProps({
  fragmentKey: { type: String, required: true },
  edition: { type: String, required: true },
  editionTitle: { type: String, default: '' },
  text: { type: String, required: true },
  title: { type: String, default: '' },
  note: { type: Object, default: null }, // an existing note to edit
})
const emit = defineEmits(['close'])

const pickerEl = ref(null)
const words = ref('')
const body = ref(props.note ? props.note.text || '' : '')
let picker = null
let selector = props.note
  ? reviewState.makeSelector(props.text, Number(props.note.start), Number(props.note.end), props.note.token_keys || [])
  : null

onMounted(async () => {
  await nextTick()
  if (props.note) {
    words.value = selector.exact
    return
  }
  const tokens = reviewState.wordTokens(props.text, sentenceId(props.fragmentKey, props.edition, props.text))
  picker = spanEditor.createWordPicker(pickerEl.value, props.text, tokens, {
    actions: [],
    onChange: (chosen) => {
      selector = chosen
      words.value = chosen ? chosen.exact : ''
    },
  })
})

async function save() {
  if (!selector) return
  const details = noteDetails({ ...props, selector })
  const saved = await updateLedger((ledger) => reviewState.upsertSpanNoteText(ledger, details, body.value))
  if (saved) emit('close')
}

async function remove() {
  if (!props.note) return
  const saved = await updateLedger((ledger) => reviewState.clearSpanNote(ledger, props.note.id))
  if (saved) emit('close')
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <section class="dialog" role="dialog" aria-modal="true">
      <h2>Note on “{{ words || '…' }}”</h2>
      <div v-if="!note" ref="pickerEl" class="lt-word-editor is-open picker" />
      <textarea v-model="body" rows="4" placeholder="Your note" />
      <p v-if="!app.ledger" class="warn">Choose where to save decisions first (top right).</p>
      <div class="actions">
        <button v-if="note" class="danger" @click="remove">Delete</button>
        <span class="spacer" />
        <button @click="emit('close')">Cancel</button>
        <button class="primary" :disabled="!words || !app.ledger" @click="save">Save note</button>
      </div>
    </section>
  </div>
</template>
