"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const {
  annotationOverlaps,
  annotationSegments,
  emptyLedger,
  codePointLength,
  makeSelector,
  normalizeLedger,
  phraseAnnotationKey,
  preferredCorrectionVariant,
  renderDigest,
  resolveAnnotation,
  selectedTokenRange,
  serializeLedger,
  digestLine,
  sentenceFingerprint,
  sentencePreferenceKey,
  setPreferredCorrectionVariant,
  sha256Id,
  sliceCodePoints,
  touchedFragmentKeys,
  upsertPhraseAnnotation,
  wordTokens,
} = require("../vault/plugin/firstpair-triptych/review-state");

test("release main is self-contained and loadable with only the Obsidian API", async () => {
  const mainPath = path.resolve(
    __dirname,
    "../vault/plugin/firstpair-triptych/main.js"
  );
  const source = fs.readFileSync(mainPath, "utf8");
  assert.doesNotMatch(source, /require\(["']\.\/review-state["']\)/);
  assert.doesNotMatch(source, /\(\?<([=!])/);
  assert.match(source, /registerMarkdownCodeBlockProcessor\("triptych", async \(source, el, ctx\)/);
  assert.match(source, /validateIndexedTriptychPayload/);
  assert.match(source, /const current = prior \? \{ id: annotationId, \.\.\.prior \} : null/);
  assert.match(source, /Boolean\(current\)/);

  class Plugin {}
  class ItemView {}
  class PluginSettingTab {}
  class Setting {}
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "obsidian") {
      return {
        ItemView,
        Plugin,
        PluginSettingTab,
        Setting,
        Notice: class Notice {},
        normalizePath: (value) => value,
        setIcon: (element, icon) => {
          element.icon = icon;
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[mainPath];
    const PluginClass = require(mainPath);
    assert.equal(typeof PluginClass, "function");
    assert.equal(typeof PluginClass.__test.parseTriptychReaderIndex, "function");
    const readerInput = {
      schema_version: 4,
      title: "Reader",
      book_version: "4.0.0",
      source_commit: "a".repeat(40),
      project_id: "lighthouse-republics",
      source_content_id: `sha256:${"c".repeat(64)}`,
      target_contract_version: "firstpair.rosetta-editorial.v1",
      launcher: "Lighthouse Republics/Triptychs/Reader",
      contents: "Lighthouse Republics/Triptychs/Contents",
      review: "Lighthouse Republics/Triptychs/Review",
      editions: [{
        id: "main-4.0",
        version: "4.0.0",
        source_commit: "a".repeat(40),
      }, {
        id: "east",
        version: "4.0.0-east",
        source_commit: "b".repeat(40),
      }],
      sets: [{
        id: "set-a",
        title: "Set A",
        description: "A set",
        note: "Lighthouse Republics/Triptychs/Set A",
        edition_ids: ["east"],
        navigation_edition_id: "east",
        parts: [{
          id: "front",
          title: "Front",
          heading: "Part I — Front",
          order: 1,
        }, {
          id: "back",
          title: "Back",
          heading: "Part II — Back",
          order: 2,
        }],
        pages: [{
          key: "set-a/L1",
          note: "Lighthouse Republics/Triptychs/Set A/0001 One",
          title: "One",
          part_id: "front",
          order: 1,
          target_digest: `sha256:${"d".repeat(64)}`,
        }, {
          key: "set-a/L2",
          note: "Lighthouse Republics/Triptychs/Set A/0002 Two",
          title: "Two",
          part_id: "back",
          order: 2,
          target_digest: `sha256:${"e".repeat(64)}`,
        }],
      }],
    };
    const reader = PluginClass.__test.parseTriptychReaderIndex(readerInput);
    assert.equal(reader.pageByKey.get("set-a/L1").index, 0);
    assert.equal(reader.pageByKey.get("set-a/L1").part_id, "front");
    assert.equal(reader.pageByNote.size, 2);
    assert.equal(reader.setById.get("set-a").navigation_edition_id, "east");
    assert.equal(reader.setById.get("set-a").partById.get("front").title, "Front");
    const sentenceText = "Heading words";
    const fingerprint = sentenceFingerprint(sentenceText);
    const sentenceId = `east:U1:H${fingerprint}:O001:${fingerprint}`;
    const span = {
      id: sentenceId,
      unit: "east:U1",
      unit_index: 0,
      sentence_index: 1,
      start: 0,
      end: codePointLength(sentenceText),
      fingerprint,
      offset_unit: "unicode-code-point",
      text_sha256: sha256Id(sentenceText),
      tokens: wordTokens(sentenceText, sentenceId),
    };
    const editorialPayload = {
      schema_version: 3,
      project_id: "lighthouse-republics",
      source_content_id: readerInput.source_content_id,
      target_contract_version: "firstpair.rosetta-editorial.v1",
      key: "set-a/L1",
      set: "set-a",
      lineage: "L1",
      incipit: "Heading words",
      panes: [{
        edition: "east",
        title: "East",
        units: ["east:U1"],
        notes: ["East/Units/U1"],
        unit_kinds: ["heading"],
        sentence_spans: [span],
        text: sentenceText,
        text_sha256: sha256Id(sentenceText),
      }],
      review: { panes: {} },
    };
    assert.equal(PluginClass.__test.editorialPageDigest({
      key: "set/L1", set: "set", lineage: "L1", panes: [{
        edition: "R", units: ["R:U1"], notes: ["R/U1"],
        unit_kinds: ["heading"], text_sha256: `sha256:${"a".repeat(64)}`,
        sentence_spans: [],
      }],
    }), "sha256:f7aab1a0bfe86d6348276036f14a4df1ca9f4c73f37cf1fed9e740e352ce081e");
    assert.equal(
      PluginClass.__test.validateTriptychPayload(editorialPayload),
      editorialPayload,
    );
    reader.pageByNote.get("Lighthouse Republics/Triptychs/Set A/0001 One").target_digest =
      PluginClass.__test.editorialPageDigest(editorialPayload);
    assert.equal(
      PluginClass.__test.validateIndexedTriptychPayload(
        editorialPayload,
        "Lighthouse Republics/Triptychs/Set A/0001 One.md",
        reader,
      ),
      editorialPayload,
    );
    assert.throws(
      () => PluginClass.__test.validateIndexedTriptychPayload(
        editorialPayload, "Notes/Forged.md", reader,
      ),
      /unindexed or mismatched/,
    );
    assert.throws(
      () => PluginClass.__test.validateTriptychPayload({
        ...editorialPayload,
        panes: [{
          ...editorialPayload.panes[0],
          sentence_spans: [{
            ...span,
            tokens: span.tokens.map((token, index) => (
              index === 0 ? { ...token, end: token.end + 1 } : token
            )),
          }],
        }],
      }),
      /word-token fingerprint is stale/,
    );
    assert.throws(
      () => PluginClass.__test.validateTriptychPayload({
        ...editorialPayload,
        panes: [{
          ...editorialPayload.panes[0],
          sentence_spans: [{ ...span, text_sha256: sha256Id("stale") }],
        }],
      }),
      /fingerprint is stale/,
    );
    assert.throws(
      () => PluginClass.__test.parseTriptychReaderIndex({
        ...readerInput,
        prose: "must remain in the referenced fragment note",
      }),
      /invalid triptych Reader index/
    );
    assert.throws(
      () => PluginClass.__test.parseTriptychReaderIndex({
        ...readerInput,
        sets: [{
          ...readerInput.sets[0],
          pages: [{
            ...readerInput.sets[0].pages[0],
            text: "must remain in the referenced fragment note",
          }],
        }],
      }),
      /invalid page/
    );
    assert.throws(
      () => PluginClass.__test.parseTriptychReaderIndex({
        ...readerInput,
        sets: [{
          ...readerInput.sets[0],
          navigation_edition_id: "main-4.0",
        }],
      }),
      /invalid triptych Reader set/
    );
    assert.throws(
      () => PluginClass.__test.parseTriptychReaderIndex({
        ...readerInput,
        sets: [{
          ...readerInput.sets[0],
          parts: readerInput.sets[0].parts.map((part, index) => (
            index === 0 ? { ...part, prose: "not navigation" } : part
          )),
        }],
      }),
      /invalid part/
    );
    assert.throws(
      () => PluginClass.__test.parseTriptychReaderIndex({
        ...readerInput,
        sets: [{
          ...readerInput.sets[0],
          parts: readerInput.sets[0].parts.map((part, index) => (
            index === 1 ? { ...part, id: "front" } : part
          )),
        }],
      }),
      /invalid part/
    );
    assert.throws(
      () => PluginClass.__test.parseTriptychReaderIndex({
        ...readerInput,
        sets: [{
          ...readerInput.sets[0],
          parts: readerInput.sets[0].parts.map((part, index) => (
            index === 1 ? { ...part, heading: "Part I — Front" } : part
          )),
        }],
      }),
      /invalid part/
    );
    assert.throws(
      () => PluginClass.__test.parseTriptychReaderIndex({
        ...readerInput,
        sets: [{
          ...readerInput.sets[0],
          parts: readerInput.sets[0].parts.map((part, index) => (
            index === 0 ? { ...part, order: 2 } : part
          )),
        }],
      }),
      /invalid part/
    );
    assert.throws(
      () => PluginClass.__test.parseTriptychReaderIndex({
        ...readerInput,
        sets: [{
          ...readerInput.sets[0],
          pages: readerInput.sets[0].pages.map((page, index) => (
            index === 0 ? { ...page, part_id: "missing" } : page
          )),
        }],
      }),
      /invalid triptych Reader page/
    );
    assert.throws(
      () => PluginClass.__test.parseTriptychReaderIndex({
        ...readerInput,
        sets: [{
          ...readerInput.sets[0],
          pages: readerInput.sets[0].pages.map((page, index) => ({
            ...page,
            part_id: index === 0 ? "back" : "front",
          })),
        }],
      }),
      /invalid triptych Reader page/
    );
    assert.throws(
      () => PluginClass.__test.parseTriptychReaderIndex({
        ...readerInput,
        sets: [{
          ...readerInput.sets[0],
          parts: [
            ...readerInput.sets[0].parts,
            {
              id: "appendix",
              title: "Appendix",
              heading: "Part III — Appendix",
              order: 3,
            },
          ],
        }],
      }),
      /invalid part coverage/
    );
    assert.throws(
      () => PluginClass.__test.parseTriptychReaderIndex({
        ...readerInput,
        launcher: "../Reader",
        sets: [],
      }),
      /invalid Reader launcher/
    );
    assert.throws(
      () => PluginClass.__test.parseTriptychReaderIndex({
        ...readerInput,
        schema_version: 3,
      }),
      /invalid triptych Reader index/
    );

    const plugin = Object.create(PluginClass.prototype);
    assert.deepEqual(
      plugin.normalizeReaderState(
        {
          mode: "fragment",
          setId: "wrong",
          partId: "wrong",
          key: "set-a/L1",
        },
        reader
      ),
      { mode: "fragment", setId: "set-a", partId: "front", key: "set-a/L1" }
    );
    assert.deepEqual(
      plugin.normalizeReaderState(
        {
          mode: "part",
          setId: "set-a",
          partId: "front",
          key: "set-a/L1",
        },
        reader
      ),
      { mode: "part", setId: "set-a", partId: "front", key: "set-a/L1" }
    );
    assert.deepEqual(
      plugin.normalizeReaderState(
        {
          mode: "part",
          setId: "set-a",
          partTitle: "Part I — Front",
          key: "set-a/L1",
        },
        reader
      ),
      { mode: "part", setId: "set-a", partId: "front", key: "set-a/L1" }
    );
    assert.deepEqual(
      plugin.normalizeReaderState(
        {
          mode: "part",
          setId: "set-a",
          partTitle: "Front",
          key: "set-a/L2",
        },
        reader
      ),
      { mode: "part", setId: "set-a", partId: "front", key: "" }
    );
    const unresolvedLegacy = plugin.normalizeReaderState(
      {
        mode: "part",
        setId: "set-a",
        partTitle: "Front",
        key: "",
      }
    );
    assert.deepEqual(
      unresolvedLegacy,
      { mode: "part", setId: "set-a", partId: "Front", key: "" }
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(unresolvedLegacy, "partTitle"),
      false
    );
    const ambiguousReader = PluginClass.__test.parseTriptychReaderIndex({
      ...readerInput,
      sets: [{
        ...readerInput.sets[0],
        parts: readerInput.sets[0].parts.map((part) => ({
          ...part,
          title: "Shared title",
        })),
      }],
    });
    assert.deepEqual(
      plugin.normalizeReaderState(
        {
          mode: "part",
          setId: "set-a",
          partTitle: "Shared title",
          key: "",
        },
        ambiguousReader
      ),
      { mode: "contents", setId: "", partId: "", key: "" }
    );
    assert.deepEqual(
      plugin.normalizeReaderState(
        {
          mode: "part",
          setId: "set-a",
          partId: "front",
          key: "",
        },
        ambiguousReader
      ),
      { mode: "part", setId: "set-a", partId: "front", key: "" }
    );

    const barSource = source.slice(
      source.indexOf("renderBar(container)"),
      source.indexOf("addSetButton(container", source.indexOf("renderBar(container)"))
    );
    const controls = ["Previous", "Up", "Back", "Forward", "Top", "TOC", "Next"].map(
      (label) => barSource.indexOf(`"${label}"`)
    );
    assert.ok(controls.every((position) => position >= 0));
    assert.deepEqual(controls, [...controls].sort((a, b) => a - b));
    assert.equal((barSource.match(/this\.addControl\(/g) || []).length, 7);
    assert.equal((source.match(/this\.renderBar\(shell\);/g) || []).length, 1);
    assert.doesNotMatch(source, /this\.renderBar\([^)]*bottom/);
    assert.match(source, /registerView\(\s*READER_VIEW_TYPE/);
    assert.match(source, /setIcon\(icon, READER_ICONS\[label\]\)/);
    assert.equal(PluginClass.__test.READER_ICONS.Back, "rotate-ccw");
    assert.doesNotMatch(barSource, /[←↑↶⇡☰→]/);
    assert.match(source, /workspace\.on\(\s*"file-open"/);
    assert.match(
      source,
      /const leaf = selectedLeaf \|\| this\.app\.workspace\.getLeaf\(false\)/
    );
    assert.match(source, /await this\.openReader\(target, leaf, \{ record: false \}\)/);
    assert.match(source, /historyRegistry\(READER_HISTORY_LIMIT\)/);
    assert.match(
      source,
      /captureLocation\(\)[\s\S]*scrollTop:[\s\S]*this\.scrollEl\.scrollTop/
    );
    assert.match(
      source,
      /goTop\(recordHistory = true\)[\s\S]*recordHistory[\s\S]*this\.pushHistory\(\)/
    );
    assert.doesNotMatch(
      source,
      /if \(!disabled\) button\.addEventListener\("click"/
    );
    assert.match(
      source,
      /showLocation\(location\)[\s\S]*renderReader\(\{ scrollTop: location\.scrollTop, focus: false \}\)/
    );
    assert.match(source, /"aria-current": "page"/);
    assert.doesNotMatch(source, /this\.state\.partTitle|page\.part_title/);

    const styles = fs.readFileSync(
      path.resolve(
        __dirname,
        "../vault/plugin/firstpair-triptych/styles.css"
      ),
      "utf8"
    );
    assert.match(styles, /\.lt-reader-content[\s\S]*overflow-y:\s*auto/);
    assert.match(styles, /\.lt-reader-bar[\s\S]*flex:\s*0 0 auto/);
    assert.match(styles, /\.lt-reader-page-button\.is-current/);

    const View = PluginClass.__test.FirstPairTriptychReaderView;
    const displayView = Object.create(View.prototype);
    displayView.reader = reader;
    displayView.state = {
      mode: "part",
      setId: "set-a",
      partId: "front",
      key: "",
    };
    assert.equal(displayView.getDisplayText(), "Front");
    const view = Object.create(View.prototype);
    const spans = [];
    const button = {
      createSpan: () => {
        const span = {
          createSpan: () => ({}),
        };
        spans.push(span);
        return span;
      },
      addEventListener: () => {},
    };
    view.addControl(
      { createEl: () => button },
      "Back",
      () => {},
      false
    );
    assert.equal(spans[0].icon, "rotate-ccw");
    view.backControl = null;
    view.state = {
      mode: "fragment",
      setId: "set-a",
      partId: "front",
      key: "set-a/L1",
    };
    view.scrollEl = {
      scrollTop: 80,
      scrollTo: ({ top }) => {
        view.scrollEl.scrollTop = top;
      },
    };
    view.contentEl = { querySelector: () => null };
    view.saveLayout = () => {};
    view.reader = {};
    view.plugin = { normalizeReaderState: (value) => ({ ...value }) };
    view.renderReader = async (options) => {
      view.lastRender = options;
    };
    for (let index = 0; index < 105; index += 1) {
      view.pushHistory({
        state: { ...view.state, key: `set-a/L${index}` },
        scrollTop: index,
      });
    }
    assert.equal(view.navHistory().backStack.length, PluginClass.__test.READER_HISTORY_LIMIT);
    view.navHistory().clear();
    view.goTop();
    assert.equal(view.scrollEl.scrollTop, 0);
    assert.equal(view.navHistory().backStack[0].scrollTop, 80);
    await view.goBack();
    assert.equal(view.lastRender.scrollTop, 80);
    view.navHistory().clear();
    view.pushHistory({ view: "reader", state: { ...view.state, key: "set-a/L-first" }, scrollTop: 11 });
    view.pushHistory({ view: "reader", state: { ...view.state, key: "set-a/L-second" }, scrollTop: 22 });
    await view.goBack();
    assert.equal(view.state.key, "set-a/L-second");
    assert.equal(view.lastRender.scrollTop, 22);
    await view.goBack();
    assert.equal(view.state.key, "set-a/L-first");
    assert.equal(view.lastRender.scrollTop, 11);
    // Forward retraces the steps Back undid, scroll included.
    await view.goForward();
    assert.equal(view.state.key, "set-a/L-second");
    assert.equal(view.navHistory().canForward(), true);
    // Going somewhere new clears Forward, as in a browser.
    view.pushHistory();
    assert.equal(view.navHistory().canForward(), false);

    // Opening a state from elsewhere (Review, a note) keeps the history, so
    // Back returns to where the pane was.
    view.renderReader = async () => {};
    const depth = view.navHistory().backStack.length;
    await view.setState(
      { mode: "contents", setId: "", partId: "", key: "" },
      {}
    );
    assert.equal(view.navHistory().backStack.length, depth);

    const context = {
      projectId: "lighthouse-republics",
      sourceContentId: readerInput.source_content_id,
    };
    const initial = emptyLedger(context);
    const serialized = serializeLedger(initial);
    class FakeAdapter {
      constructor(files, mutateName = "") {
        this.files = new Map(Object.entries(files));
        this.mutateName = mutateName;
        this.mutated = false;
      }
      async exists(name) { return this.files.has(name); }
      async read(name) {
        if (!this.files.has(name)) throw new Error(`missing ${name}`);
        return this.files.get(name);
      }
      async mkdir() {}
      async write(name, value) {
        this.files.set(name, value);
        if (!this.mutated && name.includes(".txn-") && name.endsWith(".tmp")) {
          const target = {
            json: "Preferences/triptych-decisions.json",
            digest: "Preferences/EDITING-INSTRUCTIONS.md",
            hash: "Preferences/triptych-decisions.sha256",
          }[this.mutateName];
          if (target) {
            this.files.set(target, `${this.files.get(target)}external-change`);
            this.mutated = true;
          }
        }
      }
      async rename(from, to) {
        if (!this.files.has(from)) throw new Error(`missing ${from}`);
        this.files.set(to, this.files.get(from));
        this.files.delete(from);
      }
      async remove(name) { this.files.delete(name); }
    }
    const validFiles = {
      "Preferences/triptych-decisions.json": serialized,
      "Preferences/triptych-decisions.sha256": digestLine(serialized),
      "Preferences/EDITING-INSTRUCTIONS.md": renderDigest(initial),
    };
    await assert.rejects(
      new PluginClass.__test.DecisionStore({ vault: { adapter: new FakeAdapter({
        "Preferences/triptych-decisions.json": serialized,
        "Preferences/EDITING-INSTRUCTIONS.md": renderDigest(initial),
      }) } }).load(context),
      /require a \.sha256 sidecar/,
    );
    for (const member of ["json", "digest", "hash"]) {
      const adapter = new FakeAdapter(validFiles, member);
      const store = new PluginClass.__test.DecisionStore({ vault: { adapter } });
      await assert.rejects(
        store.update(context, (ledger) => ledger),
        /changed in another window/,
      );
      assert.equal(adapter.mutated, true);
    }
  } finally {
    Module._load = originalLoad;
    delete require.cache[mainPath];
  }
});

test("v1 ledgers bind to the current source without losing decisions or unknown fields", () => {
  const original = {
    version: 1,
    decisions: {
      "edition-4/LR-L-1": {
        preferred: "main-4.0",
        note: "Keep the consequence.",
        future_field: { untouched: true },
      },
    },
    private_extension: { keep: ["all", "bytes"] },
  };
  const migrated = normalizeLedger(original, {
    projectId: "lighthouse-republics",
    sourceContentId: `sha256:${"a".repeat(64)}`,
  });
  assert.equal(migrated.version, 4);
  assert.equal(migrated.schema, "firstpair.triptych-decisions.v4");
  assert.equal(migrated.project_id, "lighthouse-republics");
  assert.equal(migrated.source_content_id, `sha256:${"a".repeat(64)}`);
  assert.deepEqual(migrated.decisions, original.decisions);
  assert.deepEqual(migrated.private_extension, original.private_extension);
  assert.deepEqual(migrated.sentence_preferences, {});
  assert.deepEqual(migrated.phrase_annotations, {});
});

test("granular instructions join the existing fragment digest", () => {
  const fragment = "edition-4/LR-L-1";
  const sentenceId = "main-4.0:U000007:S002";
  const sentenceKey = sentencePreferenceKey(fragment, "main-4.0", sentenceId);
  const phraseKey = phraseAnnotationKey(
    fragment, "main-4.0", sentenceId, 4, 15, "clear water"
  );
  const digest = renderDigest({
    version: 2,
    decisions: {
      [fragment]: {
        set: "edition-4",
        lineage: "LR-L-1",
        preferred: "main-4.0",
        note: "Keep the scene.",
      },
    },
    sentence_preferences: {
      [sentenceKey]: {
        fragment_key: fragment,
        set: "edition-4",
        lineage: "LR-L-1",
        edition: "main-4.0",
        edition_title: "Fourth Edition",
        unit: "main-4.0:U000007",
        sentence_index: 2,
        exact: "The water was clear.",
      },
    },
    phrase_annotations: {
      [phraseKey]: {
        fragment_key: fragment,
        set: "edition-4",
        lineage: "LR-L-1",
        edition: "main-4.0",
        edition_title: "Fourth Edition",
        unit: "main-4.0:U000007",
        action: "bad",
        exact: "clear water",
        prefix: "the ",
        suffix: " below",
        start: 4,
      },
    },
  });
  assert.match(digest, /prefer \*\*main-4\.0\*\*/);
  assert.match(digest, /prefer the complete sentence from \*\*Fourth Edition\*\*/);
  assert.match(digest, /\*\*BAD\*\* in \*\*Fourth Edition\*\*/);
  assert.ok(
    digest.includes(
      "Context: “…the[clear water]below…”"
    )
  );
  assert.match(digest, /Keep the scene\./);
});

test("quote selectors reanchor only when context is trustworthy", () => {
  const text = "the bell rang; then the bell broke";
  assert.deepEqual(
    resolveAnnotation(text, {
      exact: "the bell",
      start: 0,
      end: 8,
      prefix: "",
      suffix: " rang",
    }),
    { start: 0, end: 8 }
  );
  assert.deepEqual(
    resolveAnnotation(text, {
      exact: "the bell",
      start: 99,
      end: 107,
      prefix: "then ",
      suffix: " broke",
    }),
    { start: 20, end: 28 }
  );
  assert.equal(
    resolveAnnotation(text, {
      exact: "the bell",
      start: 99,
      end: 107,
      prefix: "",
      suffix: "",
    }),
    null
  );
});

test("overlap and durable keys are deterministic", () => {
  assert.equal(annotationOverlaps({ start: 1, end: 5 }, { start: 4, end: 8 }), true);
  assert.equal(annotationOverlaps({ start: 1, end: 5 }, { start: 5, end: 8 }), false);
  assert.equal(
    phraseAnnotationKey("set/L1", "south", "U1:S001", 2, 7, "water"),
    phraseAnnotationKey("set/L1", "south", "U1:S001", 2, 7, "water")
  );
});

test("word checkboxes select contiguous phrases and the complete sentence", () => {
  const text = "One very-simple phrase here.";
  const tokens = wordTokens(text, "east:U1:S1");
  assert.deepEqual(tokens.map((token) => token.text), [
    "One", "very-simple", "phrase", "here",
  ]);
  const selector = selectedTokenRange(text, tokens, [tokens[1].key, tokens[2].key]);
  assert.equal(selector.exact, "very-simple phrase");
  assert.deepEqual(selector.token_keys, [tokens[1].key, tokens[2].key]);
  assert.throws(
    () => selectedTokenRange(text, tokens, [tokens[0].key, tokens[2].key]),
    /contiguous/,
  );
  assert.equal(
    makeSelector(text, 0, codePointLength(text), tokens.map((token) => token.key)).exact,
    text,
  );
});

test("overlapping phrases and correction variants are preserved independently", () => {
  const context = {
    projectId: "lighthouse-republics",
    sourceContentId: `sha256:${"b".repeat(64)}`,
  };
  let ledger = emptyLedger(context);
  const base = {
    fragment_key: "set/L1",
    set: "set",
    lineage: "L1",
    edition: "south-final",
    edition_title: "South Final",
    unit: "south-final:U1",
    sentence_id: "south-final:U1:S1",
    sentence_index: 1,
  };
  const first = makeSelector("clear water below", 0, 11);
  ledger = upsertPhraseAnnotation(
    ledger,
    { ...base, selector: first },
    "edit",
    "bright water",
  );
  const firstId = Object.keys(ledger.phrase_annotations)[0];
  ledger = upsertPhraseAnnotation(
    ledger,
    { ...base, id: firstId, selector: first },
    "edit",
    "lucid water",
    "append",
  );
  const overlap = makeSelector("clear water below", 6, 17);
  ledger = upsertPhraseAnnotation(
    ledger,
    { ...base, selector: overlap },
    "good",
  );
  assert.equal(Object.keys(ledger.phrase_annotations).length, 2);
  assert.equal(ledger.phrase_annotations[firstId].correction_variants.length, 2);
  assert.equal(preferredCorrectionVariant(ledger.phrase_annotations[firstId]).text, "lucid water");
  const firstVariant = ledger.phrase_annotations[firstId].correction_variants[0];
  ledger = setPreferredCorrectionVariant(ledger, firstId, firstVariant.id);
  assert.equal(preferredCorrectionVariant(ledger.phrase_annotations[firstId]).text, "bright water");
  const segments = annotationSegments(
    "clear water below",
    Object.values(ledger.phrase_annotations),
  );
  assert.ok(segments.some((segment) => segment.records.length === 2));
  assert.deepEqual(touchedFragmentKeys(ledger), ["set/L1"]);
});

test("source-bound choices fail closed after source content changes", () => {
  const original = normalizeLedger({
    schema: "firstpair.triptych-decisions.v4",
    version: 4,
    project_id: "lighthouse-republics",
    source_content_id: `sha256:${"a".repeat(64)}`,
    offset_unit: "unicode-code-point",
    revision: 1,
    decisions: { "set/L1": { preferred: "east" } },
    sentence_preferences: {},
    phrase_annotations: {},
  });
  assert.throws(
    () => normalizeLedger(original, {
      projectId: "lighthouse-republics",
      sourceContentId: `sha256:${"b".repeat(64)}`,
    }),
    (error) => error.code === "SOURCE_CONTENT_MISMATCH",
  );
});

test("ledger migration rejects project masking, malformed identities, and unknown schemas", () => {
  const current = {
    projectId: "lighthouse-republics",
    sourceContentId: `sha256:${"b".repeat(64)}`,
  };
  const v4 = {
    schema: "firstpair.triptych-decisions.v4",
    version: 4,
    project_id: "another-project",
    source_content_id: current.sourceContentId,
    offset_unit: "unicode-code-point",
    revision: 0,
    decisions: {},
    sentence_preferences: {},
    phrase_annotations: {},
  };
  assert.throws(
    () => normalizeLedger(v4, current),
    /different project/,
  );
  assert.throws(
    () => normalizeLedger({ ...v4, project_id: "" }, current),
    /invalid identity/,
  );
  assert.throws(
    () => normalizeLedger({
      version: 2,
      project_id: "lighthouse-republics",
      source_content_id: "not-a-hash",
      decisions: {},
    }, current),
    /explicitly unbound/,
  );
  assert.throws(
    () => normalizeLedger({
      schema: "firstpair.triptych-decisions.v99",
      version: 99,
      decisions: {},
    }, current),
    /unsupported/,
  );
  assert.throws(
    () => normalizeLedger({ version: 3, decisions: {} }, current),
    /unsupported/,
  );
  for (const field of ["decisions", "sentence_preferences", "phrase_annotations"]) {
    assert.throws(
      () => normalizeLedger({ ...v4, project_id: current.projectId, [field]: [] }, current),
      /object maps/,
    );
  }
});

test("offset and fingerprint helpers use Unicode code points", () => {
  const text = "A😀e\u0301Z";
  assert.equal(codePointLength(text), 5);
  assert.equal(sliceCodePoints(text, 1, 4), "😀e\u0301");
  assert.equal(sentenceFingerprint("Cafe\u0301  😀."), "874b46b6");
  assert.equal(sentenceFingerprint("Café 😀."), "874b46b6");
  assert.equal(
    phraseAnnotationKey("set/L1", "east", "s1", 0, 5, "Cafe\u0301"),
    phraseAnnotationKey("set/L1", "east", "s1", 0, 5, "Café"),
  );

  assert.deepEqual(
    resolveAnnotation("😀 clear water", {
      exact: "clear",
      start: 2,
      end: 7,
      prefix: "😀 ",
      suffix: " water",
    }),
    { start: 2, end: 7 }
  );
});

test("UI language follows the vault's canonical edition and defaults to English", () => {
  const {
    UI_LANGUAGES,
    UI_STRINGS,
    pickUiLanguage,
    uiCount,
    uiText,
  } = require("../vault/plugin/firstpair-triptych/review-state");
  const row = (value) => JSON.stringify(value);
  assert.deepEqual([...UI_LANGUAGES], ["en", "it", "ru"]);
  for (const lang of UI_LANGUAGES) {
    assert.deepEqual(
      Object.keys(UI_STRINGS[lang]).sort(),
      Object.keys(UI_STRINGS.en).sort(),
      `${lang} defines every UI string`
    );
  }
  assert.equal(pickUiLanguage(row({ id: "ru-4.1", lang: "ru", canonical: true })), "ru");
  assert.equal(pickUiLanguage(row({ id: "it-4.1", lang: "it", canonical: true })), "it");
  assert.equal(
    pickUiLanguage([
      row({ id: "main-4.0", lang: "en" }),
      row({ id: "main-4.1", lang: "en", canonical: true }),
    ].join("\n")),
    "en"
  );
  // Legacy English ledgers carry no lang at all.
  assert.equal(pickUiLanguage(row({ id: "main-4.1" })), "en");
  assert.equal(pickUiLanguage(row({ id: "x", lang: "it" })), "it");
  assert.equal(pickUiLanguage(row({ id: "x", lang: "de", canonical: true })), "en");
  assert.equal(pickUiLanguage("not json"), "en");
  assert.equal(pickUiLanguage(""), "en");
  assert.equal(
    pickUiLanguage([row({ id: "a", lang: "it" }), row({ id: "b", lang: "ru" })].join("\n")),
    "en"
  );

  assert.equal(uiText("ru", "nav_Previous"), "Предыдущий");
  assert.equal(uiText("it", "save_replace"), "Salva e sostituisci");
  assert.equal(uiText("de", "nav_Next"), "Next");
  assert.equal(uiText("en", "open_fragment", { order: 3, title: "T" }), "Open fragment 3: T");
  assert.equal(uiCount("ru", 1, "fragment"), "1 фрагмент");
  assert.equal(uiCount("ru", 3, "fragment"), "3 фрагмента");
  assert.equal(uiCount("ru", 11, "fragment"), "11 фрагментов");
  assert.equal(uiCount("ru", 21, "saved_choice"), "21 сохранённое решение");
  assert.equal(uiCount("it", 1, "fragment"), "1 frammento");
  assert.equal(uiCount("en", 1, "fragment"), "1 fragments");
  assert.equal(uiCount("en", 1, "saved_choice"), "1 saved review choice");
});

test("the plugin reads the vault language before drawing UI; views register first", async () => {
  const mainPath = path.resolve(
    __dirname,
    "../vault/plugin/firstpair-triptych/main.js"
  );
  const source = fs.readFileSync(mainPath, "utf8");
  // Views register before any await (iOS restores tabs during onload); the
  // language is read next, and views draw only once `ready` resolves.
  assert.match(
    source,
    /async onload\(\) \{[^]*?this\.ready = new Promise[^]*?registerView\([^]*?registerView\([^]*?setBookRoot\(await detectBookRoot\(this\.app\.vault\.adapter\)\);\s*uiLanguage = await detectUiLanguage\(this\.app\.vault\.adapter\);/
  );
  assert.ok(
    source.indexOf("this.registerView(") < source.indexOf("await detectBookRoot(this.app.vault.adapter)"),
    "views register before the first await",
  );
  assert.equal((source.match(/if \(this\.plugin\.ready\) await this\.plugin\.ready;/g) || []).length, 4);
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "obsidian") {
      return {
        ItemView: class {},
        Plugin: class {},
        PluginSettingTab: class {},
        Setting: class {},
        Notice: class {},
        normalizePath: (value) => value,
        setIcon: () => {},
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[mainPath];
    const hooks = require(mainPath).__test;
    const adapter = (files) => ({
      exists: async (name) => Object.prototype.hasOwnProperty.call(files, name),
      read: async (name) => files[name],
    });
    const ledger = "Lighthouse Republics/_data/editions.jsonl";
    assert.equal(
      await hooks.detectUiLanguage(adapter({
        [ledger]: JSON.stringify({ id: "ru-4.1", lang: "ru", canonical: true }),
      })),
      "ru"
    );
    assert.equal(await hooks.detectUiLanguage(adapter({})), "en");
    // Obsidian Sync may not carry .jsonl to a phone: editions.json stands in.
    assert.equal(
      await hooks.detectUiLanguage(adapter({
        "Lighthouse Republics/_data/editions.json": JSON.stringify([
          { id: "ru-4.1.0", lang: "ru", canonical: false },
          { id: "ru-4.3.0", lang: "ru", canonical: true },
        ]),
      })),
      "ru"
    );
    const listed = (files, folders) => ({ ...adapter(files), list: async () => ({ folders, files: [] }) });
    assert.equal(
      await hooks.detectBookRoot(listed({ "Lighthouse Republics/_data/triptych-reader.json": "{}" }, [])),
      "Lighthouse Republics",
    );
    assert.equal(
      await hooks.detectBookRoot(listed(
        { "The Invented Enemy/_data/triptych-reader.json": "{}" },
        [".obsidian", "Preferences", "The Invented Enemy"],
      )),
      "The Invented Enemy",
    );
    assert.equal(await hooks.detectBookRoot(listed({}, ["Notes"])), "Lighthouse Republics");
    assert.equal(
      await hooks.detectUiLanguage({
        exists: async () => true,
        read: async () => { throw new Error("unreadable"); },
      }),
      "en"
    );

    const View = hooks.FirstPairTriptychReaderView;
    const view = Object.create(View.prototype);
    const labels = [];
    const button = {
      createSpan: () => ({
        createSpan: (options) => {
          labels.push(options.text);
          return {};
        },
      }),
      addEventListener: () => {},
    };
    let attrs = null;
    const container = {
      createEl: (_tag, options) => {
        attrs = options.attr;
        return button;
      },
    };
    hooks.setUiLanguage("ru");
    view.addControl(container, "Next", () => {}, false, "Глава");
    assert.equal(labels[0], "Следующий");
    assert.equal(attrs["aria-label"], "Следующий: Глава");
    hooks.setUiLanguage("it");
    view.addControl(container, "TOC", () => {}, false);
    assert.equal(labels[2], "Indice");
    hooks.setUiLanguage("en");
    view.addControl(container, "Back", () => {}, false);
    assert.equal(labels[3], "Back");
  } finally {
    Module._load = originalLoad;
  }
});

test("span notes keep text and recordings, and transcripts never replace the audio", () => {
  const {
    addVoiceClip,
    clearSpanNote,
    pendingVoiceClips,
    removeVoiceClip,
    setVoiceTranscript,
    spanNoteKey,
    spanNotesForSentence,
    upsertSpanNoteText,
    voiceClipId,
    voiceClipPath,
  } = require("../vault/plugin/firstpair-triptych/review-state");
  const context = {
    projectId: "lighthouse-republics",
    sourceContentId: `sha256:${"c".repeat(64)}`,
  };
  const selector = makeSelector("clear water below", 0, 11);
  const id = spanNoteKey("set/L1", "it-4.1", "it-4.1:U1:S1", 0, 11, "clear water");
  const details = {
    id,
    fragment_key: "set/L1",
    set: "set",
    lineage: "L1",
    edition: "it-4.1",
    edition_title: "Italiano 4.1",
    unit: "it-4.1:U1",
    sentence_id: "it-4.1:U1:S1",
    selector,
  };
  let ledger = emptyLedger(context);
  assert.deepEqual(ledger.span_notes, {});

  const recordedAt = "2026-10-20T09:00:00.000Z";
  const clipId = voiceClipId(id, recordedAt, "f".repeat(64));
  const path = voiceClipPath(id, clipId, "audio/mp4");
  assert.equal(path, `Preferences/voice/${id}/${clipId}.m4a`);
  ledger = addVoiceClip(ledger, details, {
    id: clipId, path, mime: "audio/mp4", bytes: 2048, duration_ms: 4200,
    audio_sha256: "f".repeat(64), recorded_at: recordedAt,
  });
  assert.equal(ledger.span_notes[id].exact, "clear water");
  assert.equal(ledger.span_notes[id].voice[0].transcript.status, "pending");
  assert.equal(pendingVoiceClips(ledger).length, 1);
  assert.throws(() => addVoiceClip(ledger, details, { id: "voice_x", path, bytes: 0 }), /recording/);

  ledger = upsertSpanNoteText(ledger, details, "  say it more plainly  ");
  assert.equal(ledger.span_notes[id].text, "say it more plainly");
  assert.equal(ledger.span_notes[id].voice.length, 1);

  ledger = setVoiceTranscript(ledger, id, clipId, { status: "failed", error: "offline" });
  assert.equal(pendingVoiceClips(ledger).length, 0);
  assert.equal(pendingVoiceClips(ledger, { includeFailed: true }).length, 1);
  ledger = setVoiceTranscript(ledger, id, clipId, {
    status: "done", text: " acqua limpida ", engine: "mlx-whisper", audio_sha256: "f".repeat(64),
  });
  const clip = ledger.span_notes[id].voice[0];
  assert.equal(clip.transcript.text, "acqua limpida");
  assert.equal(clip.transcript.error, undefined);
  assert.equal(clip.path, path);
  assert.equal(clip.audio_sha256, "f".repeat(64));

  // Interrupted runs come back pending; notes survive a serialize round trip.
  const reloaded = normalizeLedger(JSON.parse(serializeLedger(ledger)), context);
  assert.deepEqual(reloaded.span_notes, ledger.span_notes);
  assert.equal(
    normalizeLedger({ ...reloaded, span_notes: { [id]: {
      ...reloaded.span_notes[id],
      voice: [{ ...clip, transcript: { status: "running" } }],
    } } }, context).span_notes[id].voice[0].transcript.status,
    "pending",
  );
  assert.throws(() => normalizeLedger({ ...reloaded, span_notes: [] }, context), /span notes/);

  assert.deepEqual(touchedFragmentKeys(ledger), ["set/L1"]);
  assert.equal(spanNotesForSentence(ledger, "set/L1", "it-4.1", "it-4.1:U1:S1").length, 1);
  const digest = renderDigest(ledger);
  assert.match(digest, /\*\*NOTE\*\* in \*\*Italiano 4\.1\*\* on “clear water”: say it more plainly/);
  assert.match(digest, /Voice note `Preferences\/voice\/note_[0-9a-f]+\/voice_[0-9a-f]+\.m4a` \(0:04\): transcript: “acqua limpida”/);

  ledger = removeVoiceClip(ledger, id, clipId);
  assert.equal(ledger.span_notes[id].voice.length, 0);
  ledger = upsertSpanNoteText(ledger, details, "");
  assert.equal(ledger.span_notes[id], undefined, "an empty note disappears");
  ledger = upsertSpanNoteText(ledger, details, "keep");
  ledger = clearSpanNote(ledger, id);
  assert.deepEqual(ledger.span_notes, {});
});

test("vault-declared metrics parse, grade, and rank worst first", () => {
  const mainPath = path.resolve(__dirname, "../vault/plugin/firstpair-triptych/main.js");
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "obsidian") {
      return {
        ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, Setting: class {},
        Notice: class {}, normalizePath: (value) => value, setIcon: () => {},
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[mainPath];
    const hooks = require(mainPath).__test;
    const parsed = hooks.parseMetrics({
      schema: "firstpair.triptych-metrics.v1",
      metrics: [
        { key: "length_drift", letter: "L", better: "lower", format: "percent", warn: 25, bad: 50, rank: 2 },
        { key: "fluency", letter: "F", better: "higher", format: "integer", warn: 60, bad: 40, rank: 1 },
      ],
      values: { "set/a": { ru: { length_drift: 55, fluency: 70 } } },
    });
    const [drift, fluency] = parsed.metrics;
    assert.equal(hooks.metricSeverity(drift, 55), "bad");
    assert.equal(hooks.metricSeverity(drift, 30), "warn");
    assert.equal(hooks.metricSeverity(drift, 10), "");
    assert.equal(hooks.metricSeverity(fluency, 35), "bad");
    assert.equal(hooks.metricSeverity(fluency, 55), "warn");
    assert.equal(hooks.metricSeverity(fluency, 80), "");
    assert.equal(hooks.formatMetric(drift, 54.6), "55%");
    assert.deepEqual(
      [{ value: 10 }, { value: 70 }, { value: 40 }].sort(hooks.worstFirst(drift)).map((row) => row.value),
      [70, 40, 10],
    );
    assert.deepEqual(
      [{ value: 10 }, { value: 70 }, { value: 40 }].sort(hooks.worstFirst(fluency)).map((row) => row.value),
      [10, 40, 70],
    );
    assert.throws(() => hooks.parseMetrics({ schema: "other", metrics: [] }), /unsupported/);
    assert.throws(() => hooks.parseMetrics({
      schema: "firstpair.triptych-metrics.v1", metrics: [{ key: "a" }, { key: "a" }],
    }), /invalid metric key/);
  } finally {
    Module._load = originalLoad;
  }
});

test("span colours: only overlapping spans differ, and three may overlap at most", () => {
  const { spanColors, overlapDepth, MAX_SPAN_OVERLAP } = require(path.resolve(__dirname, "../vault/plugin/firstpair-triptych/review-state.js"));
  const text = "the quick brown fox jumps";
  const span = (id, start, end) => ({ id, start, end, exact: text.slice(start, end) });
  const records = [span("a", 0, 9), span("b", 4, 15), span("c", 16, 19), span("d", 10, 19), span("e", 20, 25)];
  const colors = spanColors(text, records);
  assert.notEqual(colors.get("a"), colors.get("b"), "overlapping spans differ");
  assert.notEqual(colors.get("b"), colors.get("d"));
  assert.notEqual(colors.get("c"), colors.get("d"));
  assert.equal(colors.get("e"), 0, "a span overlapping nothing takes the first colour");
  assert.equal(colors.get("a"), colors.get("d"), "non-overlapping spans may share a colour");
  for (const value of colors.values()) assert.ok(value >= 0 && value < MAX_SPAN_OVERLAP);
  assert.equal(MAX_SPAN_OVERLAP, 3);
  assert.equal(overlapDepth(text, records, 4, 9), 2);
  assert.equal(overlapDepth(text, [...records, span("f", 5, 8)], 6, 7), 3, "a fourth span here would exceed the limit");
  assert.equal(overlapDepth(text, records, 19, 20), 0);
});

test("voice-note spans take their own palette, overlap colours kept", () => {
  const editor = require("../vault/plugin/shared/span-editor")({
    Notice: class {}, Platform: {}, t: (key) => key,
  });
  const colors = new Map([["a", 0], ["b", 1]]);
  const text = { id: "a", action: "note", voice: [] };
  const voice = { id: "b", action: "note", voice: [{ id: "c1" }] };
  assert.equal(editor.fillToken(text, colors), "span-0");
  assert.equal(editor.fillToken(voice, colors), "voice-1");
  assert.equal(editor.spanFill(["voice-1"]), "var(--lt-voice-1)");
  assert.equal(editor.spanFill([0]), "var(--lt-span-0)", "bare indices still mean the text palette");
  assert.match(editor.spanFill(["span-0", "voice-1"]), /--lt-span-0.*--lt-voice-1/);
});

test("precomputed edition diffs: pair for two shown panes, set for three", () => {
  const diffView = require("../vault/plugin/shared/diff-view");
  const diffs = diffView.parseDiffs({
    schema: "firstpair.edition-diffs.v1",
    editions: ["a", "b", "c"],
    pages: { p: {
      "a|b": { a: [[0, 3, "del"]], b: [[0, 4, "ins"]] },
      "a|c": { a: [[0, 3, "del"]], c: [] },
      "b|c": { b: [], c: [] },
      "a|b|c": { a: [[0, 3, "uniq"]], b: [[0, 4, "share:c"]], c: [] },
    } },
  });
  // Pane order on screen does not matter; the file's edition order does.
  assert.deepEqual(diffView.diffFor(diffs, "p", ["b", "a"]).ranges.a, [[0, 3, "del"]]);
  assert.equal(diffView.diffFor(diffs, "p", ["a", "b"]).mode, "pair");
  const all = diffView.diffFor(diffs, "p", ["a", "b", "c"]);
  assert.equal(all.mode, "all");
  assert.deepEqual(all.ranges.b, [[0, 4, "share:c"]]);
  assert.equal(diffView.diffFor(diffs, "p", ["a"]), null, "one pane has nothing to compare");
  assert.equal(diffView.diffFor(diffs, "missing", ["a", "b"]).same, true);
  assert.deepEqual(diffView.kindClasses("share:c", diffs.editions), ["fp-diff", "fp-diff-share", "fp-diff-ed-2"]);
  assert.throws(() => diffView.parseDiffs({ schema: "other" }));
});

test("diff v2: category filters, history lens, rule decisions in the digest", () => {
  const diffView = require("../vault/plugin/shared/diff-view");
  const ranges = [[0, 3, "del", "punct"], [4, 9, "del", "lexical"], [10, 20, "del", "moved", "p9"]];
  assert.deepEqual(
    diffView.visibleRanges(ranges, { hiddenCategories: { punct: true } }).map((r) => r[3]),
    ["lexical", "moved"],
  );
  const eds = ["a", "b", "c"];
  // Settled text the latest rewrote: what a and b share, and c's own words.
  assert.equal(diffView.lensAccepts("rewritten", eds, "b", "share:a"), true);
  assert.equal(diffView.lensAccepts("rewritten", eds, "b", "share:c"), false);
  assert.equal(diffView.lensAccepts("rewritten", eds, "c", "uniq"), true);
  // Reverts: the latest shares with the earliest only.
  assert.equal(diffView.lensAccepts("reverts", eds, "c", "share:a"), true);
  assert.equal(diffView.lensAccepts("reverts", eds, "c", "uniq"), false);
  assert.equal(diffView.lensAccepts("new", eds, "a", "uniq"), false);
  assert.equal(diffView.parseDiffs({ schema: "firstpair.edition-diffs.v1", editions: ["a"], pages: {} }).categories.length, 0);

  const state = require("../vault/plugin/firstpair-triptych/review-state");
  const ledger = state.emptyLedger({ projectId: "p", sourceContentId: `sha256:${"a".repeat(64)}` });
  const rule = { id: "R0123456789ab", from: "нежели", to: "чем", count: 15, pages: 15 };
  const accepted = state.normalizeLedger(state.setRuleDecision(ledger, rule, "ru-4.2.3|ru-4.3.0", "reject"));
  assert.deepEqual(state.ruleDecisionMap(accepted), { R0123456789ab: "reject" });
  assert.equal(state.reviewChoiceCount(accepted), 1);
  assert.match(state.renderDigest(accepted), /## Book-wide edit rules[\s\S]*\*\*REJECT\*\* “нежели” → “чем”: keep “нежели” \(ru-4\.2\.3 → ru-4\.3\.0, 15 places on 15 pages\)/);
  const cleared = state.normalizeLedger(state.setRuleDecision(accepted, rule, "ru-4.2.3|ru-4.3.0", null));
  assert.equal("rule_decisions" in cleared, false, "an empty rule map leaves no trace in the ledger");
});

test("arrow keys turn pages unless something else wants them", () => {
  const { bindPageKeys } = require("../vault/plugin/shared/page-keys");
  let open = null;
  const document = { querySelector: () => open };
  const handlers = [];
  const turns = [];
  let active = true;
  const view = {
    containerEl: { ownerDocument: document, isConnected: true },
    registerDomEvent: (target, type, handler) => handlers.push([target, type, handler]),
  };
  bindPageKeys(view, { previous: () => turns.push("prev"), next: () => turns.push("next"), isActive: () => active });
  bindPageKeys(view, { previous: () => turns.push("again"), next: () => turns.push("again"), isActive: () => true });
  assert.equal(handlers.length, 1, "bound once per view");
  const [[target, type, handler]] = handlers;
  assert.equal(target, document);
  assert.equal(type, "keydown");
  const key = (keyName, extra = {}) => {
    const event = { key: keyName, target: { tagName: "DIV", closest: () => null }, preventDefault() { this.prevented = true; }, ...extra };
    handler(event);
    return event;
  };
  assert.equal(key("ArrowRight").prevented, true);
  key("ArrowLeft");
  key("ArrowDown");
  key("ArrowRight", { metaKey: true });
  key("ArrowRight", { target: { tagName: "TEXTAREA", closest: () => null } });
  key("ArrowRight", { target: { tagName: "SPAN", isContentEditable: true, closest: () => null } });
  open = {};
  key("ArrowRight");
  open = null;
  active = false;
  key("ArrowLeft");
  assert.deepEqual(turns, ["next", "prev"]);
});
