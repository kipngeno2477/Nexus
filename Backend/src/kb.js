// In-memory knowledge base: documents from data/raw (+ optional uploads in data/uploads),
// ingested at startup and indexed with BM25. Uploaded originals are stored unmodified.

import { mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestDirectory, ingestText } from "./ingest/ingest.js";
import { BM25Index } from "./retrieval/bm25.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UPLOAD_DIR = path.join(ROOT, "data/uploads");

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
  punishment: ["penalty", "offence", "fine", "imprisonment"],
  penalty: ["offence", "fine", "imprisonment"],
  jail: ["imprisonment"],
  government: ["public", "entity", "state"],
  office: ["public", "entity"],
};

export class KnowledgeBase {
  constructor() {
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

  async load() {
    try {
      const raw = await ingestDirectory();
      let uploads = { docs: [], chunks: [] };
      try {
        await readdir(UPLOAD_DIR);
        uploads = await ingestDirectory(UPLOAD_DIR);
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

  /** Adds an uploaded plain-text document. Original text is stored as received. */
  async addDocument({ fileName, text, title }) {
    const base = path.basename(String(fileName || ""));
    if (!/^[\w .()-]{1,100}\.(txt|md)$/i.test(base)) throw Object.assign(new Error("fileName must be a .txt or .md name"), { status: 400 });
    if (typeof text !== "string" || !text.trim()) throw Object.assign(new Error("text is required"), { status: 400 });
    const chunks = ingestText({ fileName: base, raw: text, title });
    if (chunks.length === 0) throw Object.assign(new Error("No usable text found after cleaning"), { status: 422 });
    const docId = chunks[0].docId;
    if (this.docs.some((d) => d.docId === docId)) throw Object.assign(new Error(`Document "${docId}" already exists`), { status: 409 });

    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(path.join(UPLOAD_DIR, base), text, { flag: "wx" }).catch((e) => {
      if (e.code === "EEXIST") throw Object.assign(new Error(`File "${base}" already uploaded`), { status: 409 });
      throw e;
    });
    const doc = { docId, title: chunks[0].docTitle, file: base, sourceUrl: null, chunks: chunks.length, uploaded: true };
    this.docs.push(doc);
    this.chunks.push(...chunks);
    this.rebuild();
    return doc;
  }

  getChunk(docId, chunkId) {
    return this.chunks.find((c) => c.docId === docId && c.chunkId === chunkId) ?? null;
  }
}

export const kb = new KnowledgeBase();
