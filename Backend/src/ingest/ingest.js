// Builds data/processed/chunks.json from the original files in data/raw/.
// Originals are read-only inputs and are never modified.
// Per-file metadata (docId, title, source URL, licence) comes from data/sources.json.
// Usage: npm run ingest

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanText } from "./clean.js";
import { chunkDocument, docIdFromFilename, slug } from "./chunk.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const RAW_DIR = path.join(ROOT, "data/raw");
export const SOURCES_FILE = path.join(ROOT, "data/sources.json");
export const OUT_FILE = path.join(ROOT, "data/processed/chunks.json");

export function ingestText({ fileName, raw, title, docId, sourceUrl }) {
  const text = cleanText(raw);
  const id = docId ? slug(docId) : docIdFromFilename(fileName);
  const docTitle = title || text.split("\n").find((l) => l.trim()) || fileName;
  return chunkDocument({ docId: id, docTitle: docTitle.slice(0, 160), sourceFile: fileName, sourceUrl, text });
}

async function loadSources() {
  try {
    return JSON.parse(await readFile(SOURCES_FILE, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw new Error(`Invalid ${path.basename(SOURCES_FILE)}: ${e.message}`);
  }
}

export async function ingestDirectory(dir = RAW_DIR) {
  const sources = await loadSources();
  const files = (await readdir(dir)).filter((f) => /\.(txt|md)$/i.test(f)).sort();
  const chunks = [];
  const docs = [];
  for (const f of files) {
    const meta = sources[f] ?? {};
    const docChunks = ingestText({ fileName: f, raw: await readFile(path.join(dir, f), "utf8"), ...meta });
    if (docs.some((d) => d.docId === docChunks[0]?.docId)) throw new Error(`Duplicate docId for ${f}`);
    docs.push({
      docId: docChunks[0]?.docId ?? docIdFromFilename(f),
      title: docChunks[0]?.docTitle ?? f,
      file: f,
      sourceUrl: meta.sourceUrl ?? null,
      chunks: docChunks.length,
    });
    chunks.push(...docChunks);
  }
  return { docs, chunks };
}

export async function buildKnowledgeBaseFile() {
  const { docs, chunks } = await ingestDirectory();
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  const kb = { builtAt: new Date().toISOString(), docs, chunks };
  await writeFile(OUT_FILE, JSON.stringify(kb, null, 2));
  return kb;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { docs, chunks } = await buildKnowledgeBaseFile();
  console.table(docs.map(({ docId, file, chunks }) => ({ docId, file, chunks })));
  console.log(`Wrote ${chunks.length} chunks from ${docs.length} documents to ${path.relative(ROOT, OUT_FILE)}`);
}
