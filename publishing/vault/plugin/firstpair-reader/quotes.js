"use strict";

/*
 * Quote-to-source finder for the FirstPair Reader, generalized from the
 * Cicero Bilingual Source Navigator (Cicero on Himself, plugin 1.3.0).
 *
 * A reviewed quote index ("schema_version": 1) lists source passages with
 * their texts in any languages and an exact note#^block target.  Matching
 * uses an inverted index of exact and IDF-weighted token postings, then a
 * containment / Dice / trigram score; Latin text folds j->i and v->u.  The
 * index path comes from the vault's Reader model, never from a book name.
 */

const DEFAULT_INDEX_NAMES = Object.freeze(["bilingual-quotes.json", "quote-index.json"]);
const LANGUAGE_NAMES = Object.freeze({
  la: "Latin", en: "English", ru: "Russian", it: "Italian", grc: "Greek", de: "German", fr: "French",
});

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value) {
  return asText(value)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/!?\[\[([^\]]+)\]\]/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|thinsp);/gi, " ")
    .replace(/&(?:mdash|ndash);/gi, "-")
    .replace(/&(?:quot|ldquo|rdquo);/gi, '"')
    .replace(/&(?:apos|lsquo|rsquo);/gi, "'")
    .replace(/æ/gi, (match) => (match === "Æ" ? "AE" : "ae"))
    .replace(/œ/gi, (match) => (match === "Œ" ? "OE" : "oe"))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[’‘`´]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .replace(/(^|\s)'/g, "$1")
    .replace(/'($|\s)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLatin(value) {
  return normalizeText(value)
    .replace(/j/g, "i")
    .replace(/v/g, "u");
}

function sanitizeVaultPath(value) {
  let path = asText(value).replace(/\\/g, "/");
  if (!path) throw new Error("missing note path");
  if (/^(?:[a-z]+:|\/|~)/i.test(path)) {
    throw new Error(`note path must be vault-relative: ${path}`);
  }
  const parts = path.split("/").filter((part) => part && part !== ".");
  if (parts.includes("..")) throw new Error(`note path escapes the vault: ${path}`);
  path = parts.join("/").replace(/\.md$/i, "");
  if (!path) throw new Error("missing note path");
  return path;
}

function sanitizeBlock(value) {
  const block = asText(value).replace(/^#?\^/, "");
  if (!block) return "";
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(block)) {
    throw new Error(`invalid block identifier: ${block}`);
  }
  return block;
}

function bilingualLinkTarget(entry) {
  const note = sanitizeVaultPath(entry && entry.note);
  const block = sanitizeBlock(entry && entry.block);
  if (!block) throw new Error("bilingual source entry has no block anchor");
  return `${note}#^${block}`;
}

function parsePositiveLine(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`invalid line number: ${value}`);
  return number;
}

function parseIndex(input) {
  let payload = input;
  if (typeof input === "string") {
    try {
      payload = JSON.parse(input);
    } catch (error) {
      throw new Error(`invalid JSON: ${error.message}`);
    }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("index root must be a JSON object");
  }

  const schemaVersion = payload.schema_version ?? payload.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== "1") {
    throw new Error(`unsupported schema_version ${JSON.stringify(schemaVersion)}; expected 1`);
  }
  if (!Array.isArray(payload.entries)) throw new Error("index entries must be an array");
  if (!payload.entries.length) throw new Error("index contains no entries");

  const errors = [];
  const entries = [];
  const ids = new Set();
  payload.entries.forEach((raw, index) => {
    try {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("entry must be an object");
      }
      const id = asText(raw.id);
      if (!id) throw new Error("missing id");
      if (ids.has(id)) throw new Error(`duplicate id ${id}`);
      ids.add(id);

      const note = sanitizeVaultPath(raw.note ?? raw.path ?? raw.note_path);
      const block = sanitizeBlock(raw.block ?? raw.anchor ?? raw.block_id);
      const line = parsePositiveLine(raw.line ?? raw.line_number);
      if (!block && line === null) throw new Error("missing block or line anchor");

      const latin = asText(raw.latin ?? raw.la);
      const english = asText(raw.english ?? raw.en ?? raw.translation);
      const russian = asText(raw.russian ?? raw.ru);
      const texts = {};
      if (raw.texts && typeof raw.texts === "object" && !Array.isArray(raw.texts)) {
        for (const [lang, value] of Object.entries(raw.texts)) {
          if (asText(value)) texts[lang] = asText(value);
        }
      }
      if (!latin && !english && !russian && !Object.keys(texts).length) {
        throw new Error("entry has no text in any language");
      }

      const aliases = [];
      for (const value of [raw.aliases, raw.quotes, raw.book_quotes]) {
        if (Array.isArray(value)) aliases.push(...value.map(asText).filter(Boolean));
      }

      entries.push({
        ...raw,
        id,
        urn: asText(raw.urn),
        work_id: asText(raw.work_id),
        work_title: asText(raw.work_title),
        citation: asText(raw.citation),
        note,
        block,
        line,
        latin,
        english,
        russian,
        texts,
        aliases: [...new Set(aliases)],
      });
    } catch (error) {
      errors.push(`entry ${index + 1}: ${error.message}`);
    }
  });

  if (errors.length) {
    const sample = errors.slice(0, 3).join("; ");
    const remainder = errors.length > 3 ? `; and ${errors.length - 3} more` : "";
    throw new Error(`${sample}${remainder}`);
  }
  return { schemaVersion: 1, entries };
}

function tokens(value) {
  return normalizeText(value).split(" ").filter(Boolean);
}

function diceCoefficient(leftValues, rightValues) {
  const left = new Set(leftValues);
  const right = new Set(rightValues);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const value of left) if (right.has(value)) overlap += 1;
  return (2 * overlap) / (left.size + right.size);
}

function trigrams(value) {
  const compact = value.replace(/\s+/g, " ");
  if (compact.length < 3) return compact ? [compact] : [];
  const values = [];
  for (let index = 0; index <= compact.length - 3; index += 1) {
    values.push(compact.slice(index, index + 3));
  }
  return values;
}

function similarity(query, candidate) {
  if (!query || !candidate) return 0;
  if (query === candidate) return 1;
  const shorter = query.length <= candidate.length ? query : candidate;
  const longer = query.length > candidate.length ? query : candidate;
  if (shorter.length >= 4 && longer.includes(shorter)) {
    const coverage = shorter.length / longer.length;
    return Math.min(0.985, 0.84 + 0.145 * Math.sqrt(coverage));
  }
  if (shorter.length < 12) return 0;

  const tokenScore = diceCoefficient(query.split(" "), candidate.split(" "));
  const trigramScore = diceCoefficient(trigrams(query), trigrams(candidate));
  const lengthRatio = shorter.length / longer.length;
  return (0.38 * tokenScore + 0.52 * trigramScore + 0.1 * lengthRatio);
}

function rawEntryFields(entry) {
  const fields = [];
  if (entry.latin) {
    fields.push({
      language: "Latin",
      text: entry.latin,
      normalizedOverride: entry.latin_normalized || entry.normalized_latin,
      latin: true,
    });
  }
  if (entry.english) {
    fields.push({
      language: "English",
      text: entry.english,
      normalizedOverride: entry.english_normalized || entry.normalized_english,
      latin: false,
    });
  }
  if (entry.russian) {
    fields.push({
      language: "Russian",
      text: entry.russian,
      normalizedOverride: entry.russian_normalized || entry.normalized_russian,
      latin: false,
    });
  }
  for (const [lang, text] of Object.entries(entry.texts || {})) {
    const legacy = { la: entry.latin, en: entry.english, ru: entry.russian }[lang];
    if (legacy && legacy === text) continue;
    fields.push({ language: LANGUAGE_NAMES[lang] || lang, text, latin: lang === "la" });
  }
  for (const alias of entry.aliases || []) {
    fields.push({ language: "Alias", text: alias, latin: false });
    fields.push({ language: "Latin alias", text: alias, latin: true });
  }
  return fields;
}

function appendPosting(map, key, fieldIndex) {
  const existing = map.get(key);
  if (existing) existing.push(fieldIndex);
  else map.set(key, [fieldIndex]);
}

function buildSearchIndex(entries, options = {}) {
  if (!Array.isArray(entries)) throw new Error("search index entries must be an array");
  const fields = [];
  const exact = new Map();
  const tokenPostings = new Map();

  entries.forEach((entry, entryIndex) => {
    for (const raw of rawEntryFields(entry)) {
      const searchText = asText(raw.normalizedOverride) || raw.text;
      const normalized = raw.latin ? normalizeLatin(searchText) : normalizeText(searchText);
      if (!normalized) continue;
      const tokenValues = [...new Set(normalized.split(" ").filter(Boolean))];
      const fieldIndex = fields.length;
      fields.push({
        entry,
        entryIndex,
        language: raw.language,
        text: raw.text,
        latin: raw.latin,
        normalized,
        tokenValues,
        tokenSet: new Set(tokenValues),
        trigramSet: null,
      });
      appendPosting(exact, normalized, fieldIndex);
      for (const token of tokenValues) appendPosting(tokenPostings, token, fieldIndex);
    }
  });

  const requestedMaximum = Number(options.maxCandidates);
  const maxCandidates = Number.isInteger(requestedMaximum) && requestedMaximum >= 100
    ? requestedMaximum
    : 2500;
  return {
    kind: "cbsn-search-index-v1",
    entries,
    fields,
    exact,
    tokenPostings,
    maxCandidates,
    debugLastCandidateCount: 0,
  };
}

function preparedQuery(normalized) {
  const tokenValues = [...new Set(normalized.split(" ").filter(Boolean))];
  return {
    normalized,
    tokenValues,
    tokenSet: new Set(tokenValues),
    trigramSet: new Set(trigrams(normalized)),
  };
}

function diceSets(left, right) {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  const smaller = left.size <= right.size ? left : right;
  const larger = left.size > right.size ? left : right;
  for (const value of smaller) if (larger.has(value)) overlap += 1;
  return (2 * overlap) / (left.size + right.size);
}

function preparedSimilarity(query, field) {
  const candidate = field.normalized;
  if (!query.normalized || !candidate) return 0;
  if (query.normalized === candidate) return 1;
  const shorter = query.normalized.length <= candidate.length ? query.normalized : candidate;
  const longer = query.normalized.length > candidate.length ? query.normalized : candidate;
  if (shorter.length >= 4 && longer.includes(shorter)) {
    const coverage = shorter.length / longer.length;
    return Math.min(0.985, 0.84 + 0.145 * Math.sqrt(coverage));
  }
  if (shorter.length < 12) return 0;
  if (!field.trigramSet) field.trigramSet = new Set(trigrams(candidate));
  const tokenScore = diceSets(query.tokenSet, field.tokenSet);
  const trigramScore = diceSets(query.trigramSet, field.trigramSet);
  const lengthRatio = shorter.length / longer.length;
  return 0.38 * tokenScore + 0.52 * trigramScore + 0.1 * lengthRatio;
}

function candidateFields(searchIndex, queryVariants) {
  const exactMatches = new Set();
  for (const query of queryVariants) {
    for (const fieldIndex of searchIndex.exact.get(query.normalized) || []) {
      exactMatches.add(fieldIndex);
    }
  }
  if (exactMatches.size) {
    const values = [...exactMatches];
    searchIndex.debugLastCandidateCount = values.length;
    return values;
  }

  const weights = new Map();
  const seenQueryTokens = new Set();
  for (const query of queryVariants) {
    for (const token of query.tokenValues) {
      if (seenQueryTokens.has(token)) continue;
      seenQueryTokens.add(token);
      const posting = searchIndex.tokenPostings.get(token);
      if (!posting) continue;
      const weight = 1 + Math.log((searchIndex.fields.length + 1) / (posting.length + 1));
      for (const fieldIndex of posting) {
        weights.set(fieldIndex, (weights.get(fieldIndex) || 0) + weight);
      }
    }
  }

  const values = [...weights.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .slice(0, searchIndex.maxCandidates)
    .map(([fieldIndex]) => fieldIndex);
  searchIndex.debugLastCandidateCount = values.length;
  return values;
}

function matchEntries(queryText, entriesOrIndex, options = {}) {
  const query = normalizeText(queryText);
  const queryLatin = normalizeLatin(queryText);
  if (!query) return [];
  const searchIndex = entriesOrIndex && entriesOrIndex.kind === "cbsn-search-index-v1"
    ? entriesOrIndex
    : buildSearchIndex(entriesOrIndex || []);
  const queryGeneralPrepared = preparedQuery(query);
  const queryLatinPrepared = queryLatin === query
    ? queryGeneralPrepared
    : preparedQuery(queryLatin);
  const queryVariants = queryLatinPrepared === queryGeneralPrepared
    ? [queryGeneralPrepared]
    : [queryGeneralPrepared, queryLatinPrepared];
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 12;
  const byEntry = new Map();

  for (const fieldIndex of candidateFields(searchIndex, queryVariants)) {
    const field = searchIndex.fields[fieldIndex];
    const candidateQuery = field.latin ? queryLatinPrepared : queryGeneralPrepared;
    const score = preparedSimilarity(candidateQuery, field);
    const existing = byEntry.get(field.entryIndex);
    if (score > 0 && (!existing || score > existing.score)) {
      byEntry.set(field.entryIndex, {
        entry: field.entry,
        score,
        language: field.language,
        matchedText: field.text,
      });
    }
  }

  return [...byEntry.values()]
    .sort((left, right) =>
      right.score - left.score ||
      (left.entry.citation || left.entry.id).localeCompare(right.entry.citation || right.entry.id)
    )
    .slice(0, limit);
}

function cleanContextText(value) {
  return asText(value)
    .replace(/^\s*(?:#{1,6}|>|[-+*]|\d+[.)])\s+/, "")
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/^\*+|\*+$/g, "")
    .trim();
}

function extractCursorText(line, cursorCharacter) {
  const source = typeof line === "string" ? line : "";
  if (!source.trim()) return "";
  const cursor = Math.max(0, Math.min(Number(cursorCharacter) || 0, source.length));
  const spans = [];
  const patterns = [
    /“([^”\n]{3,})”/gu,
    /‘([^’\n]{3,})’/gu,
    /"([^"\n]{3,})"/gu,
    /`([^`\n]{3,})`/gu,
    /\*([^*\n]{3,})\*/gu,
    /_([^_\n]{3,})_/gu,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const start = match.index;
      const end = match.index + match[0].length;
      if (cursor >= start && cursor <= end) spans.push({ text: match[1], start, end });
    }
  }
  if (spans.length) {
    spans.sort((left, right) => (left.end - left.start) - (right.end - right.start));
    return cleanContextText(spans[0].text);
  }

  let start = 0;
  let end = source.length;
  for (let index = cursor - 1; index >= 0; index -= 1) {
    if (/[.!?]/u.test(source[index])) {
      start = index + 1;
      break;
    }
  }
  for (let index = cursor; index < source.length; index += 1) {
    if (/[.!?]/u.test(source[index])) {
      end = index + 1;
      break;
    }
  }
  const sentence = cleanContextText(source.slice(start, end));
  return sentence || cleanContextText(source);
}

// Where a vault keeps its quote index: the configured path, the model's,
// then <book>/_data/<default name> for the vault's book folder.
function candidateIndexPaths(configuredPath, modelPath = "", root = "") {
  const paths = [];
  const defaults = DEFAULT_INDEX_NAMES.map((name) => (root ? `${root}/_data/${name}` : `_data/${name}`));
  for (const value of [configuredPath, modelPath, ...defaults]) {
    const path = asText(value).replace(/\\/g, "/").replace(/^\.\//, "");
    if (!path || /^(?:[a-z]+:|\/|~)/i.test(path) || path.split("/").includes("..")) continue;
    if (!paths.includes(path)) paths.push(path);
  }
  return paths;
}

module.exports = {
  DEFAULT_INDEX_NAMES,
  LANGUAGE_NAMES,
  bilingualLinkTarget,
  buildSearchIndex,
  candidateIndexPaths,
  cleanContextText,
  diceCoefficient,
  extractCursorText,
  matchEntries,
  normalizeLatin,
  normalizeText,
  parseIndex,
  sanitizeBlock,
  sanitizeVaultPath,
  similarity,
  tokens,
  trigrams,
};
