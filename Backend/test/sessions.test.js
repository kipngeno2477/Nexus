import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionStore } from "../src/sessions.js";
import { BM25Index } from "../src/retrieval/bm25.js";
import { ingestText } from "../src/ingest/ingest.js";
import { answerQuestion, LIMITS } from "../src/pipeline/answer.js";

// Minimal stand-in for the shared knowledge base.
function fakeKb() {
  const chunks = ingestText({ fileName: "shared.txt", raw: "SECTION 1 Licences\nA trading licence is required to trade in a public place." });
  return { chunks, loadedAt: "t0", index: new BM25Index(chunks), hasDoc: (id) => id === "shared" };
}

// Synthetic test document — not a real bylaw.
const WASTE = [
  "SAMPLE COUNTY WASTE BYLAW",
  "Page 1 of 2",
  "SECTION 1 Collection",
  "Household refuse shall be collected every Tuesday.",
  "SAMPLE COUNTY WASTE BYLAW",
  "Page 2 of 2",
  "SECTION 2 Fines",
  "A person who dumps waste in a public place is liable to a fine not exceeding ten thousand shillings.",
  "SAMPLE COUNTY WASTE BYLAW",
  "SAMPLE COUNTY WASTE BYLAW",
].join("\n");

function store(over = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const s = new SessionStore({ kb: fakeKb(), limits: { ttlMs: 60_000, maxSessions: 3, maxDocsPerSession: 2, maxChars: 5_000, ...over }, now: clock.now });
  return { s, clock };
}

test("first upload creates a session; doc is private and reported", () => {
  const { s } = store();
  const out = s.addDocument(undefined, { fileName: "waste.txt", text: WASTE });
  assert.ok(SessionStore.isValidId(out.sessionId));
  assert.equal(out.doc.docId, "my-waste");
  assert.equal(out.doc.private, true);
  assert.equal(out.doc.title, "SAMPLE COUNTY WASTE BYLAW");
  assert.equal(out.report.sections, 2);
  assert.ok(s.getChunk(out.sessionId, "my-waste", "s2-c01").private);
});

test("same session keeps adding; duplicate file names get unique ids; per-session limit", () => {
  const { s } = store();
  const { sessionId } = s.addDocument(null, { fileName: "waste.txt", text: WASTE });
  const second = s.addDocument(sessionId, { fileName: "waste.txt", text: WASTE });
  assert.equal(second.sessionId, sessionId);
  assert.equal(second.doc.docId, "my-waste-2");
  assert.throws(() => s.addDocument(sessionId, { fileName: "c.txt", text: "SECTION 1 X\ny z" }), (e) => e.status === 409);
});

test("sessions are isolated from each other", () => {
  const { s } = store();
  const a = s.addDocument(null, { fileName: "waste.txt", text: WASTE });
  const b = s.addDocument(null, { fileName: "other.txt", text: "SECTION 1 Water\nWater is supplied daily." });
  assert.notEqual(a.sessionId, b.sessionId);
  assert.equal(s.getChunk(b.sessionId, "my-waste", "s2-c01"), null, "B cannot read A's document");
  const ids = new Set(s.indexFor(s.get(b.sessionId)).chunks.map((c) => c.docId));
  assert.deepEqual([...ids].sort(), ["my-other", "shared"]);
});

test("combined index: heap ranks private and shared chunks together", () => {
  const { s } = store();
  const { sessionId } = s.addDocument(null, { fileName: "waste.txt", text: WASTE });
  const index = s.indexFor(s.get(sessionId));
  const docIds = new Set(index.score("public place").candidates.map((c) => c.docId));
  assert.ok(docIds.has("shared") && docIds.has("my-waste"));
  assert.equal(s.indexFor(s.get(sessionId)), index, "index cached while nothing changes");
});

test("idle sessions expire; expired id starts a fresh session on next upload", () => {
  const { s, clock } = store();
  const { sessionId } = s.addDocument(null, { fileName: "waste.txt", text: WASTE });
  clock.advance(30_000);
  assert.ok(s.get(sessionId), "activity within TTL keeps it alive");
  clock.advance(61_000);
  assert.equal(s.get(sessionId), null);
  const again = s.addDocument(sessionId, { fileName: "waste.txt", text: WASTE });
  assert.notEqual(again.sessionId, sessionId);
});

test("session cap evicts the least recently used", () => {
  const { s, clock } = store();
  const ids = [];
  for (let i = 0; i < 3; i++) {
    ids.push(s.addDocument(null, { fileName: `d${i}.txt`, text: "SECTION 1 A\nsome words here" }).sessionId);
    clock.advance(10);
  }
  s.get(ids[0]); // touch the oldest so ids[1] becomes LRU
  s.addDocument(null, { fileName: "d3.txt", text: "SECTION 1 A\nsome words here" });
  assert.ok(s.get(ids[0]));
  assert.equal(s.get(ids[1]), null);
  assert.equal(s.sessions.size, 3);
});

test("validation and removal", () => {
  const { s } = store();
  for (const [input, status] of [
    [{ fileName: "x.exe", text: "a" }, 400],
    [{ fileName: "../x.txt/", text: "a" }, 400],
    [{ fileName: "x.txt", text: " " }, 400],
    [{ fileName: "x.txt", text: "a".repeat(5_001) }, 413],
  ]) {
    assert.throws(() => s.addDocument(null, input), (e) => e.status === status);
  }
  assert.equal(s.sessions.size, 0, "failed uploads do not create sessions");
  const { sessionId } = s.addDocument(null, { fileName: "waste.txt", text: WASTE });
  assert.throws(() => s.removeDocument(sessionId, "nope"), (e) => e.status === 404);
  assert.throws(() => s.removeDocument("not-a-uuid", "my-waste"), (e) => e.status === 404);
  s.removeDocument(sessionId, "my-waste");
  assert.deepEqual(s.get(sessionId).docs, []);
});

test("pipeline over a session: citations flag private sources; docIds can target them", async () => {
  const { s } = store();
  const { sessionId } = s.addDocument(null, { fileName: "waste.txt", text: WASTE });
  const llm = {
    async chat() {
      return { content: JSON.stringify({ verdict: "answered", claims: [{ text: "Dumping waste in a public place is liable to a fine not exceeding ten thousand shillings.", evidence: ["E1"] }], missing: "", conflicts: [] }) };
    },
  };
  const r = await answerQuestion({ question: "fine for dumping waste", k: 3, docIds: ["my-waste"] }, { index: s.indexFor(s.get(sessionId)), llm }, LIMITS);
  assert.equal(r.status, "answered");
  assert.equal(r.citations[0].docId, "my-waste");
  assert.equal(r.citations[0].private, true);
  assert.ok(r.evidence.every((e) => e.docId === "my-waste"));
});

test("PDF-origin metadata is validated and kept on private documents", () => {
  const { s } = store();
  const out = s.addDocument(null, { fileName: "waste.txt", text: WASTE, sourceFormat: "pdf", originalName: "C:\\docs\\Waste Bylaw.pdf", pages: 3 });
  assert.equal(out.doc.sourceFormat, "pdf");
  assert.equal(out.doc.originalName, "Waste Bylaw.pdf", "path stripped");
  assert.equal(out.doc.pages, 3);
  const plain = s.addDocument(out.sessionId, { fileName: "other.txt", text: "SECTION 1 Water\nWater is supplied daily." });
  assert.equal(plain.doc.sourceFormat, "text", "defaults to text");
  for (const bad of [{ sourceFormat: "docx" }, { pages: 0 }, { pages: 2.5 }, { originalName: "x".repeat(201) }]) {
    assert.throws(() => s.addDocument(null, { fileName: "b.txt", text: "SECTION 1 A\nwords here", ...bad }), (e) => e.status === 400, JSON.stringify(bad).slice(0, 30));
  }
});
