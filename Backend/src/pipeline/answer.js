// Fixed, bounded workflow:  VALIDATE → RETRIEVE → GATE → SYNTHESIZE → VERIFY → DONE
// Control flow is decided by code, never by the model. The model's only job is to write
// claims from the supplied evidence. Every loop is bounded by explicit counters and a
// global step budget; every path ends in a DONE status.

import { topK } from "../retrieval/topK.js";
import { InvalidKError } from "../retrieval/candidates.js";
import { LlmError } from "../llm/client.js";
import { ANSWER_SCHEMA, buildMessages, buildRepairMessages, evidenceTag } from "./prompt.js";
import { parseModelOutput, verifyCitations, OutputFormatError } from "./verify.js";

export const LIMITS = Object.freeze({
  maxSteps: 10,
  maxLlmAttempts: 2,   // attempts per synthesis for transient errors (timeout / 5xx / 429 / unreachable)
  maxRepairs: 1,       // one re-ask if the model returns malformed JSON
  maxQuestionChars: 500,
  maxK: 10,
  defaultK: 4,
  backoffMs: 500,
  maxRetryWaitMs: 8000, // longest provider-suggested wait we accept before giving up
  excerptChars: 700,
  maxCrossRefs: 1,     // extra chunks added by following "section N" references
});

export const STATUS = Object.freeze({
  answered: 200,
  insufficient_evidence: 200,
  conflicting_evidence: 200,
  invalid_input: 400,
  model_unavailable: 503,
  retrieval_error: 500,
  step_budget_exceeded: 500,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STEPS = {
  VALIDATE(ctx) {
    const q = typeof ctx.input.question === "string" ? ctx.input.question.trim() : "";
    if (!q) return fail(ctx, "invalid_input", "Question is required.");
    if (q.length > ctx.limits.maxQuestionChars)
      return fail(ctx, "invalid_input", `Question must be at most ${ctx.limits.maxQuestionChars} characters.`);
    const k = ctx.input.k ?? ctx.limits.defaultK;
    if (!Number.isInteger(k) || k < 1 || k > ctx.limits.maxK)
      return fail(ctx, "invalid_input", `k must be an integer between 1 and ${ctx.limits.maxK}.`);
    // Optional document filter: [] / undefined = search everything.
    const ids = ctx.input.docIds;
    if (ids != null && !(Array.isArray(ids) && ids.length <= 20 && ids.every((d) => typeof d === "string" && d.length > 0 && d.length <= 100)))
      return fail(ctx, "invalid_input", "docIds must be an array of at most 20 document ids.");
    if (ids?.length) {
      const known = new Set(ctx.deps.index.chunks.map((c) => c.docId));
      const unknown = ids.filter((d) => !known.has(d));
      if (unknown.length) return fail(ctx, "invalid_input", `Unknown document id(s): ${unknown.join(", ")}`);
      ctx.docFilter = new Set(ids);
    }
    ctx.question = q;
    ctx.k = k;
    return "RETRIEVE";
  },

  RETRIEVE(ctx) {
    try {
      const t0 = performance.now();
      const scored = ctx.deps.index.score(ctx.question);
      const { queryTerms } = scored;
      const candidates = ctx.docFilter ? scored.candidates.filter((c) => ctx.docFilter.has(c.docId)) : scored.candidates;
      const t1 = performance.now();
      const sel = topK(candidates, ctx.k);
      const t2 = performance.now();
      const crossRefs = followCrossReferences(sel.results, candidates, ctx.deps.index.chunks, ctx.limits.maxCrossRefs);
      ctx.evidence = [...sel.results, ...crossRefs.added];
      ctx.retrieval = {
        method: "bm25 + bounded min-heap top-K",
        queryTerms,
        corpusChunks: ctx.deps.index.chunks.length,
        candidates: candidates.length,
        docFilter: ctx.docFilter ? [...ctx.docFilter] : null,
        requestedK: sel.requestedK,
        returned: sel.returned,
        insufficient: sel.insufficient,
        rejected: sel.rejected,
        heapReplacements: sel.replacements,
        crossRefs: crossRefs.trace,
        scoreMs: +(t1 - t0).toFixed(3),
        selectMs: +(t2 - t1).toFixed(3),
      };
      return "GATE";
    } catch (e) {
      if (e instanceof InvalidKError) return fail(ctx, "invalid_input", e.message);
      return fail(ctx, "retrieval_error", `Retrieval failed: ${e.message}`);
    }
  },

  GATE(ctx) {
    const best = ctx.evidence[0]?.score ?? 0;
    const cov = ctx.deps.index.coverage?.(ctx.question, ctx.evidence) ?? { ratio: 1, uncovered: [] };
    if (ctx.retrieval) ctx.retrieval.coverage = cov;
    const lowCoverage = cov.ratio < ctx.deps.minCoverage;
    if (ctx.evidence.length === 0 || best < ctx.deps.minScore || lowCoverage) {
      ctx.result = {
        verdict: "insufficient_evidence",
        claims: [],
        conflicts: [],
        unsupported: [],
        missing:
          ctx.evidence.length === 0
            ? "No passage in the knowledge base matches this question."
            : "The closest passages are only weakly related to this question.",
        warnings: [
          {
            code: "retrieval_gate",
            detail: lowCoverage
              ? `Only ${cov.covered}/${cov.total} question terms found in the evidence (missing: ${cov.uncovered.join(", ")}); model not called.`
              : `Best score ${best.toFixed(2)} below threshold ${ctx.deps.minScore}; model not called.`,
          },
        ],
      };
      return "DONE:insufficient_evidence";
    }
    return "SYNTHESIZE";
  },

  async SYNTHESIZE(ctx) {
    const messages = ctx.repairOf
      ? buildRepairMessages(ctx.question, ctx.evidence, ctx.repairOf.content, ctx.repairOf.problem)
      : buildMessages(ctx.question, ctx.evidence);
    for (let attempt = 1; attempt <= ctx.limits.maxLlmAttempts; attempt++) {
      ctx.counters.llmCalls++;
      try {
        const t0 = performance.now();
        const out = await ctx.deps.llm.chat(messages, { schema: ANSWER_SCHEMA });
        ctx.llm = { model: out.model, usage: out.usage, ms: Math.round(performance.now() - t0), ...(out.fallbackFrom ? { fallbackFrom: out.fallbackFrom } : {}) };
        ctx.raw = out.content;
        return "VERIFY";
      } catch (e) {
        const err = e instanceof LlmError ? e : new LlmError("unavailable", e.message);
        ctx.llmErrors.push({ attempt, kind: err.kind, message: err.message });
        if (!err.retryable || attempt === ctx.limits.maxLlmAttempts) break;
        // honour the provider's suggested wait (bounded), else exponential backoff
        const wait = err.retryAfterMs ? Math.min(err.retryAfterMs + 250, ctx.limits.maxRetryWaitMs) : ctx.limits.backoffMs * 2 ** (attempt - 1);
        if (err.retryAfterMs && err.retryAfterMs > ctx.limits.maxRetryWaitMs) break; // too long to keep the user waiting
        await sleep(wait);
      }
    }
    const rateLimited = ctx.llmErrors.at(-1)?.kind === "rate_limited";
    return fail(
      ctx,
      "model_unavailable",
      rateLimited
        ? "The answer service is busy (free-tier rate limit). Try again in a few seconds. Meanwhile, here are the retrieved source passages."
        : "The language model is unavailable. Showing the retrieved source passages without a generated answer."
    );
  },

  VERIFY(ctx) {
    let parsed;
    try {
      parsed = parseModelOutput(ctx.raw);
    } catch (e) {
      if (!(e instanceof OutputFormatError)) throw e;
      if (ctx.counters.repairs < ctx.limits.maxRepairs) {
        ctx.counters.repairs++;
        ctx.repairOf = { content: ctx.raw, problem: e.message };
        ctx.repairReasons.push({ problem: e.message, model: ctx.llm?.model, head: String(ctx.raw ?? "").slice(0, 160) });
        return "SYNTHESIZE";
      }
      return fail(ctx, "model_unavailable", `Model output was invalid after ${ctx.limits.maxRepairs} repair attempt(s). Showing source passages only.`);
    }
    // Self-contradiction ("answered" with no claims): one bounded re-ask, else fall through to abstain.
    if (parsed.verdict === "answered" && parsed.claims.length === 0 && ctx.counters.repairs < ctx.limits.maxRepairs) {
      const problem = 'verdict was "answered" but "claims" was empty; put each supported fact in "claims" with its evidence tags';
      ctx.counters.repairs++;
      ctx.repairOf = { content: ctx.raw, problem };
      ctx.repairReasons.push({ problem, model: ctx.llm?.model, head: String(ctx.raw ?? "").slice(0, 160) });
      return "SYNTHESIZE";
    }
    ctx.result = verifyCitations(parsed, ctx.evidence);
    return `DONE:${ctx.result.verdict}`;
  },
};

/**
 * Bounded cross-reference expansion. Legal text points elsewhere ("exempted under section 6").
 * If >= 2 selected chunks reference the same section of their own document and that section is
 * not already selected, add its best-scoring chunk (or its first chunk if it did not score).
 * Adds at most `max` chunks; the heap's top-K selection is unchanged.
 */
export function followCrossReferences(selected, candidates, allChunks, max = 1) {
  const trace = [];
  if (!max || selected.length === 0) return { added: [], trace };
  const have = new Set(selected.map((c) => `${c.docId}|${c.sectionId}`));
  const refs = new Map(); // "docId|sN" -> Set(chunkId)
  for (const c of selected) {
    for (const m of c.text.matchAll(/\bsections?\s+(\d{1,3}[A-Z]?)\b/gi)) {
      const key = `${c.docId}|s${m[1].toLowerCase()}`;
      if (have.has(key)) continue;
      if (!refs.has(key)) refs.set(key, new Set());
      refs.get(key).add(c.chunkId);
    }
  }
  const ranked = [...refs.entries()].filter(([, from]) => from.size >= 2).sort((a, b) => b[1].size - a[1].size || (a[0] < b[0] ? -1 : 1));
  const added = [];
  for (const [key, from] of ranked) {
    if (added.length >= max) break;
    const [docId, sectionId] = key.split("|");
    // "section 6" points at the start of the section, where its main provision is
    const first = allChunks.filter((c) => c.docId === docId && c.sectionId === sectionId).sort((a, b) => (a.chunkId < b.chunkId ? -1 : 1))[0];
    if (!first) continue; // reference to a section that does not exist in the corpus
    const scored = candidates.find((c) => c.docId === docId && c.chunkId === first.chunkId);
    const chunk = { ...first, score: scored?.score ?? 0 };
    added.push({ ...chunk, crossRef: { from: [...from] } });
    trace.push({ docId, sectionId, chunkId: chunk.chunkId, referencedBy: [...from] });
  }
  return { added, trace };
}

function fail(ctx, status, message) {
  ctx.error = { status, message };
  return `DONE:${status}`;
}

/**
 * @param {{question:string, k?:number}} input
 * @param {{index: import("../retrieval/bm25.js").BM25Index, llm: {chat:Function}, minScore?: number}} deps
 */
export async function answerQuestion(input, deps, limits = LIMITS) {
  const ctx = {
    input: input ?? {},
    deps: { minScore: 0, minCoverage: 0, ...deps },
    limits,
    evidence: [],
    counters: { llmCalls: 0, repairs: 0 },
    llmErrors: [],
    repairReasons: [],
    trace: [],
  };
  const started = performance.now();
  let state = "VALIDATE";
  let done = null;

  for (let step = 0; step < limits.maxSteps; step++) {
    const t0 = performance.now();
    const next = await STEPS[state](ctx);
    ctx.trace.push({ step: step + 1, state, next, ms: +(performance.now() - t0).toFixed(2) });
    if (next.startsWith("DONE:")) {
      done = next.slice(5);
      break;
    }
    state = next;
  }
  if (!done) done = fail(ctx, "step_budget_exceeded", "Workflow stopped: step budget exceeded.").slice(5);

  return formatResponse(ctx, done, performance.now() - started);
}

function excerpt(text, n) {
  return text.length <= n ? text : `${text.slice(0, n).replace(/\s+\S*$/, "")} …`;
}

function citationFor(chunk, tagIndex, limits) {
  return {
    ref: tagIndex + 1,
    tag: evidenceTag(tagIndex),
    docId: chunk.docId,
    docTitle: chunk.docTitle,
    part: chunk.part ?? null,
    sectionId: chunk.sectionId,
    sectionTitle: chunk.sectionTitle,
    chunkId: chunk.chunkId,
    sourceFile: chunk.sourceFile,
    sourceUrl: chunk.sourceUrl ?? null,
    private: !!chunk.private, // from the user's own uploaded document
    crossRef: chunk.crossRef ?? null, // added because selected passages reference this section
    score: +chunk.score.toFixed(4),
    excerpt: excerpt(chunk.text, limits.excerptChars),
  };
}

function formatResponse(ctx, status, totalMs) {
  const evidence = ctx.evidence.map((c, i) => citationFor(c, i, ctx.limits));
  const r = ctx.result;
  const tagIndex = (t) => Number(t.slice(1)) - 1;

  const answer = (r?.claims ?? []).map((c) => ({ text: c.text, refs: c.tags.map((t) => tagIndex(t) + 1), lowOverlap: !!c.lowOverlap }));
  const citedRefs = new Set([...answer.flatMap((a) => a.refs), ...(r?.conflicts ?? []).flatMap((c) => c.tags.map((t) => tagIndex(t) + 1))]);
  const warnings = [...(r?.warnings ?? [])];
  if (ctx.retrieval?.insufficient && ctx.evidence.length > 0)
    warnings.push({ code: "fewer_than_k", detail: `Only ${ctx.retrieval.returned} of ${ctx.retrieval.requestedK} requested passages matched.` });

  const messages = {
    answered: null,
    insufficient_evidence: r?.missing || "The documents do not contain enough information to answer this question.",
    conflicting_evidence: "The source passages disagree on this question. See the conflicts listed.",
  };

  return {
    status,
    httpStatus: STATUS[status] ?? 500,
    question: ctx.question ?? ctx.input.question ?? null,
    message: ctx.error?.message ?? messages[status] ?? null,
    answer,
    answerText: answer.map((a) => `${a.text} ${a.refs.map((n) => `[${n}]`).join("")}`).join(" "),
    citations: evidence.filter((e) => citedRefs.has(e.ref)),
    conflicts: (r?.conflicts ?? []).map((c) => ({ description: c.description, refs: c.tags.map((t) => tagIndex(t) + 1) })),
    missing: r?.missing || null,
    unsupported: r?.unsupported ?? [],
    warnings,
    evidence, // all selected top-K passages (shown as raw excerpts when the model is unavailable)
    debug: {
      retrieval: ctx.retrieval ?? null,
      llm: { ...(ctx.llm ?? {}), calls: ctx.counters.llmCalls, repairs: ctx.counters.repairs, repairReasons: ctx.repairReasons, errors: ctx.llmErrors },
      trace: ctx.trace,
      limits: ctx.limits,
      totalMs: Math.round(totalMs),
    },
  };
}
