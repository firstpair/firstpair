"use strict";

/*
 * Per-book Reader state in the plugin's data.json.  Pure: it reads and
 * returns plain settings objects, so it runs unchanged in tests.
 *
 * Since 2.5.0 every book keeps its own record, keyed by the book's root
 * folder ("" for a book at the vault root):
 *
 *   books: {
 *     "<root>": {
 *       state:         { mode, editionId, partId, pageId, scrollTop, enabled,
 *                        source, interlinear, columns, word },
 *       choices:       { <lang>: <translation id> },
 *       defaultColumn: "<cell key>",        // the phone tab opened first
 *       glossLang:     "<lang>" | null,     // interlinear glosses (2.6.0); null: Auto
 *       hiddenColumns: ["<column name>"]    // source-table language bar
 *     }
 *   },
 *   lastBook: "<root>"                       // the book read last
 *
 * Before 2.5.0 the Reader knew one book and kept these as top-level maps
 * keyed by the book's title (`state`, `choices`, `defaultColumn`,
 * `hiddenColumns`).  A book with no record yet takes its entries from those
 * maps under its legacy title; the maps themselves are left as they were.
 */

const RECORD_FIELDS = ["state", "choices", "defaultColumn", "hiddenColumns"];

function own(object, key) {
  return Boolean(object) && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key);
}

// The 2.4.x entries of a book whose title (the aligned edition's, else the
// library's or the book's) was `legacyKey`, or null when there are none.
function legacyRecord(settings, legacyKey) {
  if (legacyKey === null || legacyKey === undefined) return null;
  const record = {};
  for (const field of RECORD_FIELDS) {
    if (own(settings[field], legacyKey)) record[field] = settings[field][legacyKey];
  }
  return Object.keys(record).length ? record : null;
}

// The book's record: its own, else one migrated from the 2.4.x maps, else
// empty.  `migrated` tells the caller the record should be saved.
function bookRecord(settings, key, legacyKey = null) {
  const books = settings.books && typeof settings.books === "object" ? settings.books : {};
  if (own(books, key)) return { record: books[key], migrated: false };
  const legacy = legacyRecord(settings, legacyKey);
  return { record: legacy ? JSON.parse(JSON.stringify(legacy)) : {}, migrated: Boolean(legacy) };
}

// A new `books` map with the book's record (migrated first, when it has
// none yet) patched; settings are not touched.
function patchBook(settings, key, patch, legacyKey = null) {
  const books = { ...(settings.books && typeof settings.books === "object" ? settings.books : {}) };
  books[key] = { ...bookRecord(settings, key, legacyKey).record, ...patch };
  return books;
}

// Every record without its saved state (Resume switched off: positions and
// languages go, as in 2.4.x); translation choices and phone tabs stay.
function withoutStates(settings) {
  const books = {};
  for (const [key, record] of Object.entries(settings.books || {})) {
    const { state: _state, ...rest } = record || {};
    books[key] = rest;
  }
  return books;
}

module.exports = { RECORD_FIELDS, bookRecord, legacyRecord, patchBook, withoutStates };
