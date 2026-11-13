import { kb } from "../src/kb.js";
import { llm } from "../src/llm/instance.js";
import { answerQuestion } from "../src/pipeline/answer.js";
import { LlmError } from "../src/llm/client.js";

const MIN_SCORE = Number(process.env.RETRIEVAL_MIN_SCORE ?? 1);
const MIN_COVERAGE = Number(process.env.RETRIEVAL_MIN_COVERAGE ?? 0.6);
const DEMO_FAILURES = process.env.DEMO_FAILURES === "true";

// Deliberately broken model used only for the failure-handling demo.
const downLlm = {
  async chat() {
    throw new LlmError("unavailable", "Simulated model outage (demo)", { retryable: true });
  },
};

export async function ask(req, res) {
  const { question, k } = req.body ?? {};
  const simulate = DEMO_FAILURES ? req.query.simulate : undefined;

  const index =
    simulate === "retrieval"
      ? { chunks: kb.chunks, score() { throw new Error("Simulated retrieval outage (demo)"); } }
      : kb.index;

  const result = await answerQuestion(
    { question, k },
    { index, llm: simulate === "model" ? downLlm : llm, minScore: MIN_SCORE, minCoverage: MIN_COVERAGE }
  );
  const { httpStatus, ...body } = result;
  res.status(httpStatus).json(body);
}

export async function health(req, res) {
  const model = await llm.health();
  res.json({
    ok: !kb.error && kb.chunks.length > 0 && model.ok,
    knowledgeBase: { ok: !kb.error, error: kb.error, docs: kb.docs.length, chunks: kb.chunks.length, loadedAt: kb.loadedAt },
    model,
    demoFailures: DEMO_FAILURES,
  });
}
