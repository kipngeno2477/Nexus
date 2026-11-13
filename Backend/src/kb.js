// In-memory knowledge base: documents from data/raw (+ optional uploads in data/uploads),
// ingested at startup and indexed with BM25. Uploaded originals are stored unmodified.

import { mkdir, writeFile, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestDirectory, ingestWithReport, RAW_DIR } from "./ingest/ingest.js";
import { BM25Index } from "./retrieval/bm25.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, "data/uploads");
const MANIFEST = "_uploads.json"; // titles/ids of uploaded docs, so they survive restarts
const MAX_UPLOADED_DOCS = Number(process.env.MAX_UPLOADED_DOCS) || 20;
const MAX_UPLOAD_CHARS = 900_000;

// Small plain-language synonym map for citizen phrasing → statutory wording.
export const SYNONYMS = {
  cost: ["fee", "fees"],
  charge: ["fee", "fees"],
  pay: ["fee", "fees"],
  price: ["fee"],
  refuse: ["reject", "decline", "refusal"],
  refused: ["rejected", "declined", "refusal"],
  deny: ["refuse", "reject"],
  denied: ["refused", "rejected"],
  appeal: ["review", "complaint"],
  complain: ["complaint", "review"],
  request: ["application", "apply"],
  apply: ["application", "applicant"],
  respond: ["decision", "response"],
  reply: ["decision", "response"],
  protected: ["protection", "penalized"],
  protect: ["protection", "penalized"],
  corruption: ["public interest", "disclosure", "wrongdoing"],
  fired: ["penalized", "employment"],
  sacked: ["penalized", "employment"],
  secret: ["exempt", "confidential", "limitation"],
  exempt: ["limitation", "withheld", "limited"],
  exemption: ["limitation", "withheld", "limited"],
  withhold: ["limitation", "exempt", "limited"],
  confidential: ["exempt", "limitation"],
  destroy: ["destroys", "erase", "conceal"],
  ask: ["application", "request"],
  days: ["day", "period", "time"],
  long: ["period", "days", "time"],
  whistleblower: ["disclosure", "protection"],
  whistle: ["disclosure", "protection"],
  punishment: ["penalty", "offence", "fine", "imprisonment"],
  penalty: ["offence", "fine", "imprisonment"],
  jail: ["imprisonment"],
  government: ["public", "entity", "state"],
  office: ["public", "entity"],
};

export class KnowledgeBase {
  constructor({ rawDir = RAW_DIR, uploadDir = UPLOAD_DIR } = {}) {
    this.rawDir = rawDir;
    this.uploadDir = uploadDir;
    this.docs = [];
    this.chunks = [];
    this.index = new BM25Index([]);
    this.loadedAt = null;
    this.error = null;
  }

  rebuild() {
    this.index = new BM25Index(this.chunks, { synonyms: SYNONYMS });
    this.loadedAt = new Date().toISOString();
  }

  get manifestFile() {
    return path.join(this.uploadDir, MANIFEST);
  }

  async load() {
    try {
      const raw = await ingestDirectory(this.rawDir);
      let uploads = { docs: [], chunks: [] };
      try {
        await readdir(this.uploadDir);
        uploads = await ingestDirectory(this.uploadDir, this.manifestFile);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      this.docs = [...raw.docs, ...uploads.docs.map((d) => ({ ...d, uploaded: true }))];
      this.chunks = [...raw.chunks, ...uploads.chunks];
      this.rebuild();
      this.error = null;
    } catch (e) {
      this.error = e.message;
      throw e;
    }
    return this;
  }

  async #readManifest() {
    try {
      return JSON.parse(await readFile(this.manifestFile, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return {};
      throw e;
    }
  }

  /**
   * Adds an uploaded plain-text document. The original text is stored unmodified in the
   * upload folder; cleaning/chunking happen in memory. Returns the doc and an ingestion report.
   */
  async addDocument({ fileName, text, title }) {
    const base = path.basename(String(fileName || "")).trim();
    if (!/^[\w .()-]{1,100}\.(txt|md)$/i.test(base)) throw httpError(400, "fileName must be a .txt or .md file name (letters, digits, spaces, . _ - ( ) only)");
    if (typeof text !== "string" || !text.trim()) throw httpError(400, "text is required");
    if (text.length > MAX_UPLOAD_CHARS) throw httpError(413, `Document too large (max ${MAX_UPLOAD_CHARS.toLocaleString()} characters)`);
    if (this.docs.filter((d) => d.uploaded).length >= MAX_UPLOADED_DOCS)
      throw httpError(409, `Upload limit reached (${MAX_UPLOADED_DOCS} documents). Remove one first.`);
    if (title != null && (typeof title !== "string" || title.length > 160)) throw httpError(400, "title must be a string of at most 160 characters");

    const { chunks, report, docTitle, docId } = ingestWithReport({ fileName: base, raw: text, title });
    if (chunks.length === 0) throw httpError(422, "No usable text found after cleaning");
    if (this.docs.some((d) => d.docId === docId)) throw httpError(409, `A document with id "${docId}" already exists. Rename the file.`);

    await mkdir(this.uploadDir, { recursive: true });
    await writeFile(path.join(this.uploadDir, base), text, { flag: "wx" }).catch((e) => {
      if (e.code === "EEXIST") throw httpError(409, `File "${base}" already uploaded`);
      throw e;
    });
    const manifest = await this.#readManifest();
    manifest[base] = { docId, title: docTitle, uploadedAt: new Date().toISOString() };
    await writeFile(this.manifestFile, JSON.stringify(manifest, null, 2));

    const doc = { docId, title: docTitle, file: base, sourceUrl: null, chunks: chunks.length, uploaded: true, ingest: report };
    this.docs.push(doc);
    this.chunks.push(...chunks);
    this.rebuild();
    return { doc, report };
  }

  /** Removes an uploaded document (bundled documents in data/raw cannot be removed). */
  async removeDocument(docId) {
    const doc = this.docs.find((d) => d.docId === docId);
    if (!doc) throw httpError(404, `Unknown document "${docId}"`);
    if (!doc.uploaded) throw httpError(403, "Bundled documents cannot be removed");
    await rm(path.join(this.uploadDir, doc.file), { force: true });
    const manifest = await this.#readManifest();
    delete manifest[doc.file];
    await writeFile(this.manifestFile, JSON.stringify(manifest, null, 2));
    this.docs = this.docs.filter((d) => d.docId !== docId);
    this.chunks = this.chunks.filter((c) => c.docId !== docId);
    this.rebuild();
    return doc;
  }

  hasDoc(docId) {
    return this.docs.some((d) => d.docId === docId);
  }

  getChunk(docId, chunkId) {
    return this.chunks.find((c) => c.docId === docId && c.chunkId === chunkId) ?? null;
  }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export const kb = new KnowledgeBase();
