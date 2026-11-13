// Private, per-browser document sessions. Documents a citizen uploads are ingested in memory,
// searchable only with their session id, never written to disk, and dropped after an idle TTL.
//
// Retrieval for a session uses ONE BM25 index built over (shared knowledge base + session docs),
// so scores are comparable and the same bounded heap selects top-K across both.

import { randomUUID } from "node:crypto";
import { ingestWithReport } from "./ingest/ingest.js";
import { slug } from "./ingest/chunk.js";
import { BM25Index } from "./retrieval/bm25.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const SESSION_LIMITS = Object.freeze({
  ttlMs: Number(process.env.SESSION_TTL_MS) || 60 * 60 * 1000, // 1 hour idle
  maxSessions: Number(process.env.MAX_SESSIONS) || 200,
  maxDocsPerSession: 3,
  maxChars: 300_000,
});

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export class SessionStore {
  /**
   * @param {{ kb: import("./kb.js").KnowledgeBase, synonyms?: object, limits?: object, now?: () => number }} opts
   */
  constructor({ kb, synonyms = {}, limits = SESSION_LIMITS, now = Date.now }) {
    this.kb = kb;
    this.synonyms = synonyms;
    this.limits = limits;
    this.now = now;
    this.sessions = new Map(); // id -> { docs, chunks, lastUsed, index, indexKey }
  }

  static isValidId(id) {
    return typeof id === "string" && UUID_RE.test(id);
  }

  sweep() {
    const cutoff = this.now() - this.limits.ttlMs;
    for (const [id, s] of this.sessions) if (s.lastUsed < cutoff) this.sessions.delete(id);
  }

  /** Existing live session or null. Touches lastUsed. */
  get(id) {
    if (!SessionStore.isValidId(id)) return null;
    const s = this.sessions.get(id);
    if (!s) return null;
    if (s.lastUsed < this.now() - this.limits.ttlMs) {
      this.sessions.delete(id);
      return null;
    }
    s.lastUsed = this.now();
    return s;
  }

  #create() {
    this.sweep();
    if (this.sessions.size >= this.limits.maxSessions) {
      // evict the least recently used session
      let oldest = null;
      for (const [id, s] of this.sessions) if (!oldest || s.lastUsed < oldest[1].lastUsed) oldest = [id, s];
      this.sessions.delete(oldest[0]);
    }
    const id = randomUUID();
    const s = { docs: [], chunks: [], lastUsed: this.now(), index: null, indexKey: null };
    this.sessions.set(id, s);
    return [id, s];
  }

  /** Adds a private document. Creates a session if `id` is missing/expired. */
  addDocument(id, { fileName, text, title }) {
    const base = String(fileName ?? "").split(/[\\/]/).pop().trim();
    if (!/^[\w .()-]{1,100}\.(txt|md)$/i.test(base)) throw httpError(400, "fileName must be a .txt or .md file name (letters, digits, spaces, . _ - ( ) only)");
    if (typeof text !== "string" || !text.trim()) throw httpError(400, "text is required");
    if (text.length > this.limits.maxChars) throw httpError(413, `Document too large (max ${this.limits.maxChars.toLocaleString()} characters)`);
    if (title != null && (typeof title !== "string" || title.length > 160)) throw httpError(400, "title must be a string of at most 160 characters");

    let s = this.get(id);
    if (s && s.docs.length >= this.limits.maxDocsPerSession)
      throw httpError(409, `You can add up to ${this.limits.maxDocsPerSession} documents. Remove one first.`);
    if (!s) [id, s] = this.#create();

    // "my-" prefix keeps private ids distinct from shared ones; suffix keeps them unique in-session
    const baseId = slug(`my-${base.replace(/\.[^.]+$/, "")}`).slice(0, 34);
    let docId = baseId;
    for (let n = 2; s.docs.some((d) => d.docId === docId) || this.kb.hasDoc?.(docId); n++) docId = `${baseId}-${n}`;

    const { chunks, report, docTitle, docId: finalId } = ingestWithReport({ fileName: base, raw: text, title, docId });
    if (chunks.length === 0) throw httpError(422, "No usable text found after cleaning");
    for (const c of chunks) c.private = true;

    const doc = { docId: finalId, title: docTitle, file: base, chunks: chunks.length, private: true, ingest: report, addedAt: new Date(this.now()).toISOString() };
    s.docs.push(doc);
    s.chunks.push(...chunks);
    s.index = null; // rebuilt lazily
    return { sessionId: id, doc, report, expiresInMs: this.limits.ttlMs };
  }

  removeDocument(id, docId) {
    const s = this.get(id);
    if (!s) throw httpError(404, "Session not found or expired");
    if (!s.docs.some((d) => d.docId === docId)) throw httpError(404, `Unknown document "${docId}"`);
    s.docs = s.docs.filter((d) => d.docId !== docId);
    s.chunks = s.chunks.filter((c) => c.docId !== docId);
    s.index = null;
    return { removed: docId };
  }

  /** Index over shared + private chunks (cached until either side changes). */
  indexFor(s) {
    const key = `${this.kb.loadedAt}|${s.chunks.length}|${s.docs.map((d) => d.docId).join(",")}`;
    if (!s.index || s.indexKey !== key) {
      s.index = new BM25Index([...this.kb.chunks, ...s.chunks], { synonyms: this.synonyms });
      s.indexKey = key;
    }
    return s.index;
  }

  getChunk(id, docId, chunkId) {
    const s = this.get(id);
    return s?.chunks.find((c) => c.docId === docId && c.chunkId === chunkId) ?? null;
  }

  stats() {
    return { activeSessions: this.sessions.size, ttlMinutes: Math.round(this.limits.ttlMs / 60000) };
  }
}
