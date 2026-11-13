// Builds data/processed/chunks.json from the original files in data/raw/.
// Originals are read-only inputs and are never modified.
// Usage: npm run ingest

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanText } from "./clean.js";
import { chunkDocument, docIdFromFilename } from "./chunk.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const RAW_DIR = path.join(ROOT, "data/raw");
export const OUT_FILE = path.join(ROOT, "data/processed/chunks.json");

export function ingestText({ fileName, raw, title }) {
  const text = cleanText(raw);
  const docId = docIdFromFilename(fileName);
  const docTitle = title || text.split("\n").find((l) => l.trim()) || fileName;
  return chunkDocument({ docId, docTitle: docTitle.slice(0, 160), sourceFile: fileName, text });
}

export async function ingestDirectory(dir = RAW_DIR) {
  const files = (await readdir(dir)).filter((f) => /\.(txt|md)$/i.test(f)).sort();
  const chunks = [];
  const docs = [];
  for (const f of files) {
    const docChunks = ingestText({ fileName: f, raw: await readFile(path.join(dir, f), "utf8") });
    docs.push({ docId: docChunks[0]?.docId ?? docIdFromFilename(f), file: f, chunks: docChunks.length });
    chunks.push(...docChunks);
  }
  return { docs, chunks };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { docs, chunks } = await ingestDirectory();
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({ builtAt: new Date().toISOString(), docs, chunks }, null, 2));
  console.table(docs);
  console.log(`Wrote ${chunks.length} chunks from ${docs.length} documents to ${path.relative(ROOT, OUT_FILE)}`);
}
