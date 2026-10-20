"use strict";

/*
 * Offline dictionaries for the FirstPair Reader.
 *
 * A dictionary is one "firstpair-reader-dictionary-v1" file of entries, or a
 * "firstpair-reader-dictionary-index-v1" whose shards are keyed by headword
 * prefix (each small enough for Obsidian Sync and a phone).  Lookups try the
 * exact surface form, then an elision-free form, longest shard prefix first.
 */

const DICTIONARY_SCHEMA = "firstpair-reader-dictionary-v1";
const DICTIONARY_INDEX_SCHEMA = "firstpair-reader-dictionary-index-v1";

// Language-aware lowercase; Latin also folds j/v so classical and modern
// orthographies meet the same headword.
function normalizeWord(value, lang = "") {
  const locale = String(lang || "").split(/[-_]/)[0] || undefined;
  let word = String(value || "").normalize("NFC");
  try {
    word = word.toLocaleLowerCase(locale);
  } catch (_error) {
    word = word.toLowerCase();
  }
  word = word.replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}’']+$/gu, "");
  if (locale === "la") word = word.replace(/j/g, "i").replace(/v/g, "u");
  return word;
}

// Candidate keys for one surface form: as written, then without a trailing
// elision mark ("m’" -> "m"), each once.
function lookupKeys(value, lang = "") {
  const exact = normalizeWord(value, lang);
  const bare = exact.replace(/[’']+$/u, "");
  return [...new Set([exact, bare].filter(Boolean))];
}

// Merge entries that share headword, part of speech, and grammar; drop only
// senses that repeat exactly (a prefix may be a different word: can/canal).
function mergeEntries(entries) {
  const groups = new Map();
  for (const entry of entries || []) {
    const key = [entry.headword || "", entry.partOfSpeech || "", entry.grammar || ""].join("\u0000");
    const group = groups.get(key) || {
      headword: entry.headword,
      partOfSpeech: entry.partOfSpeech,
      grammar: entry.grammar,
      definitions: [],
      examples: [],
    };
    for (const definition of entry.definitions || []) {
      const plain = String(definition).trim();
      if (plain && !group.definitions.includes(plain)) group.definitions.push(plain);
    }
    for (const example of entry.examples || []) {
      const text = typeof example === "string" ? example : JSON.stringify(example);
      if (!group.examples.some((known) => (typeof known === "string" ? known : JSON.stringify(known)) === text)) {
        group.examples.push(example);
      }
    }
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({ ...group, examples: group.examples.slice(0, 2) }));
}

function exampleText(example) {
  if (typeof example === "string") return example;
  return [example.latin || example.source, example.translation].filter(Boolean).join(" — ");
}

// A small least-recently-used cache of parsed files: a phone browsing a large
// dictionary keeps a few shards, not all of them.
class LruCache {
  constructor(limit = 8) {
    this.limit = limit;
    this.items = new Map();
  }

  get(key) {
    if (!this.items.has(key)) return undefined;
    const value = this.items.get(key);
    this.items.delete(key);
    this.items.set(key, value);
    return value;
  }

  set(key, value) {
    this.items.delete(key);
    this.items.set(key, value);
    while (this.items.size > this.limit) this.items.delete(this.items.keys().next().value);
  }

  clear() {
    this.items.clear();
  }
}

// readJson(path) -> Promise<object>; throws when the file is missing.
function dictionaryLookup(readJson, cache = new LruCache()) {
  const load = async (path) => {
    const cached = cache.get(path);
    if (cached) return cached;
    const value = await readJson(path);
    cache.set(path, value);
    return value;
  };
  return async function lookup(path, surface, lang = "") {
    const dictionary = await load(path);
    const keys = lookupKeys(surface, lang);
    if (dictionary.schema !== DICTIONARY_INDEX_SCHEMA) {
      for (const key of keys) {
        const entries = dictionary.entries && dictionary.entries[key];
        if (entries && entries.length) return entries;
      }
      return [];
    }
    const base = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    for (const key of keys) {
      for (let length = Math.min(key.length, dictionary.prefixLength || 1); length >= 0; length -= 1) {
        const shard = dictionary.shards && dictionary.shards[key.slice(0, length)];
        if (!shard) continue;
        const entries = (await load(base + shard)).entries;
        if (entries && entries[key] && entries[key].length) return entries[key];
      }
    }
    return [];
  };
}

module.exports = {
  DICTIONARY_INDEX_SCHEMA,
  DICTIONARY_SCHEMA,
  LruCache,
  dictionaryLookup,
  exampleText,
  lookupKeys,
  mergeEntries,
  normalizeWord,
};
