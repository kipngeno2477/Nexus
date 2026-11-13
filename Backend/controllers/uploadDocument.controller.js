import { timingSafeEqual } from "node:crypto";
import { kb } from "../src/kb.js";
import { sessions, SESSION_HEADER } from "../src/sessionStore.js";

const ALLOW_UPLOADS = process.env.ALLOW_UPLOADS === "true";
// When set, adding/removing documents requires header `x-upload-token: <UPLOAD_TOKEN>`,
// so visitors to a public deployment cannot change the shared knowledge base.
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN || "";

function tokenOk(req) {
  if (!UPLOAD_TOKEN) return true;
  const given = Buffer.from(String(req.get("x-upload-token") ?? ""));
  const want = Buffer.from(UPLOAD_TOKEN);
  return given.length === want.length && timingSafeEqual(given, want);
}

function guardWrite(req, res) {
  if (!ALLOW_UPLOADS) {
    res.status(403).json({ message: "Uploads are disabled on this deployment." });
    return false;
  }
  if (!tokenOk(req)) {
    res.status(401).json({ message: "A valid upload token is required to change the knowledge base." });
    return false;
  }
  return true;
}

export function listDocuments(req, res) {
  res.json({
    docs: kb.docs,
    totalChunks: kb.chunks.length,
    uploadsEnabled: ALLOW_UPLOADS,
    uploadsRequireToken: ALLOW_UPLOADS && !!UPLOAD_TOKEN,
  });
}

export function listChunks(req, res) {
  const chunks = kb.chunks
    .filter((c) => c.docId === req.params.docId)
    .map(({ docId, chunkId, part, sectionId, sectionTitle, text }) => ({ docId, chunkId, part, sectionId, sectionTitle, words: text.split(/\s+/).length }));
  if (chunks.length === 0) return res.status(404).json({ message: `Unknown document "${req.params.docId}"` });
  res.json({ docId: req.params.docId, chunks });
}

export function getChunk(req, res) {
  const chunk =
    kb.getChunk(req.params.docId, req.params.chunkId) ??
    sessions.getChunk(req.get(SESSION_HEADER), req.params.docId, req.params.chunkId); // private docs: own session only
  if (!chunk) return res.status(404).json({ message: "Chunk not found" });
  res.json(chunk);
}

export async function uploadDocument(req, res) {
  if (!guardWrite(req, res)) return;
  try {
    const { doc, report } = await kb.addDocument(req.body ?? {});
    res.status(201).json({ doc, report, totalChunks: kb.chunks.length });
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
}

export async function deleteDocument(req, res) {
  if (!guardWrite(req, res)) return;
  try {
    const doc = await kb.removeDocument(req.params.docId);
    res.json({ removed: doc.docId, totalChunks: kb.chunks.length });
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
}
