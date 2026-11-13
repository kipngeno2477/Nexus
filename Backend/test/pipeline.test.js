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

test("cross-reference: section referenced by >=2 selected chunks is added once", async () => {
  const { followCrossReferences } = await import("../src/pipeline/answer.js");
  const mk = (sectionId, chunkId, text, score) => ({ docId: "d", sectionId, chunkId, text, score });
  const selected = [mk("s2", "s2-c01", "exempt information is withheld under section 6", 5), mk("s4", "s4-c01", "only as exempted under section 6 and section 9", 4)];
  const candidates = [...selected, mk("s6", "s6-c02", "limitation text", 1), mk("s6", "s6-c01", "limitation list", 3), mk("s9", "s9-c01", "x", 2)];
  const all = candidates;
  const { added, trace } = followCrossReferences(selected, candidates, all, 1);
  assert.deepEqual(added.map((c) => c.chunkId), ["s6-c01"], "first chunk of section 6 (start of the provision); s9 referenced once only");
  assert.deepEqual(trace[0].referencedBy.sort(), ["s2-c01", "s4-c01"]);
  assert.equal(followCrossReferences(selected, candidates, all, 0).added.length, 0, "disabled when max = 0");
  const noTarget = followCrossReferences(selected, selected, selected, 1);
  assert.equal(noTarget.added.length, 0, "reference to a section not in the corpus adds nothing");
});

test("numbers in a claim must appear in the cited passage", async () => {
  const { numbersNotInSource } = await import("../src/pipeline/verify.js");
  const src = "a fine not exceeding five hundred thousand shillings or imprisonment for 1 year; within twenty-one days";
  assert.deepEqual(numbersNotInSource("fine of up to five hundred thousand shillings within twenty-one days, 1 year", src), []);
  assert.deepEqual(numbersNotInSource("within 30 days", src), ["30"]);
  assert.deepEqual(numbersNotInSource("a fine of one million shillings", src), ["one million"]);
  const llm = mockLlm({ verdict: "answered", claims: [{ text: "The trading licence fee is 750 shillings per year.", evidence: ["E1"] }], missing: "", conflicts: [] });
  const r = await run({ question: "trading licence fee", k: 1 }, llm);
  assert.ok(r.warnings.some((w) => w.code === "number_not_in_source" && /750/.test(w.detail)));
  assert.equal(r.answer[0].lowOverlap, true);
});

test("'answered' with no claims triggers one re-ask, then abstains if still empty", async () => {
  const empty = { verdict: "answered", claims: [], missing: "facts are listed here instead", conflicts: [] };
  const good = { verdict: "answered", claims: [{ text: "A trading licence is required.", evidence: ["E1"] }], missing: "", conflicts: [] };
  const fixed = await run({ question: "trading licence", k: 1 }, mockLlm(empty, good));
  assert.equal(fixed.status, "answered");
  assert.equal(fixed.debug.llm.repairs, 1);
  assert.match(fixed.debug.llm.repairReasons[0].problem, /claims/);

  const llm = mockLlm(empty, empty);
  const still = await run({ question: "trading licence", k: 1 }, llm);
  assert.equal(still.status, "insufficient_evidence");
  assert.equal(llm.calls.length, 2, "bounded: original + one re-ask");
});

test("number found in another passage completes the citation instead of flagging", async () => {
  const llm = mockLlm({
    verdict: "answered",
    claims: [{ text: "The trading licence fee is five hundred shillings per year.", evidence: ["E2"] }],
    missing: "",
    conflicts: [],
  });
  const r = await run({ question: "trading licence fee", k: 3 }, llm);
  const fee = r.citations.find((c) => c.sectionId === "s2");
  assert.ok(fee, "section 2 (five hundred) is cited");
  assert.ok(r.answer[0].refs.includes(fee.ref));
  assert.equal(r.answer[0].lowOverlap, false);
  assert.ok(r.warnings.some((w) => w.code === "citation_completed"));
});

test("missing verdict is inferred from content instead of discarding the answer", async () => {
  const r1 = await run({ question: "trading licence", k: 1 }, mockLlm({ claims: [{ text: "A trading licence is required.", evidence: ["E1"] }], missing: "", conflicts: [] }));
  assert.equal(r1.status, "answered");
  assert.equal(r1.debug.llm.repairs, 0);
  assert.ok(r1.warnings.some((w) => w.code === "verdict_inferred"));
  const r2 = await run({ question: "trading licence fee", k: 3 }, mockLlm({ claims: [], missing: "", conflicts: [{ description: "500 vs 1000", evidence: ["E1", "E2"] }] }));
  assert.equal(r2.status, "conflicting_evidence");
  const r3 = await run({ question: "trading licence", k: 1 }, mockLlm({ verdict: "maybe", claims: [] }, { verdict: "maybe", claims: [] }));
  assert.equal(r3.status, "model_unavailable", "an unknown verdict value is still a format error");
});
