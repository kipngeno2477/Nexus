// Evaluation runner: retrieval quality, grounded-answer quality and failure handling,
// all through the same pipeline the API uses.
//
// Usage (from Backend/):
//   npm run eval                       full run (retrieval + model + failure scenarios)
//   npm run eval -- --retrieval-only   no model calls (Recall@K, MRR, heap == full sort)
//   npm run eval -- --only=q01,q17     subset of questions
//   npm run eval -- --delay=13000      pause after each model call (free-tier pacing)
//
// Writes eval-results/latest.json and eval-results/latest.md.

import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kb } from "../kb.js";
import { llm } from "../llm/instance.js";
import { LlmError } from "../llm/client.js";
import { answerQuestion, LIMITS } from "../pipeline/answer.js";
import { topK } from "../retrieval/topK.js";
import { fullSortTopK } from "../retrieval/fullSortTopK.js";
import { BM25Index } from "../retrieval/bm25.js";
import { ingestText, ingestWithReport } from "../ingest/ingest.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUT_DIR = path.join(ROOT, "eval-results");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const RETRIEVAL_ONLY = !!args["retrieval-only"];
const DELAY_MS = Number(args.delay ?? 13_000);
const ONLY = args.only ? new Set(String(args.only).split(",")) : null;
const K = Number(args.k ?? LIMITS.defaultK);
const GATE = {
  minScore: Number(process.env.RETRIEVAL_MIN_SCORE ?? 0),
  minCoverage: Number(process.env.RETRIEVAL_MIN_COVERAGE ?? 0.6),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(0)}%` : "n/a");
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const quantile = (xs, q) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const re = (p) => new RegExp(p, "i");

// ---------------- 1. Retrieval (no model) ----------------

function retrievalEval(questions) {
  const ks = [1, 2, 3, 4, 5, 8];
  const answerable = questions.filter((q) => q.expectSections.length);
  const rows = [];
  let heapMismatches = 0;
  for (const q of questions) {
    const { candidates } = kb.index.score(q.question);
    const ranked = fullSortTopK(candidates, Math.max(candidates.length, 1)).results;
    const heap8 = topK(candidates, 8).results;
    const sort8 = fullSortTopK(candidates, 8).results;
    const same = JSON.stringify(heap8) === JSON.stringify(sort8);
    if (!same) heapMismatches++;
    const firstRank = ranked.findIndex((c) => q.expectSections.includes(c.sectionId));
    rows.push({ id: q.id, candidates: candidates.length, firstRank: firstRank >= 0 ? firstRank + 1 : null, heapEqualsSort: same });
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const recallAt = Object.fromEntries(
    ks.map((k) => [k, mean(answerable.map((q) => (byId.get(q.id).firstRank && byId.get(q.id).firstRank <= k ? 1 : 0)))])
  );
  const mrr = mean(answerable.map((q) => (byId.get(q.id).firstRank ? 1 / byId.get(q.id).firstRank : 0)));
  return { rows, recallAt, mrr, heapMismatches, answerable: answerable.length };
}

// ---------------- 2. Full pipeline ----------------

function scoreAnswer(q, r) {
  const text = r.answerText ?? "";
  const statusOk =
    q.expectStatus === "either" ? ["answered", "insufficient_evidence"].includes(r.status) : r.status === q.expectStatus;
  const evidenceSections = r.evidence.map((e) => e.sectionId);
  const heapSections = r.evidence.filter((e) => !e.crossRef).map((e) => e.sectionId);
  const retrievalHit = q.expectSections.length ? q.expectSections.some((s) => evidenceSections.includes(s)) : null;
  const retrievalHitHeapOnly = q.expectSections.length ? q.expectSections.some((s) => heapSections.includes(s)) : null;
  const facts = (q.facts ?? []).map((f) => ({ fact: f, found: re(f).test(text) }));
  const forbidden = (q.forbid ?? []).filter((f) => re(f).test(text));
  const cited = r.citations ?? [];
  const precise = q.acceptableSections.length ? cited.filter((c) => q.acceptableSections.includes(c.sectionId)).length : null;
  const flagged = (r.warnings ?? []).filter((w) => ["number_not_in_source", "low_overlap"].includes(w.code)).length;
  const invented = (r.warnings ?? []).filter((w) => w.code === "invented_citation_removed").length;
  return {
    id: q.id,
    category: q.category,
    question: q.question,
    status: r.status,
    expectStatus: q.expectStatus,
    statusOk,
    retrievalHit,
    retrievalHitHeapOnly,
    crossRefs: r.debug.retrieval?.crossRefs?.length ?? 0,
    facts,
    factRecall: facts.length ? facts.filter((f) => f.found).length / facts.length : null,
    forbidden,
    citations: cited.length,
    citationPrecision: cited.length && precise != null ? precise / cited.length : null,
    claims: r.answer.length,
    unsupportedRemoved: r.unsupported.length,
    flaggedClaims: flagged,
    inventedCitationsRemoved: invented,
    model: r.debug.llm.model ?? null,
    fallback: !!r.debug.llm.fallbackFrom,
    llmCalls: r.debug.llm.calls,
    repairs: r.debug.llm.repairs,
    llmMs: r.debug.llm.ms ?? null,
    totalMs: r.debug.totalMs,
    tokens: r.debug.llm.usage?.total_tokens ?? null,
    answerText: text,
    message: r.message,
  };
}

async function pipelineEval(questions) {
  const results = [];
  for (const [i, q] of questions.entries()) {
    const r = await answerQuestion({ question: q.question, k: K }, { index: kb.index, llm, ...GATE });
    const s = scoreAnswer(q, r);
    results.push(s);
    const mark = s.statusOk && s.factRecall !== 0 && !s.forbidden.length ? "ok " : "!! ";
    console.log(`${mark}${q.id} ${s.status.padEnd(22)} model=${s.model ?? "-"} facts=${s.factRecall == null ? "-" : pct(s.factRecall)} cites=${s.citations} ${s.llmMs ?? 0}ms`);
    if (r.debug.llm.calls > 0 && i < questions.length - 1) await sleep(DELAY_MS);
  }
  return results;
}

// ---------------- 3. Failure scenarios ----------------

const DOWN = { async chat() { throw new LlmError("unavailable", "simulated outage", { retryable: true }); } };
const mock = (...replies) => {
  let n = 0;
  return { async chat() { const r = replies[Math.min(n++, replies.length - 1)]; return { content: typeof r === "string" ? r : JSON.stringify(r), model: "mock" }; } };
};

function noisify(text) {
  const lines = text.split("\n");
  const out = [];
  lines.forEach((l, i) => {
    out.push(i % 7 === 3 ? `  ${l.replace(/ /g, "  \t")}  ` : l);
    if (i % 25 === 24) out.push("", `Page ${Math.floor(i / 25) + 1} of 30`, "KENYA GAZETTE SUPPLEMENT", "");
  });
  return "﻿KENYA GAZETTE SUPPLEMENT\r\n" + out.join("\r\n");
}

async function scenarios() {
  const list = [];
  const add = (name, expected, actual, pass, note = "") => {
    list.push({ name, expected, actual, pass, note });
    console.log(`${pass ? "ok " : "!! "}${name}: ${actual}`);
  };
  const base = { index: kb.index, ...GATE };
  const fast = { ...LIMITS, backoffMs: 1 };

  for (const [label, input] of [
    ["K = 0", { question: "fees", k: 0 }],
    ["K = 11 (above max 10)", { question: "fees", k: 11 }],
    ['K = "3" (string)', { question: "fees", k: "3" }],
    ["K = 2.5", { question: "fees", k: 2.5 }],
    ["empty question", { question: "   " }],
    ["question over 500 chars", { question: "x".repeat(501) }],
    ["unknown docIds", { question: "fees", docIds: ["nope"] }],
  ]) {
    const r = await answerQuestion(input, { ...base, llm: DOWN }, fast);
    add(`invalid input: ${label}`, "invalid_input, no model call", `${r.status}, calls=${r.debug.llm.calls}`, r.status === "invalid_input" && r.debug.llm.calls === 0);
  }

  {
    const r = await answerQuestion({ question: "How do I get a passport?", k: 4 }, { ...base, llm: DOWN }, fast);
    add("empty candidate set (no matching passage)", "insufficient_evidence, model not called", `${r.status}, candidates=${r.debug.retrieval.candidates}, calls=${r.debug.llm.calls}`, r.status === "insufficient_evidence" && r.debug.llm.calls === 0);
  }
  {
    const r = await answerQuestion({ question: "How much does it cost to request information?", k: 4 }, { ...base, llm: DOWN }, fast);
    add("model outage", `model_unavailable after ${LIMITS.maxLlmAttempts} attempts, sources still shown`, `${r.status}, calls=${r.debug.llm.calls}, passages=${r.evidence.length}`, r.status === "model_unavailable" && r.debug.llm.calls === LIMITS.maxLlmAttempts && r.evidence.length > 0);
  }
  {
    const broken = { chunks: kb.chunks, score() { throw new Error("index offline"); } };
    const r = await answerQuestion({ question: "fees", k: 4 }, { ...base, index: broken, llm: DOWN }, fast);
    add("retrieval outage", "retrieval_error", r.status, r.status === "retrieval_error");
  }
  {
    const r = await answerQuestion({ question: "How much does it cost to request information?", k: 4 }, { ...base, llm: mock("not json", "still not json") }, fast);
    add("malformed model output twice", `stops after ${LIMITS.maxRepairs} repair`, `${r.status}, calls=${r.debug.llm.calls}, repairs=${r.debug.llm.repairs}`, r.status === "model_unavailable" && r.debug.llm.repairs === 1 && r.debug.llm.calls === 2);
  }
  {
    const r = await answerQuestion(
      { question: "How much does it cost to request information?", k: 4 },
      { ...base, llm: mock({ verdict: "answered", claims: [{ text: "No fee may be levied for an application.", evidence: ["E1", "E9"] }, { text: "Requests are processed online.", evidence: [] }], missing: "", conflicts: [] }) },
      fast
    );
    add("model invents a citation and an uncited claim", "invented tag removed, uncited claim reported", `cited=${r.answer[0]?.refs.join(",")}, unsupported=${r.unsupported.length}`, r.answer.length === 1 && r.answer[0].refs.join() === "1" && r.unsupported.length === 1);
  }
  {
    const r = await answerQuestion(
      { question: "How much does it cost to request information?", k: 4 },
      { ...base, llm: mock({ verdict: "answered", claims: [{ text: "Applications cost 750 shillings.", evidence: ["E1"] }], missing: "", conflicts: [] }) },
      fast
    );
    add("model states a number not in any passage", "claim flagged number_not_in_source", r.warnings.map((w) => w.code).join(",") || "none", r.warnings.some((w) => w.code === "number_not_in_source"));
  }

  // ties: same score, shuffled input order → identical output
  {
    const pool = [];
    for (const d of ["d3", "d1", "d2"]) for (const c of ["c2", "c1", "c3"]) pool.push({ docId: d, chunkId: c, sectionId: "s", score: 5 });
    const outs = new Set();
    for (let i = 0; i < 50; i++) outs.add(topK([...pool].sort(() => Math.random() - 0.5), 4).results.map((x) => `${x.docId}/${x.chunkId}`).join(" "));
    add("tied scores in shuffled order (50 runs)", "one deterministic order", [...outs][0] + (outs.size > 1 ? ` (+${outs.size - 1} other orders)` : ""), outs.size === 1);
  }
  // fewer than K valid candidates
  {
    const r = topK([{ docId: "a", chunkId: "1", score: 2 }, { docId: "b", chunkId: "1", score: NaN }, { docId: "a", chunkId: "1", score: 9 }], 5);
    add("fewer than K valid + NaN score + duplicate", "1 result, 1 invalid, 1 duplicate, no filler", `returned=${r.returned}, invalid=${r.rejected.invalid}, duplicate=${r.rejected.duplicate}`, r.returned === 1 && r.rejected.invalid === 1 && r.rejected.duplicate === 1 && r.insufficient);
  }
  // noisy input document
  {
    const raw = await readFile(path.join(ROOT, "data/raw/bylaw.txt"), "utf8");
    const clean = ingestWithReport({ fileName: "a.txt", raw, title: "A" });
    const noisy = ingestWithReport({ fileName: "a.txt", raw: noisify(raw), title: "A" });
    const same = JSON.stringify(clean.chunks.map((c) => [c.chunkId, c.text.replace(/\s+/g, " ")])) === JSON.stringify(noisy.chunks.map((c) => [c.chunkId, c.text.replace(/\s+/g, " ")]));
    add("noisy copy of the Act (page numbers, headers, tabs, CRLF, BOM)", "identical chunks to the clean copy", `${noisy.report.pageNumbersRemoved} page numbers + ${noisy.report.repeatedLinesRemoved} header lines removed; identical=${same}`, same);
  }

  // conflicting evidence: two SYNTHETIC documents that disagree (not real law), real model
  if (!RETRIEVAL_ONLY) {
    const chunks = [
      ...ingestText({ fileName: "town-fees-2019.txt", raw: "SECTION 1 Market stall fee\nThe monthly market stall fee is five hundred shillings." }),
      ...ingestText({ fileName: "town-fees-2021.txt", raw: "SECTION 1 Market stall fee\nThe monthly market stall fee is eight hundred shillings." }),
    ];
    await sleep(DELAY_MS);
    const r = await answerQuestion({ question: "What is the monthly market stall fee?", k: 4 }, { index: new BM25Index(chunks), llm, ...GATE });
    add("conflicting evidence (two synthetic docs: 500 vs 800 shillings), real model", "conflicting_evidence with both cited", `${r.status}, conflict refs=${r.conflicts.map((c) => c.refs.join("+")).join(";") || "-"}`, r.status === "conflicting_evidence", r.conflicts[0]?.description ?? r.answerText);
  }
  return list;
}

// ---------------- report ----------------

function summarize(pipeline) {
  const answerable = pipeline.filter((r) => r.expectStatus === "answered");
  const unanswerable = pipeline.filter((r) => r.expectStatus === "insufficient_evidence");
  const withFacts = pipeline.filter((r) => r.factRecall != null && r.status === "answered");
  const withCites = pipeline.filter((r) => r.citationPrecision != null);
  const llmRuns = pipeline.filter((r) => r.llmCalls > 0);
  const llmMs = llmRuns.map((r) => r.llmMs).filter(Number.isFinite);
  return {
    questions: pipeline.length,
    answeredWhenAnswerable: mean(answerable.map((r) => (r.status === "answered" ? 1 : 0))),
    abstainedWhenUnanswerable: mean(unanswerable.map((r) => (r.status === "insufficient_evidence" ? 1 : 0))),
    statusAccuracy: mean(pipeline.map((r) => (r.statusOk ? 1 : 0))),
    retrievalHit: mean(pipeline.filter((r) => r.retrievalHit != null).map((r) => (r.retrievalHit ? 1 : 0))),
    retrievalHitHeapOnly: mean(pipeline.filter((r) => r.retrievalHitHeapOnly != null).map((r) => (r.retrievalHitHeapOnly ? 1 : 0))),
    factRecall: mean(withFacts.map((r) => r.factRecall)),
    citationPrecision: mean(withCites.map((r) => r.citationPrecision)),
    claims: pipeline.reduce((n, r) => n + r.claims, 0),
    unsupportedRemoved: pipeline.reduce((n, r) => n + r.unsupportedRemoved, 0),
    flaggedClaims: pipeline.reduce((n, r) => n + r.flaggedClaims, 0),
    inventedCitationsRemoved: pipeline.reduce((n, r) => n + r.inventedCitationsRemoved, 0),
    forbiddenViolations: pipeline.filter((r) => r.forbidden.length).map((r) => r.id),
    gatedWithoutModel: pipeline.filter((r) => r.llmCalls === 0).length,
    fallbackAnswers: pipeline.filter((r) => r.fallback).length,
    repairs: pipeline.reduce((n, r) => n + r.repairs, 0),
    llmMsP50: quantile(llmMs, 0.5),
    llmMsP95: quantile(llmMs, 0.95),
    tokens: pipeline.reduce((n, r) => n + (r.tokens ?? 0), 0),
  };
}

function markdown({ meta, retrieval, pipeline, summary, scenarioList }) {
  const L = [];
  L.push(`# Evaluation results`, ``, `Run: ${meta.at} · corpus: ${meta.chunks} chunks / ${meta.docs} document(s) · K=${meta.k} · model: ${meta.model}${meta.fallback ? ` (fallback ${meta.fallback})` : ""} · gate: coverage >= ${GATE.minCoverage}`, ``);
  L.push(`## Retrieval (BM25 + bounded min-heap, no model)`, ``);
  L.push(`| Recall@1 | @2 | @3 | @4 | @5 | @8 | MRR | heap == full sort |`, `|---|---|---|---|---|---|---|---|`);
  const ra = retrieval.recallAt;
  L.push(`| ${pct(ra[1])} | ${pct(ra[2])} | ${pct(ra[3])} | ${pct(ra[4])} | ${pct(ra[5])} | ${pct(ra[8])} | ${retrieval.mrr.toFixed(3)} | ${retrieval.rows.length - retrieval.heapMismatches}/${retrieval.rows.length} queries identical |`, ``);
  L.push(`Recall@K = share of the ${retrieval.answerable} answerable questions whose expected section is in the top K. Rank of first expected section per question: ${retrieval.rows.filter((r) => r.firstRank !== undefined).map((r) => `${r.id}:${r.firstRank ?? "–"}`).join(", ")}.`, ``);
  if (pipeline) {
    const s = summary;
    L.push(`## Grounded answers (full pipeline)`, ``);
    L.push(`| Metric | Value |`, `|---|---|`);
    L.push(`| Status correct (answered / abstained as expected) | ${pct(s.statusAccuracy)} |`);
    L.push(`| Answered when the Act covers it | ${pct(s.answeredWhenAnswerable)} |`);
    L.push(`| Abstained when it does not | ${pct(s.abstainedWhenUnanswerable)} |`);
    L.push(`| Expected section in evidence (heap only / with cross-reference) | ${pct(s.retrievalHitHeapOnly)} / ${pct(s.retrievalHit)} |`);
    L.push(`| Key-fact recall in answers | ${pct(s.factRecall)} |`);
    L.push(`| Citation precision (cited section relevant) | ${pct(s.citationPrecision)} |`);
    L.push(`| Claims generated | ${s.claims} |`);
    L.push(`| Unsupported claims removed / flagged for review | ${s.unsupportedRemoved} / ${s.flaggedClaims} |`);
    L.push(`| Invented citations removed | ${s.inventedCitationsRemoved} |`);
    L.push(`| Fabrication traps triggered | ${s.forbiddenViolations.length ? s.forbiddenViolations.join(", ") : "none"} |`);
    L.push(`| Stopped at retrieval gate (no model call) | ${s.gatedWithoutModel} |`);
    L.push(`| Answered by fallback model / JSON repairs | ${s.fallbackAnswers} / ${s.repairs} |`);
    L.push(`| Model latency p50 / p95 | ${s.llmMsP50} ms / ${s.llmMsP95} ms |`);
    L.push(`| Total tokens | ${s.tokens} |`, ``);
    L.push(`### Per question`, ``, `| id | category | status | ok | facts | cites (precise) | model | ms |`, `|---|---|---|---|---|---|---|---|`);
    for (const r of pipeline) {
      L.push(`| ${r.id} | ${r.category} | ${r.status} | ${r.statusOk && !r.forbidden.length && r.factRecall !== 0 ? "✓" : "✗"} | ${r.factRecall == null ? "–" : pct(r.factRecall)} | ${r.citations}${r.citationPrecision == null ? "" : ` (${pct(r.citationPrecision)})`} | ${r.model ?? "gate"}${r.fallback ? " (fallback)" : ""} | ${r.llmMs ?? "–"} |`);
    }
    L.push(``, `### Answers`, ``);
    for (const r of pipeline) L.push(`- **${r.id}** ${r.question}  \n  → _${r.status}_: ${(r.answerText || r.message || "").replace(/\n/g, " ").slice(0, 400)}`);
    L.push(``);
  }
  L.push(`## Failure handling`, ``, `| Scenario | Expected | Actual | Pass |`, `|---|---|---|---|`);
  for (const sc of scenarioList) L.push(`| ${sc.name} | ${sc.expected} | ${sc.actual} | ${sc.pass ? "✓" : "✗"} |`);
  L.push(``);
  return L.join("\n");
}

// ---------------- main ----------------

const spec = JSON.parse(await readFile(path.join(HERE, "questions.json"), "utf8"));
const questions = spec.questions.filter((q) => !ONLY || ONLY.has(q.id));
await kb.load();
const meta = { at: new Date().toISOString(), chunks: kb.chunks.length, docs: kb.docs.length, k: K, model: llm.config.model || "(none)", fallback: llm.config.fallbackModel, questions: questions.length };

console.log(`\n== Retrieval (${questions.length} questions, no model) ==`);
const retrieval = retrievalEval(questions);
console.log(`Recall@1..8: ${Object.entries(retrieval.recallAt).map(([k, v]) => `@${k}=${pct(v)}`).join(" ")}  MRR=${retrieval.mrr.toFixed(3)}  heap==sort mismatches=${retrieval.heapMismatches}`);

let pipeline = null;
let summary = null;
if (!RETRIEVAL_ONLY) {
  console.log(`\n== Full pipeline (${meta.model}, K=${K}, pacing ${DELAY_MS} ms after each model call) ==`);
  pipeline = await pipelineEval(questions);
  summary = summarize(pipeline);
}
console.log(`\n== Failure scenarios ==`);
const scenarioList = await scenarios();

await mkdir(OUT_DIR, { recursive: true });
const report = { meta, retrieval, summary, pipeline, scenarios: scenarioList };
await writeFile(path.join(OUT_DIR, "latest.json"), JSON.stringify(report, null, 2));
await writeFile(path.join(OUT_DIR, "latest.md"), markdown({ meta, retrieval, pipeline, summary, scenarioList }));
console.log(`\nWrote ${path.relative(ROOT, OUT_DIR)}/latest.md and latest.json`);
if (summary) console.log(JSON.stringify(summary, null, 2));
