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
async function detectUiLanguage(adapter) {
  try {
    const path = normalizePath(EDITIONS_LEDGER_PATH);
    if (!(await adapter.exists(path))) return "en";
    return pickUiLanguage(await adapter.read(path));
  } catch (_error) {
    return "en";
  }
}

const LEDGER_PATH = "Preferences/triptych-decisions.json";
const DIGEST_PATH = "Preferences/EDITING-INSTRUCTIONS.md";
const LEDGER_HASH_PATH = "Preferences/triptych-decisions.sha256";
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

class DecisionStore {
  constructor(app) {
    this.app = app;
    this.queue = Promise.resolve();
    this.cache = null;
    this.sequence = 0;
  }

  contextFromPayload(payload) {
    return {
      projectId: payload.project_id,
      sourceContentId: payload.source_content_id,
    };
  }

  async _readSnapshot(context) {
    const adapter = this.app.vault.adapter;
    const path = normalizePath(LEDGER_PATH);
    try {
      if (await adapter.exists(path)) {
        const serialized = await adapter.read(path);
        const parsed = JSON.parse(serialized);
        const hashPath = normalizePath(LEDGER_HASH_PATH);
        const digestPath = normalizePath(DIGEST_PATH);
        const hashExists = await adapter.exists(hashPath);
        const digestExists = await adapter.exists(digestPath);
        const installedHash = hashExists ? await adapter.read(hashPath) : null;
        const installedDigest = digestExists ? await adapter.read(digestPath) : null;
        if (hashExists) {
          if (installedHash !== digestLine(serialized)) {
            throw new Error("triptych review-choice digest mismatch");
          }
        } else if (parsed && parsed.schema === LEDGER_SCHEMA) {
          throw new Error("v4 triptych review choices require a .sha256 sidecar");
        }
        if (parsed && parsed.schema === LEDGER_SCHEMA && !digestExists) {
          throw new Error("v4 triptych review choices require an editing digest");
        }
        return {
          ledger: normalizeLedger(parsed, context),
          files: { json: serialized, digest: installedDigest, hash: installedHash },
        };
      }
      if (
        await adapter.exists(normalizePath(DIGEST_PATH))
        || await adapter.exists(normalizePath(LEDGER_HASH_PATH))
      ) throw new Error("triptych review sidecars exist without a ledger");
    } catch (error) {
      console.error("firstpair-triptych: unreadable ledger", error);
      new Notice(t("ledger_unreadable"));
      throw error;
    }
    return { ledger: emptyLedger(context), files: { json: null, digest: null, hash: null } };
  }

  async _read(context) {
    return (await this._readSnapshot(context)).ledger;
  }

  async load(context) {
    if (
      this.cache
      && this.cache.project_id === context.projectId
      && this.cache.source_content_id === context.sourceContentId
    ) return this.cache;
    this.cache = await this._read(context);
    return this.cache;
  }

  update(context, mutator) {
    const operation = this.queue.catch(() => undefined).then(async () => {
      const adapter = this.app.vault.adapter;
      const dir = normalizePath("Preferences");
      if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
      const snapshot = await this._readSnapshot(context);
      let ledger = snapshot.ledger;
      const baseRevision = Math.max(0, Number(ledger.revision) || 0);
      const result = mutator(ledger);
      if (result && typeof result === "object") ledger = result;
      ledger = normalizeLedger(ledger, context);
      ledger.version = 4;
      ledger.revision = Math.max(
        baseRevision + 1,
        Math.max(0, Number(ledger.revision) || 0),
      );
      const serialized = serializeLedger(ledger);
      await this._writePair(
        serialized,
        renderDigest(ledger),
        digestLine(serialized),
        snapshot.files,
      );
      this.cache = ledger;
      return ledger;
    });
    this.queue = operation;
    return operation;
  }

  async _removeIfPresent(path) {
    const adapter = this.app.vault.adapter;
    if (await adapter.exists(path)) await adapter.remove(path);
  }

  async _writePair(serialized, digest, ledgerHash, expectedFiles) {
    const adapter = this.app.vault.adapter;
    this.sequence += 1;
    const suffix = `.txn-${Date.now()}-${this.sequence}`;
    const jsonPath = normalizePath(LEDGER_PATH);
    const digestPath = normalizePath(DIGEST_PATH);
    const hashPath = normalizePath(LEDGER_HASH_PATH);
    const jsonTemp = normalizePath(`${LEDGER_PATH}${suffix}.tmp`);
    const digestTemp = normalizePath(`${DIGEST_PATH}${suffix}.tmp`);
    const hashTemp = normalizePath(`${LEDGER_HASH_PATH}${suffix}.tmp`);
    const jsonBackup = normalizePath(`${LEDGER_PATH}${suffix}.bak`);
    const digestBackup = normalizePath(`${DIGEST_PATH}${suffix}.bak`);
    const hashBackup = normalizePath(`${LEDGER_HASH_PATH}${suffix}.bak`);
    let oldJsonMoved = false;
    let oldDigestMoved = false;
    let newJsonInstalled = false;
    let newDigestInstalled = false;
    let oldHashMoved = false;
    let newHashInstalled = false;
    try {
      await adapter.write(jsonTemp, serialized);
      await adapter.write(digestTemp, digest);
      await adapter.write(hashTemp, ledgerHash);
      if (await adapter.read(jsonTemp) !== serialized) {
        throw new Error("temporary triptych ledger verification failed");
      }
      if (await adapter.read(digestTemp) !== digest) {
        throw new Error("temporary editing-instruction verification failed");
      }
      if (await adapter.read(hashTemp) !== ledgerHash) {
        throw new Error("temporary triptych ledger digest verification failed");
      }
      for (const [name, path] of [
        ["json", jsonPath], ["digest", digestPath], ["hash", hashPath],
      ]) {
        const expected = expectedFiles[name];
        const exists = await adapter.exists(path);
        if (exists !== (expected !== null) || (exists && await adapter.read(path) !== expected)) {
          throw new Error(
            "triptych review choices changed in another window; reload before saving"
          );
        }
      }
      if (await adapter.exists(jsonPath)) {
        await adapter.rename(jsonPath, jsonBackup);
        oldJsonMoved = true;
      }
      if (await adapter.exists(digestPath)) {
        await adapter.rename(digestPath, digestBackup);
        oldDigestMoved = true;
      }
      if (await adapter.exists(hashPath)) {
        await adapter.rename(hashPath, hashBackup);
        oldHashMoved = true;
      }
      await adapter.rename(jsonTemp, jsonPath);
      newJsonInstalled = true;
      await adapter.rename(digestTemp, digestPath);
      newDigestInstalled = true;
      await adapter.rename(hashTemp, hashPath);
      newHashInstalled = true;
      if (await adapter.read(jsonPath) !== serialized) {
        throw new Error("installed triptych ledger verification failed");
      }
      if (await adapter.read(digestPath) !== digest) {
        throw new Error("installed editing-instruction verification failed");
      }
      if (
        await adapter.read(hashPath) !== ledgerHash
        || digestLine(await adapter.read(jsonPath)) !== ledgerHash
      ) {
        throw new Error("installed triptych ledger digest verification failed");
      }
    } catch (error) {
      const rollbackErrors = [];
      const attempt = async (operation) => {
        try {
          await operation();
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      };
      if (newDigestInstalled) {
        await attempt(() => this._removeIfPresent(digestPath));
      }
      if (newHashInstalled) {
        await attempt(() => this._removeIfPresent(hashPath));
      }
      if (newJsonInstalled) {
        await attempt(() => this._removeIfPresent(jsonPath));
      }
      if (oldJsonMoved) {
        await attempt(async () => {
          if (await adapter.exists(jsonBackup) && !await adapter.exists(jsonPath)) {
            await adapter.rename(jsonBackup, jsonPath);
          }
        });
      }
      if (oldDigestMoved) {
        await attempt(async () => {
          if (await adapter.exists(digestBackup) && !await adapter.exists(digestPath)) {
            await adapter.rename(digestBackup, digestPath);
          }
        });
      }
      if (oldHashMoved) {
        await attempt(async () => {
          if (await adapter.exists(hashBackup) && !await adapter.exists(hashPath)) {
            await adapter.rename(hashBackup, hashPath);
          }
        });
      }
      await attempt(() => this._removeIfPresent(jsonTemp));
      await attempt(() => this._removeIfPresent(digestTemp));
      await attempt(() => this._removeIfPresent(hashTemp));
      if (rollbackErrors.length) error.rollbackErrors = rollbackErrors;
      throw error;
    }
    // Once both installed files have been read back, backup cleanup is
    // housekeeping. It must never turn a committed decision into a reported
    // failure and leave the UI's in-memory ledger behind disk.
    for (const backup of [jsonBackup, digestBackup, hashBackup]) {
      try {
        await this._removeIfPresent(backup);
      } catch (cleanupError) {
        console.warn(
          `firstpair-triptych: retained transaction backup ${backup}`,
          cleanupError
        );
      }
    }
  }
}

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

/* ------------------------------ voice notes ------------------------------ */

// iOS records AAC in MP4; Electron records Opus in WebM.  Both play back on
// the device that made them and both feed Whisper unchanged.
const RECORDER_MIME_TYPES = Object.freeze({
  ios: ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"],
  other: ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"],
});
const LOCAL_TRANSCRIBE_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_MLX_MODEL = "mlx-community/whisper-large-v3-turbo";

// The selected words bias Whisper toward the book's names and spellings
// without inviting it to recite the whole sentence back.
function compactPrompt(exact) {
  return String(exact || "").replace(/\s+/g, " ").trim().slice(0, 200);
}

async function sha256Bytes(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ensureFolder(adapter, folder) {
  let current = "";
  for (const part of normalizePath(folder).split("/")) {
    current = current ? `${current}/${part}` : part;
    if (!(await adapter.exists(current))) await adapter.mkdir(current);
  }
}

class VoiceRecorder {
  constructor() {
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.startedAt = 0;
  }

  get recording() {
    return Boolean(this.recorder && this.recorder.state === "recording");
  }

  async start() {
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
    if (!media || !media.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("this device offers no microphone recorder");
    }
    this.stream = await media.getUserMedia({ audio: true });
    const candidates = RECORDER_MIME_TYPES[Platform && Platform.isIosApp ? "ios" : "other"];
    const mimeType = candidates.find((type) => (
      typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(type)
    ));
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size) this.chunks.push(event.data);
    });
    this.startedAt = Date.now();
    // A timeslice keeps data flowing, so an interrupted take still yields audio.
    this.recorder.start(1000);
  }

  elapsedMs() {
    return this.recording ? Date.now() - this.startedAt : 0;
  }

  stop() {
    return new Promise((resolve, reject) => {
      const recorder = this.recorder;
      if (!recorder || recorder.state === "inactive") {
        this.release();
        reject(new Error("not recording"));
        return;
      }
      recorder.addEventListener("stop", () => {
        const durationMs = Date.now() - this.startedAt;
        const mime = recorder.mimeType || (this.chunks[0] && this.chunks[0].type) || "audio/webm";
        const blob = new Blob(this.chunks, { type: mime });
        this.release();
        resolve({ blob, mime, durationMs });
      }, { once: true });
      recorder.addEventListener("error", (event) => {
        this.release();
        reject(event.error || new Error("recording failed"));
      }, { once: true });
      recorder.stop();
    });
  }

  release() {
    if (this.stream) for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;
    this.recorder = null;
  }
}

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
    this.history = [];
    this.scrollEl = null;
    this.backControl = null;
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
    this.history = [];
    this.updateBackControl();
    this.state = this.plugin.normalizeReaderState(next, this.reader);
    if (this.reader) await this.renderReader({ scrollTop: 0, focus: false });
  }

  async onOpen() {
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
  }

  saveLayout() {
    if (this.app.workspace && typeof this.app.workspace.requestSaveLayout === "function") {
      this.app.workspace.requestSaveLayout();
    }
  }

  captureLocation() {
    return {
      state: { ...this.state },
      scrollTop: Number(this.scrollEl && this.scrollEl.scrollTop) || 0,
    };
  }

  pushHistory(location = this.captureLocation()) {
    this.history.push(location);
    if (this.history.length > READER_HISTORY_LIMIT) this.history.shift();
    this.updateBackControl();
  }

  updateBackControl() {
    if (this.backControl) this.backControl.disabled = !this.history.length;
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
    const prior = this.history.pop();
    if (!prior) return;
    this.state = this.plugin.normalizeReaderState(prior.state, this.reader);
    await this.renderReader({ scrollTop: prior.scrollTop, focus: false });
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
    this.backControl = this.addControl(
      controls,
      "Back",
      () => this.goBack(),
      !this.history.length
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
    await this.renderReview();
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

  async renderReview() {
    this.contentEl.empty();
    this.contentEl.addClass("lt-review-view");
    try {
      this.reader = await this.plugin.loadReaderIndex();
      const context = {
        projectId: this.reader.project_id,
        sourceContentId: this.reader.source_content_id,
      };
      const ledger = await this.plugin.store.load(context);
      const shell = this.contentEl.createDiv({ cls: "lt-review-shell" });
      const bar = shell.createDiv({
        cls: "lt-review-bar",
        attr: { role: "navigation", "aria-label": t("review_nav_aria") },
      });
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
          }));
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
      content.createEl("h2", { text: t("digest_heading") });
      content.createEl("pre", {
        cls: "lt-review-digest",
        text: renderDigest(ledger),
      });
    } catch (error) {
      console.error("firstpair-triptych: Review open failed", error);
      this.contentEl.createEl("h1", { text: t("review_heading") });
      this.contentEl.createEl("p", {
        cls: "lt-reader-error",
        text: error.code === "SOURCE_CONTENT_MISMATCH"
          ? t("source_mismatch")
          : t("review_could_not_open", { error: error.message || error }),
      });
    }
  }
}

const DEFAULT_SETTINGS = {
  editionVisibility: {},
  knownEditions: {},
  soloEdition: "",
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
    setBookRoot(await detectBookRoot(this.app.vault.adapter));
    uiLanguage = await detectUiLanguage(this.app.vault.adapter);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.store = new DecisionStore(this.app);
    this.transcribing = new Set();
    this.voiceListeners = new Set();
    this.pendingRun = null;
    this.readerCache = null;
    this.readerTransition = false;
    this.registerView(
      READER_VIEW_TYPE,
      (leaf) => new FirstPairTriptychReaderView(leaf, this)
    );
    this.registerView(
      REVIEW_VIEW_TYPE,
      (leaf) => new FirstPairTriptychReviewView(leaf, this)
    );
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
        const view = this.activeReaderView();
        if (view) void view.goBack();
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

  async openReader(target = null, selectedLeaf = null) {
    try {
      const reader = await this.loadReaderIndex();
      const leaf = selectedLeaf || this.app.workspace.getLeaf(false);
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

  async openReview(selectedLeaf = null) {
    try {
      await this.loadReaderIndex();
      const leaf = selectedLeaf || this.app.workspace.getLeaf(false);
      await leaf.setViewState({
        type: REVIEW_VIEW_TYPE,
        active: true,
        state: {},
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
      if (target.mode === "review") await this.openReview(leaf);
      else await this.openReader(target, leaf);
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
    let ledger = await this.store.load(context);
    const existing = ledger.decisions[payload.key] || {};
    const review = payload.review || null;

    const root = el.createDiv({ cls: "lt-triptych" });
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

    const paneRow = root.createDiv({ cls: "lt-panes" });
    paneRow.style.setProperty("--lt-panes", String(visiblePanes.length));

    const checkboxes = new Map();
    for (const pane of visiblePanes) {
      const paneReview = review && review.panes ? review.panes[pane.edition] : null;
      const paneEl = paneRow.createDiv({ cls: "lt-pane" });
      if (!pane.text) paneEl.addClass("lt-absent");
      if (paneReview && paneReview.structural && !isSolo) paneEl.addClass("lt-structural");
      if (paneReview && paneReview.outlier && !isSolo) paneEl.addClass("lt-outlier");

      const head = paneEl.createDiv({ cls: "lt-pane-head" });
      head.createSpan({ cls: "lt-pane-title", text: pane.title || pane.edition });

      const label = head.createEl("label", { cls: "lt-prefer" });
      if (isSolo) label.style.display = "none";
      const box = label.createEl("input", { type: "checkbox" });
      box.checked = existing.preferred === pane.edition;
      label.createSpan({ text: t("prefer_this_pane") });
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

      const body = paneEl.createDiv({ cls: "lt-pane-body" });
      this.renderEditorialPaneBody(
        payload,
        pane,
        body,
        root,
        () => ledger,
        (nextLedger) => { ledger = nextLedger; }
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
    const overlap = annotationsForSentence(getLedger(), payload, pane, span)
      .find((annotation) => (
        annotation.id !== annotationId &&
        annotationOverlaps(annotation, selector)
      ));
    if (overlap) {
      new Notice(t("phrase_overlap"));
      return;
    }
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
      for (const [otherId, annotation] of Object.entries(
        ledger.phrase_annotations
      )) {
        if (
          otherId !== key &&
          annotation.fragment_key === payload.key &&
          annotation.edition === pane.edition &&
          annotation.sentence_id === span.id &&
          annotationOverlaps(annotation, selector)
        ) {
          throw new Error(
            "phrase overlaps an existing instruction; clear it first"
          );
        }
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

  notifyVoice() {
    for (const listener of [...this.voiceListeners]) {
      try {
        listener();
      } catch (error) {
        console.error("firstpair-triptych: voice listener failed", error);
      }
    }
  }

  // The recording is written and read back before the ledger names it, so
  // the original voice exists on disk before anything else can happen to it.
  async saveVoiceClip(context, details, recording) {
    const adapter = this.app.vault.adapter;
    const buffer = await recording.blob.arrayBuffer();
    if (!buffer.byteLength) throw new Error("the recording is empty");
    const audioSha256 = await sha256Bytes(buffer);
    const recordedAt = new Date().toISOString();
    const clipId = voiceClipId(details.id, recordedAt, audioSha256);
    const path = normalizePath(voiceClipPath(details.id, clipId, recording.mime));
    await ensureFolder(adapter, path.split("/").slice(0, -1).join("/"));
    await adapter.writeBinary(path, buffer);
    const stored = await adapter.readBinary(path);
    if (stored.byteLength !== buffer.byteLength || await sha256Bytes(stored) !== audioSha256) {
      throw new Error(`the saved recording did not verify: ${path}`);
    }
    const ledger = await this.store.update(context, (current) => addVoiceClip(current, details, {
      id: clipId,
      path,
      mime: recording.mime,
      bytes: buffer.byteLength,
      duration_ms: recording.durationMs,
      audio_sha256: audioSha256,
      recorded_at: recordedAt,
    }));
    return { ledger, clipId };
  }

  async trashVaultPath(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) await this.app.vault.trash(file, false);
    else if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.trashLocal(path);
  }

  openSpanNoteDialog(options) {
    const {
      payload, pane, span, selector, root, setLedger, refresh, autoRecord, onClose,
    } = options;
    const context = this.store.contextFromPayload(payload);
    const details = this.spanNoteDetails(payload, pane, span, selector);
    const noteId = details.id;
    const currentNote = () => {
      const ledger = this.store.cache;
      return ledger && ledger.span_notes ? ledger.span_notes[noteId] || null : null;
    };
    const document = root.ownerDocument;
    const view = document.defaultView;
    const overlay = document.createElement("div");
    overlay.className = "lt-correction-overlay lt-note-overlay";
    const dialog = document.createElement("section");
    dialog.className = "lt-correction-dialog lt-note-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const title = document.createElement("h2");
    title.textContent = t("note_dialog_title");
    const quote = document.createElement("p");
    quote.className = "lt-correction-quote";
    quote.textContent = t("selected_quote", { quote: selector.exact });
    const field = document.createElement("textarea");
    field.rows = 3;
    field.placeholder = t("note_text_placeholder");
    field.setAttribute("aria-label", t("note_text_aria"));
    const initial = currentNote();
    field.value = initial ? initial.text : "";

    const recorderRow = document.createElement("div");
    recorderRow.className = "lt-recorder";
    const recordButton = document.createElement("button");
    recordButton.type = "button";
    recordButton.className = "lt-record-button";
    const recordStatus = document.createElement("span");
    recordStatus.className = "lt-record-status";
    recorderRow.append(recordButton, recordStatus);

    const clipsHeading = document.createElement("div");
    clipsHeading.className = "lt-variant-heading";
    clipsHeading.textContent = t("voice_clips");
    const clipList = document.createElement("div");
    clipList.className = "lt-voice-clips";

    const error = document.createElement("p");
    error.className = "lt-correction-error";
    const actions = document.createElement("div");
    actions.className = "lt-correction-actions";
    const deleteNote = document.createElement("button");
    deleteNote.type = "button";
    deleteNote.className = "lt-note-delete mod-warning";
    deleteNote.textContent = t("delete_note");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = t("cancel");
    const save = document.createElement("button");
    save.type = "button";
    save.className = "mod-cta";
    save.textContent = t("save_note");
    actions.append(deleteNote, cancel, save);
    dialog.append(title, quote, field, recorderRow, clipsHeading, clipList, error, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const recorder = new VoiceRecorder();
    let ticker = null;
    let busy = false;
    let starting = false;
    let closed = false;
    const applyLedger = (ledger) => {
      if (setLedger) setLedger(ledger);
      if (refresh) refresh();
    };
    const twoTap = (button, label, action) => {
      let armed = false;
      let timer = null;
      button.addEventListener("click", async () => {
        if (!armed) {
          armed = true;
          button.textContent = t("confirm_delete_clip");
          timer = view.setTimeout(() => {
            armed = false;
            button.textContent = label;
          }, 4000);
          return;
        }
        if (timer) view.clearTimeout(timer);
        armed = false;
        button.textContent = label;
        await action();
      });
    };
    const renderRecorder = () => {
      const recording = recorder.recording;
      recordButton.textContent = recording ? `■ ${t("stop")}` : `● ${t("record")}${starting ? " …" : ""}`;
      recordButton.toggleClass("is-recording", recording);
      // While the microphone (or iOS's permission prompt) is opening.
      recordButton.disabled = starting || (busy && !recording);
      recordStatus.textContent = recording
        ? t("recording", { time: formatDuration(recorder.elapsedMs()) })
        : "";
    };
    const renderClips = () => {
      const note = currentNote();
      const clips = note ? note.voice : [];
      clipsHeading.hidden = clips.length === 0;
      deleteNote.hidden = !note;
      clipList.replaceChildren();
      for (const clip of clips) {
        const row = document.createElement("div");
        row.className = "lt-voice-clip";
        const player = document.createElement("audio");
        player.controls = true;
        player.preload = "metadata";
        player.src = this.app.vault.adapter.getResourcePath(clip.path);
        const meta = document.createElement("span");
        meta.className = "lt-voice-meta";
        meta.textContent = `${formatDuration(clip.duration_ms)} · ${clip.recorded_at.slice(0, 16).replace("T", " ")}`;
        const transcript = document.createElement("div");
        transcript.className = "lt-voice-transcript";
        const key = `${noteId}/${clip.id}`;
        const state = this.transcribing.has(key) ? "running" : clip.transcript.status;
        transcript.addClass(`lt-transcript-${state}`);
        if (state === "done") transcript.textContent = clip.transcript.text || "—";
        else if (state === "running") transcript.textContent = t("transcript_running");
        else if (state === "failed") {
          transcript.textContent = t("transcript_failed", { error: clip.transcript.error || "?" });
        } else transcript.textContent = t("transcript_pending");
        const clipActions = document.createElement("div");
        clipActions.className = "lt-voice-actions";
        const transcribe = document.createElement("button");
        transcribe.type = "button";
        transcribe.textContent = state === "done" ? t("retranscribe") : t("transcribe");
        transcribe.disabled = state === "running";
        transcribe.addEventListener("click", () => {
          void this.transcribeClip(context, noteId, clip.id, { force: true, quiet: false });
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "mod-warning";
        remove.textContent = t("delete_clip");
        twoTap(remove, t("delete_clip"), async () => {
          try {
            const ledger = await this.store.update(
              context, (current) => removeVoiceClip(current, noteId, clip.id),
            );
            await this.trashVaultPath(clip.path);
            applyLedger(ledger);
            renderClips();
          } catch (failure) {
            error.textContent = t("note_save_failed", { error: failure.message || failure });
          }
        });
        clipActions.append(transcribe, remove);
        row.append(player, meta, transcript, clipActions);
        clipList.appendChild(row);
      }
    };
    const stopAndSave = async () => {
      if (!recorder.recording) return;
      if (ticker) view.clearInterval(ticker);
      ticker = null;
      busy = true;
      renderRecorder();
      try {
        const recording = await recorder.stop();
        const { ledger, clipId } = await this.saveVoiceClip(context, details, recording);
        applyLedger(ledger);
        new Notice(t("voice_saved"));
        if (this.settings.autoTranscribe) {
          void this.transcribeClip(context, noteId, clipId, { quiet: true });
        }
      } catch (failure) {
        console.error("firstpair-triptych: voice note save failed", failure);
        error.textContent = t("voice_save_failed", { error: failure.message || failure });
        new Notice(t("voice_save_failed", { error: failure.message || failure }));
      } finally {
        busy = false;
        if (!closed) {
          renderRecorder();
          renderClips();
        }
      }
    };
    const startRecording = async () => {
      if (starting || recorder.recording) return;
      error.textContent = "";
      starting = true;
      // getUserMedia is called before the first await, inside the tap, as iOS requires.
      const opening = recorder.start();
      renderRecorder();
      try {
        await opening;
      } catch (failure) {
        recorder.release();
        error.textContent = t("mic_unavailable", { error: failure.message || failure });
        return;
      } finally {
        starting = false;
        renderRecorder();
      }
      if (closed) {
        recorder.release();
        return;
      }
      ticker = view.setInterval(renderRecorder, 250);
      renderRecorder();
    };
    const finish = async () => {
      if (closed) return;
      // Closing never loses a take: an open recording is stopped and saved.
      if (recorder.recording) await stopAndSave();
      closed = true;
      this.voiceListeners.delete(listener);
      document.removeEventListener("keydown", keydown, true);
      overlay.remove();
      if (onClose) onClose();
    };
    const listener = () => {
      if (!closed) renderClips();
    };
    const keydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void finish();
      }
    };
    this.voiceListeners.add(listener);
    document.addEventListener("keydown", keydown, true);
    recordButton.addEventListener("click", () => {
      if (recorder.recording) void stopAndSave();
      else void startRecording();
    });
    cancel.addEventListener("click", () => void finish());
    save.addEventListener("click", async () => {
      if (recorder.recording) await stopAndSave();
      const text = field.value.trim();
      const note = currentNote();
      if (text !== (note ? note.text : "")) {
        try {
          const ledger = await this.store.update(
            context, (current) => upsertSpanNoteText(current, details, text),
          );
          applyLedger(ledger);
        } catch (failure) {
          error.textContent = t("note_save_failed", { error: failure.message || failure });
          return;
        }
      }
      await finish();
    });
    twoTap(deleteNote, t("delete_note"), async () => {
      const note = currentNote();
      if (!note) return;
      try {
        const ledger = await this.store.update(
          context, (current) => clearSpanNote(current, noteId),
        );
        for (const clip of note.voice) await this.trashVaultPath(clip.path);
        applyLedger(ledger);
        field.value = "";
        await finish();
      } catch (failure) {
        error.textContent = t("note_save_failed", { error: failure.message || failure });
      }
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay && !recorder.recording) void finish();
    });
    renderRecorder();
    renderClips();
    // The ledger cache may predate this dialog; load it so existing clips show.
    void this.store.load(context).then(() => {
      if (!closed) {
        renderClips();
        if (!field.value && currentNote()) field.value = currentNote().text;
      }
    });
    if (autoRecord) void startRecording();
    else view.setTimeout(() => field.focus(), 0);
  }

  /* --------------------------- transcription ---------------------------- */

  localWhisperCommand() {
    if (!Platform || !Platform.isDesktopApp) return null;
    try {
      const fs = require("fs");
      const os = require("os");
      const path = require("path");
      const configured = String(this.settings.mlxWhisperPath || "").trim()
        .replace(/^~(?=\/|$)/, os.homedir());
      const candidates = [
        configured,
        path.join(os.homedir(), ".local/bin/mlx_whisper"),
        "/opt/homebrew/bin/mlx_whisper",
        "/usr/local/bin/mlx_whisper",
      ].filter(Boolean);
      return candidates.find((candidate) => fs.existsSync(candidate)) || null;
    } catch (_error) {
      return null;
    }
  }

  resolveTranscriptionEngine() {
    const choice = this.settings.transcriptionEngine || "auto";
    if (choice === "off") return null;
    const command = choice === "api" ? null : this.localWhisperCommand();
    const api = choice !== "local"
      && String(this.settings.apiKey || "").trim()
      && String(this.settings.apiBaseUrl || "").trim();
    if (command) return { kind: "local", command };
    if (api) return { kind: "api" };
    return null;
  }

  voiceLanguage() {
    const language = String(this.settings.voiceLanguage || "").trim().toLowerCase();
    return language === "auto" ? "" : language;
  }

  async transcribeLocally(command, clip, prompt) {
    const { execFile } = require("child_process");
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const model = String(this.settings.mlxModel || "").trim() || DEFAULT_MLX_MODEL;
    const audio = this.app.vault.adapter.getFullPath(clip.path);
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "firstpair-voice-"));
    const args = [
      audio, "--model", model, "--output-dir", outputDir, "--output-name", clip.id,
      "--output-format", "json", "--verbose", "False",
    ];
    const language = this.voiceLanguage();
    if (language) args.push("--language", language);
    if (prompt) args.push("--initial-prompt", prompt);
    // Obsidian launched from the Dock does not inherit a shell PATH, and
    // mlx_whisper needs ffmpeg beside it.
    const env = {
      ...process.env,
      PATH: [
        path.dirname(command), path.join(os.homedir(), ".local/bin"),
        "/opt/homebrew/bin", "/usr/local/bin", process.env.PATH || "",
      ].filter(Boolean).join(":"),
    };
    const lastLine = (text) => String(text || "").trim().split("\n").pop();
    try {
      const stderr = await new Promise((resolve, reject) => {
        execFile(command, args, {
          env, timeout: LOCAL_TRANSCRIBE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
        }, (failure, _stdout, errors) => {
          if (failure) reject(new Error(lastLine(errors) || failure.message));
          else resolve(errors);
        });
      });
      // mlx_whisper reports an unreadable file on stderr and still exits 0.
      const output = path.join(outputDir, `${clip.id}.json`);
      if (!fs.existsSync(output)) throw new Error(lastLine(stderr) || "mlx_whisper wrote no transcript");
      const result = JSON.parse(fs.readFileSync(output, "utf8"));
      return {
        text: String(result.text || "").trim(),
        language: String(result.language || language || ""),
        engine: "mlx-whisper",
        model,
      };
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }

  async transcribeWithApi(buffer, clip, prompt) {
    const settings = this.settings;
    const model = String(settings.apiModel || "").trim() || "whisper-1";
    const boundary = `----firstpair${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    const encoder = new TextEncoder();
    const parts = [];
    const field = (name, value) => parts.push(encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ));
    field("model", model);
    field("response_format", "json");
    const language = this.voiceLanguage();
    if (language) field("language", language);
    if (prompt) field("prompt", prompt);
    const filename = clip.path.split("/").pop();
    const mime = clip.mime.split(";")[0] || "application/octet-stream";
    parts.push(encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n`
      + `Content-Type: ${mime}\r\n\r\n`,
    ));
    parts.push(new Uint8Array(buffer));
    parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));
    const body = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) {
      body.set(part, offset);
      offset += part.byteLength;
    }
    const response = await requestUrl({
      url: `${String(settings.apiBaseUrl).trim().replace(/\/+$/, "")}/audio/transcriptions`,
      method: "POST",
      headers: { Authorization: `Bearer ${String(settings.apiKey).trim()}` },
      contentType: `multipart/form-data; boundary=${boundary}`,
      body: body.buffer,
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}: ${String(response.text || "").slice(0, 200)}`);
    }
    return {
      text: String((response.json && response.json.text) || "").trim(),
      language: String((response.json && response.json.language) || language || ""),
      engine: "api",
      model,
    };
  }

  // Returns "done", "failed", "missing" (audio not synced here yet),
  // "unavailable" (no engine on this device) or "skipped".
  async transcribeClip(context, noteId, clipId, { force = false, quiet = true } = {}) {
    const key = `${noteId}/${clipId}`;
    if (this.transcribing.has(key)) return "skipped";
    const engine = this.resolveTranscriptionEngine();
    if (!engine) {
      if (!quiet) new Notice(t("transcribe_unavailable"));
      return "unavailable";
    }
    const adapter = this.app.vault.adapter;
    const ledger = await this.store._read(context);
    const note = ledger.span_notes[noteId];
    const clip = note && note.voice.find((voice) => voice.id === clipId);
    if (!clip || (!force && clip.transcript.status === "done")) return "skipped";
    if (!(await adapter.exists(clip.path))) return "missing";
    this.transcribing.add(key);
    this.notifyVoice();
    const record = async (transcript) => {
      const next = await this.store.update(context, (current) => {
        const currentNote = current.span_notes[noteId];
        const currentClip = currentNote && currentNote.voice.find((voice) => voice.id === clipId);
        if (!currentClip || currentClip.audio_sha256 !== clip.audio_sha256) return current;
        if (!force && currentClip.transcript.status === "done") return current;
        return setVoiceTranscript(current, noteId, clipId, transcript);
      });
      return next;
    };
    try {
      const buffer = await adapter.readBinary(clip.path);
      if (await sha256Bytes(buffer) !== clip.audio_sha256) {
        throw new Error("the recording on disk does not match its ledger hash");
      }
      const prompt = compactPrompt(note.exact);
      const result = engine.kind === "local"
        ? await this.transcribeLocally(engine.command, clip, prompt)
        : await this.transcribeWithApi(buffer, clip, prompt);
      await record({ status: "done", ...result, audio_sha256: clip.audio_sha256 });
      return "done";
    } catch (failure) {
      console.error("firstpair-triptych: transcription failed", failure);
      try {
        await record({
          status: "failed",
          error: String(failure.message || failure).slice(0, 300),
          engine: engine.kind === "local" ? "mlx-whisper" : "api",
        });
      } catch (writeFailure) {
        console.error("firstpair-triptych: could not record transcription failure", writeFailure);
      }
      if (!quiet) new Notice(t("transcript_failed", { error: failure.message || failure }));
      return "failed";
    } finally {
      this.transcribing.delete(key);
      this.notifyVoice();
    }
  }

  async transcribePending({ includeFailed = false, quiet = false } = {}) {
    if (this.pendingRun) return this.pendingRun;
    this.pendingRun = (async () => {
      let reader;
      try {
        reader = await this.loadReaderIndex();
      } catch (_error) {
        return 0;
      }
      const context = { projectId: reader.project_id, sourceContentId: reader.source_content_id };
      let ledger;
      try {
        ledger = await this.store._read(context);
      } catch (_error) {
        return 0;
      }
      const pending = pendingVoiceClips(ledger, { includeFailed });
      if (!pending.length) {
        if (!quiet) new Notice(t("transcribe_none"));
        return 0;
      }
      if (!this.resolveTranscriptionEngine()) {
        if (!quiet) new Notice(t("transcribe_unavailable"));
        return 0;
      }
      let done = 0;
      for (const { note, clip } of pending) {
        const outcome = await this.transcribeClip(context, note.id, clip.id, {
          force: includeFailed && clip.transcript.status === "failed",
        });
        if (outcome === "done") done += 1;
      }
      if (done || !quiet) new Notice(t("transcribe_done", { count: done }));
      return done;
    })();
    try {
      return await this.pendingRun;
    } finally {
      this.pendingRun = null;
    }
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
    const save = async (action, correction = null, mode = "create") => {
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

  renderEditorialSentenceText(
    payload, pane, span, sentenceText, copy, view, root, getLedger, setLedger,
  ) {
    copy.empty();
    const records = [
      ...annotationsForSentence(getLedger(), payload.key, pane.edition, span.id),
      ...spanNotesForSentence(getLedger(), payload.key, pane.edition, span.id)
        .map((note) => ({ ...note, action: "note" })),
    ];
    for (const segment of annotationSegments(sentenceText, records)) {
      if (!segment.records.length) {
        copy.appendText(segment.text);
        continue;
      }
      const actions = [...new Set(segment.records.map((record) => record.action))];
      const mark = copy.createEl("mark", {
        cls: [
          "lt-phrase-mark",
          ...actions.map((action) => `lt-phrase-${action}`),
          segment.records.length > 1 ? "lt-phrase-overlap" : "",
        ].filter(Boolean).join(" "),
        text: segment.text,
        attr: { role: "button", tabindex: "0" },
      });
      const activate = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (segment.records.length === 1 && segment.records[0].action === "note") {
          const record = segment.records[0];
          this.openSpanNoteDialog({
            payload,
            pane,
            span,
            selector: makeSelector(sentenceText, record.start, record.end, record.token_keys),
            root,
            setLedger,
            refresh: view.refresh,
          });
        } else if (segment.records.length === 1) {
          const record = segment.records[0];
          this.showEditorialPhraseMenu({
            payload,
            pane,
            span,
            sentenceText,
            selector: makeSelector(sentenceText, record.start, record.end, record.token_keys),
            existing: record,
            anchor: mark,
            root,
            setLedger,
            refresh: view.refresh,
          });
        } else {
          view.wrapper.addClass("is-editing-words");
          view.wordsButton.setAttribute("aria-pressed", "true");
          view.saved.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      };
      mark.addEventListener("click", activate);
      mark.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") activate(event);
      });
    }
  }

  renderEditorialSavedPhrases(
    payload, pane, span, sentenceText, view, root, getLedger, setLedger,
  ) {
    const records = annotationsForSentence(
      getLedger(), payload.key, pane.edition, span.id,
    );
    const notes = spanNotesForSentence(getLedger(), payload.key, pane.edition, span.id);
    view.saved.empty();
    view.saved.hidden = records.length + notes.length === 0;
    if (!records.length && !notes.length) return;
    view.saved.createSpan({ cls: "lt-saved-heading", text: t("saved_phrases") });
    for (const record of records) {
      const preferred = preferredCorrectionVariant(record);
      const label = record.action === "edit" && preferred
        ? `${actionLabel("edit")} → ${preferred.text}`
        : actionLabel(record.action);
      const button = view.saved.createEl("button", {
        cls: `lt-saved-phrase lt-saved-${record.action}`,
        text: `“${record.exact}” · ${label}`,
        attr: { type: "button" },
      });
      button.addEventListener("click", () => this.showEditorialPhraseMenu({
        payload,
        pane,
        span,
        sentenceText,
        selector: makeSelector(sentenceText, record.start, record.end, record.token_keys),
        existing: record,
        anchor: button,
        root,
        setLedger,
        refresh: view.refresh,
      }));
    }
    for (const note of notes) {
      const bits = [actionLabel("note")];
      if (note.voice.length) bits.push(`🎙 ${note.voice.length}`);
      if (note.text) bits.push(note.text);
      const button = view.saved.createEl("button", {
        cls: "lt-saved-phrase lt-saved-note",
        text: `“${note.exact}” · ${bits.join(" · ")}`,
        attr: { type: "button" },
      });
      button.addEventListener("click", () => this.openSpanNoteDialog({
        payload,
        pane,
        span,
        selector: makeSelector(sentenceText, note.start, note.end, note.token_keys),
        root,
        setLedger,
        refresh: view.refresh,
      }));
    }
  }

  renderEditorialPaneBody(payload, pane, body, root, getLedger, setLedger) {
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
        continue;
      }
      let cursor = block.start;
      for (const span of blockSpans) {
        if (span.start > cursor) {
          paragraph.createSpan({ text: sliceCodePoints(pane.text, cursor, span.start) });
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
        const prefer = preferLabel.createEl("input", { type: "checkbox" });
        prefer.checked = Boolean(getLedger().sentence_preferences[preferenceKey]);
        preferLabel.createSpan({ text: t("prefer") });
        const wordsButton = controls.createEl("button", {
          cls: "lt-words-toggle",
          text: t("words"),
          attr: { type: "button", "aria-pressed": "false" },
        });
        const copy = wrapper.createSpan({ cls: "lt-sentence-text lt-editorial-copy" });
        const editor = wrapper.createSpan({ cls: "lt-word-editor" });
        const selectAllLabel = editor.createEl("label", { cls: "lt-select-all-words" });
        const selectAll = selectAllLabel.createEl("input", { type: "checkbox" });
        selectAllLabel.createSpan({ text: t("whole_sentence") });
        editor.createSpan({
          cls: "lt-word-help",
          text: t("words_hint"),
        });
        const tokenList = editor.createSpan({ cls: "lt-word-token-list" });
        const tokenChecks = new Map();
        const tokens = span.tokens || wordTokens(sentenceText, span.id);
        const summary = editor.createSpan({
          cls: "lt-word-summary",
          text: t("select_hint"),
        });
        const phraseActions = editor.createSpan({ cls: "lt-word-actions" });
        const saved = editor.createSpan({ cls: "lt-saved-phrases" });
        const view = {
          wrapper, wordsButton, copy, editor, selectAll, tokenChecks, tokens,
          selector: null, summary, saved, refresh: null,
        };
        const updateSelection = () => {
          const selected = [...tokenChecks.entries()]
            .filter(([, checkbox]) => checkbox.checked)
            .map(([key]) => key);
          selectAll.checked = Boolean(tokens.length && selected.length === tokens.length);
          selectAll.indeterminate = Boolean(selected.length && selected.length < tokens.length);
          try {
            view.selector = selected.length
              ? selectedTokenRange(sentenceText, tokens, selected)
              : null;
            if (selectAll.checked) {
              view.selector = makeSelector(
                sentenceText, 0, codePointLength(sentenceText),
                tokens.map((token) => token.key),
              );
            }
            summary.setText(view.selector
              ? t("selected_quote", { quote: view.selector.exact })
              : t("select_hint"));
          } catch (_error) {
            view.selector = null;
            summary.setText(t("one_phrase_hint"));
          }
          for (const button of phraseActions.querySelectorAll("button")) {
            button.disabled = !view.selector;
          }
        };
        const clearSelection = () => {
          for (const checkbox of tokenChecks.values()) checkbox.checked = false;
          selectAll.checked = false;
          selectAll.indeterminate = false;
          updateSelection();
        };
        const saveSelection = async (action, actionButton) => {
          const selector = view.selector && { ...view.selector };
          if (!selector) return;
          const annotationId = phraseAnnotationKey(
            payload.key, pane.edition, span.id,
            selector.start, selector.end, selector.exact,
          );
          const prior = getLedger().phrase_annotations[annotationId];
          const current = prior ? { id: annotationId, ...prior } : null;
          let correction = null;
          let mode = "create";
          if (action === "edit") {
            const preferred = current && preferredCorrectionVariant(current);
            const request = await this.requestCorrection(
              root, selector.exact, preferred ? preferred.text : "", Boolean(current)
            );
            if (!request) return;
            correction = request.value;
            mode = request.mode;
          }
          try {
            const next = await this.persistPhraseAction(
              payload, pane, span, sentenceText, selector, action, current,
              correction, mode,
            );
            setLedger(next);
            clearSelection();
            view.refresh();
          } catch (error) {
            console.error("firstpair-triptych: selected phrase failed", error);
            new Notice(t("phrase_choice_failed", { error: error.message || error }));
            if (actionButton) actionButton.focus();
          }
        };
        for (const token of tokens) {
          const tokenControl = tokenList.createSpan({ cls: "lt-word-token" });
          const label = tokenControl.createEl("label");
          const checkbox = label.createEl("input", { type: "checkbox" });
          label.createSpan({ text: token.text });
          const only = tokenControl.createEl("button", {
            cls: "lt-word-only",
            text: t("only"),
            attr: { type: "button", title: t("only_title", { word: token.text }) },
          });
          tokenChecks.set(token.key, checkbox);
          checkbox.addEventListener("change", updateSelection);
          only.addEventListener("click", () => {
            for (const control of tokenChecks.values()) control.checked = false;
            checkbox.checked = true;
            updateSelection();
            const selector = view.selector;
            const annotationId = phraseAnnotationKey(
              payload.key, pane.edition, span.id,
              selector.start, selector.end, selector.exact,
            );
            const prior = getLedger().phrase_annotations[annotationId];
            this.showEditorialPhraseMenu({
              payload,
              pane,
              span,
              sentenceText,
              selector,
              existing: prior ? { id: annotationId, ...prior } : null,
              anchor: only,
              root,
              setLedger,
              refresh: view.refresh,
            });
          });
        }
        for (const action of ["good", "bad", "edit"]) {
          const label = actionLabel(action);
          const button = phraseActions.createEl("button", {
            cls: `lt-phrase-action lt-action-${action}`,
            text: label,
            attr: { type: "button", disabled: "disabled" },
          });
          button.addEventListener("click", () => void saveSelection(action, button));
        }
        for (const [kind, autoRecord] of [["note", false], ["voice", true]]) {
          const button = phraseActions.createEl("button", {
            cls: `lt-phrase-action lt-action-${kind}`,
            text: t(`action_${kind}`),
            attr: { type: "button", disabled: "disabled" },
          });
          button.addEventListener("click", () => {
            const selector = view.selector && { ...view.selector };
            if (!selector) return;
            this.openSpanNoteDialog({
              payload, pane, span, selector, root, setLedger, autoRecord,
              refresh: view.refresh,
              onClose: clearSelection,
            });
          });
        }
        const clear = phraseActions.createEl("button", {
          cls: "lt-clear-word-selection",
          text: t("clear_selection"),
          attr: { type: "button", disabled: "disabled" },
        });
        clear.addEventListener("click", clearSelection);
        const updateClear = () => {
          clear.disabled = ![...tokenChecks.values()].some((checkbox) => checkbox.checked);
        };
        for (const checkbox of tokenChecks.values()) {
          checkbox.addEventListener("change", updateClear);
        }
        selectAll.addEventListener("change", () => {
          for (const checkbox of tokenChecks.values()) checkbox.checked = selectAll.checked;
          updateSelection();
          updateClear();
        });
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
        clearSelection();
        view.refresh();
        cursor = span.end;
      }
      if (cursor < block.end) {
        paragraph.createSpan({ text: sliceCodePoints(pane.text, cursor, block.end) });
      }
    }
  }
};

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
  detectBookRoot,
  detectUiLanguage,
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
