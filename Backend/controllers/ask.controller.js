import { kb } from "../src/kb.js";
import { llm } from "../src/llm/instance.js";
import { answerQuestion } from "../src/pipeline/answer.js";
import { LlmError } from "../src/llm/client.js";
import { sessions, SESSION_HEADER } from "../src/sessionStore.js";

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
  const { question, k, docIds } = req.body ?? {};
  const simulate = DEMO_FAILURES ? req.query.simulate : undefined;

  // A private session searches shared + its own documents through one combined index.
  const session = sessions.get(req.get(SESSION_HEADER));
  const index =
    simulate === "retrieval"
      ? { chunks: kb.chunks, score() { throw new Error("Simulated retrieval outage (demo)"); } }
      : session
        ? sessions.indexFor(session)
        : kb.index;

  const result = await answerQuestion(
    { question, k, docIds },
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
    privateSessions: sessions.stats(),
    model,
    demoFailures: DEMO_FAILURES,
  });
}
