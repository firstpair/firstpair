// The shared FirstPair reader modules, used as they are by the Obsidian
// plugins: the decisions ledger and digest, span-note colours and the word
// picker, diff lenses, and Back/Forward history.

import reviewState from '@firstpair/firstpair-triptych/review-state.js'
import ledgerStore from '@firstpair/shared/ledger-store.js'
import spanEditorFactory from '@firstpair/shared/span-editor.js'
import diffView from '@firstpair/shared/diff-view.js'
import navHistory from '@firstpair/shared/nav-history.js'
import { installDomShim } from './dom-shim.js'

installDomShim()

export { reviewState, diffView }
export const { NavHistory } = navHistory

export const t = (key, vars) => reviewState.uiText('en', key, vars)

const notices = []
export function notify(message) {
  notices.push(String(message))
  window.dispatchEvent(new CustomEvent('firstpair-notice', { detail: String(message) }))
}

export const { DecisionStore } = ledgerStore({
  normalizePath: (path) => path,
  notifyUnreadable: () => notify('The decisions file could not be read; it was left untouched.'),
})

export const spanEditor = spanEditorFactory({
  Notice: class { constructor(message) { notify(message) } },
  Platform: { isMobile: false, isIosApp: false, isDesktopApp: false },
  t,
  actionLabel: (action) => t(`action_${action}`),
})

// A rule's id, as the shared ledger expects (R + 12 hex).
export function ruleId(pair, from, to) {
  return `R${reviewState.sha256Utf8(`${pair}\u001f${from}\u001f${to}`).slice(0, 12)}`
}
