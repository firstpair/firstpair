<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowRight,
  BookOpen,
  Braces,
  BrainCircuit,
  ExternalLink,
  GraduationCap,
  Library,
  Link as LinkIcon,
  PenLine,
  SearchCheck,
  Sparkles,
  UserRound,
} from '@lucide/vue'

const libraryShelfConfig = [
  {
    id: 'history',
    label: 'History',
    deck: 'Historical previews and arguments from Venice to Russophobia.',
  },
  {
    id: 'music',
    label: 'Music',
    deck: 'Practical music guides and listening-led learning books.',
  },
  {
    id: 'technology',
    label: 'Technology',
    deck: 'Books about software, startups, and technical culture.',
  },
  {
    id: 'publishing',
    label: 'Publishing',
    deck: 'First Pair Press tooling and field guides.',
  },
  {
    id: 'querygraph',
    label: 'QueryGraph',
    deck: 'The graph, catalog, security, and data systems bookshelf.',
  },
  {
    id: 'other',
    label: 'Other',
    deck: 'Uncategorized books and tutorials.',
  },
] as const

type LibraryShelfId = (typeof libraryShelfConfig)[number]['id']

type Book = {
  slug: string
  title: string
  kicker: string
  description: string
  accent: string
  shelf?: LibraryShelfId
  source?: string
  homepage?: string
  pdf: string
  epub: string
  html: string
  htmlChapters: string
  htmlSource?: string
  htmlChaptersSource?: string
  tutorial?: string
  tutorialSource?: string
  cover?: string
  headboard?: string
  post?: string
  vault?: string
  vaultGuide?: string
  vaultGuideSource?: string
  tags: string[]
}

type Catalog = {
  books: Book[]
}

type LibraryFilter = 'all' | 'finished' | 'previews' | 'tutorials'

const books = ref<Book[]>([])
const catalogError = ref('')
const activeFilter = ref<LibraryFilter>('all')
const routePath = ref(window.location.pathname)

const catalogUrl = computed(() => `${import.meta.env.BASE_URL}catalog.json`)
const previewCount = computed(() => books.value.filter((book) => book.homepage).length)
const finishedCount = computed(() => books.value.length - previewCount.value)
const tutorialCount = computed(() => books.value.filter((book) => book.tutorial).length)

const filters = computed(() => [
  { id: 'all' as const, label: 'All titles', count: books.value.length },
  { id: 'finished' as const, label: 'Finished', count: finishedCount.value },
  { id: 'previews' as const, label: 'Previews', count: previewCount.value },
  { id: 'tutorials' as const, label: 'Learn', count: tutorialCount.value },
])

const bookDetailHref = (book: Book): string => `/books/${book.slug}/`
const bookPageHref = (book: Book): string => bookDetailHref(book)
const stableDeliverableHref = (book: Book, format: 'pdf' | 'epub' | 'vault' | 'cover'): string =>
  `/${book.slug}/${format}/`
const bookHeroImage = (book: Book): string => book.headboard ?? book.cover ?? ''

const knownLibraryShelfIds = new Set<string>(libraryShelfConfig.map((shelf) => shelf.id))

const bookShelf = (book: Book): LibraryShelfId =>
  book.shelf && knownLibraryShelfIds.has(book.shelf) ? book.shelf : 'other'

const filteredBooks = computed(() => {
  switch (activeFilter.value) {
    case 'finished':
      return books.value.filter((book) => !book.homepage)
    case 'previews':
      return books.value.filter((book) => book.homepage)
    case 'tutorials':
      return books.value.filter((book) => book.tutorial)
    default:
      return books.value
  }
})

const libraryShelves = computed(() =>
  libraryShelfConfig
    .map((shelf) => ({
      ...shelf,
      books: filteredBooks.value.filter((book) => bookShelf(book) === shelf.id),
    }))
    .filter((shelf) => shelf.books.length > 0),
)

const shelfLinks = computed(() =>
  libraryShelfConfig.filter((shelf) => books.value.some((book) => bookShelf(book) === shelf.id)),
)

const selectedBookSlug = computed(() => {
  const match = /^\/books\/([^/]+)\/?$/.exec(routePath.value)
  return match ? decodeURIComponent(match[1]) : null
})

const selectedBook = computed(() =>
  selectedBookSlug.value ? books.value.find((book) => book.slug === selectedBookSlug.value) : null,
)

function updateRoute() {
  routePath.value = window.location.pathname
}

function navigateInApp(event: MouseEvent, href: string) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
    return
  }

  const url = new URL(href, window.location.origin)

  if (url.origin !== window.location.origin) {
    return
  }

  event.preventDefault()
  window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`)
  routePath.value = window.location.pathname

  if (url.hash) {
    requestAnimationFrame(() => document.querySelector(url.hash)?.scrollIntoView())
  } else {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }
}

onMounted(async () => {
  window.addEventListener('popstate', updateRoute)

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

onBeforeUnmount(() => {
  window.removeEventListener('popstate', updateRoute)
})

watch(selectedBook, (book) => {
  document.title = book ? `${book.title} - First Pair` : 'First Pair'
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
      <a class="brand" href="/" @click="navigateInApp($event, '/')">
        <span class="brand-mark"><Library :size="18" /></span>
        <span>firstpair.org</span>
      </a>
      <nav class="nav-links" aria-label="Primary">
        <a href="/#books" @click="navigateInApp($event, '/#books')">Books</a>
        <a href="/#sources" @click="navigateInApp($event, '/#sources')">Sources</a>
        <a
          href="https://firstpair.press/"
          target="_blank"
          rel="noreferrer"
          aria-label="First Pair Press blog: the story of First Pair Press and every book"
        >
          Story
          <ExternalLink :size="14" />
        </a>
        <a href="https://github.com/firstpair/firstpair" target="_blank" rel="noreferrer">
          GitHub
          <ExternalLink :size="14" />
        </a>
      </nav>
    </header>

    <section
      v-if="selectedBook"
      class="book-detail"
      :style="{ '--book-accent': selectedBook.accent }"
      :aria-labelledby="`book-detail-${selectedBook.slug}`"
    >
      <a class="book-detail__back" href="/#books" @click="navigateInApp($event, '/#books')">
        Back to library
      </a>

      <div
        class="book-detail__hero"
        :class="{ 'book-detail__hero--image': bookHeroImage(selectedBook) }"
        :style="bookHeroImage(selectedBook) ? { backgroundImage: `linear-gradient(90deg, rgba(12, 16, 19, 0.84), rgba(12, 16, 19, 0.54), rgba(12, 16, 19, 0.18)), url('${bookHeroImage(selectedBook)}')` } : undefined"
      >
        <div class="book-detail__copy">
          <p class="eyebrow">{{ selectedBook.kicker }}</p>
          <h1 :id="`book-detail-${selectedBook.slug}`">{{ selectedBook.title }}</h1>
          <p>{{ selectedBook.description }}</p>
          <div class="book-detail__primary">
            <a :href="stableDeliverableHref(selectedBook, 'pdf')">PDF</a>
            <a :href="stableDeliverableHref(selectedBook, 'epub')">EPUB</a>
            <a :href="selectedBook.html" target="_blank" rel="noopener noreferrer">Read online</a>
            <a :href="selectedBook.htmlChapters" target="_blank" rel="noopener noreferrer">Chapters</a>
          </div>
        </div>
      </div>

      <div class="book-detail__body">
        <section class="book-detail__section" aria-labelledby="book-detail-formats">
          <div>
            <p class="eyebrow">Formats</p>
            <h2 id="book-detail-formats">Current public editions</h2>
          </div>
          <div class="book-detail__links">
            <a :href="stableDeliverableHref(selectedBook, 'pdf')">PDF</a>
            <a :href="stableDeliverableHref(selectedBook, 'epub')">EPUB</a>
            <a :href="selectedBook.html" target="_blank" rel="noopener noreferrer">Hosted HTML</a>
            <a :href="selectedBook.htmlChapters" target="_blank" rel="noopener noreferrer">Chapter HTML</a>
            <a
              v-if="selectedBook.vault"
              :href="stableDeliverableHref(selectedBook, 'vault')"
              download
            >
              Obsidian Vault
            </a>
            <a
              v-if="selectedBook.vaultGuide"
              :href="selectedBook.vaultGuide"
              target="_blank"
              rel="noopener noreferrer"
            >
              Vault guide
            </a>
            <a
              v-if="selectedBook.tutorial"
              :href="selectedBook.tutorial"
              target="_blank"
              rel="noopener noreferrer"
            >
              Learn
            </a>
            <a
              v-if="selectedBook.cover"
              :href="stableDeliverableHref(selectedBook, 'cover')"
              target="_blank"
              rel="noopener noreferrer"
            >
              Cover
            </a>
          </div>
        </section>

        <section class="book-detail__section" aria-labelledby="book-detail-context">
          <div>
            <p class="eyebrow">Context</p>
            <h2 id="book-detail-context">Sources and story</h2>
          </div>
          <div class="book-detail__links">
            <a
              v-if="selectedBook.post"
              :href="selectedBook.post"
              target="_blank"
              rel="noreferrer"
            >
              FirstPair.press post
              <ExternalLink :size="14" />
            </a>
            <a
              v-if="selectedBook.source"
              :href="selectedBook.source"
              target="_blank"
              rel="noreferrer"
            >
              Source
              <ExternalLink :size="14" />
            </a>
            <a v-if="selectedBook.homepage" :href="selectedBook.homepage">Preview page</a>
          </div>
          <div class="tag-row">
            <span v-for="tag in selectedBook.tags" :key="tag">{{ tag }}</span>
          </div>
        </section>
      </div>
    </section>

    <template v-else>
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <p class="eyebrow">First Pair Press</p>
        <h1 id="hero-title">
          <span class="title-phrase">First-principles</span> books,
          <span class="title-phrase">AI-researched</span>
        </h1>
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
        <nav v-if="shelfLinks.length" class="shelf-shortcuts" aria-label="Browse library shelves">
          <span>Shelves</span>
          <a
            v-for="shelf in shelfLinks"
            :key="shelf.id"
            :href="`#library-shelf-${shelf.id}`"
          >
            {{ shelf.label }}
          </a>
        </nav>
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
            <span>Learn</span>
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

    <section id="books" class="library-area" aria-labelledby="books-title">
      <div class="library-heading">
        <p class="eyebrow">Library</p>
        <h2 id="books-title">Public books and previews, beautifully typeset.</h2>
      </div>

      <div v-if="books.length" class="library-filters" role="tablist" aria-label="Filter the library">
        <button
          v-for="filter in filters"
          :key="filter.id"
          type="button"
          role="tab"
          class="library-filter"
          :class="{ 'library-filter--active': activeFilter === filter.id }"
          :aria-selected="activeFilter === filter.id"
          @click="activeFilter = filter.id"
        >
          <GraduationCap v-if="filter.id === 'tutorials'" :size="15" />
          <span>{{ filter.label }}</span>
          <span class="library-filter__count">{{ filter.count }}</span>
        </button>
      </div>

      <p v-if="catalogError" class="catalog-error">{{ catalogError }}</p>

      <div v-if="libraryShelves.length" class="library-shelves">
        <div
          v-for="shelf in libraryShelves"
          :key="shelf.id"
          class="library-shelf"
          :aria-labelledby="`library-shelf-${shelf.id}`"
        >
          <div class="library-shelf__heading">
            <div>
              <p class="eyebrow">Shelf</p>
              <h3 :id="`library-shelf-${shelf.id}`">{{ shelf.label }}</h3>
            </div>
            <span class="library-shelf__count">
              {{ shelf.books.length }} {{ shelf.books.length === 1 ? 'title' : 'titles' }}
            </span>
          </div>
          <p class="library-shelf__deck">{{ shelf.deck }}</p>

          <div class="book-grid">
            <article
              v-for="book in shelf.books"
              :id="book.slug"
              :key="book.slug"
              class="book-card"
              :style="{ '--book-accent': book.accent }"
            >
              <component
                :is="bookPageHref(book) ? 'a' : 'div'"
                class="book-card__cover"
                :class="{ 'book-card__cover--image': book.cover }"
                :href="bookPageHref(book)"
                @click="navigateInApp($event, bookPageHref(book))"
              >
                <img v-if="book.cover" :src="book.cover" :alt="`${book.title} cover`" loading="lazy" />
                <template v-else>
                  <Sparkles :size="24" />
                  <span>{{ book.kicker }}</span>
                  <strong>{{ book.title }}</strong>
                </template>
              </component>
              <div class="book-card__body">
                <div>
                  <p class="book-kicker">{{ book.kicker }}</p>
                  <h3>
                    <a
                      v-if="bookPageHref(book)"
                      :href="bookPageHref(book)"
                      @click="navigateInApp($event, bookPageHref(book))"
                      >{{ book.title }}</a
                    >
                    <template v-else>{{ book.title }}</template>
                  </h3>
                  <p>{{ book.description }}</p>
                </div>
                <div class="tag-row">
                  <span v-for="tag in book.tags" :key="tag">{{ tag }}</span>
                </div>
                <div class="book-links">
                  <a :href="bookDetailHref(book)" @click="navigateInApp($event, bookDetailHref(book))">
                    Book page
                  </a>
                  <a v-if="book.homepage" :href="book.homepage">Preview</a>
                  <a :href="stableDeliverableHref(book, 'pdf')">PDF</a>
                  <a :href="stableDeliverableHref(book, 'epub')">EPUB</a>
                  <a :href="book.html" target="_blank" rel="noopener noreferrer">Read</a>
                  <a :href="book.htmlChapters" target="_blank" rel="noopener noreferrer">Chapters</a>
                  <a v-if="book.vault" :href="stableDeliverableHref(book, 'vault')" download>Vault</a>
                  <a v-if="book.vaultGuide" :href="book.vaultGuide" target="_blank" rel="noopener noreferrer">Vault guide</a>
                  <a
                    v-if="book.tutorial"
                    class="book-link--learn"
                    :href="book.tutorial"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <GraduationCap :size="15" />
                    Learn
                  </a>
                  <a v-if="book.source" :href="book.source" target="_blank" rel="noreferrer">
                    Source
                    <ExternalLink :size="14" />
                  </a>
                </div>
              </div>
            </article>
          </div>
        </div>
      </div>
      <p v-else-if="books.length" class="catalog-error">No books match this filter.</p>
    </section>
    </template>
  </main>
</template>
