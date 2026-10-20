"use strict";

// FirstPair Reader 2 data contract: every index format, read into one
// validated model, and the validator's refusals.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const contract = require(path.resolve(__dirname, "../vault/plugin/firstpair-reader/contract.js"));
const dictionary = require(path.resolve(__dirname, "../vault/plugin/firstpair-reader/dictionary.js"));

function io(files) {
  return {
    read: async (name) => (Object.prototype.hasOwnProperty.call(files, name)
      ? (typeof files[name] === "string" ? files[name] : JSON.stringify(files[name])) : null),
    list: async (folder) => {
      const prefix = folder && folder !== "/" ? `${folder}/` : "";
      const names = Object.keys(files).filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length));
      return {
        files: names.filter((name) => !name.includes("/")).map((name) => prefix + name),
        folders: [...new Set(names.filter((name) => name.includes("/")).map((name) => name.split("/")[0]))].map((name) => prefix + name),
      };
    },
  };
}

test("v2 index: parts, pages, markers, and capabilities", async () => {
  const model = await contract.discover(io({
    "Book/_data/reader.json": {
      schema: "firstpair-reader.v2", title: "Book", lang: "ru", version: "2.0", source_commit: "abc",
      launcher: "Book/Reader", contents: "Book/Contents", start_page: "p2",
      parts: [{ id: "A", title: "First" }, { id: "B", title: "Second", note: "Book/Parts/B" }],
      pages: [
        { id: "p1", title: "One", part: "A", note: "Book/Parts/A", marker: { start: "<!--s1-->", end: "<!--e1-->" } },
        { id: "p2", title: "Two", part: "A", note: "Book/Parts/A", marker: { start: "<!--s2-->", end: "<!--e2-->" } },
        { id: "p3", title: "Three", part: "B", path: "Book/Pages/p3.md" },
      ],
      dictionaries: { en: { path: "Book/_data/dict/ru-en.json" } },
      words: { lang: "ru" },
      fragments: "Book/_data/fragments.json",
    },
  }));
  assert.equal(model.format, "v2");
  assert.equal(model.uiLang, "ru");
  assert.deepEqual(model.parts.map((part) => [part.id, part.pageIds]), [["A", ["p1", "p2"]], ["B", ["p3"]]]);
  assert.equal(model.pages[0].file, "Book/Parts/A.md");
  assert.equal(model.startPage, "p2");
  assert.deepEqual(contract.targetForNote(model, "Book/Reader.md"), { mode: "page", pageId: "p2" });
  assert.deepEqual(contract.targetForNote(model, "Book/Parts/A.md"), { mode: "part", partId: "A" });
  assert.deepEqual(contract.targetForNote(model, "Book/Pages/p3.md"), { mode: "page", pageId: "p3" });
  assert.deepEqual(contract.targetForNote(model, "Book/Contents.md"), { mode: "contents" });
  assert.equal(contract.extractMarked("x<!--s2--> body <!--e2-->y", model.pages[1].marker), "body");
  assert.equal(contract.extractMarked("no markers", model.pages[1].marker), null);
});

test("parallel, v1 array, Cicero, reader-v1, library, and code books are all read", async () => {
  const parallel = await contract.discover(io({
    "_data/parallel-reader.json": {
      schema: "firstpair-parallel-reader-v1", title: "Commedia", sourceLanguage: { id: "it", lang: "it" },
      translations: [{ id: "en", lang: "en" }],
      pages: [{ id: "c1", title: "Canto 1", path: "_data/chapters/c1.json", part: "Inferno" }, { id: "c2", title: "Canto 2", path: "_data/chapters/c2.json", part: "Inferno" }],
    },
  }));
  assert.equal(parallel.format, "parallel");
  assert.equal(parallel.lang, "it");
  assert.equal(parallel.uiLang, null, "the source language is not the interface language");
  assert.deepEqual(parallel.parts.map((part) => part.title), ["Inferno"]);

  const v1 = await contract.discover(io({ "_data/reader.json": [{ id: "a", title: "A", path: "Reader/001 - A.md" }, { id: "b", title: "B", path: "Reader/002 - B.md" }] }));
  assert.equal(v1.format, "v1");
  assert.equal(v1.pages[1].note, "Reader/002 - B");

  const cicero = await contract.discover(io({
    "Cicero/_data/reader.json": {
      schema_version: 1, title: "Cicero", launcher: "Cicero/Reader/Launcher", contents: "Cicero/Reader/Contents", start_page: "C1",
      parts: [{ id: "P1", title: "One", note: "Cicero/Reader/P1", page_ids: ["C1"] }],
      pages: [{ id: "C1", order: 1, title: "Proem", part_id: "P1", part_title: "One", note: "Cicero/Reader/C1", markdown: "# Proem\n\nText." }],
    },
  }));
  assert.equal(cicero.format, "cicero");
  assert.equal(cicero.pages[0].markdown, "# Proem\n\nText.");
  assert.deepEqual(contract.targetForNote(cicero, "Cicero/Reader/Launcher.md"), { mode: "page", pageId: "C1" });

  const native = await contract.discover(io({
    "Reader/reader-index.json": {
      schema: "firstpair.reader.v1", title: "Enemy", launcher: "Reader/Launcher.md", contents: "Reader/Contents.md", cover: "Reader/cover.png",
      parts: [{ id: "one", title: "Part I" }],
      pages: [{ id: "preface", title: "Preface", note: "Reader/Pages/preface.md", part: null, order: 1 }, { id: "c1", title: "Chapter 1", note: "Reader/Pages/c1.md", part: "one", order: 2 }],
    },
  }));
  assert.equal(native.format, "reader-v1");
  assert.deepEqual(native.parts.map((part) => [part.id, part.pageIds]), [["front", ["preface"]], ["one", ["c1"]]]);
  assert.equal(native.cover, "Reader/cover.png");

  const libraryFiles = {
    "Mobile/_data/mobile-library.json": {
      schema_version: 1, title: "Library", launcher: "Mobile/Reader",
      editions: [{ id: "e1", title: "First", version: "1.0", family: "Main", data: "Mobile/_data/editions/e1.json", note: "Mobile/E1/Contents" }],
      sources: [{ id: "s1", title: "Source", note: "Mobile/Sources/s1" }], anthology: "Mobile/Anthology",
    },
    "Mobile/_data/editions/e1.json": {
      schema_version: 2, id: "e1", commit: "def",
      parts: [{ id: "P001", order: 1, title: "Front", note: "Mobile/E1/01 - Front" }],
      pages: [{ id: "e1:C0001", order: 1, part_id: "P001", title: "Opening", note: "Mobile/E1/01 - Front", anchor: "reader-c0001" }],
    },
  };
  const library = await contract.discover(io(libraryFiles));
  assert.equal(library.format, "library");
  const edition = await contract.loadEdition(io(libraryFiles), library, "e1");
  assert.equal(edition.pages[0].marker.start, "<!-- lmr-page-start:e1:C0001 -->");
  assert.equal(edition.sources.notes[0].note, "Mobile/Sources/s1");

  const code = await contract.discover(io({
    "DNS/_data/fragments.json": [],
    "DNS/Chapters/02-Names.md": "# Names",
    "DNS/Chapters/01-Preface.md": "# Preface",
    "DNS/Book.md": "map",
  }));
  assert.equal(code.format, "code");
  assert.deepEqual(code.pages.map((page) => page.id), ["01-Preface", "02-Names"]);
  assert.equal(code.launcher, "DNS/Book");
  assert.equal(code.fragments, "DNS/_data/fragments.json");
});

test("the validator refuses unsafe or inconsistent indexes", async () => {
  const v2 = (pages, parts = [{ id: "A", title: "A" }]) => io({ "_data/reader.json": { schema: "firstpair-reader.v2", title: "T", parts, pages } });
  await assert.rejects(contract.discover(v2([{ id: "a", part: "A", path: "../escape.md" }])), /unsafe segment/);
  await assert.rejects(contract.discover(v2([{ id: "a", part: "A", path: "/etc/passwd.md" }])), /vault-relative/);
  await assert.rejects(contract.discover(v2([{ id: "a", part: "A", path: "x.md" }, { id: "a", part: "A", path: "y.md" }])), /duplicate page id/);
  await assert.rejects(contract.discover(v2([{ id: "a", part: "A", path: "x.md" }, { id: "b", part: "B", path: "y.md" }, { id: "c", part: "A", path: "z.md" }], [{ id: "A", title: "A" }, { id: "B", title: "B" }])), /not contiguous/);
  await assert.rejects(contract.discover(v2([{ id: "a", part: "Z", path: "x.md" }])), /unknown part/);
  await assert.rejects(contract.discover(io({ "_data/reader.json": "{ truncated" })), /not valid JSON/);
  await assert.rejects(contract.discover(io({ "Notes/a.md": "x" })), /no FirstPair Reader index/);
});

test("dictionary keys, merging, and the shard cache", async () => {
  assert.deepEqual(dictionary.lookupKeys("M’", "it"), ["m’", "m"]);
  assert.equal(dictionary.normalizeWord("Iuvat", "la"), "iuuat");
  assert.equal(dictionary.normalizeWord("İstanbul", "tr"), "istanbul");
  const merged = dictionary.mergeEntries([
    { headword: "can", partOfSpeech: "v", definitions: ["can", "canal"] },
    { headword: "can", partOfSpeech: "v", definitions: ["can"] },
  ]);
  assert.deepEqual(merged[0].definitions, ["can", "canal"], "a prefix is a different sense, not a repeat");
  const reads = [];
  const files = {
    "d/index.json": { schema: "firstpair-reader-dictionary-index-v1", prefixLength: 2, shards: { me: "me.json", m: "m.json" } },
    "d/me.json": { schema: "firstpair-reader-dictionary-v1", entries: { mezzo: [{ headword: "mezzo" }] } },
    "d/m.json": { schema: "firstpair-reader-dictionary-v1", entries: { m: [{ headword: "mi" }] } },
  };
  const cache = new dictionary.LruCache(2);
  const lookup = dictionary.dictionaryLookup(async (name) => {
    reads.push(name);
    if (!files[name]) throw new Error(`missing ${name}`);
    return files[name];
  }, cache);
  assert.equal((await lookup("d/index.json", "Mezzo", "it"))[0].headword, "mezzo");
  assert.equal((await lookup("d/index.json", "m’", "it"))[0].headword, "mi", "falls back to the bare form");
  assert.equal(cache.items.size, 2, "the cache stays bounded");
  await assert.rejects(lookup("d/missing.json", "x"), /missing/);
});
