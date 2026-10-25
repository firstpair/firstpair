"use strict";

/*
 * FirstPair Reader data contract: every reader format FirstPair vaults carry,
 * read into one validated book model.  Pure: the caller supplies
 *   io.read(path)  -> Promise<string|null>   (null when the file is absent)
 *   io.list(path)  -> Promise<{files: string[], folders: string[]}|null>
 * with vault-relative paths, so the module runs unchanged in Obsidian and in
 * tests.
 *
 * Formats, discovered in this order:
 *   v2        _data/reader.json or <Book>/_data/reader.json, schema
 *             "firstpair-reader.v2" (written by new builders)
 *   parallel  _data/parallel-reader.json with chapter JSON (aligned editions)
 *   v1        _data/reader.json as a bare page array (firstpair-reader 1.x)
 *   reader-v1 Reader/reader-index.json, schema "firstpair.reader.v1" (the
 *             July 2026 native vaults: parts, pages with notes, a cover)
 *   cicero    <Book>/_data/reader.json, schema_version 1, pages with markdown
 *   library   <Book>/_data/mobile-library.json, editions whose pages are
 *             marker-delimited blocks of Part notes
 *   code      <Book>/_data/fragments.json beside a <Book>/Chapters/ folder
 *
 * Model:
 *   { format, root, title, author, subtitle, lang, uiLang, version, sourceCommit, launcher, contents,
 *     startPage, cover, parts[{id,title,note,pageIds}],
 *     pages[{id,order,title,partId,file,note,anchor,marker,markdown,chapter}],
 *     aligned, dictionaries, words, fragments, quotes, metrics, editions,
 *     sources }
 */

const V2_SCHEMA = "firstpair-reader.v2";
const PARALLEL_SCHEMA = "firstpair-parallel-reader-v1";

class ContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContractError";
  }
}

function fail(message) {
  throw new ContractError(message);
}

// Vault-relative, no traversal, no absolute or home paths, forward slashes.
function safePath(value, label) {
  const path = String(value || "").trim();
  if (!path) fail(`${label} is empty`);
  if (path.startsWith("/") || path.startsWith("~") || path.includes("\\")
    || /^[a-z]+:/i.test(path)) fail(`${label} is not vault-relative: ${path}`);
  if (path.split("/").some((part) => !part || part === "." || part === "..")) {
    fail(`${label} has an unsafe segment: ${path}`);
  }
  return path;
}

function noteOf(path) {
  return path ? path.replace(/\.md$/i, "") : null;
}

function fileOf(note) {
  return note && !/\.[A-Za-z0-9]+$/.test(note.split("/").pop()) ? `${note}.md` : note;
}

function nfc(value) {
  return String(value ?? "").normalize("NFC");
}

function join(root, path) {
  return root ? `${root}/${path}` : path;
}

async function readJson(io, path) {
  const text = await io.read(path);
  if (text === null || text === undefined) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${path} is not valid JSON (${error.message})`);
  }
}

// Parts in page order, each a contiguous run; part order must not repeat.
function validate(model) {
  if (!model.pages.length) fail("the Reader index has no pages");
  const ids = new Set();
  const files = new Map();
  model.pages.forEach((page, index) => {
    if (!page.id) fail(`page ${index + 1} has no id`);
    if (ids.has(page.id)) fail(`duplicate page id ${page.id}`);
    ids.add(page.id);
    page.order = index + 1;
    if (!page.title) page.title = page.id;
    if (page.file) {
      safePath(page.file, `page ${page.id} path`);
      const key = `${page.file}#${page.anchor || ""}#${page.marker ? page.marker.start : ""}`;
      if (files.has(key)) fail(`pages ${files.get(key)} and ${page.id} share one location`);
      files.set(key, page.id);
    }
    if (page.chapter) safePath(page.chapter, `page ${page.id} chapter`);
    if (!page.file && !page.chapter && page.markdown === null) {
      fail(`page ${page.id} has no text source`);
    }
  });
  const partIds = new Set(model.parts.map((part) => part.id));
  if (partIds.size !== model.parts.length) fail("duplicate part ids");
  let previousPart = -1;
  const seen = new Set();
  for (const page of model.pages) {
    const index = model.parts.findIndex((part) => part.id === page.partId);
    if (index < 0) fail(`page ${page.id} names unknown part ${page.partId}`);
    if (index !== previousPart) {
      if (seen.has(page.partId)) fail(`part ${page.partId} is not contiguous`);
      if (index < previousPart) fail(`part ${page.partId} is out of order`);
      seen.add(page.partId);
      previousPart = index;
    }
  }
  for (const part of model.parts) {
    part.pageIds = model.pages.filter((page) => page.partId === part.id).map((page) => page.id);
    if (!part.pageIds.length) fail(`part ${part.id} has no pages`);
    if (part.note) safePath(part.note, `part ${part.id} note`);
  }
  for (const key of ["launcher", "contents", "cover"]) {
    if (model[key]) safePath(model[key], key);
  }
  if (model.startPage && !ids.has(model.startPage)) {
    const byNote = model.pages.find((page) => page.note === model.startPage);
    model.startPage = byNote ? byNote.id : null;
  }
  return model;
}

function baseModel(format, root, source = {}) {
  return {
    format,
    root,
    title: String(source.title || root || "Reader"),
    // Optional shelf metadata a builder may declare in its index.
    author: source.author ? String(source.author) : null,
    subtitle: source.subtitle ? String(source.subtitle) : null,
    // lang: the text's language; uiLang: the Reader's interface language.
    lang: source.lang || null,
    uiLang: source.ui_lang || null,
    version: source.version || null,
    sourceCommit: source.source_commit || source.sourceCommit || null,
    launcher: null,
    contents: null,
    startPage: null,
    cover: null,
    parts: [],
    pages: [],
    aligned: null,
    dictionaries: null,
    words: null,
    fragments: null,
    quotes: null,
    metrics: null,
    editions: null,
    sources: null,
  };
}

// Parts from page "part" labels (v1, parallel): one part per contiguous run.
function partsFromLabels(pages, fallbackTitle) {
  const parts = [];
  for (const page of pages) {
    const title = String(page.partLabel || fallbackTitle);
    const last = parts[parts.length - 1];
    if (!last || last.title !== title) {
      parts.push({ id: `P${String(parts.length + 1).padStart(3, "0")}`, title, note: null, pageIds: [] });
    }
    page.partId = parts[parts.length - 1].id;
    delete page.partLabel;
  }
  return parts;
}

function page(fields) {
  return {
    id: String(fields.id || ""),
    order: 0,
    title: String(fields.title || ""),
    partId: fields.partId || null,
    file: fields.file || null,
    note: fields.note || noteOf(fields.file),
    anchor: fields.anchor || null,
    marker: fields.marker || null,
    markdown: typeof fields.markdown === "string" ? fields.markdown : null,
    chapter: fields.chapter || null,
  };
}

/* ------------------------------------------------------------- loaders */

function loadV2(data, root) {
  const model = baseModel("v2", root, data);
  model.uiLang = data.ui_lang || data.lang || null;
  const at = (path, label) => (path ? safePath(path, label) : null);
  model.launcher = at(data.launcher, "launcher");
  model.contents = at(data.contents, "contents");
  model.cover = at(data.cover, "cover");
  model.startPage = data.start_page || null;
  model.parts = (data.parts || []).map((part) => ({
    id: String(part.id), title: String(part.title || part.id), note: part.note || null, pageIds: [],
  }));
  model.pages = (data.pages || []).map((row) => page({
    id: row.id,
    title: row.title,
    partId: row.part,
    file: row.path || fileOf(row.note),
    note: row.note || noteOf(row.path),
    anchor: row.anchor,
    marker: row.marker ? { start: row.marker.start, end: row.marker.end } : null,
    markdown: row.markdown,
    chapter: row.chapter,
  }));
  if (!model.parts.length) {
    model.parts = [{ id: "P001", title: model.title, note: null, pageIds: [] }];
    for (const row of model.pages) row.partId = row.partId || "P001";
  }
  model.aligned = data.aligned || null;
  model.dictionaries = data.dictionaries || null;
  model.words = data.words || null;
  model.fragments = at(data.fragments, "fragments");
  model.quotes = at(data.quotes, "quotes");
  model.metrics = at(data.metrics, "metrics");
  model.editions = Array.isArray(data.editions) ? data.editions.map((edition) => ({
    id: String(edition.id),
    title: String(edition.title || edition.id),
    version: edition.version || null,
    family: edition.family || null,
    index: safePath(edition.index, `edition ${edition.id} index`),
  })) : null;
  return model;
}

function loadParallel(data, root) {
  const model = baseModel("parallel", root, data);
  // The source text's language drives word normalization; the interface
  // stays in the vault's ui_lang (English unless declared).
  model.lang = data.sourceLanguage && (data.sourceLanguage.lang || data.sourceLanguage.id) || null;
  model.uiLang = data.ui_lang || null;
  model.pages = (data.pages || []).map((row) => Object.assign(page({
    id: row.id, title: row.title, chapter: row.path,
  }), { partLabel: row.part }));
  model.parts = partsFromLabels(model.pages, model.title);
  model.aligned = data;
  model.dictionaries = data.dictionaries || null;
  return model;
}

function loadV1(rows, root) {
  const model = baseModel("v1", root);
  model.pages = rows.map((row) => {
    const isChapter = /\.json$/i.test(String(row.path || ""));
    return Object.assign(page({
      id: row.id,
      title: row.title,
      file: isChapter ? null : row.path,
      chapter: isChapter ? row.path : null,
    }), { partLabel: row.part });
  });
  model.parts = partsFromLabels(model.pages, "Contents");
  return model;
}

function loadCicero(data, root) {
  const model = baseModel("cicero", root, data);
  model.launcher = data.launcher || null;
  model.contents = data.contents || null;
  model.startPage = data.start_page || null;
  model.parts = (data.parts || []).map((part) => ({
    id: String(part.id), title: String(part.title || part.id), note: part.note || null, pageIds: [],
  }));
  model.pages = (data.pages || []).map((row) => page({
    id: row.id,
    title: row.title,
    partId: row.part_id,
    file: fileOf(row.note),
    note: row.note,
    markdown: row.markdown,
  }));
  return model;
}

// firstpair.reader.v1: parts and pages with notes; pages whose part is null
// lead the book and form a "Front" part.
function loadReaderV1(data, root) {
  const model = baseModel("reader-v1", root, data);
  model.sourceCommit = data.sourceCommit || null;
  model.launcher = data.launcher ? noteOf(data.launcher) : null;
  model.contents = data.contents ? noteOf(data.contents) : null;
  model.cover = data.cover || null;
  const declared = (data.parts || []).map((part) => ({
    id: String(part.id), title: String(part.title || part.id), note: part.note || null, pageIds: [],
  }));
  const rows = [...(data.pages || [])].sort((left, right) => (left.order || 0) - (right.order || 0));
  const front = rows.some((row) => !row.part) ? [{ id: "front", title: "Front", note: null, pageIds: [] }] : [];
  model.parts = [...front, ...declared];
  model.pages = rows.map((row) => page({
    id: row.id,
    title: row.title,
    partId: row.part || "front",
    file: row.note,
    note: noteOf(row.note),
  }));
  // A null-part page after the first real part belongs to the part before it.
  let last = null;
  for (const item of model.pages) {
    if (item.partId === "front" && last && last !== "front") item.partId = last;
    last = item.partId;
  }
  return model;
}

async function loadLibrary(io, data, root) {
  const model = baseModel("library", root, data);
  model.launcher = data.launcher || null;
  model.editions = (data.editions || []).map((edition) => ({
    id: String(edition.id),
    title: String(edition.title || edition.id),
    version: edition.version || null,
    family: edition.family || null,
    index: safePath(edition.data, `edition ${edition.id} data`),
    contents: edition.note || null,
  }));
  model.sources = {
    anthology: data.anthology || null,
    notes: (data.sources || []).map((row) => ({ id: row.id, title: row.title, note: row.note })),
  };
  // A library opens on its first edition; the others are one tap away.
  if (!model.editions.length) fail("the library lists no editions");
  return model;
}

// One edition of a library: pages are marker-delimited blocks of Part notes.
function loadLibraryEdition(data, library, edition) {
  const model = baseModel("library-edition", library.root, data);
  model.title = edition.title;
  model.version = edition.version;
  model.sourceCommit = data.commit || null;
  model.contents = edition.contents || null;
  model.parts = (data.parts || []).map((part) => ({
    id: String(part.id), title: String(part.title || part.id), note: part.note || null, pageIds: [],
  }));
  model.pages = (data.pages || []).map((row) => page({
    id: row.id,
    title: row.title,
    partId: row.part_id,
    file: fileOf(row.note),
    note: row.note,
    anchor: row.anchor,
    marker: { start: `<!-- lmr-page-start:${row.id} -->`, end: `<!-- lmr-page-end:${row.id} -->` },
  }));
  model.startPage = data.start_page || null;
  model.sources = library.sources;
  return validate(model);
}

async function loadCode(io, root, fragmentsPath) {
  const model = baseModel("code", root, { title: root });
  const listing = await io.list(join(root, "Chapters"));
  const chapters = ((listing && listing.files) || []).filter((name) => /\.md$/i.test(name)).sort();
  if (!chapters.length) fail(`${root}/Chapters has no chapter notes`);
  model.parts = [{ id: "P001", title: root, note: null, pageIds: [] }];
  model.pages = chapters.map((name) => {
    const file = name.includes("/") ? name : join(join(root, "Chapters"), name);
    const stem = file.split("/").pop().replace(/\.md$/i, "");
    return page({ id: stem, title: stem.replace(/^\d+[-_ .]*/, "").replace(/[-_]+/g, " ") || stem, partId: "P001", file });
  });
  const book = await io.read(join(root, "Book.md"));
  if (book !== null) model.launcher = join(root, "Book");
  model.fragments = fragmentsPath;
  return model;
}

/* ------------------------------------------------------------ discovery */

async function discoverIn(io, root) {
  const data = join(root, "_data");
  const reader = await readJson(io, `${data}/reader.json`);
  if (reader && !Array.isArray(reader) && reader.schema === V2_SCHEMA) return loadV2(reader, root);
  if (!root) {
    const parallel = await readJson(io, "_data/parallel-reader.json");
    if (parallel && Array.isArray(parallel.pages)) return loadParallel(parallel, root);
  }
  if (Array.isArray(reader)) {
    if (!reader.length) fail("the Reader index is empty");
    return loadV1(reader, root);
  }
  if (reader && reader.schema_version === 1 && Array.isArray(reader.pages)) {
    return loadCicero(reader, root);
  }
  if (reader) fail(`${data}/reader.json has an unknown schema`);
  const native = await readJson(io, join(root, "Reader/reader-index.json"));
  if (native && native.schema === "firstpair.reader.v1") return loadReaderV1(native, root);
  const library = await readJson(io, `${data}/mobile-library.json`);
  if (library && library.schema_version === 1) return loadLibrary(io, library, root);
  if ((await io.read(`${data}/fragments.json`)) !== null) {
    return loadCode(io, root, `${data}/fragments.json`);
  }
  return null;
}

// Top-level folders that may hold a book: visible, one segment, in NFC so a
// folder listed in decomposed form (macOS, iCloud) matches the index's paths.
async function topFolders(io) {
  const listing = await io.list("");
  return ((listing && listing.folders) || [])
    .map((name) => nfc(name).replace(/^\/+|\/+$/g, ""))
    .filter((name) => name && !name.startsWith(".") && !name.includes("/"))
    .sort();
}

// The first book in the vault: the root index, else the first folder's.
async function discover(io) {
  const atRoot = await discoverIn(io, "");
  if (atRoot) return finish(atRoot, io);
  for (const folder of await topFolders(io)) {
    const model = await discoverIn(io, folder);
    if (model) return finish(model, io);
  }
  fail("no FirstPair Reader index in this vault");
}

// Every book in the vault: the root index (if any), then each top-level
// folder whose own index reads, in folder order.  A book that cannot be read
// (a half-synced index) is reported in `broken` instead of hiding the others;
// with no readable book at all the first such error is thrown, as discover()
// does.
async function discoverAll(io) {
  const books = [];
  const broken = [];
  const attempt = async (root) => {
    try {
      const model = await discoverIn(io, root);
      if (model) books.push(await finish(model, io));
    } catch (error) {
      broken.push({ root, error });
    }
  };
  await attempt("");
  for (const folder of await topFolders(io)) await attempt(folder);
  if (!books.length) {
    if (broken.length) throw broken[0].error;
    fail("no FirstPair Reader index in this vault");
  }
  return { books, broken };
}

async function finish(model, io) {
  if (model.format === "library") return model;
  return validate(model);
}

async function loadEdition(io, library, editionId) {
  const edition = library.editions.find((item) => item.id === editionId) || library.editions[0];
  const data = await readJson(io, edition.index);
  if (!data) fail(`edition ${edition.id} is not in the vault yet (${edition.index})`);
  return loadLibraryEdition(data, library, edition);
}

/* ------------------------------------------------------------- routing */

// Which Reader location a note stands for: the static fallback notes open
// the Reader at the same place.
function targetForNote(model, notePath) {
  const note = noteOf(nfc(notePath));
  if (!note) return null;
  const same = (path) => Boolean(path) && noteOf(nfc(path)) === note;
  if (same(model.launcher)) {
    return model.startPage ? { mode: "page", pageId: model.startPage } : { mode: "contents" };
  }
  if (same(model.contents)) return { mode: "contents" };
  const pages = model.pages.filter((page) => same(page.note));
  if (pages.length === 1) return { mode: "page", pageId: pages[0].id };
  const part = model.parts.find((item) => same(item.note));
  if (part) return { mode: "part", partId: part.id };
  if (pages.length > 1) return { mode: "part", partId: pages[0].partId };
  return null;
}

/* --------------------------------------------------------------- shelf */

// A book's key: its root folder ("" for a book at the vault root), in NFC.
function bookKey(model) {
  return nfc(model && model.root);
}

// The book a note belongs to: one whose Reader notes include it, else the
// book whose folder contains it (the longest root wins), else the root book.
function bookForNote(books, notePath) {
  const path = nfc(notePath).replace(/^\/+/, "");
  if (!path || !books || !books.length) return null;
  const exact = books.find((book) => book.format !== "library" && targetForNote(book, path));
  if (exact) return exact;
  const inside = books
    .filter((book) => bookKey(book) && path.startsWith(`${bookKey(book)}/`))
    .sort((left, right) => bookKey(right).length - bookKey(left).length);
  if (inside.length) return inside[0];
  return books.find((book) => !bookKey(book)) || null;
}

// What the shelf shows for a book: title, optional author and subtitle (from
// the index), and the language pair of an aligned edition (source first,
// translations in order) or the text's own language.
function shelfEntry(model) {
  const aligned = model.aligned && typeof model.aligned === "object" ? model.aligned : null;
  let source = null;
  const targets = [];
  if (aligned) {
    const declared = aligned.sourceLanguage || {};
    const id = declared.lang || declared.id || model.lang;
    if (id) source = { id, label: declared.label || id };
    const seen = new Set();
    for (const item of aligned.translations || []) {
      const lang = item.lang || item.id;
      if (!lang || seen.has(lang)) continue;
      seen.add(lang);
      const named = (aligned.languages || []).find((language) => language.id === lang);
      targets.push({ id: lang, label: (named && named.label) || item.label || lang });
    }
  } else if (model.lang) {
    source = { id: model.lang, label: model.lang };
  }
  return {
    key: bookKey(model),
    title: model.title,
    author: model.author || null,
    subtitle: model.subtitle || null,
    source,
    targets,
    languages: [source && source.label, targets.map((item) => item.label).join(", ")]
      .filter(Boolean).join(" → "),
  };
}

// Interlinear glosses in several languages (since 2.6.0).  A unit's
// `words[i][2]` is the gloss in the edition's primary gloss language,
// `aligned.interlinear.glossLang`, else the first translation's language;
// `glosses.<lang>` is an optional array parallel to `words` (same length)
// for any other language.
function primaryGlossLang(aligned) {
  const declared = aligned && aligned.interlinear && aligned.interlinear.glossLang;
  if (typeof declared === "string" && declared) return declared;
  const first = ((aligned && aligned.translations) || [])[0];
  return first ? (first.lang || first.id || null) : null;
}

// The gloss languages a set of units offers: the primary one first, then
// every `glosses` key in the order `preferred` lists languages, then the rest.
function glossLanguages(aligned, units = [], preferred = []) {
  const found = new Set();
  for (const unit of units) {
    if (!unit || !Array.isArray(unit.words)) continue;
    for (const [lang, list] of Object.entries(unit.glosses || {})) {
      if (Array.isArray(list) && list.length === unit.words.length) found.add(lang);
    }
  }
  const primary = primaryGlossLang(aligned);
  const ordered = [primary, ...preferred.filter((lang) => found.has(lang)), ...found].filter(Boolean);
  return [...new Set(ordered)];
}

// The languages to try for glosses, best first: an explicit choice, then the
// shown translation columns in display order; with only the source shown,
// the interface language.  The primary gloss is the last resort of
// unitGlosses, so it need not be listed.
function glossOrder({ explicit = null, shown = [], uiLang = null } = {}) {
  const order = [explicit, ...shown];
  if (!shown.length) order.push(uiLang);
  return [...new Set(order.filter(Boolean))];
}

// A unit's glosses in the first language of `order` it has, else the
// primary glosses (`words[i][2]`): { lang, glosses } with one string a word.
function unitGlosses(unit, order, primary) {
  const words = Array.isArray(unit && unit.words) ? unit.words : [];
  const own = () => words.map((word) => (Array.isArray(word) && word[2]) || "");
  for (const lang of order || []) {
    if (lang === primary) return { lang, glosses: own() };
    const list = unit.glosses && unit.glosses[lang];
    if (Array.isArray(list) && list.length === words.length) {
      return { lang, glosses: list.map((gloss) => (typeof gloss === "string" ? gloss : "")) };
    }
  }
  return { lang: primary, glosses: own() };
}

// Text between two literal markers, or null when either is missing.
function extractMarked(text, marker) {
  const source = String(text || "");
  const start = source.indexOf(marker.start);
  if (start < 0) return null;
  const end = source.indexOf(marker.end, start + marker.start.length);
  if (end < 0) return null;
  return source.slice(start + marker.start.length, end).trim();
}

module.exports = {
  ContractError,
  PARALLEL_SCHEMA,
  V2_SCHEMA,
  bookForNote,
  bookKey,
  discover,
  discoverAll,
  extractMarked,
  glossLanguages,
  glossOrder,
  loadEdition,
  noteOf,
  primaryGlossLang,
  safePath,
  shelfEntry,
  targetForNote,
  unitGlosses,
  validate,
};
