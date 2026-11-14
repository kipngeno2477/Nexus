import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestWithReport } from "../src/ingest/ingest.js";
import { inferTitle } from "../src/ingest/clean.js";
import { KnowledgeBase } from "../src/kb.js";
import { topK } from "../src/retrieval/topK.js";
import { answerQuestion, LIMITS } from "../src/pipeline/answer.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACT = await readFile(path.join(ROOT, "data/raw/bylaw.txt"), "utf8");

// ---------- Noise robustness on the real document ----------

function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Adds typical scan/export noise WITHOUT changing the words of the law. */
function addNoise(text, seed = 7) {
  const rand = rng(seed);
  const header = "KENYA GAZETTE SUPPLEMENT - ACTS";
  const lines = text.split("\n");
  const out = [];
  let page = 1;
  lines.forEach((line, i) => {
    let l = line;
    // split a long word across lines with a hyphen (only plain alphabetic words)
    if (rand() < 0.08) {
      l = l.replace(/\b([A-Za-z]{5,})([a-z]{4,})\b/, (m, a, b) => `${a}-\n${b}`);
    }
    // ragged spacing and tabs
    if (rand() < 0.2) l = l.replace(/ /g, () => (rand() < 0.15 ? "  \t " : " "));
    if (rand() < 0.1) l = `   ${l}   `;
    // stray control/zero-width characters
    if (rand() < 0.05) l = l.replace(/ /, " ​");
    out.push(l);
    if (i % 25 === 24) {
      out.push("", `Page ${page} of 30`, header, "");
      page++;
    }
  });
  return "﻿" + header + "\r\n" + out.join("\r\n");
}

const norm = (s) => s.replace(/\s+/g, " ").trim();

test("noisy copy of the real Act ingests to the same sections and text", () => {
  const clean = ingestWithReport({ fileName: "act.txt", raw: ACT, title: "Act" });
  const noisy = ingestWithReport({ fileName: "act.txt", raw: addNoise(ACT), title: "Act" });

  assert.ok(noisy.report.pageNumbersRemoved >= 20, "page numbers removed");
  assert.ok(noisy.report.repeatedLinesRemoved >= 20, "running headers removed");
  assert.ok(noisy.report.hyphenationsJoined > 0, "hyphenation repaired");

  const sections = (r) => [...new Set(r.chunks.map((c) => `${c.sectionId}|${c.sectionTitle}`))];
  assert.deepEqual(sections(noisy), sections(clean), "same section structure");
  assert.equal(noisy.chunks.length, clean.chunks.length, "same number of chunks");
  // chunk-by-chunk, with a short message (a full-text diff would be ~50k characters)
  clean.chunks.forEach((c, i) => {
    const a = norm(c.text);
    const b = norm(noisy.chunks[i].text);
    if (a !== b) {
      let p = 0;
      while (a[p] === b[p]) p++;
      assert.fail(`chunk ${c.chunkId} differs at ${p}: clean "${a.slice(p - 30, p + 30)}" vs noisy "${b.slice(p - 30, p + 30)}"`);
    }
    assert.equal(noisy.chunks[i].chunkId, c.chunkId);
  });
});

test("bundled Act: report shows the expected structure", () => {
  const { report } = ingestWithReport({ fileName: "bylaw.txt", raw: ACT, title: "Access to Information Act" });
  assert.equal(report.sectionTitles.filter((t) => /^\d+\./.test(t)).length, 28, "28 numbered sections");
  assert.equal(report.parts.length, 7, "Parts I-VII");
  assert.ok(report.clauseMarkersJoined > 200);
});

test("document with no headings still ingests (as one section) and says so", () => {
  const { chunks, report } = ingestWithReport({ fileName: "notes.txt", raw: "Water is collected on Mondays.\nRefuse bins must be covered at all times." });
  assert.equal(report.headingsDetected, false);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].sectionId, "preamble");
});

test("title inference: running header beats first heading; falls back to file name", () => {
  assert.equal(inferTitle("SAMPLE TOWN BYLAW\r\nPage 1\r\nSECTION 1 Fees\r\n...", "x.txt"), "SAMPLE TOWN BYLAW");
  assert.equal(inferTitle("Page 1 of 3\nSECTION 1 Fees\nThe fee is...", "county-waste_bylaw.txt"), "County waste bylaw");
  assert.equal(inferTitle("", "a.txt"), "A");
});

// ---------- Knowledge base: upload, remove, persistence ----------

let dir;
let kb;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "nexus-kb-"));
  await mkdir(path.join(dir, "raw"));
  await writeFile(path.join(dir, "raw", "base.txt"), "SECTION 1 Licences\nA trading licence is required to trade in a public place.\n");
  kb = new KnowledgeBase({ rawDir: path.join(dir, "raw"), uploadDir: path.join(dir, "uploads") });
  await kb.load();
});
after(() => rm(dir, { recursive: true, force: true }));

const WASTE = [
  "SAMPLE COUNTY WASTE BYLAW",
  "Page 1 of 2",
  "SECTION 1 Collection days",
  "Household refuse shall be collected every Tues-",
  "day and Friday by the county.",
  "SAMPLE COUNTY WASTE BYLAW",
  "Page 2 of 2",
  "SECTION 2 Fines",
  "A person who dumps waste in a public place commits an offence and is liable to a fine not exceeding ten thousand shillings.",
  "SAMPLE COUNTY WASTE BYLAW",
  "SAMPLE COUNTY WASTE BYLAW",
].join("\r\n");

test("upload: original stored unmodified, report returned, chunks searchable", async () => {
  const { doc, report } = await kb.addDocument({ fileName: "waste.txt", text: WASTE });
  assert.equal(doc.docId, "waste");
  assert.equal(doc.title, "SAMPLE COUNTY WASTE BYLAW");
  assert.equal(report.sections, 2);
  assert.equal(report.pageNumbersRemoved, 2);
  assert.equal(report.repeatedLinesRemoved, 4);
  assert.equal(report.hyphenationsJoined, 1);
  assert.equal(await readFile(path.join(dir, "uploads", "waste.txt"), "utf8"), WASTE, "original preserved byte-for-byte");

  const { results } = topK(kb.index.score("fine for dumping waste").candidates, 1);
  assert.equal(results[0].docId, "waste");
  assert.equal(results[0].sectionId, "s2");
  assert.ok(kb.getChunk("waste", "s1-c01").text.includes("Tuesday"), "hyphenation repaired in chunk text");
});

test("upload validation", async () => {
  const bad = [
    [{ fileName: "../../etc/passwd", text: "x" }, 400],
    [{ fileName: "evil.exe", text: "x" }, 400],
    [{ fileName: "empty.txt", text: "   " }, 400],
    [{ fileName: "big.txt", text: "a ".repeat(500_000) }, 413],
    [{ fileName: "waste.txt", text: "SECTION 1 X\nduplicate id" }, 409],
    [{ fileName: "t.txt", text: "x y z", title: 42 }, 400],
  ];
  for (const [input, status] of bad) {
    await assert.rejects(kb.addDocument(input), (e) => e.status === status, `${input.fileName} → ${status}`);
  }
});

test("uploaded doc and its title survive a restart", async () => {
  await kb.addDocument({ fileName: "water.txt", text: "SECTION 1 Supply\nWater is supplied daily.", title: "Water Services Bylaw" });
  const fresh = new KnowledgeBase({ rawDir: path.join(dir, "raw"), uploadDir: path.join(dir, "uploads") });
  await fresh.load();
  const doc = fresh.docs.find((d) => d.docId === "water");
  assert.equal(doc.title, "Water Services Bylaw");
  assert.equal(doc.uploaded, true);
  assert.ok(fresh.hasDoc("waste"));
});

test("remove: uploaded doc removed from index and disk; bundled doc protected", async () => {
  await assert.rejects(kb.removeDocument("base"), (e) => e.status === 403);
  await assert.rejects(kb.removeDocument("nope"), (e) => e.status === 404);
  await kb.removeDocument("water");
  assert.equal(kb.hasDoc("water"), false);
  assert.equal(kb.chunks.some((c) => c.docId === "water"), false);
  assert.ok(!(await readdir(path.join(dir, "uploads"))).includes("water.txt"));
  const manifest = JSON.parse(await readFile(path.join(dir, "uploads", "_uploads.json"), "utf8"));
  assert.equal(manifest["water.txt"], undefined);
});

// ---------- Document filter in the pipeline ----------

test("docIds filter restricts retrieval to the chosen documents", async () => {
  const llm = { async chat() { return { content: JSON.stringify({ verdict: "insufficient_evidence", claims: [], missing: "n/a", conflicts: [] }) }; } };
  const deps = { index: kb.index, llm };
  const all = await answerQuestion({ question: "public place", k: 4 }, deps, LIMITS);
  assert.deepEqual([...new Set(all.evidence.map((e) => e.docId))].sort(), ["base", "waste"]);

  const onlyWaste = await answerQuestion({ question: "public place", k: 4, docIds: ["waste"] }, deps, LIMITS);
  assert.ok(onlyWaste.evidence.length > 0);
  assert.ok(onlyWaste.evidence.every((e) => e.docId === "waste"));
  assert.deepEqual(onlyWaste.debug.retrieval.docFilter, ["waste"]);

  for (const docIds of [["nope"], "waste", [1], Array(21).fill("waste")]) {
    const r = await answerQuestion({ question: "public place", k: 4, docIds }, deps, LIMITS);
    assert.equal(r.status, "invalid_input", JSON.stringify(docIds).slice(0, 30));
  }
});

test("shared upload keeps PDF-origin metadata across a restart", async () => {
  const { doc } = await kb.addDocument({ fileName: "roads.txt", text: "SECTION 1 Roads\nRoads are maintained by the county.", sourceFormat: "pdf", originalName: "Roads Act.pdf", pages: 2 });
  assert.equal(doc.sourceFormat, "pdf");
  const fresh = new KnowledgeBase({ rawDir: path.join(dir, "raw"), uploadDir: path.join(dir, "uploads") });
  await fresh.load();
  const again = fresh.docs.find((d) => d.docId === "roads");
  assert.equal(again.sourceFormat, "pdf");
  assert.equal(again.originalName, "Roads Act.pdf");
  await assert.rejects(kb.addDocument({ fileName: "x.txt", text: "SECTION 1 A\nb", sourceFormat: "exe" }), (e) => e.status === 400);
});
