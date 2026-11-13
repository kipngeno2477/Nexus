import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { RateLimiter, AnswerCache } from "../src/askGuard.js";
import { createLlmClient, LlmError } from "../src/llm/client.js";
import { answerQuestion, LIMITS } from "../src/pipeline/answer.js";
import { BM25Index } from "../src/retrieval/bm25.js";
import { ingestText } from "../src/ingest/ingest.js";

test("rate limiter: N per window per client, then retry-after; window resets", () => {
  let t = 0;
  const rl = new RateLimiter({ limit: 3, windowMs: 1000, now: () => t });
  assert.deepEqual([1, 2, 3].map(() => rl.take("a").ok), [true, true, true]);
  const blocked = rl.take("a");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterMs, 1000);
  assert.equal(rl.take("b").ok, true, "other clients unaffected");
  t = 1000;
  assert.equal(rl.take("a").ok, true, "new window");
});

test("answer cache: normalised key, TTL, LRU bound, failures never cached", () => {
  let t = 0;
  const c = new AnswerCache({ max: 2, ttlMs: 100, now: () => t });
  const k1 = AnswerCache.key({ question: "  What   is the FEE? ", k: 4, docIds: ["b", "a"], kbVersion: "v1" });
  assert.equal(k1, AnswerCache.key({ question: "what is the fee?", k: 4, docIds: ["a", "b"], kbVersion: "v1" }));
  assert.notEqual(k1, AnswerCache.key({ question: "what is the fee?", k: 4, docIds: ["a", "b"], kbVersion: "v2" }), "KB change invalidates");

  c.set(k1, { status: "answered" });
  assert.deepEqual(c.get(k1), { status: "answered" });
  c.set("x", { status: "model_unavailable" });
  assert.equal(c.get("x"), null, "failures are not cached");
  c.set("m", { status: "insufficient_evidence", debug: { llm: { calls: 1 } } });
  assert.equal(c.get("m"), null, "model abstentions are not cached");
  c.set("k2", { status: "insufficient_evidence", debug: { llm: { calls: 0 } } });
  c.set("k3", { status: "answered" });
  assert.equal(c.map.size, 2);
  t = 101;
  assert.equal(c.get("k3"), null, "expired");
});

test("client: 429 carries retryAfterMs from header or Groq-style body", async () => {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (req.url.includes("header")) {
        res.writeHead(429, { "retry-after": "3", "content-type": "application/json" });
        return res.end("{}");
      }
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Rate limit reached ... Please try again in 2.04s. Need more tokens?" } }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const c1 = createLlmClient({ provider: "openai_compatible", baseUrl: `${base}/header`, model: "m", timeoutMs: 1000 });
    await assert.rejects(c1.chat([]), (e) => e.kind === "rate_limited" && e.retryAfterMs === 3000);
    const c2 = createLlmClient({ provider: "openai_compatible", baseUrl: `${base}/body`, model: "m", timeoutMs: 1000 });
    await assert.rejects(c2.chat([]), (e) => e.kind === "rate_limited" && e.retryAfterMs === 2040);
  } finally {
    server.close();
  }
});

const index = new BM25Index(ingestText({ fileName: "t.txt", raw: "SECTION 1 Licences\nA trading licence is required to trade in a public place." }));
const OK = JSON.stringify({ verdict: "answered", claims: [{ text: "A trading licence is required.", evidence: ["E1"] }], missing: "", conflicts: [] });

test("pipeline waits the provider's retry-after (bounded) and then succeeds", async () => {
  let calls = 0;
  const llm = {
    async chat() {
      if (++calls === 1) throw new LlmError("rate_limited", "busy", { retryable: true, status: 429, retryAfterMs: 120 });
      return { content: OK, model: "m" };
    },
  };
  const t0 = Date.now();
  const r = await answerQuestion({ question: "trading licence", k: 1 }, { index, llm }, { ...LIMITS, maxRetryWaitMs: 1000 });
  assert.equal(r.status, "answered");
  assert.ok(Date.now() - t0 >= 120, "waited at least retry-after");
});

test("pipeline gives up quickly when retry-after is too long, with a busy message", async () => {
  let calls = 0;
  const llm = {
    async chat() {
      calls++;
      throw new LlmError("rate_limited", "busy", { retryable: true, status: 429, retryAfterMs: 60_000 });
    },
  };
  const t0 = Date.now();
  const r = await answerQuestion({ question: "trading licence", k: 1 }, { index, llm }, { ...LIMITS, maxRetryWaitMs: 1000 });
  assert.equal(r.status, "model_unavailable");
  assert.match(r.message, /busy/);
  assert.equal(calls, 1);
  assert.ok(Date.now() - t0 < 500);
  assert.ok(r.evidence.length > 0, "sources still shown");
});
