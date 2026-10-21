"use strict";

/*
 * Shared decisions ledger for FirstPair plugins (Triptych and Reader).
 *
 * One ledger per vault: Preferences/triptych-decisions.json with its exact
 * .sha256 sidecar and the EDITING-INSTRUCTIONS.md digest.  Every write is
 * queued, re-reads the files, verifies temporary copies, swaps with backups,
 * verifies again, and rolls back on failure; a file changed in another window
 * is refused rather than overwritten.
 */

const {
  LEDGER_SCHEMA,
  digestLine,
  emptyLedger,
  normalizeLedger,
  renderDigest,
  serializeLedger,
} = require("../firstpair-triptych/review-state");

const LEDGER_PATH = "Preferences/triptych-decisions.json";
const DIGEST_PATH = "Preferences/EDITING-INSTRUCTIONS.md";
const LEDGER_HASH_PATH = "Preferences/triptych-decisions.sha256";

// deps: { normalizePath, notifyUnreadable(error) }
module.exports = function ledgerStore(deps) {
  const { normalizePath } = deps;
  const Notice = { unreadable: deps.notifyUnreadable || (() => {}) };

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
        // A text change is a known state handled by Review, not a fault to
        // announce on every page.
        if (error.code !== "SOURCE_CONTENT_MISMATCH") Notice.unreadable(error);
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

    // Move the whole decision file set aside when it was made on an earlier
    // text, so a new review can start.  Scope is the complete file, never a
    // page; recordings stay where they are and the archived ledger names them.
    archiveMismatched() {
      const operation = this.queue.catch(() => undefined).then(async () => {
        const adapter = this.app.vault.adapter;
        const jsonPath = normalizePath(LEDGER_PATH);
        if (!(await adapter.exists(jsonPath))) return null;
        const serialized = await adapter.read(jsonPath);
        const parsed = JSON.parse(serialized);
        const shortSource = String(parsed.source_content_id || "sha256:unbound")
          .replace(/^sha256:/, "").slice(0, 12);
        const archive = normalizePath("Preferences/archive");
        if (!(await adapter.exists(archive))) await adapter.mkdir(archive);
        let stem = `triptych-decisions-${shortSource}-r${Number(parsed.revision) || 0}`;
        for (let suffix = 1; await adapter.exists(`${archive}/${stem}.json`); suffix += 1) {
          stem = `triptych-decisions-${shortSource}-r${Number(parsed.revision) || 0}-${suffix}`;
        }
        const moves = [
          [jsonPath, `${archive}/${stem}.json`],
          [normalizePath(LEDGER_HASH_PATH), `${archive}/${stem}.sha256`],
          [normalizePath(DIGEST_PATH), `${archive}/${stem}-EDITING-INSTRUCTIONS.md`],
        ];
        const moved = [];
        try {
          for (const [from, to] of moves) {
            if (await adapter.exists(from)) {
              await adapter.rename(from, to);
              moved.push([from, to]);
            }
          }
        } catch (error) {
          for (const [from, to] of moved.reverse()) {
            if (await adapter.exists(to) && !(await adapter.exists(from))) await adapter.rename(to, from);
          }
          throw error;
        }
        this.cache = null;
        return `${archive}/${stem}.json`;
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

  return { DecisionStore, LEDGER_PATH, DIGEST_PATH, LEDGER_HASH_PATH };
};

module.exports.LEDGER_PATH = LEDGER_PATH;
module.exports.DIGEST_PATH = DIGEST_PATH;
module.exports.LEDGER_HASH_PATH = LEDGER_HASH_PATH;
