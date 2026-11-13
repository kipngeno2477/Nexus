import { test } from "node:test";
import assert from "node:assert/strict";
import { answerQuestion, LIMITS } from "../src/pipeline/answer.js";
import { BM25Index } from "../src/retrieval/bm25.js";
import { ingestText } from "../src/ingest/ingest.js";
import { LlmError } from "../src/llm/client.js";

// Synthetic test document — not a real law.
const DOC = [
  "SECTION 1 Trading licences",
  "No person shall trade in a public place without a valid trading licence issued by the council.",
  "SECTION 2 Licence fees",
  "The fee for a trading licence is five hundred shillings per year.",
  "SECTION 3 Licence fees amendment",
  "The fee for a trading licence is one thousand shillings per year.",
  "SECTION 4 Waste",
  "Every occupier shall keep refuse in a covered receptacle until collection.",
].join("\n");

const index = new BM25Index(ingestText({ fileName: "test-town.txt", raw: DOC }));
const FAST = { ...LIMITS, backoffMs: 1 };

function mockLlm(...replies) {
  const calls = [];
  return {
    calls,
    async chat(messages) {
      calls.push(messages);
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (r instanceof Error) throw r;
      return { content: typeof r === "string" ? r : JSON.stringify(r), model: "mock" };
    },
  };
}
const run = (input, llm, minScore = 0) => answerQuestion(input, { index, llm, minScore }, FAST);

test("answered with valid citations mapped to full metadata", async () => {
  const llm = mockLlm({ verdict: "answered", claims: [{ text: "You need a valid trading licence issued by the council to trade in a public place.", evidence: ["E1"] }], missing: "", conflicts: [] });
  const r = await run({ question: "Do I need a licence to trade in a public place?", k: 2 }, llm);
  assert.equal(r.status, "answered");
  assert.equal(r.httpStatus, 200);
  assert.equal(r.answer.length, 1);
  assert.equal(r.citations[0].docId, "test-town");
  assert.equal(r.citations[0].sectionId, "s1");
  assert.ok(r.citations[0].excerpt.includes("trading licence"));
  assert.match(r.answerText, /\[1\]$/);
  assert.equal(llm.calls.length, 1);
  assert.ok(llm.calls[0][1].content.includes("[E1]"), "selected heap chunks are what the model sees");
});

test("invented citations are removed; uncited claims are unsupported", async () => {
  const llm = mockLlm({
    verdict: "answered",
    claims: [
      { text: "A trading licence is required.", evidence: ["E1", "E9", "section 99"] },
      { text: "Licences can be renewed online.", evidence: [] },
    ],
    missing: "",
    conflicts: [],
  });
  const r = await run({ question: "trading licence", k: 2 }, llm);
  assert.equal(r.answer.length, 1);
  assert.deepEqual(r.answer[0].refs, [1]);
  assert.equal(r.unsupported.length, 1);
  assert.ok(r.warnings.some((w) => w.code === "invented_citation_removed"));
});

test("sub-clause citation forms resolve to their passage tag", async () => {
  const llm = mockLlm({
    verdict: "answered",
    claims: [{ text: "A trading licence is required to trade in a public place.", evidence: ["E1.2", "[E1]", "E2:", "e1(3)", "E1x", "E"] }],
    missing: "",
    conflicts: [],
  });
  const r = await run({ question: "trading licence", k: 2 }, llm);
  assert.equal(r.status, "answered");
  assert.deepEqual(r.answer[0].refs, [1, 2]);
  const removed = r.warnings.find((w) => w.code === "invented_citation_removed");
  assert.match(removed.detail, /E1x, E$/);
});

test("answer with no supported claims becomes insufficient_evidence", async () => {
  const llm = mockLlm({ verdict: "answered", claims: [{ text: "Made up.", evidence: ["E7"] }], missing: "", conflicts: [] });
  const r = await run({ question: "trading licence", k: 2 }, llm);
  assert.equal(r.status, "insufficient_evidence");
  assert.equal(r.answer.length, 0);
});

test("no matching evidence: gate stops before the model", async () => {
  const llm = mockLlm(new Error("must not be called"));
  const r = await run({ question: "spaceship parking regulations", k: 3 }, llm);
  assert.equal(r.status, "insufficient_evidence");
  assert.equal(llm.calls.length, 0);
  assert.ok(r.warnings.some((w) => w.code === "retrieval_gate"));
});

test("weak evidence below min score: gate stops before the model", async () => {
  const llm = mockLlm(new Error("must not be called"));
  const r = await run({ question: "public place", k: 3 }, llm, 1e9);
  assert.equal(r.status, "insufficient_evidence");
  assert.equal(llm.calls.length, 0);
});

test("model reports insufficient evidence", async () => {
  const llm = mockLlm({ verdict: "insufficient_evidence", claims: [], missing: "The passages do not mention opening hours.", conflicts: [] });
  const r = await run({ question: "What are trading licence opening hours?", k: 2 }, llm);
  assert.equal(r.status, "insufficient_evidence");
  assert.equal(r.message, "The passages do not mention opening hours.");
});

test("conflicting evidence is reported with citations", async () => {
  const llm = mockLlm({
    verdict: "conflicting_evidence",
    claims: [],
    missing: "",
    conflicts: [{ description: "One passage says 500 shillings, another says 1000 shillings.", evidence: ["E1", "E2"] }],
  });
  const r = await run({ question: "What is the trading licence fee?", k: 3 }, llm);
  assert.equal(r.status, "conflicting_evidence");
  assert.deepEqual(r.conflicts[0].refs, [1, 2]);
  assert.equal(r.citations.length, 2);
  const sections = r.citations.map((c) => c.sectionId).sort();
  assert.deepEqual(sections, ["s2", "s3"]);
});

test("invalid input and invalid K", async () => {
  const llm = mockLlm(new Error("must not be called"));
  for (const input of [{}, { question: "" }, { question: "   " }, { question: "x".repeat(501) }, { question: "fee", k: 0 }, { question: "fee", k: 2.5 }, { question: "fee", k: "3" }, { question: "fee", k: 11 }]) {
    const r = await run(input, llm);
    assert.equal(r.status, "invalid_input", JSON.stringify(input).slice(0, 40));
    assert.equal(r.httpStatus, 400);
  }
  assert.equal(llm.calls.length, 0);
});

test("transient model failure is retried once, then succeeds", async () => {
  const ok = { verdict: "answered", claims: [{ text: "A trading licence is required.", evidence: ["E1"] }], missing: "", conflicts: [] };
  const llm = mockLlm(new LlmError("timeout", "t/o", { retryable: true }), ok);
  const r = await run({ question: "trading licence", k: 2 }, llm);
  assert.equal(r.status, "answered");
  assert.equal(r.debug.llm.calls, 2);
});

test("model unavailable after bounded retries returns raw excerpts", async () => {
  const llm = mockLlm(new LlmError("unavailable", "down", { retryable: true }));
  const r = await run({ question: "trading licence", k: 2 }, llm);
  assert.equal(r.status, "model_unavailable");
  assert.equal(r.httpStatus, 503);
  assert.equal(llm.calls.length, LIMITS.maxLlmAttempts);
  assert.ok(r.evidence.length > 0, "retrieved passages still shown");
  assert.equal(r.answer.length, 0);
});

test("non-retryable model error is not retried", async () => {
  const llm = mockLlm(new LlmError("not_configured", "LLM_MODEL is not set"));
  const r = await run({ question: "trading licence", k: 2 }, llm);
  assert.equal(r.status, "model_unavailable");
  assert.equal(llm.calls.length, 1);
});

test("malformed JSON: one repair, then success", async () => {
  const ok = { verdict: "answered", claims: [{ text: "A trading licence is required.", evidence: ["E1"] }], missing: "", conflicts: [] };
  const llm = mockLlm("Sure! Here is the answer: licence needed", ok);
  const r = await run({ question: "trading licence", k: 2 }, llm);
  assert.equal(r.status, "answered");
  assert.equal(r.debug.llm.repairs, 1);
  assert.ok(llm.calls[1].at(-1).content.includes("previous reply was invalid"));
});

test("malformed JSON twice: stops after bounded repair", async () => {
  const llm = mockLlm("nope", "still nope");
  const r = await run({ question: "trading licence", k: 2 }, llm);
  assert.equal(r.status, "model_unavailable");
  assert.equal(llm.calls.length, 2);
  assert.ok(r.debug.trace.length <= LIMITS.maxSteps);
});

test("retrieval failure is reported explicitly", async () => {
  const broken = { chunks: [], score() { throw new Error("index offline"); } };
  const r = await answerQuestion({ question: "fee", k: 2 }, { index: broken, llm: mockLlm() }, FAST);
  assert.equal(r.status, "retrieval_error");
  assert.equal(r.httpStatus, 500);
});

test("trace records the fixed workflow", async () => {
  const llm = mockLlm({ verdict: "answered", claims: [{ text: "A trading licence is required.", evidence: ["E1"] }], missing: "", conflicts: [] });
  const r = await run({ question: "trading licence", k: 2 }, llm);
  assert.deepEqual(r.debug.trace.map((t) => t.state), ["VALIDATE", "RETRIEVE", "GATE", "SYNTHESIZE", "VERIFY"]);
  assert.equal(r.debug.retrieval.method, "bm25 + bounded min-heap top-K");
});
