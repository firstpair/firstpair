<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  ArrowRight,
  BookOpen,
  Braces,
  BrainCircuit,
  ExternalLink,
  Library,
  Link as LinkIcon,
  PenLine,
  SearchCheck,
  Sparkles,
  UserRound,
} from '@lucide/vue'

type Book = {
  slug: string
  title: string
  kicker: string
  description: string
  accent: string
  source: string
  homepage?: string
  pdf: string
  epub: string
  html: string
  htmlChapters: string
  htmlSource?: string
  htmlChaptersSource?: string
  tags: string[]
}

type Catalog = {
  books: Book[]
}

const books = ref<Book[]>([])
const catalogError = ref('')

const catalogUrl = computed(() => `${import.meta.env.BASE_URL}catalog.json`)
const previewCount = computed(() => books.value.filter((book) => book.homepage).length)
const finishedCount = computed(() => books.value.length - previewCount.value)

onMounted(async () => {
  try {
    const response = await fetch(catalogUrl.value)

    if (!response.ok) {
      throw new Error(`Catalog request failed: ${response.status}`)
    }

    const catalog = (await response.json()) as Catalog
    books.value = catalog.books
  } catch (error) {
    catalogError.value = 'The library catalog is temporarily unavailable.'
    console.error(error)
  }
})

const sources = [
  { label: 'First principles', icon: Braces },
  { label: 'AI research', icon: SearchCheck },
  { label: 'Rosetta Scored', icon: BrainCircuit },
  { label: 'Human authorship', icon: PenLine },
  { label: 'Preview editions', icon: BookOpen },
]

const fragments = [
  'first principles',
  'source triangulation',
  'archival leads',
  'human judgment',
  'AI research map',
  'Rosetta Scored review',
  'citations and links',
  'editorial voice',
  'PDF EPUB HTML',
]
</script>

<template>
  <main class="site-shell">
    <header class="topbar" aria-label="First Pair">
      <a class="brand" href="/">
        <span class="brand-mark"><Library :size="18" /></span>
        <span>firstpair.org</span>
      </a>
      <nav class="nav-links" aria-label="Primary">
        <a href="#books">Books</a>
        <a href="#sources">Sources</a>
        <a href="https://github.com/firstpair/firstpair" target="_blank" rel="noreferrer">
          GitHub
          <ExternalLink :size="14" />
        </a>
      </nav>
    </header>

    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <p class="eyebrow">First Pair Press</p>
        <h1 id="hero-title">First-principles books, AI-researched</h1>
        <p class="lede">
          First Pair makes First Principles AI-Researched Books. Human authorship
          and AI research work as a pair: questions are reduced to first
          principles, sources are traced, and Rosetta Scored review turns the
          collaboration into beautiful, easy-to-review PDF, EPUB, and web
          editions.
        </p>
        <div class="hero-actions">
          <a class="primary-link" href="#books">
            Browse books
            <ArrowRight :size="17" />
          </a>
          <a class="secondary-link" href="https://github.com/firstpair/firstpair/tree/main/publishing" target="_blank" rel="noreferrer">
            Publishing sources
            <LinkIcon :size="16" />
          </a>
        </div>
      </div>

      <div class="press-stage" aria-label="Animated human and AI coauthorship">
        <div class="collab-orbit" aria-hidden="true">
          <article class="collab-card collab-human">
            <UserRound :size="18" />
            <span>Human author</span>
            <strong>judgment, memory, voice</strong>
          </article>
          <article class="collab-card collab-ai">
            <BrainCircuit :size="18" />
            <span>AI researcher</span>
            <strong>sources, Rosetta scores, checks</strong>
          </article>
        </div>

        <div class="source-stack">
          <article class="source-page page-md">
            <span>human notes</span>
            <code>Why did this republic form?</code>
            <code>What is the first cause?</code>
            <code>voice, stakes, judgment</code>
          </article>
          <article class="source-page page-tr">
            <span>AI research</span>
            <code>archive -> claim -> citation</code>
            <code>Rosetta Scored review</code>
            <code>find contradictions</code>
          </article>
        </div>

        <div class="make-line">
          <span v-for="fragment in fragments" :key="fragment">{{ fragment }}</span>
        </div>

        <div class="edition-wrap">
          <article class="book-object">
            <div class="book-spine"></div>
            <div class="book-cover">
              <Sparkles :size="30" />
              <span>First Pair</span>
              <strong>Review-Ready Book</strong>
            </div>
            <div class="book-pages">
              <span v-for="index in 8" :key="index"></span>
            </div>
          </article>
          <div class="format-badges">
            <span>PDF</span>
            <span>EPUB</span>
            <span>HTML</span>
            <span>Chapters</span>
          </div>
        </div>
      </div>
    </section>

    <section id="sources" class="source-band" aria-label="Source pipeline">
      <div v-for="item in sources" :key="item.label" class="source-step">
        <component :is="item.icon" :size="20" />
        <span>{{ item.label }}</span>
      </div>
    </section>

    <section id="books" class="library-section" aria-labelledby="books-title">
      <div class="section-heading">
        <p class="eyebrow">Library</p>
        <h2 id="books-title">Public books and previews, beautifully typeset.</h2>
      </div>

      <div v-if="books.length" class="library-summary" aria-label="Library totals">
        <span>{{ books.length }} public titles</span>
        <span>{{ previewCount }} previews</span>
        <span>{{ finishedCount }} finished books</span>
      </div>

      <p v-if="catalogError" class="catalog-error">{{ catalogError }}</p>

      <div class="book-grid">
        <article
          v-for="book in books"
          :id="book.slug"
          :key="book.slug"
          class="book-card"
          :style="{ '--book-accent': book.accent }"
        >
          <div class="book-card__cover">
            <Sparkles :size="24" />
            <span>{{ book.kicker }}</span>
            <strong>{{ book.title }}</strong>
          </div>
          <div class="book-card__body">
            <div>
              <p class="book-kicker">{{ book.kicker }}</p>
              <h3>{{ book.title }}</h3>
              <p>{{ book.description }}</p>
            </div>
            <div class="tag-row">
              <span v-for="tag in book.tags" :key="tag">{{ tag }}</span>
            </div>
            <div class="book-links">
              <a v-if="book.homepage" :href="book.homepage">Preview</a>
              <a :href="book.pdf">PDF</a>
              <a :href="book.epub">EPUB</a>
              <a :href="book.html" target="_blank" rel="noopener noreferrer">Read</a>
              <a :href="book.htmlChapters" target="_blank" rel="noopener noreferrer">Chapters</a>
              <a :href="book.source" target="_blank" rel="noreferrer">
                Source
                <ExternalLink :size="14" />
              </a>
            </div>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>
