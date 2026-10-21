"use strict";

/*
 * Span voice and text notes for FirstPair plugins (Triptych and Reader).
 *
 * A recording is written and read back byte for byte under Preferences/voice/
 * before the ledger names it; transcription (local mlx_whisper on a desktop,
 * or an OpenAI-compatible endpoint) follows and is stored beside it, never
 * replacing it.  The host plugin supplies:
 *   this.app, this.settings, this.store (a shared DecisionStore),
 *   this.transcribing (Set), this.voiceListeners (Set), voiceContext().
 */

const {
  addVoiceClip,
  clearSpanNote,
  formatDuration,
  pendingVoiceClips,
  removeVoiceClip,
  setVoiceTranscript,
  upsertSpanNoteText,
  voiceClipId,
  voiceClipPath,
} = require("../firstpair-triptych/review-state");

// deps: { Notice, Platform, normalizePath, requestUrl, t }
module.exports = function voiceCore(deps) {
  const { Notice, Platform, normalizePath, requestUrl, t } = deps;

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

  class VoiceNotesMethods {
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
      // A caller may hand over its own ledger context and span details (the
      // Reader does); the Triptych derives them from its page payload.
      const context = options.context || this.store.contextFromPayload(payload);
      const details = options.details || this.spanNoteDetails(payload, pane, span, selector);
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
      title.className = "lt-note-title";
      title.textContent = t("note_dialog_title", { quote: selector.exact });
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
      // Save sits right under the text so the iOS keyboard never covers it.
      dialog.append(title, field, error, actions, recorderRow, clipsHeading, clipList);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      // Fit the overlay to the visible viewport: when the on-screen keyboard
      // opens, the dialog shrinks and scrolls above it instead of under it.
      const viewport = view.visualViewport;
      const fitViewport = () => {
        if (!viewport) return;
        overlay.style.top = `${viewport.offsetTop}px`;
        overlay.style.height = `${viewport.height}px`;
        overlay.style.bottom = "auto";
      };
      if (viewport) {
        viewport.addEventListener("resize", fitViewport);
        viewport.addEventListener("scroll", fitViewport);
        fitViewport();
      }

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
        if (viewport) {
          viewport.removeEventListener("resize", fitViewport);
          viewport.removeEventListener("scroll", fitViewport);
        }
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
        let context;
        try {
          context = await this.voiceContext();
        } catch (_error) {
          return 0;
        }
        if (!context) return 0;
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
  }

  // Install the voice-note methods on a plugin class.
  function install(PluginClass) {
    for (const name of Object.getOwnPropertyNames(VoiceNotesMethods.prototype)) {
      if (name === "constructor") continue;
      Object.defineProperty(
        PluginClass.prototype, name,
        Object.getOwnPropertyDescriptor(VoiceNotesMethods.prototype, name),
      );
    }
    return PluginClass;
  }

  return {
    install, VoiceRecorder, compactPrompt, sha256Bytes, ensureFolder, DEFAULT_MLX_MODEL,
  };
};
