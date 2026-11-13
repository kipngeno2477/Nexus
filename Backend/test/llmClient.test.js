import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createLlmClient } from "../src/llm/client.js";

// Fake OpenAI-compatible server. Behaviour is chosen per model id.
let server;
let baseUrl;
const requests = [];

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const j = JSON.parse(body);
      requests.push({ auth: req.headers.authorization, ...j });
      const reply = (status, obj) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      const ok = () => reply(200, { model: j.model, choices: [{ message: { content: '{"verdict":"answered"}' } }], usage: { total_tokens: 5 } });
      switch (j.model) {
        case "good": return ok();
        case "withdrawn": return reply(404, { error: { message: "The model `withdrawn` does not exist", code: "model_not_found" } });
        case "busy": return reply(429, { error: { message: "rate limited" } });
        case "no-schema":
          if (j.response_format.type === "json_schema") return reply(400, { error: { message: "response_format json_schema is not supported" } });
          return ok();
        case "bad-request": return reply(400, { error: { message: "messages: too long" } });
        case "slow": return setTimeout(ok, 500);
        default: return reply(500, { error: { message: "boom" } });
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const client = (over) =>
  createLlmClient({ provider: "openai_compatible", baseUrl, apiKey: "test-key", timeoutMs: 2000, maxTokens: 50, ...over });
const MSG = [{ role: "user", content: "hi" }];

test("primary model: schema request, auth header, reasoning_effort sent", async () => {
  requests.length = 0;
  const out = await client({ model: "good", reasoningEffort: "none" }).chat(MSG, { schema: { type: "object" } });
  assert.equal(out.model, "good");
  assert.equal(requests[0].auth, "Bearer test-key");
  assert.equal(requests[0].response_format.type, "json_schema");
  assert.equal(requests[0].reasoning_effort, "none");
  assert.equal(requests[0].temperature, 0);
});

test("withdrawn primary → fallback used once, without reasoning_effort", async () => {
  requests.length = 0;
  const out = await client({ model: "withdrawn", fallbackModel: "good", reasoningEffort: "none" }).chat(MSG, { schema: {} });
  assert.equal(out.model, "good");
  assert.match(out.fallbackFrom.error, /does not exist/);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].reasoning_effort, undefined);
});

test("rate-limited primary → fallback", async () => {
  const out = await client({ model: "busy", fallbackModel: "good" }).chat(MSG, { schema: {} });
  assert.equal(out.model, "good");
});

test("no fallback configured → typed retryable error", async () => {
  await assert.rejects(client({ model: "busy" }).chat(MSG), (e) => e.kind === "rate_limited" && e.retryable);
});

test("both models failing → error from fallback, only 2 calls", async () => {
  requests.length = 0;
  await assert.rejects(client({ model: "busy", fallbackModel: "broken" }).chat(MSG), (e) => e.status === 500);
  assert.equal(requests.length, 2);
});

test("model without json_schema support downgrades once to json_object", async () => {
  requests.length = 0;
  const out = await client({ model: "no-schema" }).chat(MSG, { schema: { type: "object" } });
  assert.equal(out.model, "no-schema");
  assert.deepEqual(requests.map((r) => r.response_format.type), ["json_schema", "json_object"]);
});

test("ordinary 400 is not retried or sent to fallback", async () => {
  requests.length = 0;
  await assert.rejects(client({ model: "bad-request", fallbackModel: "good" }).chat(MSG), (e) => e.status === 400 && !e.retryable);
  assert.equal(requests.length, 1);
});

test("timeout is a retryable error", async () => {
  await assert.rejects(client({ model: "slow", timeoutMs: 100 }).chat(MSG), (e) => e.kind === "timeout" && e.retryable);
});

test("unreachable endpoint is a retryable 'unavailable' error", async () => {
  const c = createLlmClient({ provider: "openai_compatible", baseUrl: "http://127.0.0.1:1", model: "x", timeoutMs: 1000 });
  await assert.rejects(c.chat(MSG), (e) => e.kind === "unavailable" && e.retryable);
});

test("missing model is not_configured", async () => {
  await assert.rejects(client({ model: "" }).chat(MSG), (e) => e.kind === "not_configured");
});
