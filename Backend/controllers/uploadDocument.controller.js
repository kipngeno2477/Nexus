import { kb } from "../src/kb.js";

const ALLOW_UPLOADS = process.env.ALLOW_UPLOADS === "true";

export function listDocuments(req, res) {
  res.json({ docs: kb.docs, totalChunks: kb.chunks.length, uploadsEnabled: ALLOW_UPLOADS });
}

export function listChunks(req, res) {
  const chunks = kb.chunks
    .filter((c) => c.docId === req.params.docId)
    .map(({ docId, chunkId, part, sectionId, sectionTitle, text }) => ({ docId, chunkId, part, sectionId, sectionTitle, words: text.split(/\s+/).length }));
  if (chunks.length === 0) return res.status(404).json({ message: `Unknown document "${req.params.docId}"` });
  res.json({ docId: req.params.docId, chunks });
}

export function getChunk(req, res) {
  const chunk = kb.getChunk(req.params.docId, req.params.chunkId);
  if (!chunk) return res.status(404).json({ message: "Chunk not found" });
  res.json(chunk);
}

export async function uploadDocument(req, res) {
  if (!ALLOW_UPLOADS) return res.status(403).json({ message: "Uploads are disabled on this deployment." });
  try {
    const doc = await kb.addDocument(req.body ?? {});
    res.status(201).json({ doc, totalChunks: kb.chunks.length });
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
}
