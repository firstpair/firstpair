import assert from 'node:assert/strict'
import test from 'node:test'

import { isPreviewBook } from '../src/library-status.js'

test('classifies a dedicated preview homepage as a preview', () => {
  assert.equal(isPreviewBook({ homepage: '/example/preview/' }), true)
})

test('classifies the catalog preview tag without a homepage as a preview', () => {
  assert.equal(isPreviewBook({ tags: ['history', 'preview'] }), true)
  assert.equal(isPreviewBook({ tags: [' Preview '] }), true)
})

test('classifies a preview kicker without a homepage as a preview', () => {
  assert.equal(isPreviewBook({ kicker: 'Author-directed public preview' }), true)
})

test('does not classify finished or similarly named entries as previews', () => {
  assert.equal(
    isPreviewBook({ kicker: 'Finished book', tags: ['history', 'previews'] }),
    false,
  )
})
