<script setup lang="ts">
defineProps<{ notebooks?: { python: string; ocaml: string } }>()
</script>

<template>
  <template v-if="notebooks">
    <a :href="notebooks.python" target="_blank" rel="noopener noreferrer">Python notebook</a>
    <a :href="notebooks.ocaml" target="_blank" rel="noopener noreferrer">OCaml notebook</a>
  </template>
</template>
