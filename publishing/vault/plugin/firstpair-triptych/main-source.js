/*
 * FirstPair Triptych — editorial Rosetta Reader for FirstPair vaults (first
 * built for Lighthouse Republics; the book folder is discovered on load).
 *
 * 1. ```triptych code blocks render as full-width side-by-side panes with
 *    the Rosetta editorial rail, equality banner, global pane filter,
 *    whole-pane and optional sentence preference checkboxes, phrase-level
 *    "prefer this" / "ungrammatical" marks, and per-fragment editing notes
 *    recorded to Preferences/triptych-decisions.json
 *    (+ EDITING-INSTRUCTIONS.md digest).
 * 2. Transformation notes (type: transformation) render as side-by-side
 *    Before | After with word-level diff highlighting and a badge rail.
 * 3. Lineage notes (type: lineage) render as a chain strip of edition runs
 *    (consecutive identical members collapsed) plus one card per distinct
 *    state with an inline diff toggle against the previous state.
 * 4. Comparison hub notes (type: comparison) gain lazy incipit previews on
 *    their lineage rows as they scroll into view.
 *
 * The enhanced viewers run in Reading view and parse the raw note text, so
 * they need no vault rebuild and are immune to preview virtualization. A
 * "raw" toggle restores the generated note.
 */

const {
  ItemView,
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  Platform,
  normalizePath,
  requestUrl,
  setIcon,
} = require("obsidian");
const {
  LEDGER_SCHEMA,
  MAX_SPAN_OVERLAP,
  overlapDepth,
  spanColors,
  addVoiceClip,
  clearSpanNote,
  formatDuration,
  pendingVoiceClips,
  removeVoiceClip,
  setVoiceTranscript,
  spanNoteKey,
  spanNotesForSentence,
  upsertSpanNoteText,
  voiceClipId,
  voiceClipPath,
  annotationSegments,
  annotationsForSentence,
  clearPhraseAnnotation,
  codePointLength,
  digestLine,
  emptyLedger,
  makeSelector,
  normalizeLedger,
  phraseAnnotationKey,
  pickUiLanguage,
  preferredCorrectionVariant,
  renderDigest,
  resolveAnnotation,
  reviewChoiceCount,
  selectedTokenRange,
  sentenceFingerprint,
  sentencePreferenceKey,
  serializeLedger,
  setPreferredCorrectionVariant,
  sha256Id,
  sliceCodePoints,
  touchedFragmentKeys,
  uiCount,
  uiText,
  upsertPhraseAnnotation,
  wordTokens,
  ruleDecisionMap,
  setRuleDecision,
} = require("./review-state");

// Visible UI text follows the vault language (editions.jsonl); see
// UI_STRINGS in review-state.js.  Identifiers, CSS classes, icon keys, and
// ledger/digest text stay English.
// The book folder holds _data/ and Triptychs/.  It is "Lighthouse Republics"
// in the Venice vaults; other books name their own, found on load.
const DEFAULT_BOOK_ROOT = "Lighthouse Republics";
let BOOK_ROOT = DEFAULT_BOOK_ROOT;
let EDITIONS_LEDGER_PATH = `${BOOK_ROOT}/_data/editions.jsonl`;
let READER_INDEX_PATH = `${BOOK_ROOT}/_data/triptych-reader.json`;
let READER_NOTE_ROOT = `${BOOK_ROOT}/Triptychs`;
function setBookRoot(root) {
  BOOK_ROOT = root;
  EDITIONS_LEDGER_PATH = `${root}/_data/editions.jsonl`;
  READER_INDEX_PATH = `${root}/_data/triptych-reader.json`;
  READER_NOTE_ROOT = `${root}/Triptychs`;
}
async function detectBookRoot(adapter) {
  try {
    if (await adapter.exists(normalizePath(`${DEFAULT_BOOK_ROOT}/_data/triptych-reader.json`))) {
      return DEFAULT_BOOK_ROOT;
    }
    const listing = await adapter.list("/");
    for (const folder of [...(listing.folders || [])].sort()) {
      const name = folder.replace(/^\/+/, "");
      if (!name || name.startsWith(".")) continue;
      if (await adapter.exists(normalizePath(`${name}/_data/triptych-reader.json`))) return name;
    }
  } catch (_error) {
    // Fall through to the Venice layout.
  }
  return DEFAULT_BOOK_ROOT;
}
let uiLanguage = "en";
function t(key, vars) {
  return uiText(uiLanguage, key, vars);
}
function tc(count, noun) {
  return uiCount(uiLanguage, count, noun);
}
function actionLabel(action) {
  const key = `action_${action}`;
  try {
    return t(key);
  } catch (_error) {
    const value = String(action || "");
    return value ? value[0].toUpperCase() + value.slice(1) : value;
  }
}
// editions.jsonl first; editions.json (the same rows as one JSON array) as
// a fallback, because Obsidian Sync does not reliably carry .jsonl files to
// phones, which then showed the interface in English.
async function detectUiLanguage(adapter) {
  try {
    const jsonl = normalizePath(EDITIONS_LEDGER_PATH);
    if (await adapter.exists(jsonl)) return pickUiLanguage(await adapter.read(jsonl));
    const json = normalizePath(EDITIONS_LEDGER_PATH.replace(/\.jsonl$/, ".json"));
    if (await adapter.exists(json)) {
      const rows = JSON.parse(await adapter.read(json));
      if (Array.isArray(rows)) return pickUiLanguage(rows.map((row) => JSON.stringify(row)).join("\n"));
    }
    return "en";
  } catch (_error) {
    return "en";
  }
}

const { LEDGER_PATH, DIGEST_PATH, LEDGER_HASH_PATH } = require("../shared/ledger-store");
const READER_VIEW_TYPE = "firstpair-triptych-reader-view";
const REVIEW_VIEW_TYPE = "firstpair-triptych-review-view";
const READER_HISTORY_LIMIT = 100;
const READER_SCHEMA_VERSION = 4;
const TRIPTYCH_SCHEMA_VERSION = 3;
const SAFE_EDITORIAL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RESERVED_EDITORIAL_IDS = new Set([
  ...Object.getOwnPropertyNames(Object.prototype), "prototype",
]);
function isSafeEditorialId(value) {
  return SAFE_EDITORIAL_ID_RE.test(value) && !RESERVED_EDITORIAL_IDS.has(value);
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}
function editorialPageDigest(payload) {
  const projection = {
    key: payload.key, set: payload.set, lineage: payload.lineage,
    panes: payload.panes.map((pane) => ({
      edition: pane.edition,
      units: pane.units,
      notes: pane.notes,
      unit_kinds: pane.unit_kinds,
      text_sha256: pane.text_sha256,
      sentence_spans: pane.sentence_spans,
    })),
  };
  return sha256Id(stableJson(projection));
}
const READER_ICONS = Object.freeze({
  Previous: "arrow-left",
  Up: "arrow-up",
  Back: "rotate-ccw",
  Forward: "rotate-cw",
  Top: "arrow-up-to-line",
  TOC: "list",
  Next: "arrow-right",
});

const BAR_GLYPHS = { 0: "·", 1: "❘", 2: "❘❘", 3: "❘❘❘" };
const FEATURE_CODES = ["N", "M", "S", "R", "E", "C", "F"];

function readerPath(value, label) {
  const path = String(value || "").trim().replace(/\.md$/i, "");
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`invalid ${label}`);
  }
  return normalizePath(path);
}

function parseTriptychReaderIndex(input) {
  const payload = typeof input === "string" ? JSON.parse(input) : input;
  const exactKeys = (value, expected) => (
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === expected.length
    && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
  if (
    !exactKeys(payload, [
      "schema_version",
      "title",
      "book_version",
      "source_commit",
      "project_id",
      "source_content_id",
      "target_contract_version",
      "launcher",
      "contents",
      "review",
      "editions",
      "sets",
    ])
    || payload.schema_version !== READER_SCHEMA_VERSION
  ) {
    throw new Error("invalid triptych Reader index");
  }
  const title = String(payload.title || "").trim();
  if (!title) throw new Error("triptych Reader index has no title");
  const launcher = readerPath(payload.launcher, "Reader launcher");
  const contents = readerPath(payload.contents, "Reader contents");
  const review = readerPath(payload.review, "Review launcher");
  const bookVersion = String(payload.book_version || "").trim();
  const sourceCommit = String(payload.source_commit || "").trim();
  const projectId = String(payload.project_id || "").trim();
  const sourceContentId = String(payload.source_content_id || "").trim();
  const targetContractVersion = String(payload.target_contract_version || "").trim();
  if (
    !bookVersion || !/^[0-9a-f]{40}$/i.test(sourceCommit)
    || !projectId || !/^sha256:[0-9a-f]{64}$/.test(sourceContentId)
    || !targetContractVersion
  ) {
    throw new Error("invalid triptych Reader source identity");
  }
  if (!Array.isArray(payload.editions) || !payload.editions.length) {
    throw new Error("triptych Reader index has no editions");
  }
  const editionById = new Map();
  const editions = payload.editions.map((rawEdition) => {
    if (!exactKeys(rawEdition, ["id", "version", "source_commit"])) {
      throw new Error("invalid triptych Reader edition identity");
    }
    const edition = {
      id: String(rawEdition.id || "").trim(),
      version: String(rawEdition.version || "").trim(),
      source_commit: String(rawEdition.source_commit || "").trim(),
    };
    if (
      !isSafeEditorialId(edition.id)
      || !edition.version
      || !/^[0-9a-f]{40}$/i.test(edition.source_commit)
      || editionById.has(edition.id)
    ) {
      throw new Error("invalid triptych Reader edition identity");
    }
    editionById.set(edition.id, edition);
    return edition;
  });
  // The index names its book by version and commit; the canonical edition is
  // the one that carries both (main-4.1, ru-4.1, or a bilingual book's lead).
  const canonical = editions.find((edition) => (
    edition.version === bookVersion && edition.source_commit === sourceCommit
  ));
  if (!canonical) {
    throw new Error("triptych Reader canonical source identity is stale");
  }
  if (!Array.isArray(payload.sets) || !payload.sets.length) {
    throw new Error("triptych Reader index has no sets");
  }
  const setById = new Map();
  const pageByKey = new Map();
  const pageByNote = new Map();
  const sets = payload.sets.map((rawSet) => {
    if (
      !exactKeys(rawSet, [
        "id",
        "title",
        "description",
        "note",
        "edition_ids",
        "navigation_edition_id",
        "parts",
        "pages",
      ])
    ) {
      throw new Error("invalid triptych Reader set");
    }
    const id = String(rawSet.id || "").trim();
    const title = String(rawSet.title || "").trim();
    const note = readerPath(rawSet.note, "triptych set note");
    const editionIds = Array.isArray(rawSet.edition_ids)
      ? rawSet.edition_ids.map((value) => String(value || "").trim())
      : [];
    const navigationEditionId = String(
      rawSet.navigation_edition_id || ""
    ).trim();
    if (
      !id
      || !title
      || setById.has(id)
      || !editionIds.length
      || new Set(editionIds).size !== editionIds.length
      || editionIds.some((editionId) => !editionById.has(editionId))
      || navigationEditionId !== editionIds[editionIds.length - 1]
      || !Array.isArray(rawSet.parts)
      || !rawSet.parts.length
      || !Array.isArray(rawSet.pages)
      || !rawSet.pages.length
    ) {
      throw new Error(`invalid triptych Reader set ${id || "(unnamed)"}`);
    }
    const partById = new Map();
    const partHeadings = new Set();
    const parts = rawSet.parts.map((rawPart, index) => {
      if (!exactKeys(rawPart, ["id", "title", "heading", "order"])) {
        throw new Error(`invalid part in triptych Reader set ${id}`);
      }
      const part = {
        id: String(rawPart.id || "").trim(),
        title: String(rawPart.title || "").trim(),
        heading: String(rawPart.heading || "").trim(),
        order: index + 1,
      };
      if (
        !part.id
        || !part.title
        || !part.heading
        || Number(rawPart.order) !== index + 1
        || partById.has(part.id)
        || partHeadings.has(part.heading)
      ) {
        throw new Error(`invalid part in triptych Reader set ${id}`);
      }
      partById.set(part.id, part);
      partHeadings.add(part.heading);
      return part;
    });
    const pageCountByPart = new Map(parts.map((part) => [part.id, 0]));
    let priorPartOrder = 0;
    const pages = rawSet.pages.map((rawPage, index) => {
      if (
        !exactKeys(rawPage, ["key", "note", "title", "part_id", "order", "target_digest"])
      ) {
        throw new Error(`invalid page in triptych Reader set ${id}`);
      }
      const key = String(rawPage.key || "").trim();
      const pageNote = readerPath(rawPage.note, "triptych page note");
      const titleText = String(rawPage.title || "").trim();
      const partId = String(rawPage.part_id || "").trim();
      const targetDigest = String(rawPage.target_digest || "").trim();
      const part = partById.get(partId);
      if (
        !key ||
        !key.startsWith(`${id}/`) ||
        !titleText ||
        !part ||
        part.order < priorPartOrder ||
        Number(rawPage.order) !== index + 1 ||
        pageByKey.has(key) ||
        pageByNote.has(pageNote) || !/^sha256:[0-9a-f]{64}$/.test(targetDigest)
      ) {
        throw new Error(`invalid triptych Reader page ${key || index + 1}`);
      }
      const page = {
        key,
        note: pageNote,
        title: titleText,
        part_id: partId,
        order: index + 1,
        target_digest: targetDigest,
        setId: id,
        index,
      };
      priorPartOrder = part.order;
      pageCountByPart.set(partId, pageCountByPart.get(partId) + 1);
      pageByKey.set(key, page);
      pageByNote.set(pageNote, page);
      return page;
    });
    if (parts.some((part) => pageCountByPart.get(part.id) === 0)) {
      throw new Error(`invalid part coverage in triptych Reader set ${id}`);
    }
    const set = {
      id,
      title,
      description: String(rawSet.description || "").trim(),
      note,
      edition_ids: editionIds,
      navigation_edition_id: navigationEditionId,
      parts,
      partById,
      pages,
    };
    setById.set(id, set);
    return set;
  });
  return {
    ...payload,
    title,
    book_version: bookVersion,
    source_commit: sourceCommit,
    project_id: projectId,
    source_content_id: sourceContentId,
    target_contract_version: targetContractVersion,
    launcher,
    contents,
    review,
    editions,
    editionById,
    sets,
    setById,
    pageByKey,
    pageByNote,
  };
}

function extractTriptychPayload(source) {
  const match = String(source || "").match(
    /^```triptych[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/m
  );
  if (!match) throw new Error("triptych note has no fenced payload");
  const payload = JSON.parse(match[1]);
  if (
    !payload ||
    payload.schema_version !== TRIPTYCH_SCHEMA_VERSION ||
    typeof payload.key !== "string" ||
    !Array.isArray(payload.panes) ||
    typeof payload.project_id !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(payload.source_content_id || "") ||
    typeof payload.target_contract_version !== "string"
  ) {
    throw new Error("triptych note has an invalid payload");
  }
  return validateTriptychPayload(payload);
}

function validateTriptychPayload(payload) {
  if (
    !payload || payload.schema_version !== TRIPTYCH_SCHEMA_VERSION
    || typeof payload.key !== "string" || !payload.key
    || typeof payload.project_id !== "string" || !payload.project_id
    || !/^sha256:[0-9a-f]{64}$/.test(payload.source_content_id || "")
    || typeof payload.target_contract_version !== "string"
    || !payload.target_contract_version
    || !Array.isArray(payload.panes) || !payload.panes.length
  ) throw new Error("triptych note has an invalid editorial payload");
  const editions = new Set();
  const sentenceIds = new Set();
  for (const pane of payload.panes) {
    if (
      !pane || typeof pane.edition !== "string" || !isSafeEditorialId(pane.edition)
      || editions.has(pane.edition) || typeof pane.text !== "string"
      || pane.text_sha256 !== sha256Id(pane.text)
      || !Array.isArray(pane.units)
      || !Array.isArray(pane.notes)
      || !Array.isArray(pane.unit_kinds)
      || pane.notes.length !== pane.units.length
      || pane.unit_kinds.length !== pane.units.length
      || !Array.isArray(pane.sentence_spans)
    ) throw new Error("triptych note has an invalid pane payload");
    editions.add(pane.edition);
    const blocks = paneBlocks(pane.text);
    if (blocks.length !== pane.units.length && pane.text) {
      throw new Error("triptych pane text does not match its unit inventory");
    }
    let previousEnd = -1;
    const occurrences = new Map();
    for (const span of pane.sentence_spans) {
      const keys = [
        "id", "unit", "unit_index", "sentence_index", "start", "end",
        "fingerprint", "offset_unit", "text_sha256", "tokens",
      ];
      if (
        !span || typeof span !== "object" || Array.isArray(span)
        || Object.keys(span).length !== keys.length
        || keys.some((key) => !Object.prototype.hasOwnProperty.call(span, key))
        || typeof span.id !== "string" || !span.id
        || sentenceIds.has(span.id)
        || typeof span.unit !== "string"
        || !Number.isInteger(span.unit_index)
        || pane.units[span.unit_index] !== span.unit
        || !Number.isInteger(span.sentence_index) || span.sentence_index < 1
        || !Number.isInteger(span.start) || !Number.isInteger(span.end)
        || span.start < 0 || span.end <= span.start
        || span.end > codePointLength(pane.text) || span.start < previousEnd
        || span.offset_unit !== "unicode-code-point"
        || typeof span.fingerprint !== "string"
        || !/^[0-9a-f]{8}$/.test(span.fingerprint)
        || !Array.isArray(span.tokens)
      ) throw new Error("triptych note has an invalid sentence span");
      const block = blocks[span.unit_index];
      if (!block || span.start < block.start || span.end > block.end) {
        throw new Error("triptych sentence span leaves its source unit");
      }
      const exact = sliceCodePoints(pane.text, span.start, span.end);
      if (
        sentenceFingerprint(exact) !== span.fingerprint
        || span.text_sha256 !== sha256Id(exact)
        || JSON.stringify(span.tokens) !== JSON.stringify(wordTokens(exact, span.id))
      ) throw new Error("triptych sentence or word-token fingerprint is stale");
      const occurrenceKey = `${span.unit}\u001f${span.fingerprint}`;
      const occurrence = (occurrences.get(occurrenceKey) || 0) + 1;
      occurrences.set(occurrenceKey, occurrence);
      const expectedId = (
        `${span.unit}:H${span.fingerprint}:O${String(occurrence).padStart(3, "0")}:`
        + span.fingerprint
      );
      if (span.id !== expectedId) {
        throw new Error("triptych sentence identity is noncanonical");
      }
      sentenceIds.add(span.id);
      previousEnd = span.end;
    }
  }
  return payload;
}

function validateIndexedTriptychPayload(payload, sourcePath, reader) {
  payload = validateTriptychPayload(payload);
  const note = String(sourcePath || "").replace(/\.md$/i, "");
  const page = reader && reader.pageByNote && reader.pageByNote.get(note);
  const set = page && reader.setById.get(page.setId);
  if (
    !page || !set
    || payload.key !== page.key
    || payload.set !== page.setId
    || payload.project_id !== reader.project_id
    || payload.source_content_id !== reader.source_content_id
    || payload.target_contract_version !== reader.target_contract_version
    || editorialPageDigest(payload) !== page.target_digest
    || payload.panes.map((pane) => pane.edition).join("\0")
      !== set.edition_ids.join("\0")
  ) {
    throw new Error(`unindexed or mismatched triptych payload: ${sourcePath || "(unknown note)"}`);
  }
  return payload;
}

function isTriptychReaderNotePath(filePath) {
  const note = normalizePath(String(filePath || "")).replace(/\.md$/i, "");
  return note === READER_NOTE_ROOT || note.startsWith(`${READER_NOTE_ROOT}/`);
}

const KIND_CLASSES = {
  unchanged: "lt-kind-unchanged",
  rewrite: "lt-kind-rewrite",
  split: "lt-kind-structural",
  fusion: "lt-kind-structural",
  complex: "lt-kind-complex",
  add: "lt-kind-add",
  excision: "lt-kind-excision",
};

/* ------------------------------- text utils ------------------------------ */

function normalizeCompare(text) {
  return (text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function stripWikilinks(text) {
  return (text || "").replace(/!?\[\[([^\]\n]+)\]\]/g, (_m, inner) => {
    const [target, alias] = inner.split("|");
    return alias !== undefined ? alias : target.split("/").pop();
  });
}

function stripFrontmatter(raw) {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  return end === -1 ? raw : raw.slice(end + 4);
}

function tokenSet(text) {
  return new Set(
    (text.toLowerCase().match(/[a-z][a-z']+/g) || []).filter((t) => t.length > 2)
  );
}

function jaccard(a, b) {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (!ta.size || !tb.size) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / (ta.size + tb.size - overlap);
}

/* Word-level diff: trim common prefix/suffix, then LCS on the middle.
 * Falls back to whole-block replace when the middle is too large. */
function wordDiff(before, after) {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--; endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const ops = [];
  for (let i = 0; i < start; i++) ops.push(["=", a[i]]);
  if (midA.length * midB.length > 300000) {
    for (const w of midA) ops.push(["-", w]);
    for (const w of midB) ops.push(["+", w]);
  } else if (midA.length || midB.length) {
    const n = midA.length, m = midB.length;
    const dp = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * (m + 1) + j] =
          midA[i] === midB[j]
            ? dp[(i + 1) * (m + 1) + j + 1] + 1
            : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { ops.push(["=", midA[i]]); i++; j++; }
      else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) {
        ops.push(["-", midA[i]]); i++;
      } else { ops.push(["+", midB[j]]); j++; }
    }
    while (i < n) { ops.push(["-", midA[i]]); i++; }
    while (j < m) { ops.push(["+", midB[j]]); j++; }
  }
  for (let i = endA; i < a.length; i++) ops.push(["=", a[i]]);
  return ops;
}

function renderDiffInto(el, ops, side) {
  // side: "before" renders = and -, "after" renders = and +, "inline" all.
  let run = [];
  let runOp = null;
  const flush = () => {
    if (!run.length) return;
    const text = run.join(" ") + " ";
    if (runOp === "=") el.createSpan({ text });
    else if (runOp === "-") el.createSpan({ cls: "lt-del", text });
    else el.createSpan({ cls: "lt-ins", text });
    run = [];
  };
  for (const [op, word] of ops) {
    if (side === "before" && op === "+") continue;
    if (side === "after" && op === "-") continue;
    if (op !== runOp) { flush(); runOp = op; }
    run.push(word);
  }
  flush();
}

/* ------------------------------ note parsing ------------------------------ */

function parseTransformation(raw) {
  const body = stripFrontmatter(raw);
  const grab = (name) => {
    const match = body.match(new RegExp(`^## ${name}\\s*$`, "m"));
    if (!match) return "";
    const start = match.index + match[0].length;
    const next = body.slice(start).search(/^## /m);
    return next === -1 ? body.slice(start) : body.slice(start, start + next);
  };
  const parseSide = (text) => {
    const units = [];
    const parts = text.split(/^### /m).slice(1);
    for (const part of parts) {
      const lines = part.split("\n");
      const key = lines[0].trim();
      const rest = lines.slice(1).join("\n");
      const linkMatch = rest.match(/\[\[([^\]|]+)\|[^\]]*\]\]/);
      const paragraphs = stripWikilinks(rest)
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p && !/^\[\[|^No (predecessor|successor)/.test(p))
        .filter((p) => p !== key && !p.startsWith(key));
      // Drop the leading self-link line.
      const textOnly = paragraphs.filter((p) => !p.startsWith(`${BOOK_ROOT}/`));
      units.push({ key, note: linkMatch ? linkMatch[1] : null, text: textOnly.join("\n\n") });
    }
    const empty = /_No (predecessor|successor)/.test(text);
    return { units, empty };
  };
  return { before: parseSide(grab("Before")), after: parseSide(grab("After")) };
}

function parseLineage(raw) {
  const body = stripFrontmatter(raw);
  const members = [];
  const sections = body.split(/^## /m).slice(1);
  const transformations = [];
  for (const section of sections) {
    const lines = section.split("\n");
    const heading = lines[0].trim();
    if (heading.startsWith("Transformations")) {
      for (const line of lines.slice(1)) {
        const match = line.match(/\[\[([^\]|]+)/);
        if (match) transformations.push(match[1]);
      }
      continue;
    }
    const headMatch = heading.match(/^(.+?):\s*(U\d+)/);
    if (!headMatch) continue;
    const rest = lines.slice(1).join("\n");
    const linkMatch = rest.match(/\[\[([^\]|]+)\|([^\]]*)\]\]/);
    const text = stripWikilinks(rest)
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p, idx) => !(idx === 0 && linkMatch && p === linkMatch[2]))
      .join("\n\n");
    members.push({
      label: headMatch[1].trim(),
      unit: headMatch[2],
      note: linkMatch ? linkMatch[1] : null,
      editionTitle: linkMatch ? linkMatch[2] : headMatch[1].trim(),
      text,
    });
  }
  return { members, transformations };
}

/* --------------------------- decision persistence ------------------------- */

function paneTexts(text) {
  return text ? text.split(/\n{2,}/) : [];
}

const SENTENCE_KINDS = new Set(["paragraph", "blockquote", "heading"]);
// Match the terminal mark itself so this fallback remains parseable on iOS
// versions whose JavaScript engine does not support regular-expression
// lookbehind. Builder-supplied schema-v2 spans remain authoritative.
const LEGACY_SENTENCE_BOUNDARY = /[.!?](["'”’)\]]*)\s+/g;
const SENTENCE_ABBREVIATIONS = new Set([
  "capt", "ch", "col", "dr", "etc", "fig", "fr", "gen", "inc", "jr",
  "lt", "mr", "mrs", "ms", "no", "pp", "prof", "rep", "rev", "sen",
  "sgt", "sr", "st", "vol", "vs",
]);
const SENTENCE_OPENERS = new Set(Array.from("*_~`([{<\"'“‘—–->#!"));

function startsLegacySentence(text) {
  let candidate = String(text || "").trimStart();
  while (candidate && SENTENCE_OPENERS.has(Array.from(candidate)[0])) {
    candidate = Array.from(candidate).slice(1).join("").trimStart();
  }
  if (!candidate) return false;
  const first = Array.from(candidate)[0];
  return /[\p{Lu}\p{Lt}\p{N}]/u.test(first);
}

function paneBlocks(text) {
  const value = String(text || "");
  if (!value) return [];
  const blocks = [];
  let startUtf16 = 0;
  for (const boundary of value.matchAll(/\n{2,}/g)) {
    blocks.push({
      start: codePointLength(value.slice(0, startUtf16)),
      end: codePointLength(value.slice(0, boundary.index)),
      text: value.slice(startUtf16, boundary.index),
    });
    startUtf16 = boundary.index + boundary[0].length;
  }
  blocks.push({
    start: codePointLength(value.slice(0, startUtf16)),
    end: codePointLength(value),
    text: value.slice(startUtf16),
  });
  return blocks;
}

function falseLegacySentenceBoundary(text, boundary) {
  const before = text.slice(0, boundary.index + 1);
  const after = text.slice(boundary.index + boundary[0].length);
  if (!before || !after || !before.endsWith(".")) return false;
  if (before.endsWith("...")) return false;
  if (/\d\.$/.test(before) && /^\d/.test(after)) return true;
  if (/(?:\b[A-Za-z]\.){2,}$/.test(before)) return true;
  const token = before.match(/\b([A-Za-z]+)\.$/);
  if (!token) return false;
  const word = token[1];
  return SENTENCE_ABBREVIATIONS.has(word.toLowerCase()) ||
    (word.length === 1 && word === word.toUpperCase());
}

function legacySentenceSpans(pane, blocks) {
  const result = [];
  blocks.forEach((block, unitIndex) => {
    const kind = (pane.unit_kinds || [])[unitIndex] || "paragraph";
    if (!SENTENCE_KINDS.has(kind)) return;
    const unit = (pane.units || [])[unitIndex] || `${pane.edition}:legacy-${unitIndex + 1}`;
    let startUtf16 = 0;
    let sentenceIndex = 1;
    const fingerprintOccurrences = new Map();
    const legacySentenceId = (fingerprint) => {
      const occurrence = (fingerprintOccurrences.get(fingerprint) || 0) + 1;
      fingerprintOccurrences.set(fingerprint, occurrence);
      return (
        `${unit}:H${fingerprint}:O${String(occurrence).padStart(3, "0")}:` +
        fingerprint
      );
    };
    for (const boundary of block.text.matchAll(LEGACY_SENTENCE_BOUNDARY)) {
      if (!startsLegacySentence(
        block.text.slice(boundary.index + boundary[0].length)
      )) continue;
      if (falseLegacySentenceBoundary(block.text, boundary)) continue;
      const rawEnd = boundary.index + 1 + String(boundary[1] || "").length;
      const raw = block.text.slice(startUtf16, rawEnd);
      const leading = codePointLength(raw) - codePointLength(raw.trimStart());
      const trailing = codePointLength(raw.trimEnd());
      if (leading < trailing) {
        const localStart =
          codePointLength(block.text.slice(0, startUtf16)) + leading;
        const localEnd =
          codePointLength(block.text.slice(0, startUtf16)) + trailing;
        const exact = sliceCodePoints(block.text, localStart, localEnd);
        const fingerprint = sentenceFingerprint(exact);
        result.push({
          id: legacySentenceId(fingerprint),
          unit,
          unit_index: unitIndex,
          sentence_index: sentenceIndex,
          start: block.start + localStart,
          end: block.start + localEnd,
          fingerprint,
          legacy: true,
        });
        sentenceIndex += 1;
      }
      startUtf16 = boundary.index + boundary[0].length;
    }
    const raw = block.text.slice(startUtf16);
    const leading = codePointLength(raw) - codePointLength(raw.trimStart());
    const trailing = codePointLength(raw.trimEnd());
    if (leading < trailing) {
      const localStart =
        codePointLength(block.text.slice(0, startUtf16)) + leading;
      const localEnd =
        codePointLength(block.text.slice(0, startUtf16)) + trailing;
      const exact = sliceCodePoints(block.text, localStart, localEnd);
      const fingerprint = sentenceFingerprint(exact);
      result.push({
        id: legacySentenceId(fingerprint),
        unit,
        unit_index: unitIndex,
        sentence_index: sentenceIndex,
        start: block.start + localStart,
        end: block.start + localEnd,
        fingerprint,
        legacy: true,
      });
    }
  });
  return result;
}

function sentenceSpansForPane(pane, blocks) {
  if (!Array.isArray(pane.sentence_spans)) return legacySentenceSpans(pane, blocks);
  return pane.sentence_spans.filter((span) => (
    span &&
    typeof span.id === "string" &&
    typeof span.unit === "string" &&
    Number.isInteger(span.start) &&
    Number.isInteger(span.end) &&
    span.start >= 0 &&
    span.end > span.start &&
    span.end <= codePointLength(pane.text) &&
    typeof span.fingerprint === "string" &&
    span.offset_unit === "unicode-code-point" &&
    span.id.endsWith(`:${span.fingerprint}`) &&
    sentenceFingerprint(sliceCodePoints(pane.text, span.start, span.end)) ===
      span.fingerprint &&
    span.text_sha256 === sha256Id(
      sliceCodePoints(pane.text, span.start, span.end)
    ) &&
    Array.isArray(span.tokens) &&
    JSON.stringify(span.tokens) === JSON.stringify(wordTokens(
      sliceCodePoints(pane.text, span.start, span.end),
      span.id,
    ))
  ));
}

function rangeOffsets(root, range) {
  try {
    const startRange = root.ownerDocument.createRange();
    startRange.selectNodeContents(root);
    startRange.setEnd(range.startContainer, range.startOffset);
    const endRange = root.ownerDocument.createRange();
    endRange.selectNodeContents(root);
    endRange.setEnd(range.endContainer, range.endOffset);
    return {
      start: codePointLength(startRange.toString()),
      end: codePointLength(endRange.toString()),
    };
  } catch (_error) {
    return null;
  }
}

function phraseSelector(sentenceText, start, end) {
  return {
    start,
    end,
    exact: sliceCodePoints(sentenceText, start, end),
    prefix: sliceCodePoints(sentenceText, Math.max(0, start - 32), start),
    suffix: sliceCodePoints(
      sentenceText, end, Math.min(codePointLength(sentenceText), end + 32)
    ),
  };
}

/* ----------------------------- ranked metrics ---------------------------- */

// Shared with the FirstPair Reader (shared/metrics.js).
const metricsCore = require("../shared/metrics");
const { formatMetric, metricSeverity, parseMetrics, worstFirst } = metricsCore;
const metricText = (metric, field) => metricsCore.metricText(metric, field, uiLanguage);

// Shared with the FirstPair Reader: the transactional ledger and voice notes.
const { DecisionStore } = require("../shared/ledger-store")({
  normalizePath,
  notifyUnreadable: () => new Notice(t("ledger_unreadable")),
});
const voiceCore = require("../shared/voice-core")({
  Notice, Platform, normalizePath, requestUrl, t: (key, vars) => t(key, vars),
});
const { ensureFolder, sha256Bytes, DEFAULT_MLX_MODEL } = voiceCore;
// The span editor every FirstPair reader shares: word picker, coloured spans,
// chooser, overlap limit, saved rows.
const editor = require("../shared/span-editor")({
  Notice, Platform, t: (key, vars) => t(key, vars), actionLabel: (action) => actionLabel(action),
});
const { isTouchDevice } = editor;
// Precomputed edition diffs every FirstPair reader shares (shared/diff-view.js).
const diffView = require("../shared/diff-view");
// Left/Right arrows turn pages on a hardware keyboard (shared/page-keys.js).
const { bindPageKeys } = require("../shared/page-keys");
// One Back/Forward history per pane, across Reader, Review, and notes
// (shared/nav-history.js).
const { NavHistory, historyRegistry } = require("../shared/nav-history");

class FirstPairTriptychReaderView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.reader = null;
    this.state = {
      mode: "contents",
      setId: "",
      partId: "",
      key: "",
    };
    this.scrollEl = null;
    this.backControl = null;
    this.forwardControl = null;
    this.renderToken = 0;
  }

  getViewType() {
    return READER_VIEW_TYPE;
  }

  getIcon() {
    return "book-open";
  }

  getDisplayText() {
    if (!this.reader) return t("reader_name");
    if (this.state.mode === "set" || this.state.mode === "part") {
      const set = this.reader.setById.get(this.state.setId);
      const part = set && set.partById.get(this.state.partId);
      return this.state.mode === "part" && part
        ? part.title
        : set
        ? set.title
        : this.reader.title;
    }
    if (this.state.mode === "fragment") {
      const page = this.reader.pageByKey.get(this.state.key);
      return page ? page.title : this.reader.title;
    }
    return this.reader.title;
  }

  getState() {
    return { ...this.state };
  }

  async setState(next, result) {
    if (typeof super.setState === "function") await super.setState(next, result);
    if (this.plugin.ready) await this.plugin.ready;
    // Whoever opened this state recorded where the pane was; the pane's
    // history survives the switch, so Back returns there.
    this.updateBackControl();
    this.state = this.plugin.normalizeReaderState(next, this.reader);
    if (this.reader) await this.renderReader({ scrollTop: 0, focus: false });
  }

  async onOpen() {
    if (this.plugin.ready) await this.plugin.ready;
    bindPageKeys(this, {
      previous: () => this.goPrevious(),
      next: () => this.goNext(),
      isActive: () => this.app.workspace.activeLeaf === this.leaf && Boolean(this.reader),
    });
    try {
      this.reader = await this.plugin.loadReaderIndex();
      this.state = this.plugin.normalizeReaderState(this.state, this.reader);
      await this.renderReader({ scrollTop: 0, focus: false });
    } catch (error) {
      console.error("firstpair-triptych: Reader open failed", error);
      this.contentEl.empty();
      this.contentEl.createEl("h1", { text: t("reader_name") });
      this.contentEl.createEl("p", {
        cls: "lt-reader-error",
        text: error.message,
      });
      new Notice(t("reader_open_failed", { error: error.message }), 10000);
    }
  }

  async onClose() {
    this.renderToken += 1;
    if (this.unsubscribeHistory) this.unsubscribeHistory();
  }

  // The pane's shared history (a private one when no plugin supplies it).
  navHistory() {
    if (this.plugin && typeof this.plugin.historyFor === "function" && this.leaf) {
      const history = this.plugin.historyFor(this.leaf);
      if (this.subscribedHistory !== history) {
        if (this.unsubscribeHistory) this.unsubscribeHistory();
        this.unsubscribeHistory = history.subscribe(() => this.updateBackControl());
        this.subscribedHistory = history;
      }
      return history;
    }
    if (!this.localHistory) this.localHistory = new NavHistory(READER_HISTORY_LIMIT);
    return this.localHistory;
  }

  saveLayout() {
    if (this.app.workspace && typeof this.app.workspace.requestSaveLayout === "function") {
      this.app.workspace.requestSaveLayout();
    }
  }

  captureLocation() {
    return {
      view: "reader",
      state: { ...this.state },
      scrollTop: Number(this.scrollEl && this.scrollEl.scrollTop) || 0,
    };
  }

  pushHistory(location = this.captureLocation()) {
    this.navHistory().visit(location);
    this.updateBackControl();
  }

  updateBackControl() {
    const history = this.navHistory();
    if (this.backControl) this.backControl.disabled = !history.canBack();
    if (this.forwardControl) this.forwardControl.disabled = !history.canForward();
  }

  restoreScroll(scrollTop) {
    const top = Math.max(0, Number(scrollTop) || 0);
    const apply = () => {
      if (!this.scrollEl) return;
      if (typeof this.scrollEl.scrollTo === "function") {
        this.scrollEl.scrollTo({ top, behavior: "auto" });
      } else {
        this.scrollEl.scrollTop = top;
      }
    };
    apply();
    if (typeof window !== "undefined" && window.requestAnimationFrame) {
      window.requestAnimationFrame(apply);
    }
  }

  async navigate(next, recordHistory = true, scrollTop = 0) {
    const target = this.plugin.normalizeReaderState(
      { ...this.state, ...next },
      this.reader
    );
    if (recordHistory && JSON.stringify(target) !== JSON.stringify(this.state)) {
      this.pushHistory();
    }
    this.state = target;
    await this.renderReader({ scrollTop, focus: scrollTop === 0 });
    this.saveLayout();
  }

  async goBack() {
    const prior = this.navHistory().back(this.captureLocation());
    if (prior) await this.showLocation(prior);
  }

  async goForward() {
    const next = this.navHistory().forward(this.captureLocation());
    if (next) await this.showLocation(next);
  }

  // A history entry: a Reader place here, anything else through the plugin
  // (Review, a note), in this same pane.
  async showLocation(location) {
    if (location.view && location.view !== "reader") {
      await this.plugin.showLocation(this.leaf, location);
      return;
    }
    this.state = this.plugin.normalizeReaderState(location.state, this.reader);
    await this.renderReader({ scrollTop: location.scrollTop, focus: false });
    this.saveLayout();
  }

  currentSet() {
    if (!this.reader) return null;
    if (this.state.mode === "fragment") {
      const page = this.reader.pageByKey.get(this.state.key);
      return page ? this.reader.setById.get(page.setId) : null;
    }
    return this.reader.setById.get(this.state.setId) || null;
  }

  currentPage() {
    return this.reader && this.reader.pageByKey.get(this.state.key);
  }

  neighbors() {
    const page = this.state.mode === "fragment" && this.currentPage();
    const set = page && this.reader.setById.get(page.setId);
    return {
      previous: page && set && page.index > 0
        ? set.pages[page.index - 1]
        : null,
      next: page && set && page.index + 1 < set.pages.length
        ? set.pages[page.index + 1]
        : null,
    };
  }

  async goPrevious() {
    const page = this.currentPage();
    const set = page && this.reader.setById.get(page.setId);
    if (this.state.mode === "fragment" && set && page.index > 0) {
      const previous = set.pages[page.index - 1];
      await this.navigate({ mode: "fragment", setId: set.id, key: previous.key });
    }
  }

  async goNext() {
    const page = this.currentPage();
    const set = page && this.reader.setById.get(page.setId);
    if (this.state.mode === "fragment" && set && page.index + 1 < set.pages.length) {
      const next = set.pages[page.index + 1];
      await this.navigate({ mode: "fragment", setId: set.id, key: next.key });
    }
  }

  async goUp() {
    if (this.state.mode === "fragment") {
      const page = this.currentPage();
      if (page) {
        await this.navigate({
          mode: "part",
          setId: page.setId,
          partId: page.part_id,
          key: page.key,
        });
      }
    } else if (this.state.mode === "part") {
      await this.navigate({
        mode: "set",
        partId: "",
      });
    } else if (this.state.mode === "set") {
      await this.navigate({
        mode: "contents",
        setId: "",
        partId: "",
        key: "",
      });
    }
  }

  async showContents() {
    if (this.state.mode === "fragment") {
      const page = this.currentPage();
      if (page) {
        await this.navigate({
          mode: "part",
          setId: page.setId,
          partId: page.part_id,
          key: page.key,
        });
      }
    } else if (this.state.mode === "set") {
      await this.navigate({
        mode: "contents",
        setId: "",
        partId: "",
        key: "",
      });
    }
  }

  goTop(recordHistory = true) {
    if (this.scrollEl) {
      if (recordHistory && Number(this.scrollEl.scrollTop) > 0) {
        this.pushHistory();
      }
      if (typeof this.scrollEl.scrollTo === "function") {
        this.scrollEl.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        this.scrollEl.scrollTop = 0;
      }
    }
    const heading = this.contentEl.querySelector("h1");
    if (heading && typeof heading.focus === "function") {
      heading.focus({ preventScroll: true });
    }
  }

  progressText() {
    if (!this.reader) return "";
    if (this.state.mode === "fragment") {
      const page = this.currentPage();
      const set = page && this.reader.setById.get(page.setId);
      return page && set
        ? `${set.title} · ${page.order}/${set.pages.length}`
        : this.reader.title;
    }
    if (this.state.mode === "set" || this.state.mode === "part") {
      const set = this.currentSet();
      if (!set) return this.reader.title;
      if (this.state.mode === "part") {
        const part = set.partById.get(this.state.partId);
        if (!part) return set.title;
        const count = set.pages.filter(
          (page) => page.part_id === part.id
        ).length;
        return `${part.title} · ${tc(count, "fragment")}`;
      }
      return `${set.title} · ${tc(set.pages.length, "fragment")}`;
    }
    const total = this.reader.sets.reduce((sum, set) => sum + set.pages.length, 0);
    return `${tc(this.reader.sets.length, "set")} · ${tc(total, "fragment")}`;
  }

  addControl(container, label, action, disabled, destination = "") {
    const controlClass = label.toLocaleLowerCase();
    const shownLabel = t(`nav_${label}`);
    const accessibleLabel = destination
      ? `${shownLabel}: ${destination}`
      : shownLabel;
    const button = container.createEl("button", {
      cls:
        "lt-reader-control clickable-icon " +
        `lt-reader-control-${controlClass}`,
      attr: {
        type: "button",
        title: accessibleLabel,
        "aria-label": accessibleLabel,
      },
    });
    const icon = button.createSpan({
      cls: "lt-reader-control-icon",
      attr: { "aria-hidden": "true" },
    });
    setIcon(icon, READER_ICONS[label]);
    const copy = button.createSpan({ cls: "lt-reader-control-copy" });
    copy.createSpan({ cls: "lt-reader-control-label", text: shownLabel });
    if (destination) {
      copy.createSpan({
        cls: "lt-reader-control-destination",
        text: destination,
      });
    }
    button.disabled = Boolean(disabled);
    button.addEventListener("click", () => void action());
    return button;
  }

  renderBar(container) {
    const adjacent = this.neighbors();
    const bar = container.createDiv({
      cls: "lt-reader-bar lt-reader-bar-top",
      attr: { role: "navigation", "aria-label": t("reader_nav_aria") },
    });
    const controls = bar.createDiv({ cls: "lt-reader-controls" });
    this.addControl(
      controls,
      "Previous",
      () => this.goPrevious(),
      !adjacent.previous,
      adjacent.previous ? adjacent.previous.title : t("start_of_set")
    );
    this.addControl(
      controls,
      "Up",
      () => this.goUp(),
      this.state.mode === "contents"
    );
    const history = this.navHistory();
    this.backControl = this.addControl(
      controls,
      "Back",
      () => this.goBack(),
      !history.canBack()
    );
    this.forwardControl = this.addControl(
      controls,
      "Forward",
      () => this.goForward(),
      !history.canForward()
    );
    this.addControl(controls, "Top", () => this.goTop(), false);
    this.addControl(
      controls,
      "TOC",
      () => this.showContents(),
      ["contents", "part"].includes(this.state.mode)
    );
    this.addControl(
      controls,
      "Next",
      () => this.goNext(),
      !adjacent.next,
      adjacent.next ? adjacent.next.title : t("end_of_set")
    );
    const review = bar.createEl("button", {
      cls: "lt-reader-review-link",
      text: t("review"),
      attr: {
        type: "button",
        title: t("review_title_attr"),
      },
    });
    review.addEventListener("click", () => void this.plugin.openReview(this.leaf));
    bar.createDiv({
      cls: "lt-reader-progress",
      text: this.progressText(),
      attr: { role: "status", "aria-live": "polite" },
    });
  }

  addSetButton(container, set) {
    const button = container.createEl("button", {
      cls: "lt-reader-list-button",
      attr: {
        type: "button",
        "aria-label": t("open_named", { name: set.title }),
      },
    });
    const copy = button.createDiv();
    copy.createDiv({ cls: "lt-reader-list-title", text: set.title });
    copy.createDiv({
      cls: "lt-reader-list-meta",
      text: tc(set.pages.length, "fragment"),
    });
    const arrow = button.createSpan({
      cls: "lt-reader-list-arrow",
      attr: { "aria-hidden": "true" },
    });
    setIcon(arrow, "arrow-right");
    button.addEventListener("click", () => void this.navigate({
      mode: "set",
      setId: set.id,
      partId: "",
      key: "",
    }));
  }

  renderContents(container) {
    const panel = container.createDiv({ cls: "lt-reader-panel" });
    panel.createEl("h1", {
      text: this.reader.title,
      attr: { tabindex: "-1" },
    });
    panel.createEl("p", {
      cls: "lt-reader-kicker",
      text: t("choose_set"),
    });
    const list = panel.createDiv({ cls: "lt-reader-list" });
    for (const set of this.reader.sets) this.addSetButton(list, set);
  }

  renderSetContents(container) {
    const set = this.currentSet();
    if (!set) throw new Error("unknown triptych Reader set");
    const panel = container.createDiv({ cls: "lt-reader-panel" });
    panel.createEl("p", {
      cls: "lt-reader-kicker",
      text: tc(set.pages.length, "fragment"),
    });
    panel.createEl("h1", { text: set.title, attr: { tabindex: "-1" } });
    if (set.description) panel.createEl("p", { text: set.description });
    const current = this.currentPage();
    const list = panel.createDiv({ cls: "lt-reader-list" });
    for (const part of set.parts) {
      const pages = set.pages.filter((page) => page.part_id === part.id);
      const isCurrent = Boolean(
        current && current.part_id === part.id
      );
      const button = list.createEl("button", {
        cls:
          "lt-reader-list-button" +
          (isCurrent ? " is-current" : ""),
        attr: {
          type: "button",
          "aria-label": t("open_named", { name: part.title }),
          ...(isCurrent ? { "aria-current": "location" } : {}),
        },
      });
      const copy = button.createDiv();
      copy.createDiv({ cls: "lt-reader-list-title", text: part.title });
      copy.createDiv({
        cls: "lt-reader-list-meta",
        text: tc(pages.length, "fragment"),
      });
      const arrow = button.createSpan({
        cls: "lt-reader-list-arrow",
        attr: { "aria-hidden": "true" },
      });
      setIcon(arrow, "arrow-right");
      button.addEventListener("click", () => void this.navigate({
        mode: "part",
        setId: set.id,
        partId: part.id,
        key: isCurrent ? current.key : "",
      }));
    }
  }

  renderPartContents(container) {
    const set = this.currentSet();
    if (!set) throw new Error("unknown triptych Reader set");
    const part = set.partById.get(this.state.partId);
    if (!part) throw new Error("unknown triptych Reader part");
    const pages = set.pages.filter(
      (page) => page.part_id === part.id
    );
    if (!pages.length) throw new Error("unknown triptych Reader part");
    const panel = container.createDiv({ cls: "lt-reader-panel" });
    panel.createEl("p", {
      cls: "lt-reader-kicker",
      text: `${set.title} · ${tc(pages.length, "fragment")}`,
    });
    panel.createEl("h1", {
      text: part.title,
      attr: { tabindex: "-1" },
    });
    const list = panel.createEl("ol", { cls: "lt-reader-page-list" });
    for (const page of pages) {
      const item = list.createEl("li");
      const isCurrent = page.key === this.state.key;
      const button = item.createEl("button", {
        cls:
          "lt-reader-page-button" +
          (isCurrent ? " is-current" : ""),
        attr: {
          type: "button",
          "aria-label": t("open_fragment", { order: page.order, title: page.title }),
          ...(isCurrent ? { "aria-current": "page" } : {}),
        },
      });
      button.createSpan({
        cls: "lt-reader-page-number",
        text: String(page.order).padStart(4, "0"),
      });
      button.createSpan({ text: page.title });
      button.addEventListener("click", () => void this.navigate({
        mode: "fragment",
        setId: set.id,
        partId: page.part_id,
        key: page.key,
      }));
    }
  }

  async renderFragment(container, token) {
    const page = this.currentPage();
    if (!page) throw new Error("unknown triptych Reader fragment");
    const set = this.reader.setById.get(page.setId);
    const file = this.app.vault.getAbstractFileByPath(
      normalizePath(`${page.note}.md`)
    );
    if (!file) throw new Error(`missing triptych note: ${page.note}.md`);
    const raw = await this.app.vault.cachedRead(file);
    if (token !== this.renderToken) return;
    const payload = validateIndexedTriptychPayload(
      extractTriptychPayload(raw), `${page.note}.md`, this.reader
    );
    await this.plugin.rememberEditions(payload);
    if (token !== this.renderToken) return;
    const part = set.partById.get(page.part_id);
    const article = container.createEl("article", { cls: "lt-reader-fragment" });
    article.createEl("p", {
      cls: "lt-reader-kicker",
      text: [set && set.title, part && part.title].filter(Boolean).join(" · "),
    });
    article.createEl("h1", { text: page.title, attr: { tabindex: "-1" } });
    const mount = article.createDiv({ cls: "lt-reader-triptych-mount" });
    await this.plugin.renderTriptych(payload, mount);
  }

  async renderReader(options = {}) {
    if (!this.reader) return;
    const token = ++this.renderToken;
    const scrollTop = Math.max(0, Number(options.scrollTop) || 0);
    this.backControl = null;
    this.forwardControl = null;
    this.contentEl.empty();
    this.contentEl.addClass("lt-reader-view");
    const shell = this.contentEl.createDiv({ cls: "lt-reader-shell" });
    this.renderBar(shell);
    const content = shell.createDiv({ cls: "lt-reader-content" });
    this.scrollEl = content;
    try {
      if (this.state.mode === "contents") this.renderContents(content);
      else if (this.state.mode === "set") this.renderSetContents(content);
      else if (this.state.mode === "part") this.renderPartContents(content);
      else await this.renderFragment(content, token);
    } catch (error) {
      console.error("firstpair-triptych: Reader render failed", error);
      content.empty();
      content.createEl("h1", {
        text: t("reader_name"),
        attr: { tabindex: "-1" },
      });
      content.createEl("p", { cls: "lt-reader-error", text: error.message });
    }
    if (token !== this.renderToken) return;
    this.restoreScroll(scrollTop);
    if (options.focus !== false && scrollTop === 0) {
      const heading = content.querySelector("h1");
      if (heading && typeof heading.focus === "function") {
        heading.focus({ preventScroll: true });
      }
    }
  }
}

class FirstPairTriptychReviewView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.reader = null;
    // Review's own place: the compared pair and which rules show their pages.
    this.reviewState = { pair: "", expanded: [] };
    this.pendingScroll = 0;
    this.renderSeq = 0;
  }

  getViewType() {
    return REVIEW_VIEW_TYPE;
  }

  getIcon() {
    return "list-checks";
  }

  getDisplayText() {
    return this.reader
      ? t("review_display", { title: this.reader.title })
      : t("review_heading");
  }

  async onOpen() {
    if (this.plugin.ready) await this.plugin.ready;
    await this.renderReview();
  }

  getState() {
    return { review: { ...this.reviewState } };
  }

  async setState(next, result) {
    if (typeof super.setState === "function") await super.setState(next, result);
    if (this.plugin.ready) await this.plugin.ready;
    const review = next && next.review ? next.review : null;
    const scrollTop = next && Number(next.scrollTop) || 0;
    if (review || scrollTop) {
      if (review) {
        this.reviewState = {
          pair: String(review.pair || ""),
          expanded: Array.isArray(review.expanded) ? review.expanded.map(String) : [],
        };
      }
      this.pendingScroll = scrollTop;
      await this.renderReview();
    }
  }

  async onClose() {
    if (this.unsubscribeHistory) this.unsubscribeHistory();
  }

  scroller() {
    return this.contentEl.querySelector(".lt-review-content");
  }

  captureLocation() {
    const scroller = this.scroller();
    return {
      view: "review",
      state: { pair: this.reviewState.pair, expanded: [...this.reviewState.expanded] },
      scrollTop: Number(scroller && scroller.scrollTop) || 0,
    };
  }

  navHistory() {
    const history = this.plugin.historyFor(this.leaf);
    if (this.subscribedHistory !== history) {
      if (this.unsubscribeHistory) this.unsubscribeHistory();
      this.unsubscribeHistory = history.subscribe(() => this.updateNavButtons());
      this.subscribedHistory = history;
    }
    return history;
  }

  updateNavButtons() {
    const history = this.navHistory();
    if (this.backButton) this.backButton.disabled = !history.canBack();
    if (this.forwardButton) this.forwardButton.disabled = !history.canForward();
  }

  async goBack() {
    const prior = this.navHistory().back(this.captureLocation());
    if (prior) await this.plugin.showLocation(this.leaf, prior);
  }

  async goForward() {
    const next = this.navHistory().forward(this.captureLocation());
    if (next) await this.plugin.showLocation(this.leaf, next);
  }

  pageChoices(ledger, key) {
    return {
      decision: ledger.decisions[key] || null,
      sentences: Object.values(ledger.sentence_preferences).filter(
        (record) => record.fragment_key === key,
      ),
      phrases: Object.values(ledger.phrase_annotations).filter(
        (record) => record.fragment_key === key,
      ),
    };
  }

  renderChoiceSummary(container, choices) {
    if (choices.decision) {
      const parts = [];
      if (choices.decision.preferred) {
        parts.push(t("overall_prefer", { edition: choices.decision.preferred }));
      }
      if (choices.decision.note) parts.push(t("note_prefix", { note: choices.decision.note }));
      if (parts.length) container.createEl("p", { text: parts.join(" · ") });
    }
    if (choices.sentences.length) {
      container.createEl("p", {
        text: tc(choices.sentences.length, "preferred_sentence"),
      });
    }
    if (choices.phrases.length) {
      const list = container.createEl("ul", { cls: "lt-review-phrase-list" });
      for (const record of choices.phrases) {
        const preferred = preferredCorrectionVariant(record);
        const suffix = preferred ? ` → ${preferred.text}` : "";
        list.createEl("li", {
          text: `${actionLabel(record.action).toLocaleUpperCase()} · ${record.edition_title || record.edition}: “${record.exact}”${suffix}`,
        });
      }
    }
  }

  // Book-wide rules and the per-Part heat map for one pair of editions,
  // drawn by the shared diff module; rule decisions go to the ledger.
  renderEditRules(content, context, ledger) {
    const diffs = this.plugin.diffs;
    const pairs = diffView.pairKeys(diffs);
    const editions = diffs.editions;
    const latest = editions.length > 1 ? `${editions[editions.length - 2]}|${editions[editions.length - 1]}` : pairs[0];
    let pair = [this.reviewState.pair, this.plugin.settings.rulesPair, latest]
      .find((key) => pairs.includes(key)) || latest;
    this.reviewState.pair = pair;
    const editionName = (id) => this.plugin.settings.knownEditions[id] || id;
    const pairName = (key) => key.split("|").map(editionName).join(" → ");
    const section = content.createDiv({ cls: "fp-rules-section" });
    const controls = section.createDiv({ cls: "lt-rank-controls" });
    controls.createSpan({ cls: "lt-chips-label", text: t("rules_pair") });
    const select = controls.createEl("select", { cls: "dropdown", attr: { "aria-label": t("rules_pair") } });
    for (const key of pairs) select.createEl("option", { value: key, text: pairName(key) });
    select.value = pair;
    const body = section.createDiv();
    const parts = this.reader.sets[0] ? this.reader.sets[0].parts : [];
    const firstPageOfPart = (part) => this.reader.sets.flatMap((set) => set.pages)
      .find((page) => page.part_id === part.id);
    const draw = () => {
      body.empty();
      body.createEl("h2", { text: t("heat_heading") });
      body.createEl("p", { cls: "lt-review-explanation", text: t("heat_explain") });
      diffView.renderSummary(body, diffs, pair, {
        t, parts,
        onOpenPart: (part) => {
          const page = firstPageOfPart(part);
          if (page) void this.plugin.openReader({ mode: "fragment", key: page.key }, this.leaf);
        },
      });
      body.createEl("h2", { text: t("rules_heading") });
      body.createEl("p", { cls: "lt-review-explanation", text: t("rules_explain") });
      diffView.renderRules(body, diffs, pair, {
        t,
        expanded: new Set(this.reviewState.expanded),
        onToggle: (ruleId, open) => {
          const expanded = new Set(this.reviewState.expanded);
          if (open) expanded.add(ruleId);
          else expanded.delete(ruleId);
          this.reviewState.expanded = [...expanded];
        },
        decisions: ruleDecisionMap(ledger),
        pageTitle: (key) => (this.reader.pageByKey.get(key) || {}).title || key,
        onOpen: (key) => void this.plugin.openReader({ mode: "fragment", key }, this.leaf),
        onDecide: async (rule, decision) => {
          try {
            ledger = await this.plugin.store.update(context, (current) => setRuleDecision(current, rule, pair, decision));
            new Notice(t("rules_saved"));
            draw();
          } catch (error) {
            console.error("firstpair-triptych: rule save failed", error);
            new Notice(t("rules_save_failed", { error: error.message || error }));
          }
        },
      });
    };
    select.addEventListener("change", async () => {
      pair = select.value;
      this.reviewState = { pair, expanded: [] };
      this.plugin.settings.rulesPair = pair;
      await this.plugin.saveSettings();
      draw();
    });
    draw();
  }

  async renderReview() {
    // onOpen and setState both render; only the latest render may draw.
    const seq = ++this.renderSeq;
    this.contentEl.empty();
    this.contentEl.addClass("lt-review-view");
    try {
      this.reader = await this.plugin.loadReaderIndex();
      const context = {
        projectId: this.reader.project_id,
        sourceContentId: this.reader.source_content_id,
      };
      let ledger = await this.plugin.store.load(context);
      if (seq !== this.renderSeq) return;
      this.contentEl.empty();
      const shell = this.contentEl.createDiv({ cls: "lt-review-shell" });
      const bar = shell.createDiv({
        cls: "lt-review-bar",
        attr: { role: "navigation", "aria-label": t("review_nav_aria") },
      });
      this.backButton = bar.createEl("button", {
        cls: "lt-review-back",
        text: `← ${t("nav_Back")}`,
        attr: { type: "button", title: t("review_back_title") },
      });
      this.backButton.addEventListener("click", () => void this.goBack());
      this.forwardButton = bar.createEl("button", {
        cls: "lt-review-forward",
        text: `${t("nav_Forward")} →`,
        attr: { type: "button" },
      });
      this.forwardButton.addEventListener("click", () => void this.goForward());
      this.updateNavButtons();
      const readerButton = bar.createEl("button", {
        text: t("reader_button"),
        attr: { type: "button" },
      });
      readerButton.addEventListener("click", () => void this.plugin.openReader(null, this.leaf));
      const refresh = bar.createEl("button", {
        text: t("refresh"),
        attr: { type: "button" },
      });
      refresh.addEventListener("click", () => void this.renderReview());
      bar.createSpan({
        cls: "lt-review-status",
        text: tc(reviewChoiceCount(ledger), "saved_choice"),
      });
      const content = shell.createDiv({ cls: "lt-review-content" });
      content.createEl("h1", { text: t("review_heading"), attr: { tabindex: "-1" } });
      content.createEl("p", {
        cls: "lt-review-explanation",
        text: t("review_explanation"),
      });
      const touched = new Set(touchedFragmentKeys(ledger));
      const pages = this.reader.sets.flatMap((set) => set.pages)
        .filter((page) => touched.has(page.key));
      content.createEl("h2", { text: t("edited_pages") });
      if (!pages.length) {
        content.createEl("p", { text: t("no_pages") });
      } else {
        const list = content.createDiv({ cls: "lt-review-page-list" });
        for (const page of pages) {
          const card = list.createEl("article", { cls: "lt-review-page-card" });
          const heading = card.createEl("button", {
            cls: "lt-review-page-link",
            text: page.title,
            attr: { type: "button" },
          });
          heading.addEventListener("click", () => void this.plugin.openReader({
            mode: "fragment",
            key: page.key,
          }, this.leaf));
          card.createEl("code", { text: page.key });
          this.renderChoiceSummary(card, this.pageChoices(ledger, page.key));
        }
      }
      const known = new Set(this.reader.pageByKey.keys());
      const unavailable = [...touched].filter((key) => !known.has(key));
      if (unavailable.length) {
        content.createEl("h2", { text: t("outside_slice") });
        const list = content.createEl("ul");
        for (const key of unavailable) list.createEl("li", { text: key });
      }
      const ranked = this.plugin.rankedMetrics();
      if (ranked.length) {
        content.createEl("h2", { text: t("rank_heading") });
        content.createEl("p", { cls: "lt-review-explanation", text: t("rank_explain") });
        const controls = content.createDiv({ cls: "lt-rank-controls" });
        const select = controls.createEl("select", { cls: "dropdown", attr: { "aria-label": t("rank_by") } });
        const editionIds = [...new Set(this.reader.sets.flatMap((set) => set.edition_ids))];
        for (const metric of ranked) {
          for (const editionId of editionIds) {
            select.createEl("option", {
              value: `${metric.key}\u001f${editionId}`,
              text: `${metric.letter} · ${metricText(metric, "label")} · ${this.plugin.settings.knownEditions[editionId] || editionId}`,
            });
          }
        }
        const list = content.createEl("ol", { cls: "lt-rank-list" });
        const renderRanking = () => {
          list.empty();
          const [key, editionId] = select.value.split("\u001f");
          const metric = ranked.find((item) => item.key === key);
          const rows = this.reader.sets.flatMap((set) => set.pages)
            .map((page) => ({
              page,
              value: (((this.plugin.metrics.values[page.key] || {})[editionId]) || {})[key],
            }))
            .filter((row) => Number.isFinite(row.value))
            .sort(worstFirst(metric))
            .slice(0, 40);
          if (!rows.length) {
            list.createEl("li", { text: t("rank_none") });
            return;
          }
          for (const row of rows) {
            const item = list.createEl("li");
            const severity = metricSeverity(metric, row.value);
            item.createSpan({
              cls: `lt-metric${severity ? ` lt-metric-${severity}` : ""}`,
              text: `${metric.letter} ${formatMetric(metric, row.value)}`,
            });
            const link = item.createEl("button", {
              cls: "lt-review-page-link", text: row.page.title, attr: { type: "button" },
            });
            link.addEventListener("click", () => void this.plugin.openReader({ mode: "fragment", key: row.page.key }, this.leaf));
          }
        };
        select.addEventListener("change", renderRanking);
        renderRanking();
      }
      if (this.plugin.diffs && Object.keys(this.plugin.diffs.rules).length + Object.keys(this.plugin.diffs.summary).length) {
        this.renderEditRules(content, context, ledger);
      }
      content.createEl("h2", { text: t("edited_copy_heading") });
      content.createEl("p", { cls: "lt-review-explanation", text: t("edited_copy_explain") });
      const exports = content.createDiv({ cls: "lt-export-actions" });
      for (const set of this.reader.sets) {
        for (const editionId of set.edition_ids) {
          const edition = this.plugin.settings.knownEditions[editionId] || editionId;
          const button = exports.createEl("button", {
            text: t("export_edition", { edition, set: set.title }),
            attr: { type: "button" },
          });
          button.addEventListener("click", async () => {
            button.disabled = true;
            try {
              const result = await this.plugin.exportEditedCopy(this.reader, set, editionId);
              new Notice(t("export_done", result));
            } catch (error) {
              console.error("firstpair-triptych: export failed", error);
              new Notice(t("export_failed", { error: error.message || error }));
            } finally {
              button.disabled = false;
            }
          });
        }
      }
      content.createEl("h2", { text: t("digest_heading") });
      content.createEl("pre", {
        cls: "lt-review-digest",
        text: renderDigest(ledger),
      });
      // A return through Back/Forward lands where Review was left.
      if (this.pendingScroll) {
        const scroller = this.scroller();
        if (scroller) scroller.scrollTop = this.pendingScroll;
        this.pendingScroll = 0;
      }
    } catch (error) {
      console.error("firstpair-triptych: Review open failed", error);
      this.contentEl.createEl("h1", { text: t("review_heading") });
      this.contentEl.createEl("p", {
        cls: "lt-reader-error",
        text: error.code === "SOURCE_CONTENT_MISMATCH"
          ? t("source_mismatch")
          : t("review_could_not_open", { error: error.message || error }),
      });
      if (error.code === "SOURCE_CONTENT_MISMATCH") {
        const card = this.contentEl.createDiv({ cls: "lt-archive-card" });
        card.createEl("p", { text: t("archive_scope") });
        const button = card.createEl("button", {
          cls: "mod-cta",
          text: t("archive_button", { count: error.reviewChoiceCount || 0 }),
          attr: { type: "button" },
        });
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            const archived = await this.plugin.store.archiveMismatched();
            new Notice(t("archived_notice", { path: archived || "—" }));
            await this.renderReview();
          } catch (archiveError) {
            button.disabled = false;
            new Notice(t("review_could_not_open", { error: archiveError.message || archiveError }));
          }
        });
      }
    }
  }
}

const DEFAULT_SETTINGS = {
  editionVisibility: {},
  knownEditions: {},
  soloEdition: "",
  showDiff: false,
  diffHidden: {},
  diffLens: "all",
  rulesPair: "",
  defaultPane: "",
  metricOrder: [],
  metricHidden: {},
  transcriptionEngine: "auto",
  autoTranscribe: true,
  voiceLanguage: "",
  mlxWhisperPath: "",
  mlxModel: DEFAULT_MLX_MODEL,
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  apiModel: "whisper-1",
  enhanceLineage: true,
  enhanceTransformation: true,
  comparisonPreviews: true,
};

/* --------------------------------- plugin -------------------------------- */

module.exports = class FirstPairTriptychPlugin extends Plugin {
  async onload() {
    // Views first: Obsidian on iOS restores open tabs while onload is still
    // reading files, and a Reader or Review tab whose view type is not yet
    // registered is left as "the plugin has gone away".  The views wait for
    // `ready` before drawing.
    let markReady;
    this.ready = new Promise((resolve) => { markReady = resolve; });
    this.registerView(
      READER_VIEW_TYPE,
      (leaf) => new FirstPairTriptychReaderView(leaf, this)
    );
    this.registerView(
      REVIEW_VIEW_TYPE,
      (leaf) => new FirstPairTriptychReviewView(leaf, this)
    );
    setBookRoot(await detectBookRoot(this.app.vault.adapter));
    uiLanguage = await detectUiLanguage(this.app.vault.adapter);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.store = new DecisionStore(this.app);
    this.metrics = await this.loadMetrics();
    this.diffs = await this.loadDiffs();
    markReady();
    this.transcribing = new Set();
    this.voiceListeners = new Set();
    this.pendingRun = null;
    this.readerCache = null;
    this.readerTransition = false;
    // Obsidian mobile keeps Backlinks and Outgoing-links leaves after their
    // core plugins are switched off; a horizontal tab swipe then lands on
    // "Plugin no longer active".  Detach only those orphaned leaves.
    for (const [viewType, coreId] of [["backlink", "backlink"], ["outgoing-link", "outgoing-link"]]) {
      const core = this.app.internalPlugins && this.app.internalPlugins.getPluginById
        ? this.app.internalPlugins.getPluginById(coreId)
        : null;
      if (core && !core.enabled) this.app.workspace.detachLeavesOfType(viewType);
    }
    this.addSettingTab(new TriptychSettingTab(this.app, this));
    this.previewQueue = [];
    this.previewActive = 0;

    this.registerMarkdownCodeBlockProcessor("triptych", async (source, el, ctx) => {
      try {
        const reader = await this.loadReaderIndex();
        const payload = validateIndexedTriptychPayload(
          JSON.parse(source), ctx && ctx.sourcePath, reader
        );
        await this.rememberEditions(payload);
        await this.renderTriptych(payload, el);
        this.widenView(el);
      } catch (error) {
        console.error("firstpair-triptych: render failed", error);
        el.createEl("pre", { text: t("render_failed", { error }) });
      }
    });

    // Enhanced viewers run INSIDE Obsidian's render pipeline as a markdown
    // post-processor. This is the only lifecycle-safe way to transform a
    // rendered note: Obsidian re-invokes it on every (re-)render, so we
    // never fight the preview by mutating it from out-of-band events.
    this.registerMarkdownPostProcessor((el, ctx) => {
      const type = ctx.frontmatter && ctx.frontmatter.type;
      if (type === "comparison") {
        if (this.settings.comparisonPreviews) this.attachIncipitPreviews(el);
        return;
      }
      if (type === "lineage" && this.settings.enhanceLineage) {
        this.enhanceSection(el, ctx, "lineage");
      } else if (type === "transformation" && this.settings.enhanceTransformation) {
        this.enhanceSection(el, ctx, "transformation");
      }
    });

    this.addCommand({
      id: "open-reader",
      name: t("cmd_open_reader"),
      callback: () => this.openReader(),
    });
    this.addCommand({
      id: "open-review",
      name: t("cmd_open_review"),
      callback: () => this.openReview(),
    });
    this.addCommand({
      id: "reader-previous",
      name: t("cmd_previous"),
      callback: () => {
        const view = this.activeReaderView();
        if (view) void view.goPrevious();
      },
    });
    this.addCommand({
      id: "reader-up",
      name: t("cmd_up"),
      callback: () => {
        const view = this.activeReaderView();
        if (view) void view.goUp();
      },
    });
    this.addCommand({
      id: "reader-back",
      name: t("cmd_back"),
      callback: () => {
        const view = this.activeReaderView() || this.activeReviewView();
        if (view) void view.goBack();
      },
    });
    this.addCommand({
      id: "reader-forward",
      name: t("cmd_forward"),
      callback: () => {
        const view = this.activeReaderView() || this.activeReviewView();
        if (view) void view.goForward();
      },
    });
    this.addCommand({
      id: "reader-top",
      name: t("cmd_top"),
      callback: () => {
        const view = this.activeReaderView();
        if (view) view.goTop();
      },
    });
    this.addCommand({
      id: "reader-contents",
      name: t("cmd_contents"),
      callback: () => {
        const view = this.activeReaderView();
        if (view) void view.showContents();
        else void this.openReader({ mode: "contents" });
      },
    });
    this.addCommand({
      id: "reader-next",
      name: t("cmd_next"),
      callback: () => {
        const view = this.activeReaderView();
        if (view) void view.goNext();
      },
    });
    this.addCommand({
      id: "export-editing-instructions",
      name: t("cmd_export"),
      callback: async () => {
        const reader = await this.loadReaderIndex();
        await this.store.update({
          projectId: reader.project_id,
          sourceContentId: reader.source_content_id,
        }, (ledger) => ledger);
        new Notice(t("wrote", { path: DIGEST_PATH }));
      },
    });
    this.addCommand({
      id: "transcribe-voice-notes",
      name: t("cmd_transcribe"),
      callback: () => void this.transcribePending({ includeFailed: true }),
    });
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.autoTranscribe) void this.transcribePending({ quiet: true });
    });
    // Recordings made on the phone arrive by Sync as a changed ledger; pick
    // them up here without a manual command.
    let ledgerTimer = null;
    const ledgerChanged = (file) => {
      if (!file || file.path !== normalizePath(LEDGER_PATH)) return;
      if (!this.settings.autoTranscribe) return;
      if (ledgerTimer) window.clearTimeout(ledgerTimer);
      ledgerTimer = window.setTimeout(() => {
        ledgerTimer = null;
        void this.transcribePending({ quiet: true });
      }, 5000);
    };
    this.registerEvent(this.app.vault.on("modify", ledgerChanged));
    this.registerEvent(this.app.vault.on("create", ledgerChanged));
    this.registerEvent(this.app.vault.on("rename", ledgerChanged));
    this.addRibbonIcon(
      "book-open",
      t("ribbon"),
      () => void this.openReader()
    );
    this.registerEvent(
      this.app.workspace.on(
        "file-open",
        (file) => void this.handleReaderFileOpen(file)
      )
    );
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(READER_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(REVIEW_VIEW_TYPE);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  activeReaderView() {
    return this.app.workspace.getActiveViewOfType(FirstPairTriptychReaderView);
  }

  activeReviewView() {
    return this.app.workspace.getActiveViewOfType(FirstPairTriptychReviewView);
  }

  normalizeReaderState(value, reader = null) {
    const raw = value && typeof value === "object" ? value : {};
    const mode = ["contents", "set", "part", "fragment"].includes(raw.mode)
      ? raw.mode
      : "contents";
    const rawPartId = typeof raw.partId === "string" ? raw.partId.trim() : "";
    const legacyPartTitle = typeof raw.partTitle === "string"
      ? raw.partTitle.trim()
      : "";
    const state = {
      mode,
      setId: typeof raw.setId === "string" ? raw.setId.trim() : "",
      partId: rawPartId || legacyPartTitle,
      key: typeof raw.key === "string" ? raw.key.trim() : "",
    };
    if (!reader) return state;
    if (state.mode === "fragment" && reader.pageByKey.has(state.key)) {
      const page = reader.pageByKey.get(state.key);
      return {
        mode: "fragment",
        setId: page.setId,
        partId: page.part_id,
        key: page.key,
      };
    }
    if (state.mode === "part" && reader.setById.has(state.setId)) {
      const set = reader.setById.get(state.setId);
      let part = set.partById.get(state.partId);
      if (!part) {
        const legacyTitle = legacyPartTitle || state.partId;
        const matches = set.parts.filter(
          (candidate) => (
            candidate.title === legacyTitle
            || candidate.heading === legacyTitle
          )
        );
        if (matches.length === 1) [part] = matches;
      }
      if (part) {
        const current = reader.pageByKey.get(state.key);
        return {
          mode: "part",
          setId: set.id,
          partId: part.id,
          key:
            current
            && current.setId === set.id
            && current.part_id === part.id
              ? current.key
              : "",
        };
      }
    }
    if (state.mode === "set" && reader.setById.has(state.setId)) {
      const current = reader.pageByKey.get(state.key);
      return {
        mode: "set",
        setId: state.setId,
        partId: "",
        key: current && current.setId === state.setId ? current.key : "",
      };
    }
    return { mode: "contents", setId: "", partId: "", key: "" };
  }

  async loadReaderIndex() {
    if (this.readerCache) return this.readerCache;
    const path = normalizePath(READER_INDEX_PATH);
    if (!(await this.app.vault.adapter.exists(path))) {
      throw new Error(`missing Reader index: ${path}`);
    }
    this.readerCache = parseTriptychReaderIndex(
      await this.app.vault.adapter.read(path)
    );
    return this.readerCache;
  }

  readerTargetForFrontmatter(frontmatter) {
    if (!frontmatter) return null;
    const type = String(frontmatter.type || "");
    if (
      type === "triptych-reader-launcher" ||
      type === "triptych-reader-contents"
    ) {
      return { mode: "contents" };
    }
    if (type === "triptych-review-launcher") return { mode: "review" };
    if (type === "triptych-hub") {
      const setId = String(frontmatter.set || "").trim();
      return setId ? { mode: "set", setId } : { mode: "contents" };
    }
    if (type === "triptych") {
      const key = String(frontmatter.triptych_key || "").trim();
      return key ? { mode: "fragment", key } : null;
    }
    return null;
  }

  historyFor(leaf) {
    if (!this.histories) this.histories = historyRegistry(READER_HISTORY_LIMIT);
    return this.histories(leaf);
  }

  // Where a pane is now, as a history entry: a Reader or Review place, or a
  // note; null for anything else.
  locationOf(leaf) {
    const view = leaf && leaf.view;
    if (!view) return null;
    if (typeof view.captureLocation === "function") return view.captureLocation();
    if (view.file && view.file.path) return { view: "file", path: view.file.path };
    return null;
  }

  // Show a history entry in a pane without recording it again.
  async showLocation(leaf, location) {
    if (location.view === "file") {
      const file = this.app.vault.getAbstractFileByPath(location.path);
      if (file) await leaf.openFile(file);
      return;
    }
    if (location.view === "review") {
      await this.openReview(leaf, { record: false, review: location.state, scrollTop: location.scrollTop });
      return;
    }
    const view = leaf.view;
    if (view instanceof FirstPairTriptychReaderView) {
      await view.showLocation({ ...location, view: "reader" });
      return;
    }
    await this.openReader(location.state, leaf, { record: false });
    if (leaf.view instanceof FirstPairTriptychReaderView) leaf.view.restoreScroll(location.scrollTop);
  }

  async openReader(target = null, selectedLeaf = null, { record = true } = {}) {
    try {
      const reader = await this.loadReaderIndex();
      const leaf = selectedLeaf || this.app.workspace.getLeaf(false);
      if (record) this.historyFor(leaf).visit(this.locationOf(leaf));
      await leaf.setViewState({
        type: READER_VIEW_TYPE,
        active: true,
        state: this.normalizeReaderState(target || { mode: "contents" }, reader),
      });
      if (typeof this.app.workspace.revealLeaf === "function") {
        await this.app.workspace.revealLeaf(leaf);
      }
    } catch (error) {
      console.error("firstpair-triptych: Reader navigation failed", error);
      new Notice(t("reader_navigate_failed", { error: error.message }), 10000);
    }
  }

  async openReview(selectedLeaf = null, { record = true, review = null, scrollTop = 0 } = {}) {
    try {
      await this.loadReaderIndex();
      const leaf = selectedLeaf || this.app.workspace.getLeaf(false);
      // Review replaces the pane it opens in; the pane's history keeps what
      // was there, so Back returns to the same page and scroll position.
      if (record) this.historyFor(leaf).visit(this.locationOf(leaf));
      await leaf.setViewState({
        type: REVIEW_VIEW_TYPE,
        active: true,
        state: { review: review || { pair: "", expanded: [] }, scrollTop },
      });
      if (typeof this.app.workspace.revealLeaf === "function") {
        await this.app.workspace.revealLeaf(leaf);
      }
    } catch (error) {
      console.error("firstpair-triptych: Review navigation failed", error);
      new Notice(t("review_open_failed", { error: error.message || error }), 10000);
    }
  }

  async handleReaderFileOpen(file) {
    if (
      !file ||
      !file.path ||
      this.readerTransition ||
      !isTriptychReaderNotePath(file.path)
    ) {
      return;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const target = this.readerTargetForFrontmatter(cache && cache.frontmatter);
    if (!target) return;
    const leaf = this.app.workspace.activeLeaf;
    if (
      !leaf
      || leaf.view instanceof FirstPairTriptychReaderView
      || leaf.view instanceof FirstPairTriptychReviewView
    ) return;
    if (leaf.view && leaf.view.file && leaf.view.file.path !== file.path) return;
    this.readerTransition = true;
    try {
      // The static note hands over to the Reader in place; it is not a stop
      // in the pane's history (Back would only hand over again).
      if (target.mode === "review") await this.openReview(leaf, { record: false });
      else await this.openReader(target, leaf, { record: false });
    } finally {
      this.readerTransition = false;
    }
  }

  /* ------------------------- enhanced note viewers ------------------------ */

  /* Called per rendered section of a lineage/transformation note. Every
   * section of the note is marked so its native rendering is hidden by CSS
   * (`.lt-native-hidden > :not(.lt-mount)`); the enhanced panel is built
   * once, into the section that carries the note's H1. All work happens
   * inside Obsidian's render pass and is re-applied on every re-render, so
   * there is no remount loop and nothing to blank. */
  enhanceSection(el, ctx, kind) {
    try {
      el.classList.add("lt-native-hidden");
      const preview = el.closest(".markdown-preview-view, .markdown-reading-view");
      if (preview) preview.classList.add("lt-wide-view");

      const h1 = el.querySelector("h1");
      if (!h1) return; // a later section; its native content is hidden above
      if (el.querySelector(":scope > .lt-mount")) return; // already built

      const mount = createDiv({ cls: "lt-mount" });
      el.prepend(mount);
      mount.createEl("p", { cls: "lt-mount-loading", text: t("rendering") });

      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (!file) {
        el.classList.remove("lt-native-hidden");
        mount.remove();
        return;
      }
      const fm = (ctx.frontmatter && { ...ctx.frontmatter }) || {};
      this.app.vault
        .cachedRead(file)
        .then((raw) => {
          mount.empty();
          if (kind === "transformation") this.renderTransformation(mount, raw, fm);
          else this.renderLineage(mount, raw, fm, el);
        })
        .catch((error) => {
          console.error("firstpair-triptych: enhance failed", error);
          el.classList.remove("lt-native-hidden"); // fall back to native
          mount.remove();
        });
    } catch (error) {
      console.error("firstpair-triptych: enhanceSection failed", error);
      el.classList.remove("lt-native-hidden");
    }
  }

  openNote(path, event) {
    this.app.workspace.openLinkText(path, "", event && (event.ctrlKey || event.metaKey));
  }

  renderTransformation(mount, raw, fm) {
    const { before, after } = parseTransformation(raw);
    const kind = String(fm.kind || "");
    const head = mount.createDiv({ cls: "lt-xform-head" });
    head.createSpan({
      cls: "lt-badge " + (KIND_CLASSES[kind] || ""),
      text: kind || "event",
    });
    head.createSpan({ cls: "lt-xform-transition", text: String(fm.transition || "") });
    const cardinality = `${before.units.length} → ${after.units.length}`;
    head.createSpan({ cls: "lt-badge lt-badge-plain", text: cardinality });
    const similarity = typeof fm.similarity === "number" ? fm.similarity : parseFloat(fm.similarity || "0");
    const meter = head.createDiv({ cls: "lt-meter", attr: { title: t("lexical_similarity", { value: similarity.toFixed(3) }) } });
    meter.createDiv({ cls: "lt-meter-fill" }).style.width = `${Math.round(similarity * 100)}%`;
    head.createSpan({ cls: "lt-meter-label", text: similarity.toFixed(3) });
    if (fm.moved === true || fm.moved === "true") {
      head.createSpan({ cls: "lt-badge lt-badge-moved", text: t("moved") });
    }
    head.createSpan({ cls: "lt-method", text: String(fm.method || "") });

    const beforeText = before.units.map((u) => u.text).join("\n\n");
    const afterText = after.units.map((u) => u.text).join("\n\n");
    const ops = wordDiff(beforeText, afterText);

    const panes = mount.createDiv({ cls: "lt-panes lt-xform-panes" });
    panes.style.setProperty("--lt-panes", "2");
    for (const [side, data, text] of [
      ["before", before, beforeText],
      ["after", after, afterText],
    ]) {
      const paneEl = panes.createDiv({ cls: "lt-pane" });
      const headEl = paneEl.createDiv({ cls: "lt-pane-head" });
      headEl.createSpan({ cls: "lt-pane-title", text: side === "before" ? t("before") : t("after") });
      const links = headEl.createDiv({ cls: "lt-unit-chips" });
      for (const unit of data.units) {
        const chip = links.createEl("a", { cls: "lt-unit-chip internal-link", text: unit.key });
        if (unit.note) {
          chip.addEventListener("click", (event) => {
            event.preventDefault();
            this.openNote(unit.note, event);
          });
        }
      }
      const body = paneEl.createDiv({ cls: "lt-pane-body lt-diff-body" });
      if (!text) {
        body.createEl("p", {
          cls: "lt-empty",
          text: side === "before" ? t("no_predecessor") : t("no_successor"),
        });
      } else {
        const p = body.createEl("p");
        renderDiffInto(p, ops, side);
      }
    }
    mount.createDiv({
      cls: "lt-glossary",
      text: t("transformation_glossary"),
    });
  }

  renderLineage(mount, raw, fm, section) {
    const { members, transformations } = parseLineage(raw);
    if (!members.length) {
      // Nothing to enhance: reveal the native rendering instead.
      if (section) section.classList.remove("lt-native-hidden");
      mount.remove();
      return;
    }

    // Collapse consecutive members with identical normalized text into runs.
    const runs = [];
    for (const member of members) {
      const norm = normalizeCompare(member.text);
      const last = runs[runs.length - 1];
      if (last && last.norm === norm) last.members.push(member);
      else runs.push({ norm, members: [member], text: member.text });
    }
    // Change intensity vs previous distinct run.
    for (let i = 0; i < runs.length; i++) {
      if (i === 0) { runs[i].level = "first"; continue; }
      const sim = jaccard(runs[i - 1].text, runs[i].text);
      runs[i].sim = sim;
      runs[i].level = sim >= 0.85 ? "light" : sim >= 0.45 ? "medium" : "heavy";
    }

    const strip = mount.createDiv({ cls: "lt-chain" });
    const runLabel = (run) => {
      const first = run.members[0].label;
      const last = run.members[run.members.length - 1].label;
      const label = first === last ? first : `${first} → ${last}`;
      return run.members.length > 1 ? `${label} ×${run.members.length}` : label;
    };
    runs.forEach((run, index) => {
      if (index) strip.createSpan({ cls: "lt-chain-arrow", text: "→" });
      const chip = strip.createEl("button", {
        cls: `lt-chain-chip lt-level-${run.level}`,
        text: runLabel(run),
        attr: { title: run.sim !== undefined ? t("similarity_previous", { value: run.sim.toFixed(2) }) : t("first_state") },
      });
      chip.addEventListener("click", () => {
        const card = mount.querySelector(`[data-lt-run="${index}"]`);
        if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    mount.createDiv({
      cls: "lt-glossary",
      text: t("lineage_glossary", { members: members.length, states: runs.length }),
    });

    runs.forEach((run, index) => {
      const card = mount.createDiv({ cls: `lt-run-card lt-level-${run.level}`, attr: { "data-lt-run": String(index) } });
      const head = card.createDiv({ cls: "lt-pane-head" });
      head.createSpan({ cls: "lt-pane-title", text: runLabel(run) });
      const chips = head.createDiv({ cls: "lt-unit-chips" });
      for (const member of run.members) {
        const chip = chips.createEl("a", {
          cls: "lt-unit-chip internal-link",
          text: `${member.label}:${member.unit}`,
        });
        if (member.note) {
          chip.addEventListener("click", (event) => {
            event.preventDefault();
            this.openNote(member.note, event);
          });
        }
      }
      let diffButton = null;
      if (index > 0) {
        diffButton = head.createEl("button", { cls: "lt-chip", text: t("diff_previous") });
      }
      const body = card.createDiv({ cls: "lt-pane-body" });
      const renderPlain = () => {
        body.empty();
        for (const paragraph of paneTexts(run.text)) body.createEl("p", { text: paragraph });
      };
      renderPlain();
      if (diffButton) {
        let showingDiff = false;
        diffButton.addEventListener("click", () => {
          showingDiff = !showingDiff;
          diffButton.classList.toggle("lt-chip-on", showingDiff);
          if (!showingDiff) return renderPlain();
          body.empty();
          const ops = wordDiff(runs[index - 1].text, run.text);
          const p = body.createEl("p", { cls: "lt-diff-body" });
          renderDiffInto(p, ops, "inline");
        });
      }
    });

    if (transformations.length) {
      const foot = mount.createDiv({ cls: "lt-lineage-foot" });
      foot.createSpan({ cls: "lt-note-label", text: t("events") });
      transformations.forEach((path, i) => {
        const name = path.split("/").pop();
        const a = foot.createEl("a", { cls: "internal-link lt-unit-chip", text: name.replace(/^LR-X-/, "") });
        a.addEventListener("click", (event) => {
          event.preventDefault();
          this.openNote(path, event);
        });
        if (i < transformations.length - 1) foot.createSpan({ text: " " });
      });
    }
  }

  /* ----------------------- comparison hub previews ------------------------ */

  attachIncipitPreviews(el) {
    const items = el.querySelectorAll("li > a.internal-link");
    if (!items.length) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        this.queueIncipit(entry.target);
      }
    }, { rootMargin: "200px" });
    for (const a of items) {
      const href = a.getAttribute("data-href") || a.getAttribute("href") || "";
      if (!/Lineages\//.test(href)) continue;
      observer.observe(a);
    }
  }

  queueIncipit(anchor) {
    this.previewQueue.push(anchor);
    this.drainIncipits();
  }

  async drainIncipits() {
    while (this.previewActive < 4 && this.previewQueue.length) {
      const anchor = this.previewQueue.shift();
      this.previewActive++;
      this.renderIncipit(anchor).finally(() => {
        this.previewActive--;
        this.drainIncipits();
      });
    }
  }

  async renderIncipit(anchor) {
    try {
      if (anchor.parentElement.querySelector(".lt-incipit")) return;
      const href = anchor.getAttribute("data-href") || anchor.getAttribute("href") || "";
      const file = this.app.metadataCache.getFirstLinkpathDest(href, "");
      if (!file) return;
      const raw = await this.app.vault.cachedRead(file);
      const { members } = parseLineage(raw);
      if (!members.length) return;
      const words = members[0].text.replace(/\s+/g, " ").split(" ").slice(0, 18).join(" ");
      anchor.parentElement.createSpan({
        cls: "lt-incipit",
        text: ` — ${words}${words ? " …" : ""} (${tc(members.length, "member")})`,
      });
    } catch (error) {
      console.error("firstpair-triptych: incipit failed", error);
    }
  }

  /* ------------------------------ triptychs ------------------------------- */

  async rememberEditions(payload) {
    let changed = false;
    for (const pane of payload.panes || []) {
      if (!Object.prototype.hasOwnProperty.call(this.settings.knownEditions, pane.edition)) {
        this.settings.knownEditions[pane.edition] = pane.title || pane.edition;
        changed = true;
      }
    }
    if (changed) await this.saveSettings();
  }

  isVisible(edition) {
    return this.settings.editionVisibility[edition] !== false;
  }

  widenView(el) {
    const view = el.closest(".markdown-reading-view, .markdown-source-view, .markdown-preview-view");
    // One edition reads best at the ordinary line width.
    if (view) view.toggleClass("lt-wide-view", !el.querySelector(".lt-solo"));
  }

  async renderTriptych(payload, el) {
    payload = validateTriptychPayload(payload);
    const context = this.store.contextFromPayload(payload);
    let ledger;
    try {
      ledger = await this.store.load(context);
    } catch (error) {
      if (error.code !== "SOURCE_CONTENT_MISMATCH") throw error;
      const notice = el.createDiv({ cls: "lt-empty lt-mismatch" });
      notice.createSpan({ text: `${t("source_mismatch")} ` });
      const open = notice.createEl("button", { text: t("review"), attr: { type: "button" } });
      open.addEventListener("click", () => void this.openReview());
      return;
    }
    const existing = ledger.decisions[payload.key] || {};
    const review = payload.review || null;

    const root = el.createDiv({ cls: "lt-triptych" });
    // Touch screens select whole words; checkboxes are for a mouse.
    if (isTouchDevice()) root.addClass("lt-touch");
    const solo = this.settings.soloEdition || "";
    const rerender = async () => {
      el.empty();
      await this.renderTriptych(payload, el);
      this.widenView(el);
    };

    const chipRow = root.createDiv({ cls: "lt-chips" });
    if (payload.panes.length > 1 || solo) {
      const soloSelect = chipRow.createEl("select", {
        cls: "dropdown lt-solo-select",
        attr: { title: t("solo_title"), "aria-label": t("solo_label") },
      });
      soloSelect.createEl("option", { value: "", text: t("solo_all") });
      const choices = payload.panes.map((pane) => [pane.edition, pane.title || pane.edition]);
      if (solo && !choices.some(([edition]) => edition === solo)) {
        choices.push([solo, this.settings.knownEditions[solo] || solo]);
      }
      for (const [edition, title] of choices) {
        soloSelect.createEl("option", { value: edition, text: title });
      }
      soloSelect.value = solo;
      soloSelect.addEventListener("change", async () => {
        this.settings.soloEdition = soloSelect.value;
        await this.saveSettings();
        await rerender();
      });
    }
    if (!solo) chipRow.createSpan({ cls: "lt-chips-label", text: t("panes_label") });
    for (const pane of solo ? [] : payload.panes) {
      const chip = chipRow.createEl("button", {
        cls: "lt-chip" + (this.isVisible(pane.edition) ? " lt-chip-on" : ""),
        text: pane.title || pane.edition,
        attr: { title: t("chip_title") },
      });
      chip.addEventListener("click", async () => {
        this.settings.editionVisibility[pane.edition] = !this.isVisible(pane.edition);
        await this.saveSettings();
        await rerender();
      });
    }
    if (this.diffs && !solo) {
      const diffChip = chipRow.createEl("button", {
        cls: "lt-chip lt-diff-chip" + (this.settings.showDiff ? " lt-chip-on" : ""),
        text: t("diff"),
        attr: { type: "button", title: t("diff_title"), "aria-pressed": this.settings.showDiff ? "true" : "false" },
      });
      diffChip.addEventListener("click", async () => {
        this.settings.showDiff = !this.settings.showDiff;
        await this.saveSettings();
        await rerender();
      });
    }
    const reviewButton = chipRow.createEl("button", {
      cls: "lt-chip lt-review-chip",
      text: t("review"),
      attr: { type: "button", title: t("review_chip_title") },
    });
    reviewButton.addEventListener("click", () => void this.openReview());
    if (payload.panes.some((pane) => String(pane.text || "").trim())) {
      const sentenceToggle = chipRow.createEl("button", {
        cls: "lt-chip lt-sentence-toggle",
        text: t("sentence_words"),
        attr: {
          type: "button",
          "aria-pressed": "false",
          title: t("sentence_toggle_title"),
        },
      });
      sentenceToggle.addEventListener("click", () => {
        const showing = !root.hasClass("lt-show-sentence-choices");
        root.toggleClass("lt-show-sentence-choices", showing);
        sentenceToggle.toggleClass("lt-chip-on", showing);
        sentenceToggle.setAttribute("aria-pressed", showing ? "true" : "false");
        sentenceToggle.setText(t("sentence_words"));
      });
    }

    const visiblePanes = solo
      ? payload.panes.filter((p) => p.edition === solo)
      : payload.panes.filter((p) => this.isVisible(p.edition));
    if (solo && !visiblePanes.some((pane) => String(pane.text || "").trim())) {
      const absent = root.createDiv({ cls: "lt-empty lt-solo-absent" });
      const soloPane = payload.panes.find((pane) => pane.edition === solo);
      const name = (soloPane && soloPane.title) || this.settings.knownEditions[solo] || solo;
      absent.createSpan({ text: t("solo_absent", { name }) + " " });
      const showAll = absent.createEl("button", { text: t("show_all"), attr: { type: "button" } });
      showAll.addEventListener("click", async () => {
        this.settings.soloEdition = "";
        await this.saveSettings();
        await rerender();
      });
      return;
    }
    if (visiblePanes.length === 0) {
      root.createDiv({ cls: "lt-empty", text: t("all_hidden") });
      return;
    }
    // One pane is an editing page, not a comparison: no pane preference, no
    // divergence rail, and the sentence and word controls open by default.
    const isSolo = visiblePanes.length === 1;
    if (isSolo) {
      root.addClass("lt-solo");
      root.addClass("lt-show-sentence-choices");
      const toggle = chipRow.querySelector(".lt-sentence-toggle");
      if (toggle) {
        toggle.addClass("lt-chip-on");
        toggle.setAttribute("aria-pressed", "true");
      }
    }

    const diffs = this.diffs && this.settings.showDiff && !isSolo
      ? this.renderDiffLegend(root, payload, visiblePanes, rerender) : null;

    const byNorm = new Map();
    for (const pane of visiblePanes) {
      if (!pane.text) continue;
      const key = normalizeCompare(pane.text);
      if (!byNorm.has(key)) byNorm.set(key, []);
      byNorm.get(key).push(pane.title || pane.edition);
    }
    const equalGroups = [...byNorm.values()].filter((g) => g.length > 1);
    if (equalGroups.length) {
      const banner = root.createDiv({ cls: "lt-equal-banner" });
      const label =
        byNorm.size === 1
          ? t("all_identical")
          : t("identical_prefix") + equalGroups.map((g) => g.join(" = ")).join(" · ");
      banner.setText(label);
    }

    // On a phone the panes form a horizontal snap track; these tabs follow
    // taps and swipes, and the tapped edition opens first on every page.
    const paneTabs = visiblePanes.length > 1
      ? root.createDiv({ cls: "lt-pane-tabs", attr: { role: "tablist", "aria-label": t("panes_label") } })
      : null;
    const paneRow = root.createDiv({ cls: "lt-panes" });
    paneRow.style.setProperty("--lt-panes", String(visiblePanes.length));
    const paneEls = [];

    const checkboxes = new Map();
    for (const pane of visiblePanes) {
      const paneReview = review && review.panes ? review.panes[pane.edition] : null;
      const paneEl = paneRow.createDiv({ cls: "lt-pane" });
      paneEls.push(paneEl);
      if (!pane.text) paneEl.addClass("lt-absent");
      if (paneReview && paneReview.structural && !isSolo) paneEl.addClass("lt-structural");
      if (paneReview && paneReview.outlier && !isSolo) paneEl.addClass("lt-outlier");

      const head = paneEl.createDiv({ cls: "lt-pane-head" });
      head.createSpan({ cls: "lt-pane-title", text: pane.title || pane.edition });

      // A bare checkbox: preferring is its only meaning; the word stays in
      // the tooltip and for screen readers.
      const preferName = t("prefer_this_pane").trim();
      const label = head.createEl("label", { cls: "lt-prefer", attr: { title: preferName } });
      if (isSolo) label.style.display = "none";
      const box = label.createEl("input", { type: "checkbox", attr: { "aria-label": preferName } });
      box.checked = existing.preferred === pane.edition;
      checkboxes.set(pane.edition, box);
      box.addEventListener("change", async () => {
        const preferred = box.checked ? pane.edition : null;
        const prior = (ledger.decisions[payload.key] || {}).preferred || null;
        for (const [edition, other] of checkboxes) other.checked = edition === preferred;
        for (const other of checkboxes.values()) other.disabled = true;
        try {
          ledger = await this.saveDecision(payload, { preferred });
          new Notice(preferred
            ? t("preferred_notice", { name: pane.title || pane.edition })
            : t("preference_cleared"));
        } catch (error) {
          for (const [edition, other] of checkboxes) other.checked = edition === prior;
          console.error("firstpair-triptych: preference save failed", error);
          new Notice(t("save_preference_failed", { error: error.message || error }));
        } finally {
          for (const other of checkboxes.values()) other.disabled = false;
        }
      });

      if (paneReview && !isSolo) {
        const rail = paneEl.createDiv({ cls: "lt-rail" });
        const bars = rail.createSpan({
          cls: "lt-rail-bars lt-bars-" + (paneReview.bars || 0),
          text: BAR_GLYPHS[paneReview.bars || 0],
          attr: { title: t("bar_legend") },
        });
        if (paneReview.outlier) bars.addClass("lt-bars-outlier");
        rail.createSpan({
          cls: "lt-rail-score",
          text: String(paneReview.score),
          attr: { title: t("score_title") },
        });
        const vector = rail.createSpan({ cls: "lt-rail-vector" });
        const features = new Set(paneReview.features || []);
        for (const code of FEATURE_CODES) {
          const description = t(`feature_${code}`);
          vector.createSpan({
            cls: "lt-rail-cell" + (features.has(code) ? " lt-rail-hit" : ""),
            text: features.has(code) ? code : "·",
            attr: { title: `${code}: ${description}` },
          });
        }
        if (paneReview.structural) {
          rail.createSpan({
            cls: "lt-rail-flag",
            text: t("split_fuse"),
            attr: { title: t("structural_title") },
          });
        }
        if (paneReview.outlier) {
          rail.createSpan({
            cls: "lt-rail-flag lt-rail-flag-outlier",
            text: t("outlier"),
            attr: { title: t("outlier_title") },
          });
        }
      }

      this.renderMetricRow(paneEl, payload.key, pane.edition);
      const body = paneEl.createDiv({ cls: "lt-pane-body" });
      this.renderEditorialPaneBody(
        payload,
        pane,
        body,
        root,
        () => ledger,
        (nextLedger) => { ledger = nextLedger; },
        diffs ? diffs.get(pane.edition) : null,
      );

      if (pane.notes && pane.notes.length) {
        const links = paneEl.createDiv({ cls: "lt-pane-links" });
        pane.units.forEach((unitId, i) => {
          const a = links.createEl("a", { text: unitId, cls: "internal-link" });
          a.addEventListener("click", (event) => {
            event.preventDefault();
            this.openNote(pane.notes[i], event);
          });
          if (i < pane.units.length - 1) links.createSpan({ text: " · " });
        });
      }
    }

    if (paneTabs) this.wirePaneTabs(paneTabs, paneRow, paneEls, visiblePanes);

    const noteRow = root.createDiv({ cls: "lt-note-row" });
    noteRow.createSpan({ cls: "lt-note-label", text: t("editing_note") });
    const note = noteRow.createEl("textarea", {
      cls: "lt-note",
      attr: {
        rows: "2",
        placeholder: t("note_placeholder"),
      },
    });
    note.value = existing.note || "";
    let savedNote = note.value.trim();
    let timer = null;
    const persistNote = async () => {
      if (timer) window.clearTimeout(timer);
      timer = null;
      const nextNote = note.value.trim();
      if (nextNote === savedNote) return;
      note.disabled = true;
      try {
        ledger = await this.saveDecision(payload, { note: nextNote });
        savedNote = nextNote;
      } catch (error) {
        note.value = savedNote;
        console.error("firstpair-triptych: editing note save failed", error);
        new Notice(t("save_note_failed", { error: error.message || error }));
      } finally {
        note.disabled = false;
      }
    };
    note.addEventListener("input", () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void persistNote(), 800);
    });
    note.addEventListener("blur", () => void persistNote());

    // The legend explains the divergence rail; pages without one need none.
    if (review) {
      root.createDiv({
        cls: "lt-glossary",
        text: `${t("bar_legend")} — ${t("feature_legend")}`,
      });
    }
  }

  async loadDiffs() {
    const path = normalizePath(`${BOOK_ROOT}/_data/triptych-diffs.json`);
    try {
      if (!(await this.app.vault.adapter.exists(path))) return null;
      return diffView.parseDiffs(await this.app.vault.adapter.read(path));
    } catch (error) {
      console.warn("firstpair-triptych: edition diffs ignored", error);
      return null;
    }
  }

  // The legend and filters under the chips, and the ranges each shown pane
  // paints: the pair when two panes show (filtered by kind of change), the
  // whole set when three do (narrowed by the history lens).
  renderDiffLegend(root, payload, visiblePanes, rerender) {
    const diff = diffView.diffFor(this.diffs, payload.key, visiblePanes.map((pane) => pane.edition));
    const legend = root.createDiv({ cls: "fp-diff-legend" });
    if (!diff) {
      legend.setText(t("diff_need_two"));
      return null;
    }
    if (diff.same) {
      legend.setText(t("diff_same"));
      return null;
    }
    const name = (edition) => {
      const pane = payload.panes.find((item) => item.edition === edition);
      return (pane && pane.title) || edition;
    };
    if (diff.mode === "pair") {
      legend.setText(t("diff_legend_pair", { older: name(diff.editions[0]), newer: name(diff.editions[1]) }));
    } else {
      legend.createSpan({ text: `${t("diff_legend_all", { count: diff.editions.length })} ` });
      for (const edition of diff.editions) {
        const index = this.diffs.editions.indexOf(edition) % 3;
        legend.createSpan({ cls: `fp-diff-swatch fp-diff-ed-${index}` });
        legend.createSpan({ text: `${name(edition)} ` });
      }
    }
    const hidden = this.settings.diffHidden || {};
    const lens = diff.mode === "all" ? (this.settings.diffLens || "all") : null;
    const filters = root.createDiv({ cls: "fp-diff-filters" });
    if (diff.mode === "pair" && this.diffs.categories.length) {
      filters.createSpan({ cls: "lt-chips-label", text: t("diff_filters") });
      for (const category of diffView.CATEGORIES) {
        const chip = filters.createEl("button", {
          cls: "lt-chip" + (hidden[category] ? "" : " lt-chip-on"),
          text: t(`diff_cat_${category}`),
          attr: { type: "button", "aria-pressed": hidden[category] ? "false" : "true" },
        });
        chip.addEventListener("click", async () => {
          this.settings.diffHidden = { ...hidden, [category]: !hidden[category] };
          await this.saveSettings();
          await rerender();
        });
      }
    } else if (diff.mode === "all") {
      filters.createSpan({ cls: "lt-chips-label", text: t("diff_lens") });
      const select = filters.createEl("select", { cls: "dropdown", attr: { "aria-label": t("diff_lens") } });
      for (const value of diffView.LENSES) select.createEl("option", { value, text: t(`diff_lens_${value}`) });
      select.value = lens;
      select.addEventListener("change", async () => {
        this.settings.diffLens = select.value;
        await this.saveSettings();
        await rerender();
      });
    }
    const pageTitle = (key) => {
      const page = this.readerCache && this.readerCache.pageByKey ? this.readerCache.pageByKey.get(key) : null;
      return page ? page.title : key;
    };
    const titleFor = ([, , kind, category, target]) => {
      let base;
      if (kind === "del") base = t("diff_del", { name: name(diff.editions[1]) });
      else if (kind === "ins") base = t("diff_ins", { name: name(diff.editions[0]) });
      else if (kind.startsWith("share:")) base = t("diff_share", { name: name(kind.slice(6)) });
      else base = t("diff_uniq");
      if (category === "moved" && target) return `${base} · ${t("diff_moved_to", { page: pageTitle(target) })}`;
      return category ? `${base} · ${t(`diff_cat_${category}`)}` : base;
    };
    const result = new Map();
    for (const edition of diff.editions) {
      result.set(edition, {
        ranges: diff.ranges[edition] || [],
        options: {
          editions: this.diffs.editions, titleFor, hiddenCategories: hidden,
          lens, lensEditions: diff.editions, edition,
        },
      });
    }
    return result;
  }

  async loadMetrics() {
    const path = normalizePath(`${BOOK_ROOT}/_data/triptych-metrics.json`);
    try {
      if (!(await this.app.vault.adapter.exists(path))) return { metrics: [], values: {} };
      return parseMetrics(await this.app.vault.adapter.read(path));
    } catch (error) {
      console.warn("firstpair-triptych: metrics ignored", error);
      return { metrics: [], values: {} };
    }
  }

  // Declared metrics in the reader's chosen order (settings), then by rank.
  rankedMetrics({ includeHidden = false } = {}) {
    if (!this.metrics) return [];
    const order = this.settings.metricOrder || [];
    const position = (metric) => {
      const index = order.indexOf(metric.key);
      return index < 0 ? order.length + metric.rank : index;
    };
    return [...this.metrics.metrics]
      .sort((left, right) => position(left) - position(right) || left.rank - right.rank)
      .filter((metric) => includeHidden || !(this.settings.metricHidden || {})[metric.key]);
  }

  renderMetricRow(container, pageKey, edition) {
    if (!this.metrics) return;
    const values = ((this.metrics.values[pageKey] || {})[edition]) || {};
    const shown = this.rankedMetrics().filter((metric) => Number.isFinite(values[metric.key]));
    if (!shown.length) return;
    const row = container.createDiv({ cls: "lt-metrics" });
    for (const metric of shown) {
      const value = values[metric.key];
      const severity = metricSeverity(metric, value);
      row.createSpan({
        cls: `lt-metric${severity ? ` lt-metric-${severity}` : ""}`,
        text: `${metric.letter} ${formatMetric(metric, value)}`,
        attr: { title: `${metricText(metric, "label")}: ${formatMetric(metric, value)} — ${metricText(metric, "description")}` },
      });
    }
  }

  wirePaneTabs(tabRow, track, paneEls, panes) {
    const view = track.ownerDocument.defaultView;
    const tabs = panes.map((pane, index) => {
      const tab = tabRow.createEl("button", {
        cls: "lt-pane-tab",
        text: pane.title || pane.edition,
        attr: { type: "button", role: "tab", title: t("pane_tab_title") },
      });
      tab.addEventListener("click", () => {
        this.settings.defaultPane = pane.edition;
        void this.saveSettings();
        setActive(index);
        scrollToPane(index, "smooth");
      });
      return tab;
    });
    const setActive = (active) => tabs.forEach((tab, index) => {
      tab.toggleClass("is-active", index === active);
      tab.setAttribute("aria-selected", index === active ? "true" : "false");
    });
    const scrollToPane = (index, behavior) => {
      const pane = paneEls[index];
      if (!pane) return;
      const left = pane.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft;
      if (typeof track.scrollTo === "function") track.scrollTo({ left, behavior });
      else track.scrollLeft = left;
    };
    const preferred = Math.max(0, panes.findIndex((pane) => pane.edition === this.settings.defaultPane));
    setActive(preferred);
    view.requestAnimationFrame(() => {
      // Only a scrollable (phone-width) track moves; wide columns stay put.
      if (track.scrollWidth > track.clientWidth + 1) scrollToPane(preferred, "auto");
    });
    let frame = 0;
    track.addEventListener("scroll", () => {
      if (frame) return;
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        const origin = track.getBoundingClientRect().left;
        let best = 0;
        let distance = Infinity;
        paneEls.forEach((pane, index) => {
          const gap = Math.abs(pane.getBoundingClientRect().left - origin);
          if (gap < distance) {
            distance = gap;
            best = index;
          }
        });
        setActive(best);
      });
    }, { passive: true });
  }

  renderPaneBody(payload, pane, body, root, getLedger, setLedger) {
    const blocks = paneBlocks(pane.text);
    if (blocks.length === 0) {
      body.createEl("p", { cls: "lt-empty", text: t("absent") });
      return;
    }
    const spans = sentenceSpansForPane(pane, blocks);
    for (const [unitIndex, block] of blocks.entries()) {
      const paragraph = body.createEl("p");
      const unit = (pane.units || [])[unitIndex] || `${pane.edition}:legacy-${unitIndex + 1}`;
      const kind = (pane.unit_kinds || [])[unitIndex] || "paragraph";
      paragraph.dataset.unitId = unit;
      paragraph.dataset.unitKind = kind;
      const blockSpans = spans
        .filter((span) => (
          span.unit === unit &&
          span.start >= block.start &&
          span.end <= block.end
        ))
        .sort((left, right) => left.start - right.start);
      if (!blockSpans.length) {
        paragraph.setText(block.text);
        continue;
      }

      let cursor = block.start;
      for (const span of blockSpans) {
        if (span.start > cursor) {
          paragraph.createSpan({
            text: sliceCodePoints(pane.text, cursor, span.start),
          });
        }
        const sentenceText = sliceCodePoints(pane.text, span.start, span.end);
        const sentence = paragraph.createSpan({
          cls: "lt-sentence",
          attr: {
            "data-sentence-id": span.id,
            "data-unit-id": span.unit,
          },
        });
        const preferenceKey = sentencePreferenceKey(payload.key, pane.edition, span.id);
        const preferred = Boolean(getLedger().sentence_preferences[preferenceKey]);
        sentence.toggleClass("lt-sentence-preferred", preferred);
        const sentenceChoice = sentence.createEl("label", {
          cls: "lt-sentence-choice-wrap",
          attr: { title: t("sentence_prefer_title") },
        });
        const checkbox = sentenceChoice.createEl("input", {
          type: "checkbox",
          cls: "lt-sentence-choice",
          attr: {
            "aria-label": t("sentence_prefer_aria", { name: pane.title || pane.edition }),
          },
        });
        checkbox.checked = preferred;
        checkbox.addEventListener("change", async () => {
          checkbox.disabled = true;
          try {
            const nextLedger = await this.saveSentencePreference(
              payload, pane, span, sentenceText, checkbox.checked
            );
            setLedger(nextLedger);
            sentence.toggleClass("lt-sentence-preferred", checkbox.checked);
          } catch (error) {
            checkbox.checked = !checkbox.checked;
            console.error("firstpair-triptych: sentence preference failed", error);
            new Notice(t("sentence_save_failed_console"));
          } finally {
            checkbox.disabled = false;
          }
        });

        const textEl = sentence.createSpan({ cls: "lt-sentence-text" });
        const refreshHighlights = () => {
          this.renderPhraseHighlights(
            payload, pane, span, sentenceText, textEl, root, getLedger, setLedger,
            refreshHighlights
          );
        };
        refreshHighlights();

        const inspectSelection = (delay = 0) => {
          window.setTimeout(() => {
            this.openPhraseSelection(
              payload, pane, span, sentenceText, textEl, root,
              getLedger, setLedger, refreshHighlights
            );
          }, delay);
        };
        textEl.addEventListener("mouseup", () => inspectSelection());
        textEl.addEventListener("touchend", () => inspectSelection(120), { passive: true });
        textEl.addEventListener("keyup", (event) => {
          if (event.key === "Shift" || event.shiftKey) inspectSelection();
        });
        cursor = span.end;
      }
      if (cursor < block.end) {
        paragraph.createSpan({
          text: sliceCodePoints(pane.text, cursor, block.end),
        });
      }
    }
  }

  renderPhraseHighlights(
    payload, pane, span, sentenceText, textEl, root,
    getLedger, setLedger, refreshHighlights
  ) {
    const annotations = annotationsForSentence(getLedger(), payload, pane, span)
      .map((annotation) => ({
        ...annotation,
        resolved: resolveAnnotation(sentenceText, annotation),
      }))
      .filter((annotation) => annotation.resolved)
      .sort((left, right) => left.resolved.start - right.resolved.start);
    textEl.empty();
    let cursor = 0;
    for (const annotation of annotations) {
      const { start, end } = annotation.resolved;
      if (start < cursor) continue; // malformed/legacy overlap; retain it in the ledger
      if (start > cursor) {
        textEl.createSpan({ text: sliceCodePoints(sentenceText, cursor, start) });
      }
      const mark = textEl.createEl("mark", {
        cls:
          "lt-phrase-mark " +
          (annotation.kind === "ungrammatical"
            ? "lt-phrase-ungrammatical"
            : "lt-phrase-prefer"),
        text: sliceCodePoints(sentenceText, start, end),
        attr: {
          role: "button",
          tabindex: "0",
          title: t("phrase_mark_title"),
        },
      });
      const edit = (event) => {
        const selection = textEl.ownerDocument.defaultView.getSelection();
        if (selection && !selection.isCollapsed) return;
        event.preventDefault();
        event.stopPropagation();
        this.showPhraseMenu({
          payload,
          pane,
          span,
          sentenceText,
          selector: {
            start,
            end,
            exact: annotation.exact,
            prefix: annotation.prefix,
            suffix: annotation.suffix,
          },
          existing: annotation,
          anchorRect: mark.getBoundingClientRect(),
          root,
          getLedger,
          setLedger,
          refreshHighlights,
        });
      };
      mark.addEventListener("click", edit);
      mark.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") edit(event);
      });
      cursor = end;
    }
    if (cursor < codePointLength(sentenceText)) {
      textEl.createSpan({ text: sliceCodePoints(sentenceText, cursor) });
    }
  }

  openPhraseSelection(
    payload, pane, span, sentenceText, textEl, root,
    getLedger, setLedger, refreshHighlights
  ) {
    const view = textEl.ownerDocument.defaultView;
    const selection = view && view.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
    const range = selection.getRangeAt(0);
    if (
      !textEl.contains(range.startContainer) ||
      !textEl.contains(range.endContainer)
    ) {
      return; // phrase controls deliberately stop at one sentence
    }
    const offsets = rangeOffsets(textEl, range);
    if (!offsets || offsets.start >= offsets.end) return;
    const raw = sliceCodePoints(sentenceText, offsets.start, offsets.end);
    const leading = codePointLength(raw) - codePointLength(raw.trimStart());
    const trailing = codePointLength(raw) - codePointLength(raw.trimEnd());
    const start = offsets.start + leading;
    const end = offsets.end - trailing;
    if (start >= end) return;
    const selector = phraseSelector(sentenceText, start, end);
    const annotationId = phraseAnnotationKey(
      payload.key, pane.edition, span.id, start, end, selector.exact
    );
    const existing = getLedger().phrase_annotations[annotationId];
    if (!existing && !this.overlapAllowed(
      this.sentenceRecords(getLedger, payload, pane, span), sentenceText, selector
    )) return;
    this.showPhraseMenu({
      payload,
      pane,
      span,
      sentenceText,
      selector,
      existing: existing ? { id: annotationId, ...existing } : null,
      anchorRect: range.getBoundingClientRect(),
      root,
      getLedger,
      setLedger,
      refreshHighlights,
    });
  }

  showPhraseMenu(options) {
    const {
      payload, pane, span, sentenceText, selector, existing, anchorRect, root,
      getLedger, setLedger, refreshHighlights,
    } = options;
    const document = root.ownerDocument;
    for (const prior of document.querySelectorAll(".lt-selection-menu")) prior.remove();
    const menu = root.createDiv({
      cls: "lt-selection-menu",
      attr: { role: "dialog", "aria-label": t("phrase_dialog_aria") },
    });
    menu.addEventListener("mousedown", (event) => event.preventDefault());
    const addAction = (label, kind) => {
      const button = menu.createEl("button", {
        cls: "lt-selection-action" + (existing && existing.kind === kind ? " is-active" : ""),
        text: label,
        attr: { type: "button" },
      });
      button.addEventListener("click", async () => {
        try {
          const nextLedger = await this.savePhraseAnnotation(
            payload, pane, span, sentenceText, selector, kind, existing && existing.id
          );
          setLedger(nextLedger);
          refreshHighlights();
          const selection = document.defaultView.getSelection();
          if (selection) selection.removeAllRanges();
          menu.remove();
        } catch (error) {
          console.error("firstpair-triptych: phrase annotation failed", error);
          new Notice(t("phrase_save_failed_console"));
        }
      });
    };
    addAction(t("prefer_this"), "prefer");
    addAction(t("ungrammatical"), "ungrammatical");
    if (existing) {
      const clear = menu.createEl("button", {
        cls: "lt-selection-action lt-selection-clear",
        text: t("clear"),
        attr: { type: "button" },
      });
      clear.addEventListener("click", async () => {
        try {
          const nextLedger = await this.clearPhraseAnnotation(existing.id);
          setLedger(nextLedger);
          refreshHighlights();
          menu.remove();
        } catch (error) {
          console.error("firstpair-triptych: clear phrase annotation failed", error);
          new Notice(t("phrase_clear_failed_console"));
        }
      });
    }
    const close = menu.createEl("button", {
      cls: "lt-selection-close",
      text: "×",
      attr: { type: "button", title: t("close"), "aria-label": t("close_phrase") },
    });
    close.addEventListener("click", () => menu.remove());

    const view = document.defaultView;
    const width = 310;
    const left = Math.max(8, Math.min(anchorRect.left, view.innerWidth - width - 8));
    const below = anchorRect.bottom + 8;
    const top = below + 52 < view.innerHeight
      ? below
      : Math.max(8, anchorRect.top - 52);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  async saveSentencePreference(payload, pane, span, exact, preferred) {
    return this.store.update(this.store.contextFromPayload(payload), (ledger) => {
      const key = sentencePreferenceKey(payload.key, pane.edition, span.id);
      if (!preferred) {
        delete ledger.sentence_preferences[key];
        return;
      }
      ledger.sentence_preferences[key] = {
        fragment_key: payload.key,
        set: payload.set,
        lineage: payload.lineage,
        incipit: payload.incipit,
        edition: pane.edition,
        edition_title: pane.title || pane.edition,
        unit: span.unit,
        sentence_id: span.id,
        sentence_fingerprint: span.fingerprint,
        sentence_text_sha256: span.text_sha256,
        sentence_index: span.sentence_index,
        exact,
        action: "prefer",
        updated_at: new Date().toISOString(),
      };
    });
  }

  async savePhraseAnnotation(
    payload, pane, span, sentenceText, selector, kind, existingId
  ) {
    return this.store.update((ledger) => {
      const key = existingId || phraseAnnotationKey(
        payload.key, pane.edition, span.id,
        selector.start, selector.end, selector.exact
      );
      const others = Object.entries(ledger.phrase_annotations)
        .filter(([otherId, annotation]) => (
          otherId !== key &&
          annotation.fragment_key === payload.key &&
          annotation.edition === pane.edition &&
          annotation.sentence_id === span.id
        ))
        .map(([, annotation]) => annotation);
      if (overlapDepth(sentenceText, others, selector.start, selector.end) >= MAX_SPAN_OVERLAP) {
        throw new Error("phrase would overlap more than three spans");
      }
      const current = ledger.phrase_annotations[key] || {};
      ledger.phrase_annotations[key] = {
        ...current,
        fragment_key: payload.key,
        set: payload.set,
        lineage: payload.lineage,
        incipit: payload.incipit,
        edition: pane.edition,
        edition_title: pane.title || pane.edition,
        unit: span.unit,
        sentence_id: span.id,
        sentence_fingerprint: span.fingerprint,
        sentence_index: span.sentence_index,
        kind,
        exact: selector.exact,
        prefix: selector.prefix,
        suffix: selector.suffix,
        start: selector.start,
        end: selector.end,
        created: current.created || new Date().toISOString(),
        updated: new Date().toISOString(),
      };
    });
  }

  async clearPhraseAnnotation(annotationId) {
    return this.store.update((ledger) => {
      delete ledger.phrase_annotations[annotationId];
    });
  }

  async saveDecision(payload, patch) {
    return this.store.update(this.store.contextFromPayload(payload), (ledger) => {
      const current = ledger.decisions[payload.key] || {};
      const next = {
        ...current,
        set: payload.set,
        lineage: payload.lineage,
        incipit: payload.incipit,
        updated: new Date().toISOString(),
      };
      if ("preferred" in patch) next.preferred = patch.preferred;
      if ("note" in patch) next.note = patch.note;
      if (!next.preferred && !next.note) delete ledger.decisions[payload.key];
      else ledger.decisions[payload.key] = next;
    });
  }

  /* ---------------------------- span notes ------------------------------ */

  spanNoteDetails(payload, pane, span, selector) {
    return {
      id: spanNoteKey(
        payload.key, pane.edition, span.id, selector.start, selector.end, selector.exact,
      ),
      fragment_key: payload.key,
      set: payload.set,
      lineage: payload.lineage,
      incipit: payload.incipit,
      edition: pane.edition,
      edition_title: pane.title || pane.edition,
      unit: span.unit,
      sentence_id: span.id,
      sentence_fingerprint: span.fingerprint,
      sentence_text_sha256: span.text_sha256,
      sentence_index: span.sentence_index,
      selector,
      token_keys: selector.token_keys || [],
    };
  }

  async voiceContext() {
    const reader = await this.loadReaderIndex();
    return { projectId: reader.project_id, sourceContentId: reader.source_content_id };
  }

  /* --------------------------- edited copy ------------------------------ */

  // Apply the preferred edit of every saved Edit to one edition's text and
  // export it for reading and replay.  Sources and generated notes are never
  // touched; overlapping or no-longer-locatable edits are listed as skipped.
  async exportEditedCopy(reader, set, editionId) {
    const context = { projectId: reader.project_id, sourceContentId: reader.source_content_id };
    const ledger = await this.store.load(context);
    const edits = Object.values(ledger.phrase_annotations)
      .filter((record) => record.action === "edit" && record.edition === editionId);
    const byPage = new Map();
    for (const record of edits) {
      if (!byPage.has(record.fragment_key)) byPage.set(record.fragment_key, []);
      byPage.get(record.fragment_key).push(record);
    }
    const applied = [];
    const skipped = [];
    const lines = [];
    let currentPart = null;
    for (const page of set.pages) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(`${page.note}.md`));
      if (!file) continue;
      const payload = validateIndexedTriptychPayload(
        extractTriptychPayload(await this.app.vault.cachedRead(file)), `${page.note}.md`, reader,
      );
      const pane = payload.panes.find((item) => item.edition === editionId);
      if (!pane || !pane.text) continue;
      const located = [];
      for (const record of byPage.get(page.key) || []) {
        const variant = preferredCorrectionVariant(record);
        const span = pane.sentence_spans.find((item) => item.id === record.sentence_id);
        const resolved = span && resolveAnnotation(
          sliceCodePoints(pane.text, span.start, span.end), record,
        );
        const entry = {
          fragment_key: page.key, sentence_id: record.sentence_id, exact: record.exact,
          replacement: variant ? variant.text : "", variant_id: variant ? variant.id : null,
        };
        if (!variant || !resolved) {
          skipped.push({ ...entry, reason: variant ? "text no longer matches" : "no preferred variant" });
          continue;
        }
        located.push({ ...entry, start: span.start + resolved.start, end: span.start + resolved.end });
      }
      located.sort((left, right) => left.start - right.start || left.end - right.end);
      const chosen = [];
      for (const entry of located) {
        if (chosen.length && entry.start < chosen[chosen.length - 1].end) {
          skipped.push({ ...entry, reason: "overlaps an earlier edit" });
        } else chosen.push(entry);
      }
      const points = Array.from(pane.text);
      for (const entry of [...chosen].reverse()) {
        points.splice(entry.start, entry.end - entry.start, ...Array.from(entry.replacement));
      }
      applied.push(...chosen.map(({ start, end, ...entry }) => entry));
      const part = set.partById.get(page.part_id);
      if (part && part !== currentPart) {
        lines.push(`# ${part.title}`, "");
        currentPart = part;
      }
      points.join("").split(/\n{2,}/).forEach((unit, index) => {
        lines.push((pane.unit_kinds[index] === "heading" ? `## ${unit}` : unit), "");
      });
    }
    const edition = reader.editions.find((item) => item.id === editionId) || {};
    const stem = `${set.id}-${editionId}-edited`.replace(/[^A-Za-z0-9._-]+/g, "-");
    const folder = "Preferences/Exports";
    await ensureFolder(this.app.vault.adapter, folder);
    const header = [
      "---",
      `edition: ${JSON.stringify(editionId)}`,
      `version: ${JSON.stringify(edition.version || "")}`,
      `source_commit: ${JSON.stringify(edition.source_commit || "")}`,
      `source_content_id: ${JSON.stringify(reader.source_content_id)}`,
      `review_revision: ${ledger.revision || 0}`,
      `applied_edits: ${applied.length}`,
      `skipped_edits: ${skipped.length}`,
      "---",
      "",
    ];
    await this.app.vault.adapter.write(`${folder}/${stem}.md`, `${[...header, ...lines].join("\n").trimEnd()}\n`);
    await this.app.vault.adapter.write(`${folder}/${stem}.json`, `${JSON.stringify({
      schema: "firstpair.triptych-edited-copy.v1",
      set: set.id,
      edition: editionId,
      version: edition.version || "",
      source_commit: edition.source_commit || "",
      source_content_id: reader.source_content_id,
      review_revision: ledger.revision || 0,
      applied,
      skipped,
    }, null, 2)}\n`);
    return { path: `${folder}/${stem}.md`, applied: applied.length, skipped: skipped.length };
  }

  requestCorrection(root, quote, initialValue = "", existing = false) {
    const document = root.ownerDocument;
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "lt-correction-overlay";
      const dialog = document.createElement("section");
      dialog.className = "lt-correction-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      const title = document.createElement("h2");
      title.textContent = existing ? t("edit_phrase") : t("propose_correction");
      const selected = document.createElement("p");
      selected.className = "lt-correction-quote";
      selected.textContent = t("selected_quote", { quote });
      const field = document.createElement("textarea");
      field.rows = 4;
      field.value = initialValue;
      field.setAttribute("aria-label", t("replacement_aria"));
      const error = document.createElement("p");
      error.className = "lt-correction-error";
      const actions = document.createElement("div");
      actions.className = "lt-correction-actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = t("cancel");
      const replace = document.createElement("button");
      replace.type = "button";
      replace.className = "mod-cta";
      replace.textContent = existing ? t("save_replace") : t("save_edit");
      const append = existing ? document.createElement("button") : null;
      if (append) {
        append.type = "button";
        append.textContent = t("save_next");
      }
      actions.append(cancel, replace);
      if (append) actions.appendChild(append);
      dialog.append(title, selected, field, error, actions);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        document.removeEventListener("keydown", keydown, true);
        overlay.remove();
        resolve(value);
      };
      const save = (mode) => {
        const value = field.value.trim();
        if (!value) {
          error.textContent = t("enter_replacement");
          field.focus();
          return;
        }
        finish({ mode, value });
      };
      const keydown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
        }
      };
      document.addEventListener("keydown", keydown, true);
      cancel.addEventListener("click", () => finish(null));
      replace.addEventListener("click", () => save(existing ? "replace" : "create"));
      if (append) append.addEventListener("click", () => save("append"));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) finish(null);
      });
      document.defaultView.setTimeout(() => field.focus(), 0);
    });
  }

  async persistPhraseAction(
    payload, pane, span, sentenceText, selector, action, existing,
    correction = null, mode = "create",
  ) {
    const context = this.store.contextFromPayload(payload);
    return this.store.update(context, (ledger) => {
      if (action === "clear") {
        return clearPhraseAnnotation(ledger, existing.id);
      }
      if (action === "prefer-variant") {
        return setPreferredCorrectionVariant(ledger, existing.id, mode);
      }
      return upsertPhraseAnnotation(
        ledger,
        {
          id: existing && existing.id,
          fragment_key: payload.key,
          set: payload.set,
          lineage: payload.lineage,
          incipit: payload.incipit,
          edition: pane.edition,
          edition_title: pane.title || pane.edition,
          unit: span.unit,
          sentence_id: span.id,
          sentence_fingerprint: span.fingerprint,
          sentence_text_sha256: span.text_sha256,
          sentence_index: span.sentence_index,
          selector,
          token_keys: selector.token_keys || [],
        },
        action,
        correction,
        mode,
      );
    });
  }

  showEditorialPhraseMenu(options) {
    const {
      payload, pane, span, sentenceText, selector, existing, anchor, root,
      setLedger, refresh,
    } = options;
    const document = root.ownerDocument;
    for (const prior of document.querySelectorAll(".lt-selection-menu")) prior.remove();
    const menu = document.createElement("div");
    menu.className = "lt-selection-menu lt-editorial-menu";
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", t("review_quote_aria", { quote: selector.exact }));
    const row = document.createElement("div");
    row.className = "lt-selection-actions";
    const ledgerRecords = () => this.sentenceRecords(() => this.store.cache || { phrase_annotations: {}, span_notes: {} }, payload, pane, span);
    const save = async (action, correction = null, mode = "create") => {
      if (!existing && action !== "clear" && !this.overlapAllowed(ledgerRecords(), sentenceText, selector)) return;
      try {
        const next = await this.persistPhraseAction(
          payload, pane, span, sentenceText, selector, action, existing,
          correction, mode,
        );
        setLedger(next);
        refresh();
        menu.remove();
      } catch (error) {
        console.error("firstpair-triptych: phrase choice failed", error);
        new Notice(t("phrase_choice_failed", { error: error.message || error }));
      }
    };
    for (const action of ["good", "bad", "edit"]) {
      const label = actionLabel(action);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.className = `lt-selection-action lt-action-${action}`;
      button.addEventListener("click", async () => {
        if (action !== "edit") {
          await save(action);
          return;
        }
        const preferred = existing && preferredCorrectionVariant(existing);
        const request = await this.requestCorrection(
          root,
          selector.exact,
          preferred ? preferred.text : "",
          Boolean(preferred),
        );
        if (request) await save("edit", request.value, request.mode);
      });
      row.appendChild(button);
    }
    for (const [kind, autoRecord] of [["note", false], ["voice", true]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = t(`action_${kind}`);
      button.className = `lt-selection-action lt-action-${kind}`;
      button.addEventListener("click", () => {
        if (!this.overlapAllowed(ledgerRecords(), sentenceText, selector)) return;
        menu.remove();
        this.openSpanNoteDialog({
          payload, pane, span, selector, root, setLedger, refresh, autoRecord,
        });
      });
      row.appendChild(button);
    }
    if (existing) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.textContent = t("clear");
      clear.className = "lt-selection-action lt-selection-clear";
      clear.addEventListener("click", () => void save("clear"));
      row.appendChild(clear);
    }
    menu.appendChild(row);
    if (existing && existing.action === "edit") {
      const variants = document.createElement("div");
      variants.className = "lt-correction-variants";
      const heading = document.createElement("div");
      heading.className = "lt-variant-heading";
      heading.textContent = t("variants_heading");
      variants.appendChild(heading);
      for (const variant of existing.correction_variants || []) {
        const label = document.createElement("label");
        label.className = "lt-variant-choice";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = variant.id === existing.preferred_variant_id;
        const text = document.createElement("span");
        text.textContent = variant.text;
        label.append(checkbox, text);
        checkbox.addEventListener("change", async () => {
          if (!checkbox.checked) {
            checkbox.checked = true;
            return;
          }
          await save("prefer-variant", null, variant.id);
        });
        variants.appendChild(label);
      }
      menu.appendChild(variants);
    }
    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    const view = document.defaultView;
    const menuRect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, view.innerWidth - menuRect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 6, view.innerHeight - menuRect.height - 8))}px`;
    const dismiss = (event) => {
      if (!menu.contains(event.target) && event.target !== anchor) {
        menu.remove();
        document.removeEventListener("pointerdown", dismiss, true);
      }
    };
    document.addEventListener("pointerdown", dismiss, true);
  }

  // Every saved span of one sentence: Good/Bad/Edit phrases and notes.
  sentenceRecords(getLedger, payload, pane, span) {
    return [
      ...annotationsForSentence(getLedger(), payload.key, pane.edition, span.id),
      ...spanNotesForSentence(getLedger(), payload.key, pane.edition, span.id)
        .map((note) => ({ ...note, action: "note" })),
    ];
  }

  overlapAllowed(records, sentenceText, selector) {
    return editor.overlapAllowed(records, sentenceText, selector);
  }

  openSpanRecord(record, context) {
    const { payload, pane, span, sentenceText, root, setLedger, refresh, anchor } = context;
    const selector = makeSelector(sentenceText, record.start, record.end, record.token_keys);
    if (record.action === "note") {
      this.openSpanNoteDialog({ payload, pane, span, selector, root, setLedger, refresh });
      return;
    }
    this.showEditorialPhraseMenu({
      payload, pane, span, sentenceText, selector, existing: record, anchor, root, setLedger, refresh,
    });
  }

  renderEditorialSentenceText(
    payload, pane, span, sentenceText, copy, view, root, getLedger, setLedger,
  ) {
    const records = this.sentenceRecords(getLedger, payload, pane, span);
    const context = { payload, pane, span, sentenceText, root, setLedger, refresh: view.refresh };
    copy.setText(sentenceText);
    editor.paintSpans(copy, records, {
      onOpen: (record, mark) => this.openSpanRecord(record, { ...context, anchor: mark }),
    });
    view.picker?.paint(records);
    if (view.diff) diffView.paint(copy, view.diff.ranges, span.start, view.diff.options);
  }

  renderEditorialSavedPhrases(
    payload, pane, span, sentenceText, view, root, getLedger, setLedger,
  ) {
    const records = this.sentenceRecords(getLedger, payload, pane, span);
    const context = { payload, pane, span, sentenceText, root, setLedger, refresh: view.refresh };
    editor.renderSavedRows(view.saved, records, {
      label: (record) => {
        if (record.action === "note") {
          const bits = [actionLabel("note")];
          if (record.voice.length) bits.push(`🎙 ${record.voice.length}`);
          if (record.text) bits.push(record.text);
          return `“${record.exact}” · ${bits.join(" · ")}`;
        }
        const preferred = preferredCorrectionVariant(record);
        return `“${record.exact}” · ${record.action === "edit" && preferred
          ? `${actionLabel("edit")} → ${preferred.text}` : actionLabel(record.action)}`;
      },
      onOpen: (record, anchor) => this.openSpanRecord(record, { ...context, anchor }),
      confirmRemove: (record) => record.action === "note" && record.voice.length > 0,
      onRemove: async (record) => {
        if (record.action === "note") {
          // Removing a note retires its recordings to the Obsidian trash.
          const ledgerContext = this.store.contextFromPayload(payload);
          setLedger(await this.store.update(ledgerContext, (current) => clearSpanNote(current, record.id)));
          for (const clip of record.voice) await this.trashVaultPath(clip.path);
        } else {
          const selector = makeSelector(sentenceText, record.start, record.end, record.token_keys);
          setLedger(await this.persistPhraseAction(payload, pane, span, sentenceText, selector, "clear", record));
        }
        view.refresh();
      },
    });
  }

  renderEditorialPaneBody(payload, pane, body, root, getLedger, setLedger, diff = null) {
    const blocks = paneBlocks(pane.text);
    if (!blocks.length) {
      body.createEl("p", { cls: "lt-empty", text: t("absent") });
      return;
    }
    const spans = sentenceSpansForPane(pane, blocks);
    for (const [unitIndex, block] of blocks.entries()) {
      const paragraph = body.createEl("p");
      const unit = (pane.units || [])[unitIndex] || `${pane.edition}:legacy-${unitIndex + 1}`;
      const kind = (pane.unit_kinds || [])[unitIndex] || "paragraph";
      if (kind === "heading") paragraph.addClass("lt-heading-unit");
      const blockSpans = spans.filter((span) => (
        span.unit === unit && span.start >= block.start && span.end <= block.end
      )).sort((left, right) => left.start - right.start);
      if (!blockSpans.length) {
        paragraph.setText(block.text);
        paragraph.setAttribute("data-fp-offset", String(block.start));
        continue;
      }
      let cursor = block.start;
      for (const span of blockSpans) {
        if (span.start > cursor) {
          paragraph.createSpan({
            text: sliceCodePoints(pane.text, cursor, span.start),
            attr: { "data-fp-offset": String(cursor) },
          });
        }
        const sentenceText = sliceCodePoints(pane.text, span.start, span.end);
        const wrapper = paragraph.createSpan({
          cls: "lt-sentence lt-editorial-sentence",
          attr: { "data-sentence-id": span.id, "data-unit-id": span.unit },
        });
        const controls = wrapper.createSpan({ cls: "lt-sentence-controls" });
        if (kind === "heading") {
          controls.createSpan({
            cls: "lt-fragment-kind-badge",
            text: t("heading_badge"),
            attr: { "aria-label": t("heading_aria") },
          });
        }
        const preferenceKey = sentencePreferenceKey(payload.key, pane.edition, span.id);
        const preferLabel = controls.createEl("label", {
          cls: "lt-sentence-choice-wrap",
          attr: { title: t("prefer_sentence_title", { name: pane.title || pane.edition }) },
        });
        const prefer = preferLabel.createEl("input", {
          type: "checkbox",
          attr: { "aria-label": t("prefer_sentence_title", { name: pane.title || pane.edition }) },
        });
        prefer.checked = Boolean(getLedger().sentence_preferences[preferenceKey]);
        const wordsButton = controls.createEl("button", {
          cls: "lt-words-toggle",
          text: t("words"),
          attr: { type: "button", "aria-pressed": "false" },
        });
        const copy = wrapper.createSpan({
          cls: "lt-sentence-text lt-editorial-copy",
          attr: { "data-fp-offset": String(span.start) },
        });
        const editorEl = wrapper.createSpan({ cls: "lt-word-editor" });
        const tokens = span.tokens || wordTokens(sentenceText, span.id);
        const view = { wrapper, wordsButton, copy, editor: editorEl, saved: null, refresh: null, picker: null, diff };
        const records = () => this.sentenceRecords(getLedger, payload, pane, span);
        const savePhrase = async (action, selector, actionButton) => {
          const annotationId = phraseAnnotationKey(
            payload.key, pane.edition, span.id, selector.start, selector.end, selector.exact,
          );
          const prior = getLedger().phrase_annotations[annotationId];
          const current = prior ? { id: annotationId, ...prior } : null;
          if (!this.overlapAllowed(records(), sentenceText, selector)) return;
          let correction = null;
          let mode = "create";
          if (action === "edit") {
            const preferred = current && preferredCorrectionVariant(current);
            const request = await this.requestCorrection(
              root, selector.exact, preferred ? preferred.text : "", Boolean(current),
            );
            if (!request) return;
            correction = request.value;
            mode = request.mode;
          }
          try {
            setLedger(await this.persistPhraseAction(
              payload, pane, span, sentenceText, selector, action, current, correction, mode,
            ));
            view.picker.clear();
            view.refresh();
          } catch (error) {
            console.error("firstpair-triptych: selected phrase failed", error);
            new Notice(t("phrase_choice_failed", { error: error.message || error }));
            if (actionButton) actionButton.focus();
          }
        };
        const openNote = (selector, autoRecord) => {
          if (!this.overlapAllowed(records(), sentenceText, selector)) return;
          this.openSpanNoteDialog({
            payload, pane, span, selector, root, setLedger, autoRecord,
            refresh: view.refresh,
            onClose: () => view.picker.clear(),
          });
        };
        view.picker = editor.createWordPicker(editorEl, sentenceText, tokens, {
          actions: [
            ...["good", "bad", "edit"].map((key) => ({ key, onSelect: (selector, button) => savePhrase(key, selector, button) })),
            { key: "note", onSelect: (selector) => openNote(selector, false) },
            { key: "voice", onSelect: (selector) => openNote(selector, true) },
          ],
          onOnly: (selector, anchor) => {
            const annotationId = phraseAnnotationKey(
              payload.key, pane.edition, span.id, selector.start, selector.end, selector.exact,
            );
            const prior = getLedger().phrase_annotations[annotationId];
            this.showEditorialPhraseMenu({
              payload, pane, span, sentenceText, selector,
              existing: prior ? { id: annotationId, ...prior } : null,
              anchor, root, setLedger, refresh: view.refresh,
            });
          },
        });
        view.saved = editorEl.createSpan({ cls: "lt-saved-phrases" });
        wordsButton.addEventListener("click", () => {
          const editing = !wrapper.hasClass("is-editing-words");
          wrapper.toggleClass("is-editing-words", editing);
          wordsButton.setAttribute("aria-pressed", editing ? "true" : "false");
        });
        prefer.addEventListener("change", async () => {
          prefer.disabled = true;
          try {
            const next = await this.saveSentencePreference(
              payload, pane, span, sentenceText, prefer.checked,
            );
            setLedger(next);
          } catch (error) {
            prefer.checked = !prefer.checked;
            new Notice(t("sentence_save_failed", { error: error.message || error }));
          } finally {
            prefer.disabled = false;
          }
        });
        view.refresh = () => {
          this.renderEditorialSentenceText(
            payload, pane, span, sentenceText, copy, view, root, getLedger, setLedger,
          );
          this.renderEditorialSavedPhrases(
            payload, pane, span, sentenceText, view, root, getLedger, setLedger,
          );
        };
        view.refresh();
        cursor = span.end;
      }
      if (cursor < block.end) {
        paragraph.createSpan({
          text: sliceCodePoints(pane.text, cursor, block.end),
          attr: { "data-fp-offset": String(cursor) },
        });
      }
    }
  }
};

voiceCore.install(module.exports);

/* -------------------------------- settings ------------------------------- */

class TriptychSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "FirstPair Triptych" });

    new Setting(containerEl)
      .setName(t("settings_lineage"))
      .setDesc(t("settings_lineage_desc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enhanceLineage).onChange(async (value) => {
          this.plugin.settings.enhanceLineage = value;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(t("settings_transformation"))
      .setDesc(t("settings_transformation_desc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enhanceTransformation).onChange(async (value) => {
          this.plugin.settings.enhanceTransformation = value;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName(t("settings_previews"))
      .setDesc(t("settings_previews_desc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.comparisonPreviews).onChange(async (value) => {
          this.plugin.settings.comparisonPreviews = value;
          await this.plugin.saveSettings();
        })
      );

    const known = Object.entries(this.plugin.settings.knownEditions).sort();
    new Setting(containerEl)
      .setName(t("settings_solo"))
      .setDesc(t("settings_solo_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("", t("solo_all"));
        for (const [id, title] of known) dropdown.addOption(id, title);
        dropdown.setValue(this.plugin.settings.soloEdition || "").onChange(async (value) => {
          this.plugin.settings.soloEdition = value;
          await this.plugin.saveSettings();
        });
      });

    const metrics = this.plugin.rankedMetrics({ includeHidden: true });
    if (metrics.length) {
      containerEl.createEl("h3", { text: t("metrics_heading") });
      containerEl.createEl("p", { text: t("metrics_desc") });
      const saveOrder = async (ordered) => {
        this.plugin.settings.metricOrder = ordered.map((metric) => metric.key);
        await this.plugin.saveSettings();
        this.display();
      };
      metrics.forEach((metric, index) => {
        new Setting(containerEl)
          .setName(`${metric.letter} · ${metricText(metric, "label")}`)
          .setDesc(metricText(metric, "description"))
          .addExtraButton((button) => button.setIcon("arrow-up").setTooltip(t("move_up"))
            .setDisabled(index === 0)
            .onClick(() => {
              const next = [...metrics];
              [next[index - 1], next[index]] = [next[index], next[index - 1]];
              void saveOrder(next);
            }))
          .addExtraButton((button) => button.setIcon("arrow-down").setTooltip(t("move_down"))
            .setDisabled(index === metrics.length - 1)
            .onClick(() => {
              const next = [...metrics];
              [next[index + 1], next[index]] = [next[index], next[index + 1]];
              void saveOrder(next);
            }))
          .addToggle((toggle) => toggle
            .setValue(!(this.plugin.settings.metricHidden || {})[metric.key])
            .onChange(async (value) => {
              this.plugin.settings.metricHidden = { ...(this.plugin.settings.metricHidden || {}) };
              if (value) delete this.plugin.settings.metricHidden[metric.key];
              else this.plugin.settings.metricHidden[metric.key] = true;
              await this.plugin.saveSettings();
            }));
      });
    }

    containerEl.createEl("h3", { text: t("settings_voice") });
    const text = (name, key, placeholder, desc = "") => {
      const setting = new Setting(containerEl).setName(t(name));
      if (desc) setting.setDesc(t(desc));
      setting.addText((field) => field
        .setPlaceholder(placeholder)
        .setValue(this.plugin.settings[key] || "")
        .onChange(async (value) => {
          this.plugin.settings[key] = value.trim();
          await this.plugin.saveSettings();
        }));
      return setting;
    };
    new Setting(containerEl)
      .setName(t("settings_engine"))
      .setDesc(t("settings_engine_desc"))
      .addDropdown((dropdown) => dropdown
        .addOption("auto", `${t("engine_local")} → ${t("engine_api")}`)
        .addOption("local", t("engine_local"))
        .addOption("api", t("engine_api"))
        .addOption("off", t("engine_off"))
        .setValue(this.plugin.settings.transcriptionEngine || "auto")
        .onChange(async (value) => {
          this.plugin.settings.transcriptionEngine = value;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName(t("settings_auto"))
      .setDesc(t("settings_auto_desc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.autoTranscribe)
        .onChange(async (value) => {
          this.plugin.settings.autoTranscribe = value;
          await this.plugin.saveSettings();
        }));
    text("settings_language", "voiceLanguage", "auto · en · ru · it");
    if (Platform && Platform.isDesktopApp) {
      text("settings_mlx_path", "mlxWhisperPath", "~/.local/bin/mlx_whisper");
      text("settings_mlx_model", "mlxModel", DEFAULT_MLX_MODEL);
    }
    text("settings_api_url", "apiBaseUrl", "https://api.openai.com/v1");
    const keySetting = text("settings_api_key", "apiKey", "sk-…", "settings_api_key_desc");
    const keyInput = keySetting.controlEl.querySelector("input");
    if (keyInput) keyInput.type = "password";
    text("settings_api_model", "apiModel", "whisper-1");

    containerEl.createEl("p", {
      text: t("settings_visibility"),
    });
    const editions = Object.entries(this.plugin.settings.knownEditions).sort();
    if (editions.length === 0) {
      containerEl.createEl("p", { text: t("settings_no_editions") });
    }
    for (const [id, title] of editions) {
      new Setting(containerEl)
        .setName(title)
        .setDesc(id)
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.editionVisibility[id] !== false)
            .onChange(async (value) => {
              this.plugin.settings.editionVisibility[id] = value;
              await this.plugin.saveSettings();
            })
        );
    }
  }
}

module.exports.__test = Object.freeze({
  ReviewView: FirstPairTriptychReviewView,
  diffView,
  detectBookRoot,
  detectUiLanguage,
  parseMetrics,
  metricSeverity,
  formatMetric,
  worstFirst,
  setUiLanguage: (lang) => { uiLanguage = lang; },
  uiLanguage: () => uiLanguage,
  FirstPairTriptychReaderView,
  FirstPairTriptychReviewView,
  READER_ICONS,
  READER_HISTORY_LIMIT,
  READER_INDEX_PATH,
  READER_VIEW_TYPE,
  extractTriptychPayload,
  isTriptychReaderNotePath,
  parseTriptychReaderIndex,
  validateTriptychPayload,
  validateIndexedTriptychPayload,
  editorialPageDigest,
  DecisionStore,
});
