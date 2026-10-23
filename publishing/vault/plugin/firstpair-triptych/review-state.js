"use strict";

/*
 * Project-neutral editorial state for Rosetta triptychs.
 *
 * The runtime UI is intentionally kept out of this module.  Every durable
 * choice can therefore be migrated and tested with plain Node, while pane
 * edition ids remain arbitrary strings supplied by the payload.
 */

const LEDGER_SCHEMA = "firstpair.triptych-decisions.v4";
const LEGACY_LEDGER_SCHEMA = "firstpair.triptych-decisions.v2";
const LEDGER_VERSION = 4;
const OFFSET_UNIT = "unicode-code-point";
const PHRASE_ACTIONS = new Set(["good", "bad", "edit"]);
const LEGACY_ACTIONS = new Map([
  ["prefer", "good"],
  ["ungrammatical", "bad"],
]);
const WORD_POINT_RE = /[\p{L}\p{M}\p{N}]/u;
const INTERNAL_WORD_JOINERS = new Set([
  "-", "\u2010", "\u2011", "'", "\u2019", "\u02bc",
]);
const SOURCE_ID_RE = /^sha256:[0-9a-f]{64}$/;

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function objectMap(value) {
  return isPlainObject(value) ? value : {};
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compactInstructionText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function codePoints(value) {
  return Array.from(String(value || ""));
}

function codePointLength(value) {
  return codePoints(value).length;
}

function sliceCodePoints(value, start, end) {
  return codePoints(value).slice(start, end).join("");
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sentenceFingerprint(value) {
  return stableHash(compactInstructionText(value).normalize("NFC"));
}

/* Dependency-free SHA-256 so the bundled plugin behaves identically on
 * desktop Electron and Obsidian mobile. */
function sha256Utf8(value) {
  const bytes = Array.from(new TextEncoder().encode(String(value)));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
    0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
    0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
    0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
    0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rotateRight = (word, count) => (word >>> count) | (word << (32 - count));
  const words = new Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const start = offset + (index * 4);
      words[index] = (
        (bytes[start] << 24)
        | (bytes[start + 1] << 16)
        | (bytes[start + 2] << 8)
        | bytes[start + 3]
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15];
      const y = words[index - 2];
      const s0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const s1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ ((~e) & g);
      const temp1 = (hh + s1 + choice + k[index] + words[index]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      hh = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function sha256Id(value) {
  return `sha256:${sha256Utf8(value)}`;
}

function isWordPoint(value) {
  return !INTERNAL_WORD_JOINERS.has(value) && WORD_POINT_RE.test(value);
}

function wordTokens(value, sentenceId) {
  if (typeof sentenceId !== "string" || !sentenceId) {
    throw new Error("word tokens require a stable sentence id");
  }
  const points = codePoints(value);
  const tokens = [];
  let cursor = 0;
  while (cursor < points.length) {
    if (!isWordPoint(points[cursor])) {
      cursor += 1;
      continue;
    }
    const start = cursor;
    cursor += 1;
    while (cursor < points.length) {
      if (isWordPoint(points[cursor])) {
        cursor += 1;
      } else if (
        INTERNAL_WORD_JOINERS.has(points[cursor])
        && cursor + 1 < points.length
        && isWordPoint(points[cursor + 1])
      ) {
        cursor += 2;
      } else {
        break;
      }
    }
    const ordinal = tokens.length;
    const text = points.slice(start, cursor).join("");
    tokens.push({
      key: `${sentenceId}:w${String(ordinal).padStart(3, "0")}`,
      ordinal,
      start,
      end: cursor,
      offset_unit: OFFSET_UNIT,
      text,
      text_sha256: sha256Id(text),
    });
  }
  return tokens;
}

function makeSelector(sentenceText, start, end, tokenKeys = null) {
  const length = codePointLength(sentenceText);
  if (
    !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end <= start || end > length
  ) {
    throw new Error("selection lies outside its sentence");
  }
  const selector = {
    unit: OFFSET_UNIT,
    start,
    end,
    exact: sliceCodePoints(sentenceText, start, end),
    prefix: sliceCodePoints(sentenceText, Math.max(0, start - 32), start),
    suffix: sliceCodePoints(sentenceText, end, Math.min(length, end + 32)),
  };
  if (tokenKeys) selector.token_keys = [...tokenKeys];
  return selector;
}

function selectedTokenRange(sentenceText, tokens, selectedKeys) {
  if (!Array.isArray(tokens) || !Array.isArray(selectedKeys) || !selectedKeys.length) {
    throw new Error("select at least one word");
  }
  const indexes = selectedKeys.map((key) => tokens.findIndex((token) => token.key === key));
  if (indexes.some((index) => index < 0) || new Set(indexes).size !== indexes.length) {
    throw new Error("unknown or duplicate selected word");
  }
  indexes.sort((left, right) => left - right);
  for (let index = 1; index < indexes.length; index += 1) {
    if (indexes[index] !== indexes[index - 1] + 1) {
      throw new Error("selected words must form one contiguous phrase");
    }
  }
  const selected = indexes.map((index) => tokens[index]);
  return makeSelector(
    sentenceText,
    selected[0].start,
    selected[selected.length - 1].end,
    selected.map((token) => token.key),
  );
}

function setSentenceTokenSelection(tokens, selected = true) {
  return selected ? (tokens || []).map((token) => token.key) : [];
}

function sentencePreferenceKey(fragmentKey, edition, sentenceId) {
  return `${fragmentKey}|${edition}|${sentenceId}`;
}

function phraseAnnotationKey(fragmentKey, edition, sentenceId, start, end, exact) {
  return (
    `${fragmentKey}|${edition}|${sentenceId}|${start}-${end}-`
    + stableHash(compactInstructionText(exact).normalize("NFC"))
  );
}

function correctionVariantId(annotationId, ordinal) {
  return `var_${sha256Utf8(`${annotationId}\u001f${ordinal}`).slice(0, 24)}`;
}

function normalizePhraseRecord(id, value) {
  const source = objectMap(value);
  const action = PHRASE_ACTIONS.has(source.action)
    ? source.action
    : LEGACY_ACTIONS.get(source.kind || source.action) || "good";
  const created = String(source.created_at || source.created || source.updated_at
    || source.updated || new Date(0).toISOString());
  const updated = String(source.updated_at || source.updated || created);
  const record = {
    ...source,
    id,
    action,
    created_at: created,
    updated_at: updated,
  };
  delete record.kind;
  delete record.created;
  delete record.updated;
  if (action === "edit") {
    let variants = Array.isArray(source.correction_variants)
      ? clone(source.correction_variants)
      : [];
    if (!variants.length && compactInstructionText(source.proposed_correction)) {
      variants = [{
        id: correctionVariantId(id, 0),
        text: compactInstructionText(source.proposed_correction),
        created_at: created,
        updated_at: updated,
      }];
    }
    variants = variants.map((variant, ordinal) => ({
      ...objectMap(variant),
      id: correctionVariantId(id, ordinal),
      text: compactInstructionText(variant.text),
      created_at: String(variant.created_at || created),
      updated_at: String(variant.updated_at || updated),
    })).filter((variant) => variant.text);
    if (!variants.length) record.action = "bad";
    else {
      record.correction_variants = variants;
      record.preferred_variant_id = variants.some(
        (variant) => variant.id === source.preferred_variant_id,
      ) ? source.preferred_variant_id : variants[variants.length - 1].id;
    }
  }
  delete record.proposed_correction;
  if (record.action !== "edit") {
    delete record.correction_variants;
    delete record.preferred_variant_id;
  }
  return record;
}

function reviewChoiceCountRaw(ledger) {
  return Object.keys(objectMap(ledger.decisions)).length
    + Object.keys(objectMap(ledger.sentence_preferences)).length
    + Object.keys(objectMap(ledger.phrase_annotations)).length
    + Object.keys(objectMap(ledger.span_notes)).length
    + Object.keys(objectMap(ledger.rule_decisions)).length;
}

function emptyLedger(context = {}) {
  const projectId = String(context.projectId || context.project_id || "").trim();
  const sourceContentId = String(
    context.sourceContentId || context.source_content_id || "",
  ).trim();
  if (!projectId || !SOURCE_ID_RE.test(sourceContentId)) {
    throw new Error("new review choices require project and source identities");
  }
  return {
    schema: LEDGER_SCHEMA,
    version: LEDGER_VERSION,
    project_id: projectId,
    source_content_id: sourceContentId,
    offset_unit: OFFSET_UNIT,
    revision: 0,
    decisions: {},
    sentence_preferences: {},
    phrase_annotations: {},
    span_notes: {},
  };
}

function normalizeLedger(value, context = {}) {
  const source = objectMap(value);
  const requestedProjectId = String(
    context.projectId || context.project_id || "",
  ).trim();
  const requestedSourceId = String(
    context.sourceContentId || context.source_content_id || "",
  ).trim();
  const storedProjectId = String(source.project_id || "").trim();
  const storedSourceId = String(source.source_content_id || "").trim();
  const isV4 = source.schema === LEDGER_SCHEMA;
  const isLegacy = (
    !source.schema
    && (source.version === 1 || source.version === 2)
    && Object.prototype.hasOwnProperty.call(source, "decisions")
  );
  if (!isV4 && !isLegacy) {
    throw new Error("unsupported review-choice data");
  }
  if (isV4) {
    if (
      source.version !== LEDGER_VERSION
      || !storedProjectId
      || !SOURCE_ID_RE.test(storedSourceId)
      || source.offset_unit !== OFFSET_UNIT
      || !Number.isInteger(source.revision)
      || source.revision < 0
    ) {
      throw new Error("v4 review choices have invalid identity or revision");
    }
    if (
      !isPlainObject(source.decisions)
      || !isPlainObject(source.sentence_preferences)
      || !isPlainObject(source.phrase_annotations)
    ) {
      throw new Error("v4 review choices must contain object maps");
    }
  } else if (
    storedSourceId
    || storedProjectId
    || Object.prototype.hasOwnProperty.call(source, "source_content_id")
    || Object.prototype.hasOwnProperty.call(source, "project_id")
  ) {
    throw new Error("legacy review choices must be explicitly unbound");
  }
  if (requestedProjectId && storedProjectId && requestedProjectId !== storedProjectId) {
    throw new Error("review choices belong to a different project");
  }
  if (requestedSourceId && !SOURCE_ID_RE.test(requestedSourceId)) {
    throw new Error("current review source identity is malformed");
  }
  const projectId = storedProjectId || requestedProjectId;
  let sourceContentId = storedSourceId || requestedSourceId;
  const wasBound = isV4;
  if (
    isV4 && Object.prototype.hasOwnProperty.call(source, "span_notes")
    && !isPlainObject(source.span_notes)
  ) {
    throw new Error("v4 span notes must be an object map");
  }
  const phrases = {};
  for (const [id, record] of Object.entries(objectMap(source.phrase_annotations))) {
    phrases[id] = normalizePhraseRecord(id, record);
  }
  const spanNotes = {};
  for (const [id, record] of Object.entries(objectMap(source.span_notes))) {
    const note = normalizeSpanNote(id, record);
    if (note) spanNotes[id] = note;
  }
  const rules = {};
  for (const [id, record] of Object.entries(objectMap(source.rule_decisions))) {
    const rule = normalizeRuleDecision(id, record);
    if (rule) rules[id] = rule;
  }
  const normalized = {
    ...source,
    schema: LEDGER_SCHEMA,
    version: LEDGER_VERSION,
    project_id: projectId,
    source_content_id: sourceContentId,
    offset_unit: OFFSET_UNIT,
    revision: isV4 ? source.revision : 0,
    decisions: objectMap(source.decisions),
    sentence_preferences: objectMap(source.sentence_preferences),
    phrase_annotations: phrases,
    span_notes: spanNotes,
    ...(Object.keys(rules).length ? { rule_decisions: rules } : {}),
  };
  if (!Object.keys(rules).length) delete normalized.rule_decisions;
  if (!projectId || !SOURCE_ID_RE.test(sourceContentId)) {
    if (isLegacy && !requestedProjectId && !requestedSourceId) return normalized;
    throw new Error("review choices have invalid source identity");
  }
  if (
    wasBound && SOURCE_ID_RE.test(requestedSourceId)
    && sourceContentId !== requestedSourceId
  ) {
    if (reviewChoiceCountRaw(normalized) === 0) {
      normalized.source_content_id = requestedSourceId;
    } else {
      const error = new Error("saved review choices belong to different source content");
      error.code = "SOURCE_CONTENT_MISMATCH";
      error.previousSourceContentId = sourceContentId;
      error.currentSourceContentId = requestedSourceId;
      error.reviewChoiceCount = reviewChoiceCountRaw(normalized);
      throw error;
    }
  }
  return normalized;
}

/* ----------------------------- edit rules -------------------------------- */

// A book-wide decision on a recurring substitution between two editions
// (firstpair.edition-diffs.v2 "rules"): accept applies `from -> to`
// everywhere, reject keeps `from` everywhere.
const RULE_DECISIONS = new Set(["accept", "reject"]);

function normalizeRuleDecision(id, record) {
  const value = objectMap(record);
  if (!/^R[0-9a-f]{12}$/.test(String(id)) || !RULE_DECISIONS.has(value.decision)) return null;
  return {
    pair: String(value.pair || ""),
    from: String(value.from || ""),
    to: String(value.to || ""),
    decision: value.decision,
    count: Number.isFinite(value.count) ? value.count : 0,
    pages: Number.isFinite(value.pages) ? value.pages : 0,
    updated_at: String(value.updated_at || ""),
  };
}

function setRuleDecision(ledger, rule, pair, decision) {
  const candidate = clone(ledger);
  candidate.rule_decisions = objectMap(candidate.rule_decisions);
  if (!decision) {
    delete candidate.rule_decisions[rule.id];
  } else {
    if (!RULE_DECISIONS.has(decision)) throw new Error(`unknown rule decision ${decision}`);
    candidate.rule_decisions[rule.id] = {
      pair, from: rule.from, to: rule.to, decision,
      count: rule.count, pages: rule.pages, updated_at: new Date().toISOString(),
    };
  }
  if (!Object.keys(candidate.rule_decisions).length) delete candidate.rule_decisions;
  return candidate;
}

function ruleDecisionMap(ledger) {
  return Object.fromEntries(
    Object.entries(objectMap(ledger.rule_decisions)).map(([id, record]) => [id, record.decision]),
  );
}

function nextLedger(ledger) {
  const candidate = clone(ledger);
  candidate.revision = Math.max(0, Number(candidate.revision) || 0) + 1;
  return candidate;
}

function preferredCorrectionVariant(record) {
  if (!record || record.action !== "edit") return null;
  return (record.correction_variants || []).find(
    (variant) => variant.id === record.preferred_variant_id,
  ) || null;
}

function upsertPhraseAnnotation(
  ledger,
  details,
  action,
  correction = null,
  mode = "create",
  now = new Date().toISOString(),
) {
  const normalizedAction = PHRASE_ACTIONS.has(action)
    ? action
    : LEGACY_ACTIONS.get(action);
  if (!normalizedAction) throw new Error("unsupported phrase review action");
  const selector = objectMap(details.selector);
  const id = details.id || phraseAnnotationKey(
    details.fragment_key,
    details.edition,
    details.sentence_id,
    selector.start,
    selector.end,
    selector.exact,
  );
  const candidate = nextLedger(ledger);
  const existing = candidate.phrase_annotations[id];
  const record = {
    ...(existing || {}),
    ...details,
    ...selector,
    id,
    action: normalizedAction,
    created_at: existing ? existing.created_at : now,
    updated_at: now,
  };
  delete record.selector;
  delete record.kind;
  if (normalizedAction === "edit") {
    const text = compactInstructionText(correction);
    if (!text) throw new Error("Edit requires replacement wording");
    if (existing && existing.action === "edit") {
      record.correction_variants = clone(existing.correction_variants || []);
      if (mode === "append") {
        const variant = {
          id: correctionVariantId(id, record.correction_variants.length),
          text,
          created_at: now,
          updated_at: now,
        };
        record.correction_variants.push(variant);
        record.preferred_variant_id = variant.id;
      } else {
        const preferred = record.correction_variants.find(
          (variant) => variant.id === existing.preferred_variant_id,
        ) || record.correction_variants[0];
        if (!preferred) {
          const variant = {
            id: correctionVariantId(id, 0), text, created_at: now, updated_at: now,
          };
          record.correction_variants = [variant];
          record.preferred_variant_id = variant.id;
        } else {
          preferred.text = text;
          preferred.updated_at = now;
          record.preferred_variant_id = preferred.id;
        }
      }
    } else {
      const variant = {
        id: correctionVariantId(id, 0), text, created_at: now, updated_at: now,
      };
      record.correction_variants = [variant];
      record.preferred_variant_id = variant.id;
    }
  } else {
    delete record.correction_variants;
    delete record.preferred_variant_id;
  }
  candidate.phrase_annotations[id] = record;
  return candidate;
}

function setPreferredCorrectionVariant(
  ledger, annotationId, variantId, now = new Date().toISOString(),
) {
  const record = ledger.phrase_annotations[annotationId];
  if (
    !record || record.action !== "edit"
    || !(record.correction_variants || []).some((variant) => variant.id === variantId)
  ) {
    throw new Error("unknown correction variant");
  }
  const candidate = nextLedger(ledger);
  candidate.phrase_annotations[annotationId].preferred_variant_id = variantId;
  candidate.phrase_annotations[annotationId].updated_at = now;
  return candidate;
}

function clearPhraseAnnotation(ledger, annotationId) {
  if (!ledger.phrase_annotations[annotationId]) return ledger;
  const candidate = nextLedger(ledger);
  delete candidate.phrase_annotations[annotationId];
  return candidate;
}

/* ------------------------------ span notes ------------------------------- */

// A span note is free commentary on one selected span: a typed note, any
// number of voice recordings, or both.  The recording is the record; its
// transcript is derived later and never replaces it.  Audio lives under
// VOICE_ROOT, named by note and clip id, and the ledger keeps its size and
// SHA-256 so a transcript always names the exact bytes it was made from.
const VOICE_ROOT = "Preferences/voice";
const TRANSCRIPT_STATES = new Set(["pending", "running", "done", "failed"]);
const AUDIO_EXTENSIONS = Object.freeze({
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
});

function spanNoteKey(fragmentKey, edition, sentenceId, start, end, exact) {
  return `note_${sha256Utf8([
    fragmentKey, edition, sentenceId, start, end, exact,
  ].map(String).join("\u001f")).slice(0, 32)}`;
}

function voiceClipId(noteId, recordedAt, audioSha256) {
  return `voice_${sha256Utf8(`${noteId}\u001f${recordedAt}\u001f${audioSha256}`).slice(0, 24)}`;
}

function audioExtension(mime) {
  const base = String(mime || "").split(";")[0].trim().toLowerCase();
  return AUDIO_EXTENSIONS[base] || "audio";
}

function voiceClipPath(noteId, clipId, mime) {
  return `${VOICE_ROOT}/${noteId}/${clipId}.${audioExtension(mime)}`;
}

function normalizeTranscript(value) {
  const source = objectMap(value);
  const status = TRANSCRIPT_STATES.has(source.status) ? source.status : "pending";
  const transcript = { ...source, status };
  // A transcription interrupted mid-run (closed app, crashed engine) is
  // simply pending again; the recording is untouched.
  if (status === "running") transcript.status = "pending";
  if (transcript.status === "done") {
    transcript.text = String(source.text || "").trim();
  }
  return transcript;
}

function normalizeVoiceClip(value) {
  const source = objectMap(value);
  const id = String(source.id || "");
  const path = String(source.path || "");
  if (!id || !path.startsWith(`${VOICE_ROOT}/`)) return null;
  return {
    ...source,
    id,
    path,
    mime: String(source.mime || ""),
    bytes: Math.max(0, Number(source.bytes) || 0),
    duration_ms: Math.max(0, Math.round(Number(source.duration_ms) || 0)),
    audio_sha256: String(source.audio_sha256 || ""),
    recorded_at: String(source.recorded_at || new Date(0).toISOString()),
    transcript: normalizeTranscript(source.transcript),
  };
}

function normalizeSpanNote(id, value) {
  const source = objectMap(value);
  const text = compactInstructionText(source.text);
  const voice = (Array.isArray(source.voice) ? source.voice : [])
    .map(normalizeVoiceClip)
    .filter(Boolean);
  if (!text && !voice.length) return null;
  const created = String(source.created_at || new Date(0).toISOString());
  return {
    ...source,
    id,
    text,
    voice,
    created_at: created,
    updated_at: String(source.updated_at || created),
  };
}

function spanNoteBase(details, now) {
  const selector = objectMap(details.selector);
  const id = details.id || spanNoteKey(
    details.fragment_key, details.edition, details.sentence_id,
    selector.start, selector.end, selector.exact,
  );
  const record = { ...details, ...selector, id, created_at: now, updated_at: now };
  delete record.selector;
  return record;
}

function upsertSpanNoteText(ledger, details, text, now = new Date().toISOString()) {
  const base = spanNoteBase(details, now);
  const candidate = nextLedger(ledger);
  candidate.span_notes = objectMap(candidate.span_notes);
  const existing = candidate.span_notes[base.id];
  const record = {
    ...(existing || base),
    text: compactInstructionText(text),
    voice: existing ? existing.voice : [],
    updated_at: now,
  };
  if (!record.text && !record.voice.length) delete candidate.span_notes[base.id];
  else candidate.span_notes[base.id] = record;
  return candidate;
}

function addVoiceClip(ledger, details, clip, now = new Date().toISOString()) {
  const normalized = normalizeVoiceClip({
    ...clip,
    transcript: clip.transcript || { status: "pending" },
  });
  if (!normalized || !normalized.audio_sha256 || !normalized.bytes) {
    throw new Error("a voice note needs a saved recording");
  }
  const base = spanNoteBase(details, now);
  const candidate = nextLedger(ledger);
  candidate.span_notes = objectMap(candidate.span_notes);
  const existing = candidate.span_notes[base.id];
  const record = existing
    ? { ...existing, voice: [...existing.voice], updated_at: now }
    : { ...base, text: "", voice: [] };
  if (record.voice.some((voice) => voice.id === normalized.id)) {
    throw new Error("duplicate voice note");
  }
  record.voice.push(normalized);
  candidate.span_notes[base.id] = record;
  return candidate;
}

function findVoiceClip(ledger, noteId, clipId) {
  const note = objectMap(ledger.span_notes)[noteId];
  const index = note ? note.voice.findIndex((voice) => voice.id === clipId) : -1;
  if (index < 0) throw new Error("unknown voice note");
  return { note, index };
}

function setVoiceTranscript(
  ledger, noteId, clipId, transcript, now = new Date().toISOString(),
) {
  findVoiceClip(ledger, noteId, clipId);
  const candidate = nextLedger(ledger);
  const { note, index } = findVoiceClip(candidate, noteId, clipId);
  const next = { ...objectMap(transcript), updated_at: now };
  if (!TRANSCRIPT_STATES.has(next.status)) throw new Error("unknown transcript state");
  if (next.status === "done") {
    next.text = String(next.text || "").trim();
    next.transcribed_at = next.transcribed_at || now;
    delete next.error;
  }
  note.voice[index] = { ...note.voice[index], transcript: next };
  note.updated_at = now;
  return candidate;
}

function removeVoiceClip(ledger, noteId, clipId, now = new Date().toISOString()) {
  findVoiceClip(ledger, noteId, clipId);
  const candidate = nextLedger(ledger);
  const { note, index } = findVoiceClip(candidate, noteId, clipId);
  note.voice.splice(index, 1);
  note.updated_at = now;
  if (!note.text && !note.voice.length) delete candidate.span_notes[noteId];
  return candidate;
}

function clearSpanNote(ledger, noteId) {
  if (!objectMap(ledger.span_notes)[noteId]) return ledger;
  const candidate = nextLedger(ledger);
  delete candidate.span_notes[noteId];
  return candidate;
}

function spanNotesForSentence(ledger, fragmentKey, edition, sentenceId) {
  return Object.values(objectMap(ledger.span_notes))
    .filter((record) => (
      record.fragment_key === fragmentKey
      && record.edition === edition
      && record.sentence_id === sentenceId
    ))
    .sort((left, right) => (
      Number(left.start) - Number(right.start)
      || Number(left.end) - Number(right.end)
      || left.id.localeCompare(right.id)
    ));
}

// Clips still owed a transcript, oldest first; "failed" is retried only on
// request so a broken engine does not spin on every launch.
function pendingVoiceClips(ledger, { includeFailed = false } = {}) {
  const pending = [];
  for (const note of Object.values(objectMap(ledger.span_notes))) {
    for (const clip of note.voice || []) {
      const status = clip.transcript && clip.transcript.status;
      if (status === "pending" || (includeFailed && status === "failed")) {
        pending.push({ note, clip });
      }
    }
  }
  return pending.sort((left, right) => (
    left.clip.recorded_at.localeCompare(right.clip.recorded_at)
    || left.clip.id.localeCompare(right.clip.id)
  ));
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(Number(ms) / 1000) || 0);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function annotationOverlaps(left, right) {
  return Number(left.start) < Number(right.end) && Number(right.start) < Number(left.end);
}

function resolveAnnotation(text, annotation) {
  const value = String(text || "");
  const exact = String(annotation.exact || "");
  if (!exact) return null;
  const points = codePoints(value);
  const exactPoints = codePoints(exact);
  const expectedStart = Number(annotation.start);
  const expectedEnd = Number(annotation.end);
  if (
    Number.isInteger(expectedStart) && Number.isInteger(expectedEnd)
    && expectedStart >= 0 && expectedEnd <= points.length
    && points.slice(expectedStart, expectedEnd).join("") === exact
  ) return { start: expectedStart, end: expectedEnd };
  const candidates = [];
  for (let start = 0; start + exactPoints.length <= points.length; start += 1) {
    if (points.slice(start, start + exactPoints.length).join("") === exact) {
      candidates.push(start);
    }
  }
  if (candidates.length === 1) {
    return { start: candidates[0], end: candidates[0] + exactPoints.length };
  }
  const prefix = codePoints(annotation.prefix || "");
  const suffix = codePoints(annotation.suffix || "");
  const contextual = candidates.filter((start) => (
    (!prefix.length || points.slice(Math.max(0, start - prefix.length), start).join("")
      === prefix.join(""))
    && (!suffix.length || points.slice(
      start + exactPoints.length,
      start + exactPoints.length + suffix.length,
    ).join("") === suffix.join(""))
  ));
  return contextual.length === 1
    ? { start: contextual[0], end: contextual[0] + exactPoints.length }
    : null;
}

function annotationsForSentence(ledger, fragmentKey, edition, sentenceId) {
  return Object.values(objectMap(ledger.phrase_annotations))
    .filter((record) => (
      record.fragment_key === fragmentKey
      && record.edition === edition
      && record.sentence_id === sentenceId
    ))
    .sort((left, right) => (
      Number(left.start) - Number(right.start)
      || Number(left.end) - Number(right.end)
      || left.id.localeCompare(right.id)
    ));
}

function annotationSegments(sentenceText, records) {
  const length = codePointLength(sentenceText);
  const valid = (records || []).map((record) => ({
    record,
    resolved: resolveAnnotation(sentenceText, record),
  })).filter((entry) => entry.resolved);
  const boundaries = new Set([0, length]);
  for (const { resolved } of valid) {
    boundaries.add(resolved.start);
    boundaries.add(resolved.end);
  }
  const ordered = [...boundaries].sort((left, right) => left - right);
  const segments = [];
  for (let index = 0; index + 1 < ordered.length; index += 1) {
    const start = ordered[index];
    const end = ordered[index + 1];
    if (start === end) continue;
    const active = valid.filter(({ resolved }) => (
      resolved.start < end && start < resolved.end
    )).map(({ record }) => record);
    segments.push({
      start,
      end,
      text: sliceCodePoints(sentenceText, start, end),
      records: active,
    });
  }
  return segments;
}

/* --------------------------- span colours ------------------------------ */

// At most this many saved spans may cover one word.
const MAX_SPAN_OVERLAP = 3;

// Resolved [start, end) positions of saved spans in one sentence (records
// whose quote no longer resolves are left out).
function resolvedSpans(sentenceText, records) {
  return (records || []).map((record) => ({ record, at: resolveAnnotation(sentenceText, record) }))
    .filter((entry) => entry.at);
}

// One of three colours per span: only spans that overlap get different
// colours (greedy interval colouring; three overlaps need at most three).
function spanColors(sentenceText, records) {
  const spans = resolvedSpans(sentenceText, records)
    .sort((left, right) => left.at.start - right.at.start || left.at.end - right.at.end
      || String(left.record.id).localeCompare(String(right.record.id)));
  const colors = new Map();
  const placed = [];
  for (const entry of spans) {
    const taken = new Set(placed
      .filter((other) => other.at.start < entry.at.end && entry.at.start < other.at.end)
      .map((other) => colors.get(other.record.id)));
    let color = 0;
    while (taken.has(color)) color += 1;
    colors.set(entry.record.id, color % MAX_SPAN_OVERLAP);
    placed.push(entry);
  }
  return colors;
}

// The most saved spans that already cover any code point of [start, end).
function overlapDepth(sentenceText, records, start, end) {
  const spans = resolvedSpans(sentenceText, records)
    .filter((entry) => entry.at.start < end && start < entry.at.end);
  let deepest = 0;
  for (let point = start; point < end; point += 1) {
    const depth = spans.filter((entry) => entry.at.start <= point && point < entry.at.end).length;
    if (depth > deepest) deepest = depth;
  }
  return deepest;
}

function reviewChoiceCount(ledger) {
  return reviewChoiceCountRaw(ledger);
}

function touchedFragmentKeys(ledger) {
  const keys = new Set(Object.keys(objectMap(ledger.decisions)));
  for (const record of Object.values(objectMap(ledger.sentence_preferences))) {
    if (record.fragment_key) keys.add(record.fragment_key);
  }
  for (const record of Object.values(objectMap(ledger.phrase_annotations))) {
    if (record.fragment_key) keys.add(record.fragment_key);
  }
  for (const record of Object.values(objectMap(ledger.span_notes))) {
    if (record.fragment_key) keys.add(record.fragment_key);
  }
  return [...keys].sort();
}

function markdownText(value) {
  return compactInstructionText(value)
    .replace(/\\/g, "\\\\").replace(/`/g, "\\`")
    .replace(/\*/g, "\\*").replace(/_/g, "\\_");
}

function decisionSet(key, value) {
  return value.set || value.fragment_key?.split("/")[0] || key.split("/")[0];
}

function renderDigest(input) {
  const ledger = normalizeLedger(input);
  const groups = new Map();
  const add = (set, sortKey, lines) => {
    if (!groups.has(set)) groups.set(set, []);
    groups.get(set).push([sortKey, lines]);
  };
  for (const [key, decision] of Object.entries(ledger.decisions)) {
    const set = decisionSet(key, decision);
    const lineage = decision.lineage || key.split("/").pop();
    const bits = [`- \`${markdownText(lineage)}\``];
    if (decision.preferred) bits.push(`prefer **${markdownText(decision.preferred)}**`);
    if (decision.note) bits.push(`— ${markdownText(decision.note)}`);
    add(set, `${lineage}/0`, [bits.join(" ")]);
  }
  for (const [key, preference] of Object.entries(ledger.sentence_preferences)) {
    const set = decisionSet(key, preference);
    const lineage = preference.lineage || preference.fragment_key?.split("/").pop() || key;
    add(set, `${lineage}/1/${preference.edition || ""}/${preference.sentence_id || key}`, [
      `- \`${markdownText(lineage)}\` prefer the complete sentence from **${markdownText(
        preference.edition_title || preference.edition,
      )}**: “${markdownText(preference.exact)}”`,
    ]);
  }
  for (const [id, record] of Object.entries(ledger.phrase_annotations)) {
    const set = decisionSet(id, record);
    const lineage = record.lineage || record.fragment_key?.split("/").pop() || id;
    let instruction;
    if (record.action === "good") instruction = "preserve this collocation";
    else if (record.action === "bad") instruction = "revise this collocation";
    else {
      const preferred = preferredCorrectionVariant(record);
      instruction = `replace with preferred edit “${markdownText(preferred && preferred.text)}”`;
    }
    const lines = [
      `- \`${markdownText(lineage)}\` **${record.action.toUpperCase()}** in **${markdownText(
        record.edition_title || record.edition,
      )}**: ${instruction}: “${markdownText(record.exact)}”`,
    ];
    if (record.action === "edit") {
      lines.push("  - Saved correction variants (preferred marked):");
      for (const variant of record.correction_variants || []) {
        const marker = variant.id === record.preferred_variant_id ? " **preferred**" : "";
        lines.push(`    - \`${variant.id}\`${marker}: “${markdownText(variant.text)}”`);
      }
    }
    if (record.prefix || record.suffix) {
      lines.push(
        `  - Context: “…${markdownText(record.prefix)}[${markdownText(record.exact)}]`
        + `${markdownText(record.suffix)}…”`,
      );
    }
    add(set, `${lineage}/2/${record.edition || ""}/${String(record.start).padStart(8, "0")}/${id}`, lines);
  }
  for (const [id, note] of Object.entries(ledger.span_notes)) {
    const set = decisionSet(id, note);
    const lineage = note.lineage || note.fragment_key?.split("/").pop() || id;
    const lines = [
      `- \`${markdownText(lineage)}\` **NOTE** in **${markdownText(
        note.edition_title || note.edition,
      )}** on “${markdownText(note.exact)}”${note.text ? `: ${markdownText(note.text)}` : ""}`,
    ];
    for (const clip of note.voice) {
      const transcript = clip.transcript || {};
      let heard;
      if (transcript.status === "done") heard = `transcript: “${markdownText(transcript.text)}”`;
      else if (transcript.status === "failed") heard = "transcription failed; listen to the recording";
      else heard = "transcription pending; listen to the recording";
      lines.push(
        // Paths are builder-shaped ids, safe verbatim inside a code span.
        `  - Voice note \`${clip.path}\` (${formatDuration(clip.duration_ms)}): ${heard}`,
      );
    }
    if (note.prefix || note.suffix) {
      lines.push(
        `  - Context: “…${markdownText(note.prefix)}[${markdownText(note.exact)}]`
        + `${markdownText(note.suffix)}…”`,
      );
    }
    add(set, `${lineage}/3/${note.edition || ""}/${String(note.start).padStart(8, "0")}/${id}`, lines);
  }
  const lines = [
    "# Rosetta Editorial Decision Digest",
    "",
    ledger.source_content_id ? `source_content_id: \`${ledger.source_content_id}\`` : "",
    `review_revision: ${ledger.revision || 0}`,
    "",
    "This is a deterministic review list, not a composed manuscript. Apply",
    "accepted choices in a separate editorial pass and revalidate the result.",
    "",
  ].filter((line, index, values) => line || index > 1 || values[index - 1] !== "");
  const rules = Object.entries(objectMap(ledger.rule_decisions))
    .sort((a, b) => a[1].pair.localeCompare(b[1].pair) || a[1].from.localeCompare(b[1].from));
  if (rules.length) {
    lines.push("## Book-wide edit rules", "");
    for (const [id, rule] of rules) {
      const [earlier, later] = rule.pair.split("|");
      const where = `${markdownText(earlier)} → ${markdownText(later)}, ${rule.count} places on ${rule.pages} pages`;
      lines.push(rule.decision === "accept"
        ? `- \`${id}\` **ACCEPT** “${markdownText(rule.from)}” → “${markdownText(rule.to)}” everywhere (${where})`
        : `- \`${id}\` **REJECT** “${markdownText(rule.from)}” → “${markdownText(rule.to)}”: keep “${markdownText(rule.from)}” (${where})`);
    }
    lines.push("");
  }
  for (const set of [...groups.keys()].sort()) {
    lines.push(`## ${markdownText(set)}`, "");
    for (const [, entryLines] of groups.get(set).sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(...entryLines);
    }
    lines.push("");
  }
  if (!groups.size && !rules.length) lines.push("_No review choices recorded yet._", "");
  return `${lines.join("\n").trimEnd()}\n`;
}

function serializeLedger(ledger) {
  return `${JSON.stringify(ledger, null, 2)}\n`;
}

function digestLine(serialized) {
  return `${sha256Utf8(serialized)}  triptych-decisions.json\n`;
}

/* --------------------------------- i18n ---------------------------------- */

// Visible plugin UI text in each vault language.  The vault declares its
// language in <book folder>/_data/editions.jsonl (the canonical
// edition's ``lang``); anything unknown falls back to English.  Ledger and
// digest text are data, not UI, and stay English in every vault.
const UI_STRINGS = Object.freeze({
  en: Object.freeze({
    nav_Previous: "Previous",
    nav_Up: "Up",
    nav_Back: "Back",
    nav_Forward: "Forward",
    nav_Top: "Top",
    nav_TOC: "TOC",
    nav_Next: "Next",
    start_of_set: "Start of set",
    end_of_set: "End of set",
    reader_nav_aria: "Triptych Reader navigation",
    review: "Review",
    review_title_attr: "Open touched pages and the editorial decision digest",
    open_named: "Open {name}",
    open_fragment: "Open fragment {order}: {title}",
    choose_set: "Choose a comparison set",
    reader_name: "FirstPair Triptych Reader",
    reader_open_failed: "FirstPair Triptych Reader could not open: {error}",
    reader_navigate_failed: "FirstPair Triptych Reader could not navigate: {error}",
    review_heading: "Rosetta Review",
    review_display: "{title} — Review",
    review_open_failed: "Rosetta Review could not open: {error}",
    review_could_not_open: "Review could not open: {error}",
    overall_prefer: "Overall: prefer {edition}",
    note_prefix: "Note: {note}",
    review_nav_aria: "Rosetta Review navigation",
    reader_button: "Reader",
    review_back_title: "Back to the page you came from",
    refresh: "Refresh",
    review_explanation:
      "This workspace lists touched Reader pages and the deterministic decision digest. "
      + "It does not assemble or overwrite a manuscript.",
    edited_pages: "Edited pages",
    no_pages: "No pages have review choices yet.",
    outside_slice: "Choices outside this Reader slice",
    digest_heading: "Decision digest",
    source_mismatch: "Saved choices belong to an earlier source version. They were not applied.",
    render_failed: "Triptych render failed: {error}",
    ledger_unreadable: "Triptych ledger unreadable; see console. Not overwriting.",
    cmd_open_reader: "Open Triptych Reader",
    cmd_open_review: "Open Rosetta Review",
    cmd_previous: "Reader: Previous fragment",
    cmd_up: "Reader: Up",
    cmd_back: "Reader: Back",
    cmd_forward: "Reader: Forward",
    cmd_top: "Reader: Top",
    cmd_contents: "Reader: Table of contents",
    cmd_next: "Reader: Next fragment",
    cmd_export: "Export editing instructions digest",
    wrote: "Wrote {path}",
    ribbon: "Open FirstPair Triptych Reader",
    rendering: "Rendering…",
    lexical_similarity: "lexical similarity {value}",
    moved: "moved",
    before: "Before",
    after: "After",
    no_predecessor: "(no predecessor: this unit is new)",
    no_successor: "(no successor: this unit was excised)",
    transformation_glossary:
      "Deletions struck on the left; insertions marked on the right. The meter is deterministic lexical similarity, not literary judgment.",
    similarity_previous: "similarity to previous state: {value}",
    first_state: "first recorded state",
    lineage_glossary:
      "{members} members collapse into {states} distinct states. Chip color: green unchanged-run boundary is light edit, amber medium, red heavy rewrite.",
    diff_previous: "diff vs previous",
    events: "Events: ",
    panes_label: "Panes:",
    chip_title: "Toggle this edition in every triptych (global)",
    review_chip_title: "Open all touched pages and the decision digest",
    sentence_words: "Sentence & words",
    sentence_toggle_title: "Show or hide independent sentence-level preference checkboxes on this page",
    all_hidden: "All panes hidden — toggle a pane above.",
    all_identical: "≡ All shown panes are identical",
    identical_prefix: "≡ Identical: ",
    prefer_this_pane: " prefer this",
    preferred_notice: "Preferred {name}",
    preference_cleared: "Preference cleared",
    save_preference_failed: "Could not save preference: {error}",
    score_title: "Rosetta divergence score, 0 (identical) to 100",
    split_fuse: "split/fuse",
    structural_title: "Structural change: sentence count differs while content aligns",
    outlier: "outlier",
    outlier_title: "Review outlier: this pane diverges most from the others",
    editing_note: "Editing note",
    note_placeholder:
      "Compact instruction for the next edition, e.g. “keep South's live-oak scene; adopt 3.1's ballot arithmetic”",
    save_note_failed: "Could not save editing note: {error}",
    bar_legend:
      "· shared/aligned · ❘ tonal or lexical pressure · ❘❘ addition, omission, or new claim · ❘❘❘ review outlier · dotted edge = structural split/fuse/reorder",
    feature_legend: "N new claim, M metaphor, S split, R rare words, E expanded, C compressed, F fused",
    feature_N: "new sentence or claim",
    feature_M: "new image or figure",
    feature_S: "sentence split",
    feature_R: "distinctive rare words",
    feature_E: "longer than neighbors",
    feature_C: "shorter than neighbors",
    feature_F: "sentences joined",
    absent: "(absent in this edition)",
    sentence_prefer_title: "Prefer this sentence in the next editing pass",
    sentence_prefer_aria: "Prefer this sentence from {name}",
    sentence_save_failed_console: "Could not save sentence preference; see console.",
    sentence_save_failed: "Could not save sentence preference: {error}",
    phrase_mark_title: "Change or clear this phrase instruction",
    phrase_overlap: "That phrase overlaps an existing mark. Clear the existing mark first.",
    phrase_dialog_aria: "Phrase instruction",
    prefer_this: "Prefer this",
    ungrammatical: "Ungrammatical",
    phrase_save_failed_console: "Could not save phrase instruction; see console.",
    clear: "Clear",
    phrase_clear_failed_console: "Could not clear phrase instruction; see console.",
    close: "Close",
    close_phrase: "Close phrase choices",
    edit_phrase: "Edit this phrase",
    propose_correction: "Propose a correction",
    selected_quote: "Selected: “{quote}”",
    replacement_aria: "Replacement wording",
    cancel: "Cancel",
    save_replace: "Save & replace",
    save_edit: "Save edit",
    save_next: "Save next",
    enter_replacement: "Enter replacement wording.",
    review_quote_aria: "Review “{quote}”",
    phrase_choice_failed: "Could not save phrase choice: {error}",
    action_good: "Good",
    action_bad: "Bad",
    action_edit: "Edit",
    action_prefer: "Prefer",
    action_ungrammatical: "Ungrammatical",
    variants_heading: "Edit variants — select the preferred version",
    saved_phrases: "Saved phrases",
    heading_badge: "Heading",
    heading_aria: "Book heading",
    prefer_sentence_title: "Prefer this complete sentence from {name}",
    prefer: "Prefer",
    words: "Words",
    whole_sentence: "Whole sentence",
    words_hint: "Check adjacent words; up to three saved spans may overlap.",
    words_hint_touch: "Tap a word, or drag across words; up to three saved spans may overlap.",
    select_hint: "Select adjacent words to review a phrase.",
    one_phrase_hint: "Choose adjacent words for one phrase.",
    only: "Only",
    only_title: "Review only “{word}”",
    clear_selection: "Clear selection",
    settings_lineage: "Enhanced lineage view",
    settings_lineage_desc:
      "Chain strip and distinct-state cards with diff toggles on lineage notes (Reading view).",
    settings_transformation: "Enhanced transformation view",
    settings_transformation_desc:
      "Side-by-side Before/After with word-level diff on transformation notes (Reading view).",
    settings_previews: "Comparison hub previews",
    settings_previews_desc: "Lazy incipit previews on comparison hub rows as they scroll into view.",
    settings_visibility:
      "Global edition visibility: a pane hidden here disappears from every "
      + "triptych (the chips above each triptych toggle the same switches).",
    settings_no_editions: "No editions seen yet — open any triptych note once.",
    action_note: "Note",
    action_voice: "🎙 Voice",
    note_dialog_title: "Note on “{quote}”",
    diff: "Diff",
    diff_title: "Mark what differs between the editions shown: two panes compare as a pair, three as a set",
    diff_legend_pair: "{older} → {newer}: struck through in {older} = removed; underlined in {newer} = added.",
    diff_legend_all: "All {count} editions: highlighted = in this edition only; underlined in an edition's colour = shared with that edition only.",
    diff_same: "No differences between the editions shown on this page.",
    diff_need_two: "Show at least two panes to see a diff.",
    diff_del: "Not in {name}",
    diff_ins: "New since {name}",
    diff_uniq: "In this edition only",
    diff_share: "Shared with {name} only",
    diff_filters: "Show",
    diff_cat_punct: "Punctuation",
    diff_cat_inflect: "Endings",
    diff_cat_function: "Small words",
    diff_cat_lexical: "Word choice",
    diff_cat_restructure: "Restructured",
    diff_cat_rewrite: "Rewritten",
    diff_cat_content: "Added or dropped",
    diff_cat_moved: "Moved",
    diff_moved_to: "Moved: see {page}",
    diff_lens: "History",
    diff_lens_all: "All differences",
    diff_lens_rewritten: "Settled text the latest rewrote",
    diff_lens_reverts: "The latest went back to the first",
    diff_lens_new: "New in the latest only",
    rules_heading: "Edit rules",
    rules_explain: "One-word substitutions that recur on several pages. Accept applies one everywhere; Reject keeps the earlier word everywhere. A substitution that also runs the other way is flagged.",
    rules_pair: "Compare",
    rules_none: "No substitution recurs on three or more pages.",
    rules_count: "{count}× on {pages} pages",
    rules_conflict: "⇄ also {from} → {to} {count}×",
    rules_conflict_title: "The edit runs both ways: likely taste, not a rule",
    rules_accept: "Accept",
    rules_reject: "Reject",
    rules_places: "Places",
    rules_saved: "Rule saved",
    rules_save_failed: "Could not save the rule: {error}",
    heat_heading: "Where the edits are",
    heat_explain: "Words changed in each Part, by kind of change, for the editions compared.",
    note_text_aria: "Text note",
    note_text_placeholder: "Type a note, record one, or both.",
    record: "Record",
    stop: "Stop",
    recording: "Recording… {time}",
    recorded: "New recording {time}, not yet saved",
    discard: "Discard",
    save_note: "Save note",
    delete_note: "Delete note",
    voice_clips: "Voice notes",
    transcript_pending: "Transcription pending",
    transcript_running: "Transcribing…",
    transcript_failed: "Transcription failed: {error}",
    transcribe: "Transcribe",
    retranscribe: "Transcribe again",
    delete_clip: "Delete recording",
    confirm_delete_clip: "Tap again to move it to the trash",
    mic_unavailable: "Recording is not available here: {error}",
    voice_saved: "Voice note saved.",
    voice_save_failed: "Could not save the voice note: {error}",
    note_save_failed: "Could not save the note: {error}",
    transcribe_none: "No voice notes are waiting for transcription.",
    transcribe_done: "Voice notes transcribed: {count}",
    transcribe_unavailable: "No transcription engine on this device; the recording is kept and waits.",
    cmd_transcribe: "Transcribe pending voice notes",
    solo_label: "Edition",
    solo_all: "All editions",
    solo_title: "Show and edit one edition only, hiding the others",
    solo_absent: "{name} has no text in this fragment.",
    show_all: "Show all editions",
    settings_solo: "Single-edition editing",
    settings_solo_desc: "Show only this edition in every triptych, as a plain editing page without comparison rails.",
    settings_voice: "Voice notes",
    settings_engine: "Transcription engine",
    settings_engine_desc: "Recordings are always saved first; transcription follows and never replaces them.",
    engine_off: "Off — keep recordings pending",
    engine_local: "Local mlx-whisper (this Mac)",
    engine_api: "OpenAI-compatible API",
    settings_auto: "Transcribe automatically",
    settings_auto_desc: "After saving a recording, and for waiting recordings when the plugin starts.",
    settings_mlx_path: "mlx_whisper command",
    settings_mlx_model: "mlx-whisper model",
    settings_api_url: "API base URL",
    settings_api_key: "API key",
    settings_api_key_desc: "Stored in this plugin's data.json inside the vault's .obsidian folder; it travels with Sync and vault copies.",
    settings_api_model: "API model",
    settings_language: "Spoken language (blank = detect)",
    overlap_limit: "Up to three saved spans may overlap; this selection would be a fourth.",
    spans_choose: "Open which span?",
    pane_tab_title: "Show this edition; it opens first on every page",
    change: "Change",
    remove: "Remove",
    archive_scope: "This applies to the whole saved review, not to one page: the old decision file, its check file, and its instructions move to Preferences/archive/, and a new, empty review starts for the current text. Voice recordings stay where they are.",
    archive_button: "Archive {count} earlier choices and start a new review",
    archived_notice: "Earlier choices archived: {path}",
    edited_copy_heading: "Edited copy",
    edited_copy_explain: "Applies the preferred version of every saved Edit to one edition and writes Markdown and JSON to Preferences/Exports/. The sources are never changed; overlapping or stale edits are listed as skipped.",
    export_edition: "Export {edition} ({set})",
    export_done: "Wrote {path}: {applied} edits applied, {skipped} skipped",
    export_failed: "Could not export the edited copy: {error}",
    rank_heading: "Ranked pages",
    rank_explain: "Pages ordered by one metric for one edition, worst first, to decide where to look next.",
    rank_by: "Rank pages by",
    rank_none: "No page has this metric.",
    metrics_heading: "Metrics",
    metrics_desc: "Metrics declared by this vault, in the order they appear on each pane. Reorder with the arrows; switch off the ones you do not need.",
    move_up: "Move up",
    move_down: "Move down",
  }),
  it: Object.freeze({
    nav_Previous: "Precedente",
    nav_Up: "Su",
    nav_Back: "Indietro",
    nav_Forward: "Avanti",
    nav_Top: "Inizio",
    nav_TOC: "Indice",
    nav_Next: "Successivo",
    start_of_set: "Inizio della serie",
    end_of_set: "Fine della serie",
    reader_nav_aria: "Navigazione del Lettore",
    review: "Revisione",
    review_title_attr: "Apri le pagine toccate e il riepilogo delle decisioni",
    open_named: "Apri {name}",
    open_fragment: "Apri il frammento {order}: {title}",
    choose_set: "Scegliete una serie",
    reader_name: "Lettore FirstPair Triptych",
    reader_open_failed: "Il Lettore non si è potuto aprire: {error}",
    reader_navigate_failed: "Il Lettore non ha potuto cambiare pagina: {error}",
    review_heading: "Revisione Rosetta",
    review_display: "{title} — Revisione",
    review_open_failed: "La revisione Rosetta non si è potuta aprire: {error}",
    review_could_not_open: "La revisione non si è potuta aprire: {error}",
    overall_prefer: "Nel complesso: preferire {edition}",
    note_prefix: "Nota: {note}",
    review_nav_aria: "Navigazione della revisione",
    reader_button: "Lettore",
    review_back_title: "Torna alla pagina da cui siete venuti",
    refresh: "Aggiorna",
    review_explanation:
      "Qui sono elencate le pagine del Lettore che portano scelte e il riepilogo "
      + "deterministico delle decisioni. Nessun manoscritto viene composto o sovrascritto.",
    edited_pages: "Pagine con scelte",
    no_pages: "Nessuna pagina porta ancora scelte di revisione.",
    outside_slice: "Scelte fuori da questo Lettore",
    digest_heading: "Riepilogo delle decisioni",
    source_mismatch:
      "Le scelte salvate appartengono a una versione precedente del testo; non sono state applicate.",
    render_failed: "Il trittico non si è potuto mostrare: {error}",
    ledger_unreadable: "Registro delle scelte illeggibile; vedete la console. Nulla è stato sovrascritto.",
    cmd_open_reader: "Apri il Lettore",
    cmd_open_review: "Apri la revisione Rosetta",
    cmd_previous: "Lettore: frammento precedente",
    cmd_up: "Lettore: su",
    cmd_back: "Lettore: indietro",
    cmd_forward: "Lettore: avanti",
    cmd_top: "Lettore: inizio",
    cmd_contents: "Lettore: indice",
    cmd_next: "Lettore: frammento successivo",
    cmd_export: "Esporta il riepilogo delle istruzioni di revisione",
    wrote: "Scritto {path}",
    ribbon: "Apri il Lettore FirstPair Triptych",
    rendering: "Composizione…",
    lexical_similarity: "somiglianza lessicale {value}",
    moved: "spostato",
    before: "Prima",
    after: "Dopo",
    no_predecessor: "(nessun predecessore: l'unità è nuova)",
    no_successor: "(nessun successore: l'unità è stata tolta)",
    transformation_glossary:
      "Le parti tolte sono barrate a sinistra, le aggiunte segnate a destra. L'indicatore misura la somiglianza lessicale, non giudica lo stile.",
    similarity_previous: "somiglianza con lo stato precedente: {value}",
    first_state: "primo stato registrato",
    lineage_glossary:
      "Membri: {members}; stati distinti: {states}. Colore: verde ritocco leggero, ambra medio, rosso riscrittura profonda.",
    diff_previous: "differenze col precedente",
    events: "Eventi: ",
    panes_label: "Riquadri:",
    chip_title: "Mostra o nascondi questa edizione in tutti i trittici",
    review_chip_title: "Apri tutte le pagine toccate e il riepilogo delle decisioni",
    sentence_words: "Frasi e parole",
    sentence_toggle_title: "Mostra o nascondi le caselle di preferenza per ogni frase di questa pagina",
    all_hidden: "Tutti i riquadri sono nascosti: riattivatene uno qui sopra.",
    all_identical: "≡ Tutti i riquadri mostrati sono identici",
    identical_prefix: "≡ Identici: ",
    prefer_this_pane: " preferisci questo",
    preferred_notice: "Preferito: {name}",
    preference_cleared: "Preferenza tolta",
    save_preference_failed: "Impossibile salvare la preferenza: {error}",
    score_title: "Punteggio di divergenza Rosetta, da 0 (identico) a 100",
    split_fuse: "divisione/fusione",
    structural_title: "Cambiamento strutturale: il numero delle frasi cambia, il contenuto corrisponde",
    outlier: "da rivedere",
    outlier_title: "Da rivedere: questo riquadro si discosta dagli altri più di tutti",
    editing_note: "Nota di revisione",
    note_placeholder:
      "Istruzione breve per la prossima edizione, per esempio «conservare la scena delle querce; adottare il conto dei voti della 3.1»",
    save_note_failed: "Impossibile salvare la nota di revisione: {error}",
    bar_legend:
      "· condiviso/allineato · ❘ pressione di tono o di lessico · ❘❘ aggiunta, omissione o affermazione nuova · ❘❘❘ da rivedere · bordo punteggiato = divisione, fusione o riordino",
    feature_legend: "N affermazione nuova, M metafora, S divisione, R parole rare, E espanso, C compresso, F fuso",
    feature_N: "frase o affermazione nuova",
    feature_M: "immagine o figura nuova",
    feature_S: "frase divisa",
    feature_R: "parole rare caratteristiche",
    feature_E: "più lungo dei vicini",
    feature_C: "più breve dei vicini",
    feature_F: "frasi unite",
    absent: "(assente in questa edizione)",
    sentence_prefer_title: "Preferire questa frase nella prossima revisione",
    sentence_prefer_aria: "Preferire questa frase da {name}",
    sentence_save_failed_console: "Impossibile salvare la preferenza di frase; vedete la console.",
    sentence_save_failed: "Impossibile salvare la preferenza di frase: {error}",
    phrase_mark_title: "Cambiare o togliere questa istruzione",
    phrase_overlap: "Il passo si sovrappone a un segno già fatto: toglietelo prima.",
    phrase_dialog_aria: "Istruzione sul passo",
    prefer_this: "Preferisci",
    ungrammatical: "Sgrammaticato",
    phrase_save_failed_console: "Impossibile salvare l'istruzione; vedete la console.",
    clear: "Togli",
    phrase_clear_failed_console: "Impossibile togliere l'istruzione; vedete la console.",
    close: "Chiudi",
    close_phrase: "Chiudi le scelte sul passo",
    edit_phrase: "Modifica questo passo",
    propose_correction: "Proponi una correzione",
    selected_quote: "Selezione: «{quote}»",
    replacement_aria: "Nuova formulazione",
    cancel: "Annulla",
    save_replace: "Salva e sostituisci",
    save_edit: "Salva la modifica",
    save_next: "Salva come variante",
    enter_replacement: "Scrivete la nuova formulazione.",
    review_quote_aria: "Rivedi «{quote}»",
    phrase_choice_failed: "Impossibile salvare la scelta: {error}",
    action_good: "Buono",
    action_bad: "Cattivo",
    action_edit: "Modifica",
    action_prefer: "Preferito",
    action_ungrammatical: "Sgrammaticato",
    variants_heading: "Varianti — scegliete la versione preferita",
    saved_phrases: "Passi salvati",
    heading_badge: "Titolo",
    heading_aria: "Titolo del libro",
    prefer_sentence_title: "Preferire questa frase intera da {name}",
    prefer: "Preferisci",
    words: "Parole",
    whole_sentence: "Frase intera",
    words_hint: "Spuntate parole contigue; al massimo tre passi salvati possono sovrapporsi.",
    words_hint_touch: "Toccate una parola o trascinate su più parole; al massimo tre passi salvati possono sovrapporsi.",
    select_hint: "Scegliete parole contigue per rivedere un passo.",
    one_phrase_hint: "Scegliete parole contigue di un solo passo.",
    only: "Solo",
    only_title: "Rivedi solo «{word}»",
    clear_selection: "Togli la selezione",
    settings_lineage: "Vista arricchita delle genealogie",
    settings_lineage_desc:
      "Catena delle edizioni e schede degli stati distinti, con confronto, nelle note di genealogia (vista di lettura).",
    settings_transformation: "Vista arricchita delle trasformazioni",
    settings_transformation_desc:
      "Prima e Dopo affiancati, con le differenze parola per parola, nelle note di trasformazione (vista di lettura).",
    settings_previews: "Anteprime negli indici di confronto",
    settings_previews_desc: "Gli incipit compaiono man mano che le righe degli indici di confronto entrano in vista.",
    settings_visibility:
      "Visibilità delle edizioni: un riquadro nascosto qui scompare da tutti i "
      + "trittici (i pulsanti sopra ogni trittico agiscono sugli stessi interruttori).",
    settings_no_editions: "Nessuna edizione ancora vista: aprite una volta una nota di trittico.",
    action_note: "Nota",
    action_voice: "🎙 Voce",
    note_dialog_title: "Nota su «{quote}»",
    diff: "Differenze",
    diff_title: "Segna ciò che cambia tra le edizioni mostrate: due riquadri si confrontano a coppia, tre insieme",
    diff_legend_pair: "{older} → {newer}: barrato in {older} = tolto; sottolineato in {newer} = aggiunto.",
    diff_legend_all: "Tutte le {count} edizioni: evidenziato = solo in questa edizione; sottolineato nel colore di un'edizione = in comune solo con quella.",
    diff_same: "Nessuna differenza tra le edizioni mostrate in questa pagina.",
    diff_need_two: "Mostrate almeno due riquadri per vedere le differenze.",
    diff_del: "Assente in {name}",
    diff_ins: "Nuovo rispetto a {name}",
    diff_uniq: "Solo in questa edizione",
    diff_share: "In comune solo con {name}",
    diff_filters: "Mostra",
    diff_cat_punct: "Punteggiatura",
    diff_cat_inflect: "Desinenze",
    diff_cat_function: "Parole brevi",
    diff_cat_lexical: "Scelta lessicale",
    diff_cat_restructure: "Ristrutturato",
    diff_cat_rewrite: "Riscritto",
    diff_cat_content: "Aggiunto o tolto",
    diff_cat_moved: "Spostato",
    diff_moved_to: "Spostato: vedi {page}",
    diff_lens: "Storia",
    diff_lens_all: "Tutte le differenze",
    diff_lens_rewritten: "Testo stabile riscritto dall'ultima",
    diff_lens_reverts: "L'ultima è tornata alla prima",
    diff_lens_new: "Nuovo solo nell'ultima",
    rules_heading: "Regole di revisione",
    rules_explain: "Sostituzioni di una parola che ricorrono in più pagine. Accetta la applica ovunque; Rifiuta conserva ovunque la parola precedente. Una sostituzione che va anche nel senso opposto è segnalata.",
    rules_pair: "Confronta",
    rules_none: "Nessuna sostituzione ricorre in tre o più pagine.",
    rules_count: "{count}× in {pages} pagine",
    rules_conflict: "⇄ anche {from} → {to} {count}×",
    rules_conflict_title: "La modifica va in entrambi i sensi: gusto, più che regola",
    rules_accept: "Accetta",
    rules_reject: "Rifiuta",
    rules_places: "Luoghi",
    rules_saved: "Regola salvata",
    rules_save_failed: "Impossibile salvare la regola: {error}",
    heat_heading: "Dove sono le modifiche",
    heat_explain: "Parole cambiate in ogni parte, per tipo di modifica, tra le edizioni confrontate.",
    note_text_aria: "Nota scritta",
    note_text_placeholder: "Scrivete una nota, registratela, o entrambe le cose.",
    record: "Registra",
    stop: "Ferma",
    recording: "Registrazione… {time}",
    recorded: "Nuova registrazione {time}, non ancora salvata",
    discard: "Scarta",
    save_note: "Salva nota",
    delete_note: "Elimina nota",
    voice_clips: "Note vocali",
    transcript_pending: "Trascrizione in attesa",
    transcript_running: "Trascrizione in corso…",
    transcript_failed: "Trascrizione non riuscita: {error}",
    transcribe: "Trascrivi",
    retranscribe: "Trascrivi di nuovo",
    delete_clip: "Elimina registrazione",
    confirm_delete_clip: "Toccate di nuovo per spostarla nel cestino",
    mic_unavailable: "Qui non si può registrare: {error}",
    voice_saved: "Nota vocale salvata.",
    voice_save_failed: "Impossibile salvare la nota vocale: {error}",
    note_save_failed: "Impossibile salvare la nota: {error}",
    transcribe_none: "Nessuna nota vocale attende la trascrizione.",
    transcribe_done: "Note vocali trascritte: {count}",
    transcribe_unavailable: "Nessun motore di trascrizione su questo dispositivo: la registrazione resta e attende.",
    cmd_transcribe: "Trascrivi le note vocali in attesa",
    solo_label: "Edizione",
    solo_all: "Tutte le edizioni",
    solo_title: "Mostra e correggi una sola edizione, nascondendo le altre",
    solo_absent: "{name} non ha testo in questo frammento.",
    show_all: "Mostra tutte le edizioni",
    settings_solo: "Correzione di una sola edizione",
    settings_solo_desc: "Mostra in ogni trittico solo questa edizione, come pagina di correzione senza binari di confronto.",
    settings_voice: "Note vocali",
    settings_engine: "Motore di trascrizione",
    settings_engine_desc: "Le registrazioni si salvano sempre prima; la trascrizione segue e non le sostituisce mai.",
    engine_off: "Spento: le registrazioni restano in attesa",
    engine_local: "mlx-whisper locale (questo Mac)",
    engine_api: "API compatibile con OpenAI",
    settings_auto: "Trascrivi automaticamente",
    settings_auto_desc: "Dopo aver salvato una registrazione, e per quelle in attesa all'avvio del plugin.",
    settings_mlx_path: "Comando mlx_whisper",
    settings_mlx_model: "Modello mlx-whisper",
    settings_api_url: "URL di base dell'API",
    settings_api_key: "Chiave API",
    settings_api_key_desc: "Salvata nel data.json del plugin dentro la cartella .obsidian del vault: viaggia con Sync e con le copie del vault.",
    settings_api_model: "Modello API",
    settings_language: "Lingua parlata (vuoto = rileva)",
    overlap_limit: "Al massimo tre passi salvati possono sovrapporsi: questa scelta sarebbe il quarto.",
    spans_choose: "Quale passo aprire?",
    pane_tab_title: "Mostra questa edizione: si aprirà per prima su ogni pagina",
    change: "Modifica",
    remove: "Rimuovi",
    archive_scope: "Riguarda l'intera revisione salvata, non una pagina: il vecchio file delle decisioni, il suo file di controllo e le istruzioni passano in Preferences/archive/, e per il testo attuale comincia una revisione nuova e vuota. Le registrazioni restano dove sono.",
    archive_button: "Archivia {count} scelte precedenti e comincia una nuova revisione",
    archived_notice: "Scelte precedenti archiviate: {path}",
    edited_copy_heading: "Copia corretta",
    edited_copy_explain: "Applica a un'edizione la versione preferita di ogni Modifica salvata e scrive Markdown e JSON in Preferences/Exports/. Le fonti non cambiano mai; le modifiche sovrapposte o superate figurano come saltate.",
    export_edition: "Esporta {edition} ({set})",
    export_done: "Scritto {path}: {applied} modifiche applicate, {skipped} saltate",
    export_failed: "Impossibile esportare la copia corretta: {error}",
    rank_heading: "Pagine in graduatoria",
    rank_explain: "Pagine ordinate per una metrica e un'edizione, dalla peggiore, per decidere dove guardare dopo.",
    rank_by: "Ordina le pagine per",
    rank_none: "Nessuna pagina ha questa metrica.",
    metrics_heading: "Metriche",
    metrics_desc: "Metriche dichiarate da questo vault, nell'ordine in cui compaiono su ogni riquadro. Riordinatele con le frecce; spegnete quelle che non servono.",
    move_up: "Sposta su",
    move_down: "Sposta giù",
  }),
  ru: Object.freeze({
    nav_Previous: "Предыдущий",
    nav_Up: "Выше",
    nav_Back: "Назад",
    nav_Forward: "Вперёд",
    nav_Top: "В начало",
    nav_TOC: "Оглавление",
    nav_Next: "Следующий",
    start_of_set: "Начало серии",
    end_of_set: "Конец серии",
    reader_nav_aria: "Навигация окна чтения",
    review: "Обзор",
    review_title_attr: "Открыть затронутые страницы и сводку решений",
    open_named: "Открыть: {name}",
    open_fragment: "Открыть фрагмент {order}: {title}",
    choose_set: "Выберите серию",
    reader_name: "Окно чтения FirstPair Triptych",
    reader_open_failed: "Окно чтения не открылось: {error}",
    reader_navigate_failed: "Окно чтения не смогло перейти: {error}",
    review_heading: "Редакторский обзор Rosetta",
    review_display: "{title} — обзор",
    review_open_failed: "Обзор Rosetta не открылся: {error}",
    review_could_not_open: "Обзор не открылся: {error}",
    overall_prefer: "В целом: предпочесть {edition}",
    note_prefix: "Заметка: {note}",
    review_nav_aria: "Навигация обзора",
    reader_button: "Окно чтения",
    review_back_title: "Вернуться на страницу, с которой пришли",
    refresh: "Обновить",
    review_explanation:
      "Здесь перечислены страницы окна чтения, на которых приняты решения, и точная "
      + "сводка этих решений. Рукопись здесь не собирается и не перезаписывается.",
    edited_pages: "Страницы с решениями",
    no_pages: "Решений пока нет ни на одной странице.",
    outside_slice: "Решения вне этого окна чтения",
    digest_heading: "Сводка решений",
    source_mismatch: "Сохранённые решения относятся к прежней версии текста и не применены.",
    render_failed: "Не удалось показать триптих: {error}",
    ledger_unreadable: "Журнал решений не читается; подробности в консоли. Ничего не перезаписано.",
    cmd_open_reader: "Открыть окно чтения",
    cmd_open_review: "Открыть обзор Rosetta",
    cmd_previous: "Окно чтения: предыдущий фрагмент",
    cmd_up: "Окно чтения: выше",
    cmd_back: "Окно чтения: назад",
    cmd_forward: "Окно чтения: вперёд",
    cmd_top: "Окно чтения: в начало",
    cmd_contents: "Окно чтения: оглавление",
    cmd_next: "Окно чтения: следующий фрагмент",
    cmd_export: "Выгрузить сводку указаний для правки",
    wrote: "Записано: {path}",
    ribbon: "Открыть окно чтения FirstPair Triptych",
    rendering: "Отрисовка…",
    lexical_similarity: "лексическое сходство {value}",
    moved: "перемещено",
    before: "До",
    after: "После",
    no_predecessor: "(предшественника нет: единица новая)",
    no_successor: "(продолжения нет: единица изъята)",
    transformation_glossary:
      "Удалённое зачёркнуто слева, добавленное отмечено справа. Шкала показывает лексическое сходство, а не литературную оценку.",
    similarity_previous: "сходство с предыдущим состоянием: {value}",
    first_state: "первое записанное состояние",
    lineage_glossary:
      "Членов: {members}; различных состояний: {states}. Цвет плашки: зелёный — лёгкая правка, янтарный — средняя, красный — сильная переработка.",
    diff_previous: "отличия от предыдущего",
    events: "События: ",
    panes_label: "Панели:",
    chip_title: "Показать или скрыть это издание во всех триптихах",
    review_chip_title: "Открыть все затронутые страницы и сводку решений",
    sentence_words: "Предложения и слова",
    sentence_toggle_title: "Показать или скрыть флажки выбора предложений на этой странице",
    all_hidden: "Все панели скрыты — включите панель выше.",
    all_identical: "≡ Все показанные панели совпадают",
    identical_prefix: "≡ Совпадают: ",
    prefer_this_pane: " предпочесть",
    preferred_notice: "Предпочтено: {name}",
    preference_cleared: "Предпочтение снято",
    save_preference_failed: "Не удалось сохранить предпочтение: {error}",
    score_title: "Оценка расхождения Rosetta: от 0 (совпадает) до 100",
    split_fuse: "разбивка/слияние",
    structural_title: "Изменено строение: число предложений другое, содержание совпадает",
    outlier: "перепроверить",
    outlier_title: "Перепроверить: эта панель расходится с остальными сильнее всех",
    editing_note: "Заметка для правки",
    note_placeholder:
      "Короткое указание для следующего издания, например: «сохранить сцену с дубами; взять подсчёт голосов из 3.1»",
    save_note_failed: "Не удалось сохранить заметку: {error}",
    bar_legend:
      "· общее/совпадает · ❘ сдвиг тона или словаря · ❘❘ добавление, пропуск или новое утверждение · ❘❘❘ перепроверить · пунктирный край = разбивка, слияние или перестановка",
    feature_legend: "N новое утверждение, M метафора, S разбивка, R редкие слова, E расширено, C сжато, F слито",
    feature_N: "новое предложение или утверждение",
    feature_M: "новый образ или фигура",
    feature_S: "предложение разбито",
    feature_R: "редкие характерные слова",
    feature_E: "длиннее соседних",
    feature_C: "короче соседних",
    feature_F: "предложения слиты",
    absent: "(в этом издании нет)",
    sentence_prefer_title: "Предпочесть это предложение при следующей правке",
    sentence_prefer_aria: "Предпочесть это предложение из «{name}»",
    sentence_save_failed_console: "Не удалось сохранить выбор предложения; подробности в консоли.",
    sentence_save_failed: "Не удалось сохранить выбор предложения: {error}",
    phrase_mark_title: "Изменить или снять это указание",
    phrase_overlap: "Отрывок пересекается с уже сделанной отметкой. Сначала снимите её.",
    phrase_dialog_aria: "Указание к отрывку",
    prefer_this: "Предпочесть",
    ungrammatical: "Неграмотно",
    phrase_save_failed_console: "Не удалось сохранить указание; подробности в консоли.",
    clear: "Снять",
    phrase_clear_failed_console: "Не удалось снять указание; подробности в консоли.",
    close: "Закрыть",
    close_phrase: "Закрыть выбор для отрывка",
    edit_phrase: "Исправить этот отрывок",
    propose_correction: "Предложить исправление",
    selected_quote: "Выбрано: «{quote}»",
    replacement_aria: "Новая формулировка",
    cancel: "Отмена",
    save_replace: "Сохранить и заменить",
    save_edit: "Сохранить правку",
    save_next: "Сохранить ещё вариант",
    enter_replacement: "Введите новую формулировку.",
    review_quote_aria: "Оценить «{quote}»",
    phrase_choice_failed: "Не удалось сохранить выбор: {error}",
    action_good: "Хорошо",
    action_bad: "Плохо",
    action_edit: "Исправить",
    action_prefer: "Предпочтено",
    action_ungrammatical: "Неграмотно",
    variants_heading: "Варианты правки — отметьте лучший",
    saved_phrases: "Сохранённые отрывки",
    heading_badge: "Заголовок",
    heading_aria: "Заголовок книги",
    prefer_sentence_title: "Предпочесть всё предложение из «{name}»",
    prefer: "Предпочесть",
    words: "Слова",
    whole_sentence: "Всё предложение",
    words_hint: "Отметьте соседние слова; пересекаться могут не больше трёх сохранённых отрывков.",
    words_hint_touch: "Нажмите на слово или проведите по нескольким; пересекаться могут не больше трёх сохранённых отрывков.",
    select_hint: "Выберите соседние слова, чтобы оценить отрывок.",
    one_phrase_hint: "Выберите соседние слова одного отрывка.",
    only: "Только",
    only_title: "Оценить только «{word}»",
    clear_selection: "Снять выделение",
    settings_lineage: "Расширенный вид родословных",
    settings_lineage_desc:
      "Цепочка изданий и карточки различных состояний с переключателем отличий в заметках-родословных (режим чтения).",
    settings_transformation: "Расширенный вид преобразований",
    settings_transformation_desc:
      "«До» и «После» рядом, с пословными отличиями, в заметках о преобразованиях (режим чтения).",
    settings_previews: "Предпросмотр в сравнениях",
    settings_previews_desc: "Начальные слова строк в сравнительных сводках подгружаются по мере прокрутки.",
    settings_visibility:
      "Видимость изданий: панель, скрытая здесь, исчезает из всех триптихов "
      + "(кнопки над каждым триптихом переключают те же флажки).",
    settings_no_editions: "Издания ещё не встречались — откройте любую заметку-триптих.",
    action_note: "Заметка",
    action_voice: "🎙 Голос",
    note_dialog_title: "Заметка к «{quote}»",
    diff: "Разница",
    diff_title: "Отметить расхождения между показанными изданиями: две панели сравниваются попарно, три — все вместе",
    diff_legend_pair: "{older} → {newer}: зачёркнуто в {older} — убрано; подчёркнуто в {newer} — добавлено.",
    diff_legend_all: "Все {count} издания: выделено — есть только в этом издании; подчёркнуто цветом издания — общее только с ним.",
    diff_same: "На этой странице показанные издания не расходятся.",
    diff_need_two: "Чтобы увидеть разницу, откройте хотя бы две панели.",
    diff_del: "Нет в {name}",
    diff_ins: "Новое по сравнению с {name}",
    diff_uniq: "Только в этом издании",
    diff_share: "Общее только с {name}",
    diff_filters: "Показать",
    diff_cat_punct: "Пунктуация",
    diff_cat_inflect: "Окончания",
    diff_cat_function: "Служебные слова",
    diff_cat_lexical: "Выбор слова",
    diff_cat_restructure: "Перестройка",
    diff_cat_rewrite: "Переписано",
    diff_cat_content: "Добавлено или убрано",
    diff_cat_moved: "Перенесено",
    diff_moved_to: "Перенесено: см. {page}",
    diff_lens: "История",
    diff_lens_all: "Все расхождения",
    diff_lens_rewritten: "Устоявшийся текст, переписанный последним",
    diff_lens_reverts: "Последнее вернулось к первому",
    diff_lens_new: "Только в последнем",
    rules_heading: "Правила правки",
    rules_explain: "Замены одного слова, повторяющиеся на нескольких страницах. «Принять» применяет замену везде, «Отклонить» везде оставляет прежнее слово. Замена, идущая и в обратную сторону, отмечена.",
    rules_pair: "Сравнить",
    rules_none: "Ни одна замена не повторяется на трёх и более страницах.",
    rules_count: "{count}× на {pages} стр.",
    rules_conflict: "⇄ и {from} → {to} {count}×",
    rules_conflict_title: "Правка идёт в обе стороны: скорее вкус, чем правило",
    rules_accept: "Принять",
    rules_reject: "Отклонить",
    rules_places: "Где",
    rules_saved: "Правило сохранено",
    rules_save_failed: "Не удалось сохранить правило: {error}",
    heat_heading: "Где правки",
    heat_explain: "Сколько слов изменено в каждой части, по видам правки, между сравниваемыми изданиями.",
    note_text_aria: "Текст заметки",
    note_text_placeholder: "Напишите заметку, запишите голосом — или то и другое.",
    record: "Записать",
    stop: "Стоп",
    recording: "Идёт запись… {time}",
    recorded: "Новая запись {time}, ещё не сохранена",
    discard: "Стереть",
    save_note: "Сохранить заметку",
    delete_note: "Удалить заметку",
    voice_clips: "Голосовые заметки",
    transcript_pending: "Ждёт расшифровки",
    transcript_running: "Расшифровывается…",
    transcript_failed: "Расшифровать не удалось: {error}",
    transcribe: "Расшифровать",
    retranscribe: "Расшифровать заново",
    delete_clip: "Удалить запись",
    confirm_delete_clip: "Нажмите ещё раз, чтобы отправить в корзину",
    mic_unavailable: "Запись здесь недоступна: {error}",
    voice_saved: "Голосовая заметка сохранена.",
    voice_save_failed: "Не удалось сохранить голосовую заметку: {error}",
    note_save_failed: "Не удалось сохранить заметку: {error}",
    transcribe_none: "Голосовых заметок, ждущих расшифровки, нет.",
    transcribe_done: "Расшифровано голосовых заметок: {count}",
    transcribe_unavailable: "На этом устройстве расшифровка не настроена; запись сохранена и подождёт.",
    cmd_transcribe: "Расшифровать ожидающие голосовые заметки",
    solo_label: "Издание",
    solo_all: "Все издания",
    solo_title: "Показывать и править одно издание, скрыв остальные",
    solo_absent: "{name}: в этом фрагменте текста нет.",
    show_all: "Показать все издания",
    settings_solo: "Правка одного издания",
    settings_solo_desc: "Показывать в каждом триптихе только это издание — как страницу правки, без шкал сравнения.",
    settings_voice: "Голосовые заметки",
    settings_engine: "Расшифровка",
    settings_engine_desc: "Запись всегда сохраняется первой; расшифровка идёт следом и никогда её не заменяет.",
    engine_off: "Выключена — записи ждут",
    engine_local: "Локальный mlx-whisper (этот Mac)",
    engine_api: "API, совместимый с OpenAI",
    settings_auto: "Расшифровывать сразу",
    settings_auto_desc: "После сохранения записи, а также для ждущих записей при запуске плагина.",
    settings_mlx_path: "Команда mlx_whisper",
    settings_mlx_model: "Модель mlx-whisper",
    settings_api_url: "Базовый URL API",
    settings_api_key: "Ключ API",
    settings_api_key_desc: "Хранится в data.json плагина в папке .obsidian хранилища и уходит вместе с Sync и копиями хранилища.",
    settings_api_model: "Модель API",
    settings_language: "Язык речи (пусто — определить)",
    overlap_limit: "Пересекаться могут не больше трёх сохранённых отрывков; этот был бы четвёртым.",
    spans_choose: "Какой отрывок открыть?",
    pane_tab_title: "Показать это издание; оно будет открываться первым на каждой странице",
    change: "Изменить",
    remove: "Убрать",
    archive_scope: "Действие относится ко всему сохранённому обзору, а не к одной странице: прежний файл решений, его проверочный файл и указания переносятся в Preferences/archive/, и для нынешнего текста начинается новый, пустой обзор. Голосовые записи остаются на месте.",
    archive_button: "Убрать в архив прежние решения ({count}) и начать новый обзор",
    archived_notice: "Прежние решения в архиве: {path}",
    edited_copy_heading: "Исправленная копия",
    edited_copy_explain: "Применяет к одному изданию предпочтённый вариант каждой сохранённой правки и пишет Markdown и JSON в Preferences/Exports/. Исходные тексты не меняются; пересекающиеся и устаревшие правки перечислены как пропущенные.",
    export_edition: "Выгрузить {edition} ({set})",
    export_done: "Записано {path}: правок применено {applied}, пропущено {skipped}",
    export_failed: "Не удалось выгрузить исправленную копию: {error}",
    rank_heading: "Страницы по метрике",
    rank_explain: "Страницы, упорядоченные по одной метрике одного издания, начиная с худших, — чтобы решить, куда смотреть дальше.",
    rank_by: "Упорядочить страницы по",
    rank_none: "Ни у одной страницы нет этой метрики.",
    metrics_heading: "Метрики",
    metrics_desc: "Метрики, объявленные этим хранилищем, в том порядке, в каком они стоят на каждой панели. Переставляйте их стрелками и отключайте ненужные.",
    move_up: "Выше",
    move_down: "Ниже",
  }),
});

// Count nouns: English keeps its historical wording; Italian has one/many;
// Russian takes one / few (2-4) / many (5-20, 11-14).
const UI_COUNTS = Object.freeze({
  en: Object.freeze({
    fragment: ["fragments", "fragments"],
    set: ["sets", "sets"],
    member: ["members", "members"],
    preferred_sentence: ["preferred sentence", "preferred sentences"],
    saved_choice: ["saved review choice", "saved review choices"],
  }),
  it: Object.freeze({
    fragment: ["frammento", "frammenti"],
    set: ["serie", "serie"],
    member: ["membro", "membri"],
    preferred_sentence: ["frase preferita", "frasi preferite"],
    saved_choice: ["scelta salvata", "scelte salvate"],
  }),
  ru: Object.freeze({
    fragment: ["фрагмент", "фрагмента", "фрагментов"],
    set: ["серия", "серии", "серий"],
    member: ["член", "члена", "членов"],
    preferred_sentence: ["предпочтённое предложение", "предпочтённых предложения", "предпочтённых предложений"],
    saved_choice: ["сохранённое решение", "сохранённых решения", "сохранённых решений"],
  }),
});

const UI_LANGUAGES = Object.freeze(Object.keys(UI_STRINGS));

function uiLanguageOrDefault(lang) {
  return Object.prototype.hasOwnProperty.call(UI_STRINGS, lang) ? lang : "en";
}

function uiText(lang, key, vars = {}) {
  const table = UI_STRINGS[uiLanguageOrDefault(lang)];
  const template = Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : UI_STRINGS.en[key];
  if (template === undefined) throw new Error(`unknown UI string: ${key}`);
  return template.replace(/\{([a-z_]+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  ));
}

function russianPluralIndex(count) {
  const value = Math.abs(Math.trunc(Number(count) || 0));
  if (value % 10 === 1 && value % 100 !== 11) return 0;
  if (value % 10 >= 2 && value % 10 <= 4 && !(value % 100 >= 12 && value % 100 <= 14)) return 1;
  return 2;
}

function uiCount(lang, count, noun) {
  const language = uiLanguageOrDefault(lang);
  const forms = UI_COUNTS[language][noun];
  if (!forms) throw new Error(`unknown UI count noun: ${noun}`);
  const index = language === "ru" ? russianPluralIndex(count) : (count === 1 ? 0 : 1);
  return `${count} ${forms[index]}`;
}

/* The vault language: the canonical row of editions.jsonl, else the one
 * language every row shares, else English. */
function pickUiLanguage(editionsJsonl) {
  const rows = [];
  for (const line of String(editionsJsonl || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === "object") rows.push(row);
    } catch (_error) {
      return "en";
    }
  }
  const canonical = rows.filter((row) => row.canonical === true);
  if (canonical.length === 1 && typeof canonical[0].lang === "string") {
    return uiLanguageOrDefault(canonical[0].lang);
  }
  const languages = new Set(rows.map((row) => (
    typeof row.lang === "string" ? row.lang : "en"
  )));
  return languages.size === 1 ? uiLanguageOrDefault([...languages][0]) : "en";
}

module.exports = {
  MAX_SPAN_OVERLAP,
  overlapDepth,
  spanColors,
  LEDGER_SCHEMA,
  LEDGER_VERSION,
  LEGACY_LEDGER_SCHEMA,
  OFFSET_UNIT,
  UI_LANGUAGES,
  UI_STRINGS,
  VOICE_ROOT,
  addVoiceClip,
  audioExtension,
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
  annotationOverlaps,
  ruleDecisionMap,
  setRuleDecision,
  annotationSegments,
  annotationsForSentence,
  clearPhraseAnnotation,
  codePointLength,
  compactInstructionText,
  correctionVariantId,
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
  setSentenceTokenSelection,
  sha256Id,
  sha256Utf8,
  sliceCodePoints,
  stableHash,
  touchedFragmentKeys,
  upsertPhraseAnnotation,
  uiCount,
  uiText,
  wordTokens,
};
