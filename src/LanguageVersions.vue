<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown } from '@lucide/vue'

// One language (or other) version of a title. The title's own deliverables are
// the first row (id null); catalog `versions` follow.
export type LanguageRow = {
  id: string | null
  label: string
  lang?: string
  pdf: string
  epub: string
  html: string
  htmlChapters: string
  vault?: string
  mobileVault?: string
  vaultGuide?: string
  emacs?: string
  emacsGuide?: string
}

type Format = 'pdf' | 'epub' | 'vault' | 'mobile-vault' | 'emacs'

const props = defineProps<{
  slug: string
  rows: LanguageRow[]
  // Card view opens nothing until a tab is chosen; the detail page opens the first.
  initiallyOpen?: boolean
}>()

const open = ref<string | null>(props.initiallyOpen && props.rows.length ? key(props.rows[0]) : null)

function key(row: LanguageRow): string {
  return row.id ?? 'default'
}

const openRow = computed(() => props.rows.find((row) => key(row) === open.value) ?? null)

function toggle(row: LanguageRow) {
  open.value = open.value === key(row) ? null : key(row)
}

function href(row: LanguageRow, format: Format): string {
  return row.id ? `/${props.slug}/${row.id}/${format}/` : `/${props.slug}/${format}/`
}

const panelId = (row: LanguageRow) => `lang-panel-${props.slug}-${key(row)}`
const tabId = (row: LanguageRow) => `lang-tab-${props.slug}-${key(row)}`
</script>

<template>
  <div class="language-versions">
    <div class="language-versions__tabs" role="tablist" aria-label="Language versions">
      <button
        v-for="row in rows"
        :id="tabId(row)"
        :key="key(row)"
        type="button"
        role="tab"
        class="language-versions__tab"
        :class="{ 'language-versions__tab--active': open === key(row) }"
        :aria-selected="open === key(row)"
        :aria-expanded="open === key(row)"
        :aria-controls="panelId(row)"
        :lang="row.lang"
        @click="toggle(row)"
      >
        <span>{{ row.label }}</span>
        <ChevronDown :size="14" aria-hidden="true" />
      </button>
    </div>
    <div
      v-for="row in rows"
      v-show="openRow && key(openRow) === key(row)"
      :id="panelId(row)"
      :key="`panel-${key(row)}`"
      class="language-versions__panel"
      role="tabpanel"
      :aria-labelledby="tabId(row)"
    >
      <a :href="href(row, 'pdf')">PDF</a>
      <a :href="href(row, 'epub')">EPUB</a>
      <a :href="row.html" target="_blank" rel="noopener noreferrer">Read online</a>
      <a :href="row.htmlChapters" target="_blank" rel="noopener noreferrer">Chapters</a>
      <a v-if="row.vault" :href="href(row, 'vault')" download>Obsidian Vault</a>
      <a v-if="row.mobileVault" :href="href(row, 'mobile-vault')" download>Mobile Vault</a>
      <a v-if="row.vaultGuide" :href="row.vaultGuide" target="_blank" rel="noopener noreferrer">Vault guide</a>
      <a v-if="row.emacs" :href="href(row, 'emacs')" download>Emacs</a>
      <a v-if="row.emacsGuide" :href="row.emacsGuide" target="_blank" rel="noopener noreferrer">Emacs guide</a>
    </div>
  </div>
</template>
