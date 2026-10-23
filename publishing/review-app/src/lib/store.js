// App state: the book, where you are (one route, mirrored in the URL hash
// for links and reloads), Back/Forward through the shared history, and the
// decisions ledger.

import { markRaw, reactive, readonly } from 'vue'
import { loadBook } from './data.js'
import { DecisionStore, NavHistory, notify, reviewState } from './shared.js'
import { devStorage, grant, pickFolder, rememberedFolder } from './storage.js'

const state = reactive({
  book: null,
  error: '',
  route: { view: 'map' },
  canBack: false,
  canForward: false,
  storage: null,
  ledger: null,
  ledgerError: '',
  notices: [],
})

const history = new NavHistory(200)
history.subscribe(() => {
  state.canBack = history.canBack()
  state.canForward = history.canForward()
})

let store = null

// ------------------------------------------------------------------ routes

const LIST_KEYS = new Set(['e'])

export function encodeRoute(route) {
  const { view, ...params } = route
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length))
    .map(([key, value]) => `${key}=${encodeURIComponent(Array.isArray(value) ? value.join(',') : value)}`)
    .join('&')
  return `#/${view}${query ? `?${query}` : ''}`
}

export function decodeRoute(hash) {
  const match = /^#\/([a-z]+)(?:\?(.*))?$/.exec(hash || '')
  if (!match) return { view: 'map' }
  const route = { view: match[1] }
  for (const pair of (match[2] || '').split('&').filter(Boolean)) {
    const [key, raw] = pair.split('=')
    const value = decodeURIComponent(raw || '')
    route[key] = LIST_KEYS.has(key) ? value.split(',').filter(Boolean) : value
  }
  return route
}

function scrollTop() {
  return document.scrollingElement ? document.scrollingElement.scrollTop : 0
}

function show(route, scroll = 0) {
  state.route = route
  const hash = encodeRoute(route)
  if (location.hash !== hash) window.history.replaceState(null, '', hash)
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, scroll)))
}

export function navigate(route) {
  if (encodeRoute(route) === encodeRoute(state.route)) return
  history.visit({ route: { ...state.route }, scroll: scrollTop() })
  show(route, 0)
}

export function replaceRoute(patch) {
  show({ ...state.route, ...patch }, scrollTop())
}

export function back() {
  const target = history.back({ route: { ...state.route }, scroll: scrollTop() })
  if (target) show(target.route, target.scroll)
}

export function forward() {
  const target = history.forward({ route: { ...state.route }, scroll: scrollTop() })
  if (target) show(target.route, target.scroll)
}

// ------------------------------------------------------------------ ledger

function context() {
  return { projectId: state.book.manifest.project_id, sourceContentId: state.book.manifest.content_id }
}

async function useStorage(storage) {
  state.storage = storage
  state.ledger = null
  state.ledgerError = ''
  if (!storage || (storage.kind === 'folder' && !storage.granted)) return
  store = new DecisionStore({ vault: { adapter: storage.adapter } })
  try {
    state.ledger = markRaw(await store.load(context()))
  } catch (error) {
    state.ledgerError = error.code === 'SOURCE_CONTENT_MISMATCH'
      ? 'The decisions in this folder were made on a different export of the texts.'
      : String(error.message || error)
  }
}

export async function chooseFolder() {
  try {
    await useStorage(await pickFolder())
  } catch (error) {
    if (error.name !== 'AbortError') notify(error.message || error)
  }
}

export async function allowFolder() {
  if (state.storage && (await grant(state.storage))) await useStorage(state.storage)
}

// Apply mutator(ledger) -> ledger through the shared transactional store.
export async function updateLedger(mutator) {
  if (!store || !state.ledger) {
    notify('Choose where to save decisions first.')
    return null
  }
  try {
    state.ledger = markRaw(await store.update(context(), mutator))
    return state.ledger
  } catch (error) {
    notify(`Could not save: ${error.message || error}`)
    return null
  }
}

export function digest() {
  return state.ledger ? reviewState.renderDigest(state.ledger) : ''
}

// --------------------------------------------------------------------- boot

export async function boot() {
  window.addEventListener('firstpair-notice', (event) => {
    state.notices.push(event.detail)
    setTimeout(() => state.notices.shift(), 5000)
  })
  try {
    state.book = markRaw(await loadBook())
  } catch (error) {
    state.error = `The book's data could not be loaded (${error.message}). Run the export and start the app with REVIEW_DATA set.`
    return
  }
  show(decodeRoute(location.hash))
  window.addEventListener('hashchange', () => {
    const route = decodeRoute(location.hash)
    if (encodeRoute(route) !== encodeRoute(state.route)) navigate(route)
  })
  await useStorage((await devStorage()) || (await rememberedFolder()))
}

export const app = readonly(state)
