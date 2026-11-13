// Builds data/processed/chunks.json from the original files in data/raw/.
// Originals are read-only inputs and are never modified.
// Per-file metadata (docId, title, source URL, licence) comes from data/sources.json.
// Usage: npm run ingest

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanTextWithStats, inferTitle } from "./clean.js";
import { chunkDocument, docIdFromFilename, slug } from "./chunk.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const RAW_DIR = path.join(ROOT, "data/raw");
export const SOURCES_FILE = path.join(ROOT, "data/sources.json");
export const OUT_FILE = path.join(ROOT, "data/processed/chunks.json");

/** Clean + chunk one document and report what ingestion did (shown after upload). */
export function ingestWithReport({ fileName, raw, title, docId, sourceUrl }) {
  const { text, stats } = cleanTextWithStats(raw);
  const id = docId ? slug(docId) : docIdFromFilename(fileName);
  const docTitle = (title?.trim() || inferTitle(raw, fileName)).slice(0, 160);
  const chunks = chunkDocument({ docId: id, docTitle, sourceFile: fileName, sourceUrl, text });
  const sections = [...new Map(chunks.map((c) => [c.sectionId, c.sectionTitle])).entries()];
  const report = {
    ...stats,
    sections: sections.length,
    sectionTitles: sections.slice(0, 50).map(([, t]) => t),
    parts: [...new Set(chunks.map((c) => c.part).filter(Boolean))],
    chunks: chunks.length,
    words: chunks.reduce((n, c) => n + c.text.split(/\s+/).length, 0),
    headingsDetected: sections.length > 1 || sections[0]?.[0] !== "preamble",
  };
  return { chunks, report, docTitle, docId: id };
}

export function ingestText(args) {
  return ingestWithReport(args).chunks;
}

async function loadSources(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw new Error(`Invalid ${path.basename(file)}: ${e.message}`);
  }
}

export async function ingestDirectory(dir = RAW_DIR, sourcesFile = SOURCES_FILE) {
  const sources = await loadSources(sourcesFile);
  const files = (await readdir(dir)).filter((f) => /\.(txt|md)$/i.test(f)).sort();
  const chunks = [];
  const docs = [];
  for (const f of files) {
    const { docId, title, sourceUrl } = sources[f] ?? {};
    const { chunks: docChunks, report, docTitle, docId: id } = ingestWithReport({
      fileName: f,
      raw: await readFile(path.join(dir, f), "utf8"),
      title,
      docId,
      sourceUrl: sourceUrl || undefined,
    });
    if (docs.some((d) => d.docId === id)) throw new Error(`Duplicate docId "${id}" for ${f}`);
    docs.push({ docId: id, title: docTitle, file: f, sourceUrl: sourceUrl || null, chunks: docChunks.length, ingest: report });
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
