import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText } from "../src/ingest/clean.js";
import { splitSections } from "../src/ingest/chunk.js";
import { ingestText } from "../src/ingest/ingest.js";
import { BM25Index } from "../src/retrieval/bm25.js";
import { topK } from "../src/retrieval/topK.js";

// Synthetic noisy text for tests only — not a real bylaw.
const NOISY = [
  "﻿SAMPLE TOWN BYLAWS",
  "Page 1 of 3",
  "SECTION 1 Interpretation",
  "In these bylaws   \"vendor\" means a person who sells goods in a pub-",
  "lic place.",
  "SAMPLE TOWN BYLAWS",
  "Page 2 of 3",
  "SECTION 2 Trading licences",
  "No person shall trade in a public place without a valid trading licence issued by the council.",
  "SAMPLE TOWN BYLAWS",
  "Page 3 of 3",
  "SECTION 3 Waste disposal",
  "Every occupier shall keep refuse in a covered receptacle until collection.",
  "SAMPLE TOWN BYLAWS",
].join("\r\n");

test("cleanText removes page numbers, repeated headers, joins hyphenation", () => {
  const t = cleanText(NOISY);
  assert.ok(!/Page \d/.test(t));
  assert.ok(!t.includes("SAMPLE TOWN BYLAWS"));
  assert.ok(t.includes("public place"));
  assert.ok(!t.includes("\r"));
});

test("sections are detected", () => {
  const titles = splitSections(cleanText(NOISY)).map((s) => s.title);
  assert.deepEqual(titles, ["SECTION 1 Interpretation", "SECTION 2 Trading licences", "SECTION 3 Waste disposal"]);
});

test("chunks carry identifiers and are unique", () => {
  const chunks = ingestText({ fileName: "Sample Town.txt", raw: NOISY });
  assert.equal(chunks.length, 3);
  for (const ch of chunks) {
    assert.equal(ch.docId, "sample-town");
    assert.ok(ch.sectionId && ch.chunkId && ch.sectionTitle && ch.sourceFile);
  }
  assert.equal(new Set(chunks.map((c) => c.chunkId)).size, chunks.length);
});

test("long sections split into overlapping chunks", () => {
  const body = Array.from({ length: 700 }, (_, i) => `word${i}`).join(" ");
  const chunks = ingestText({ fileName: "long.txt", raw: `SECTION 4 Long\n${body}` });
  // 200-word windows, 40-word overlap → starts at 0,160,320,480,640
  assert.deepEqual(chunks.map((c) => c.chunkId), ["s4-c01", "s4-c02", "s4-c03", "s4-c04", "s4-c05"]);
  assert.ok(chunks.every((c) => c.text.split(" ").length <= 200));
  assert.ok(chunks[1].text.startsWith("word160"), "overlap preserved");
});

test("BM25 + heap retrieve the supporting section", () => {
  const index = new BM25Index(ingestText({ fileName: "sample.txt", raw: NOISY }));
  const { candidates } = index.score("Do I need a licence to trade?");
  const { results } = topK(candidates, 1);
  assert.equal(results[0].sectionId, "s2");
});

test("BM25 returns no candidates for unrelated query", () => {
  const index = new BM25Index(ingestText({ fileName: "sample.txt", raw: NOISY }));
  assert.equal(index.score("spaceship parking fines").candidates.length, 0);
});
