# Nexus: Ask the Law, Get the Section

Nexus answers plain-language questions about public law and cites the exact section each
statement comes from. If the documents don't cover a question, it says so instead of guessing.

- **Challenge:** C, Purposeful Agentic AI / RAG Workflow
- **SDG 16:** turning legal text into something a citizen can query
- **Knowledge base:** Access to Information Act, 2016 (Kenya); see [SOURCES.md](SOURCES.md)
- **Run it on your computer:** [SETUP.md](SETUP.md)
- **Bring your own document:** citizens can upload a **PDF**, `.txt` or `.md` (or paste text), privately, and ask about it
- **Results:** see [EVALUATION.md](EVALUATION.md)

**Results** (27-question evaluation on Groq `qwen3.8-27b`; details in [EVALUATION.md](EVALUATION.md)):

| Correct answer or abstention | Unanswerable refused | Key facts in answers | Relevant citations | Failure scenarios | Heap == full sort | Answer time |
|---|---|---|---|---|---|---|
| **26/27** | **5/5** | **100%** | **96%** | **17/17** | **all queries** | **~1 s** |

---

## Contents
1. [How it works](#1-how-it-works)
2. [Mandatory DSA: bounded min-heap top-K](#2-mandatory-dsa-bounded-min-heap-top-k)
3. [The bounded workflow](#3-the-bounded-workflow)
4. [Guarding against made-up answers](#4-guarding-against-made-up-answers)
5. [Failure handling](#5-failure-handling)
6. [Documents: bundled, private and shared](#6-documents-bundled-private-and-shared)
7. [Project layout](#7-project-layout)
8. [Running locally](#8-running-locally)
9. [Testing and evaluation](#9-testing-and-evaluation)
10. [Deploying to PrimeCloud](#10-deploying-to-primecloud)
11. [Configuration reference](#11-configuration-reference)
12. [API reference](#12-api-reference)
13. [Known limitations](#13-known-limitations)

---

## 1. How it works

```
 question ─► VALIDATE ─► RETRIEVE ─────────────────────► GATE ─► SYNTHESIZE ─► VERIFY ─► DONE
                         BM25 score every chunk          enough     LLM writes     citations
                         bounded min-heap → top-K        evidence?  claims from    checked,
                         + ≤1 cross-referenced section   if not:    the passages   numbers
                                                         abstain    only (JSON)    checked
```

1. **Ingest:** messy plain text is cleaned (page numbers, running headers, broken hyphenation,
   stray whitespace and control characters) and split by section heading into ~200-word chunks.
   Every chunk keeps its document id, Part, section id and title, and chunk id.
2. **Retrieve:** BM25 keyword scoring (written in plain JS, with a light stemmer and a small
   citizen-to-statute synonym map) gives every chunk a score. Our **bounded min-heap** selects
   the top K.
3. **Gate:** if no chunk matched, or fewer than 60% of the question's terms appear in the
   selected passages, Nexus answers "not enough evidence" **without calling the model**.
4. **Synthesize:** the model sees only the selected passages, tagged `E1…EK`, and must return
   JSON claims, each citing the tags that support it.
5. **Verify:** citations are mapped back to document/section/chunk. Invented citations are
   removed, uncited claims are dropped and reported, and numbers must appear in the evidence.
6. **Done:** the answer, citations, source excerpts and a full trace of what happened.

No LangChain or LlamaIndex: plain application code keeps every step visible, and the heap
selection has to be our own code anyway.

---

## 2. Mandatory DSA: bounded min-heap top-K

| | |
|---|---|
| Heap | `Backend/src/retrieval/minHeap.js`: array-backed binary heap (`push`, `pop`, `replaceRoot`, `siftUp/Down`, `isValidHeap`) |
| Selection loop | `Backend/src/retrieval/topK.js`, used by the live pipeline (`src/pipeline/answer.js`), not a demo-only path |
| Baseline | `Backend/src/retrieval/fullSortTopK.js`: full sort + slice, with the same validation, duplicate and tie rules |
| Ordering | `Backend/src/retrieval/compare.js`: higher score, then lower `docId`, then lower `chunkId`. The same comparator drives heap replacement and output sorting, so ties never depend on input order |

**Algorithm:** validate K (a positive integer, else `InvalidKError`). For each candidate: reject
it if its score is non-finite or its ids are missing (counted); skip it if its
`docId::chunkId` was already seen (duplicate policy: the first occurrence wins, later ones are
counted); push while the heap holds fewer than K entries; otherwise, if the candidate beats the
root (the least desirable selected chunk), replace the root and sift down. Finally, sort the
K selected chunks in descending order. Fewer than K valid candidates returns what exists with
`insufficient: true`; **no filler chunks are ever added**.

**Complexity:** insertion/replacement O(log K); selection O(n log K) for K ≥ 2 and O(n) for
K = 1; heap storage O(K); final sort O(K log K). BM25 scoring and the duplicate `Set` (O(n))
are separate costs.

**Verified:** 300 randomised trials (pools of roughly 50–2,050 candidates, K from 1 to 40, with ties, NaN/Infinity
scores and duplicates) give identical results to the full sort. The heap property is checked
after every insertion, and shuffled ties always produce the same order. Benchmark
(`npm run bench`), median times on identical candidate pools:

| n | K | Heap (ms) | Full sort (ms) | Identical? |
|---|---|---|---|---|
| 1,000 | 5 | 0.63 | 0.78 | yes |
| 10,000 | 5 | 4.09 | 11.43 | yes |
| 100,000 | 1 | 69.99 | 224.78 | yes |
| 100,000 | 5 | 62.15 | 219.55 | yes |
| 100,000 | 50 | 73.88 | 218.05 | yes |

Full table and methodology in [EVALUATION.md](EVALUATION.md).

---

## 3. The bounded workflow

Control flow is decided by code, never by the model (`Backend/src/pipeline/answer.js`). The
model's only job is to write claims from the passages it is given.

| Limit | Value |
|---|---|
| Workflow steps | max 10, then a hard stop (`step_budget_exceeded`) |
| Model attempts per answer | 2 (retried only on timeout, 5xx, 429 or unreachable; waits for the provider's retry-after up to 8 s) |
| Fallback model | tried once if the primary fails (e.g. rate-limited) |
| JSON repair | 1 re-ask if the reply is malformed, or says "answered" with no claims |
| Cross-reference step | at most 1 extra chunk (see below) |
| Evidence per answer | K passages (default 4, max 10), plus at most 1 cross-reference |
| Output | max 8 claims, 600 output tokens, 500-char questions |

**Cross-reference step:** legal text points elsewhere ("exempted under section 6"). If 2 or
more selected chunks cite the same section of their document, its first chunk is added as one
extra passage. The heap's top-K is unchanged; the addition is tagged in the response and the UI.

Every response includes `debug.trace`: each step, its timing and the next state, shown in the UI
under **"How this answer was produced"**.

---

## 4. Guarding against made-up answers

- **Retrieval gate:** off-topic questions never reach the model.
- **Evidence-only prompt:** "use ONLY the numbered passages", with every claim tagged.
- **Citation check:** tags that don't match a supplied passage are removed (`invented_citation_removed`).
  Claims left without a valid citation are dropped and listed as unsupported.
- **Number check:** every number in a claim ("21", "twenty-one", "500,000") must appear in the
  evidence. If it's in another selected passage, that citation is added; if it's in none, the
  claim is flagged for the reader.
- **Overlap check:** claims worded very differently from their passage are flagged "check source".
- **Honest abstention:** `insufficient_evidence` with what is missing; partial answers say which part
  isn't covered; `conflicting_evidence` lists the disagreeing passages.
- **Self-contradiction:** "answered" with no claims gets one re-ask, then abstains.

---

## 5. Failure handling

| Situation | What the user gets | Status (HTTP) |
|---|---|---|
| Empty, too long, bad `k`, unknown document | "Check your question" | `invalid_input` (400) |
| Nothing relevant in the documents | "Not enough evidence", model not called | `insufficient_evidence` (200) |
| Passages disagree | Both sides, each cited | `conflicting_evidence` (200) |
| Model down, timing out or rate-limited (after retry + fallback) | Clear message **plus the retrieved source passages** to read directly | `model_unavailable` (503) |
| Search index failure | "Search failed" | `retrieval_error` (500) |
| Too many questions from one client | "Please wait N seconds" | `rate_limited` (429) |

Judges can trigger outages on purpose: with `DEMO_FAILURES=true`, the **Simulate** selector
(or `POST /api/ask?simulate=model|retrieval`) forces a model or search outage.

---

## 6. Documents: bundled, private and shared

| Kind | Who adds it | Where it lives | Visible to |
|---|---|---|---|
| **Bundled** | committed in `Backend/data/raw/` + `data/sources.json` | in the image; ingested at startup | everyone |
| **Private** ("Your documents" on the main page) | any visitor, no login | **server memory only**, under a random session id; deleted after 1 h idle; max 3 docs × 300 KB | only that browser tab |
| **Shared upload** (Knowledge base drawer) | admin with `UPLOAD_TOKEN` | disk (`UPLOAD_DIR`) | everyone; **off in production** (containers are stateless) |

Every ingested document gets an **ingestion report**: sections found, chunks, page numbers and
running headers removed, hyphenation repaired, clause markers joined. Private documents are
searched together with the Act through one combined index, so the same heap ranks both. The
**Search in** selector restricts a question to one document.

---

## 7. Project layout

```
Dockerfile, .dockerignore      single-container build (frontend + API), port 8080
SOURCES.md, EVALUATION.md      provenance and results
Backend/
  server.js                    Express app, /healthz, static frontend, graceful shutdown
  data/raw/bylaw.txt           original document (never modified)
  data/sources.json            document ids, titles, source URLs
  src/ingest/                  clean.js (noise removal + report), chunk.js (sections → chunks), ingest.js
  src/retrieval/               bm25.js, minHeap.js, topK.js, fullSortTopK.js, compare.js, candidates.js
  src/pipeline/                answer.js (state machine), prompt.js, verify.js (citation/number checks)
  src/llm/                     client.js (Ollama + OpenAI-compatible e.g. Groq, fallback, retry-after)
  src/kb.js                    shared knowledge base + synonym map
  src/sessions.js              private per-user documents
  src/askGuard.js              per-client rate limit + answer cache
  src/eval/                    questions.json, runEval.js, benchmark.js, ask-cli.js
  controllers/, routes/        HTTP layer
  test/                        node:test suites (74 tests)
  eval-results/                run1-baseline, run2, run3 (final) and latest evaluation outputs
Frontend/                      React + Vite (no UI libraries)
  src/App.jsx                  ask form, results, document filter
  src/components/              Answer, Sources, RetrievalDetails, MyDocuments, KnowledgeBase, ...
```

---

## 8. Running locally

> **New to the project?** Follow the step-by-step guide in **[SETUP.md](SETUP.md)**: installing Node 22, getting a Groq key or Ollama, running, checking and troubleshooting. The summary below is for people who already know the stack.

Requires **Node 22** (`nvm use`; see `.nvmrc`).

```bash
# Backend
cd Backend
npm install
cp .env.example .env         # then set the LLM_* values (see below)
npm run dev                  # http://localhost:5000

# Frontend (dev server with hot reload, proxies /api to :5000)
cd Frontend
npm install
npm run dev                  # http://localhost:5173

# Or production-style: build once and let Express serve it on :5000
cd Frontend && npm run build && cd ../Backend && npm start
```

**Model options** (set in `Backend/.env`):
- **Groq (hosted, recommended):** `LLM_PROVIDER=openai_compatible`,
  `LLM_BASE_URL=https://api.groq.com/openai/v1`, `LLM_MODEL=qwen/qwen3.8-27b`,
  `LLM_REASONING_EFFORT=none`, `LLM_FALLBACK_MODEL=openai/gpt-oss-20b`,
  `LLM_FALLBACK_REASONING_EFFORT=low`, `LLM_API_KEY=…`. About 1 s per answer.
- **Ollama (offline):** `LLM_PROVIDER=ollama`, `LLM_MODEL=qwen2.5:3b` after `ollama pull qwen2.5:3b`.
  45–65 s per answer on a laptop CPU.

Terminal Q&A without the UI: `npm run ask -- "How much does it cost to request information?"`

---

## 9. Testing and evaluation

```bash
cd Backend
npm test                            # 74 unit/integration tests, no network needed
npm run bench                       # heap vs full-sort timings
npm run eval -- --retrieval-only    # Recall@K, MRR, heap == sort on real queries (no model calls)
npm run eval                        # full run on the configured model + failure scenarios (~6 min on Groq free tier)
```

`npm run eval` writes `Backend/eval-results/latest.md` and `latest.json` (the three reported runs are kept as `run1-baseline`, `run2`, `run3`). The question set is
`Backend/src/eval/questions.json`: 27 questions (direct, paraphrased, conditional, a
fabrication trap, a noisy typo question, and unanswerable/near-domain questions), each with
expected sections and key facts checked against the Act. Add questions there; no code changes
needed. Options: `--only=q01,q17`, `--delay=13000` (pause after each model call), `--k=4`.

What the tests cover: heap correctness (property checks, ties, duplicates, invalid scores,
randomised equivalence with the full sort), ingestion (noise robustness on the real Act,
headings, chunk ids), the pipeline with a mocked model (every status, retries, repairs,
invented citations, number checks, cross-references), the LLM client against a fake server
(fallback, 429/retry-after, timeouts), private sessions (isolation, expiry, limits) and the
rate limiter and cache.

---

## 10. Deploying to PrimeCloud

The repo builds as one container (`Dockerfile` at the root: frontend build → backend production
dependencies → `node:22-alpine`, non-root user).

1. **Applications → Deploy Service** → source **GitHub repository**, branch `main`,
   Dockerfile path **`Dockerfile`**, *Auto-deploy on push* ON.
2. **Container port `8080`**, **health check path `/healthz`** (returns 200 once the
   knowledge base has loaded; never calls the model, so health checks cost no quota).
3. **Environment variables** (the API key as a secret; never commit `.env`):

   | Variable | Value |
   |---|---|
   | `LLM_PROVIDER` | `openai_compatible` |
   | `LLM_BASE_URL` | `https://api.groq.com/openai/v1` |
   | `LLM_MODEL` | `qwen/qwen3.8-27b` |
   | `LLM_REASONING_EFFORT` | `none` |
   | `LLM_FALLBACK_MODEL` | `openai/gpt-oss-20b` |
   | `LLM_FALLBACK_REASONING_EFFORT` | `low` |
   | `LLM_API_KEY` | Groq key (**secret**) |
   | `LLM_TIMEOUT_MS` | `30000` |
   | `TRUST_PROXY` | `1` (real client IPs for rate limiting) |
   | `DEMO_FAILURES` | `true` (enables the Simulate selector for the failure demo) |

   Leave `ALLOW_UPLOADS` unset (shared uploads would vanish on redeploy). Private uploads work.
4. Push to `main` and watch **Building → Verifying Health → Running**.
5. **Check over HTTPS:**
   - [ ] `/healthz` returns `{"ok":true,"chunks":53}`
   - [ ] Knowledge base drawer lists the Act with its ingestion report
   - [ ] "How much does it cost to request information?" → answered, cites *12. Fees*
   - [ ] "How do I get a passport?" → not enough evidence (model not called)
   - [ ] Passages (K) = 0 → "Check your question"
   - [ ] Simulate → model outage → "Answer generator unavailable" + source passages
   - [ ] "How this answer was produced" shows the workflow trace and heap top-K table
   - [ ] Paperclip → upload a PDF (selectable text) or `.txt` and ask about it; a scanned PDF is rejected with a clear message
6. **Exit code 137 (out of memory):** add RAM and raise `NODE_OPTIONS=--max-old-space-size`
   (the image sets 384 MB for a 512 MiB container).

Local image test, if you have Docker access: `docker build -t nexus . && docker run --rm -p 8080:8080 -e LLM_PROVIDER=openai_compatible -e LLM_BASE_URL=https://api.groq.com/openai/v1 -e LLM_MODEL=qwen/qwen3.8-27b -e LLM_API_KEY=… nexus`

---

## 11. Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 5000 (8080 in Docker) | HTTP port |
| `LLM_PROVIDER` | `ollama` | `ollama` or `openai_compatible` |
| `LLM_BASE_URL` | `http://localhost:11434` | model endpoint |
| `LLM_MODEL` / `LLM_API_KEY` | — | model id / key (key: server-side secret) |
| `LLM_FALLBACK_MODEL` | — | tried once if the primary fails |
| `LLM_REASONING_EFFORT` / `LLM_FALLBACK_REASONING_EFFORT` | — | e.g. `none` / `low` |
| `LLM_TIMEOUT_MS` / `LLM_MAX_TOKENS` | 60000 / 600 | per-call timeout / output cap |
| `RETRIEVAL_MIN_COVERAGE` / `RETRIEVAL_MIN_SCORE` | 0.6 / 0 | evidence gate (coverage; optional absolute score floor, off because BM25 scores depend on corpus size) |
| `ASK_RATE_LIMIT` | 10 | questions per minute per client |
| `ANSWER_CACHE_TTL_MS` | 900000 | cache lifetime for repeated questions |
| `TRUST_PROXY` | — | set `1` behind a proxy |
| `DEMO_FAILURES` | — | `true` enables `?simulate=model\|retrieval` |
| `ALLOW_PRIVATE_UPLOADS` | `true` | private per-user documents |
| `SESSION_TTL_MS` / `MAX_SESSIONS` | 3600000 / 200 | private session lifetime / cap |
| `ALLOW_UPLOADS` / `UPLOAD_TOKEN` / `UPLOAD_DIR` | — | shared-knowledge-base uploads (admin) |

---

## 12. API reference

| Method & path | Purpose |
|---|---|
| `POST /api/ask` | `{question, k?, docIds?}` → `{status, answer[], answerText, citations[], evidence[], conflicts[], missing, unsupported[], warnings[], debug}` |
| `GET /api/health` | knowledge base + model status |
| `GET /healthz` | lightweight readiness probe |
| `GET /api/documents` | bundled/shared documents with ingestion reports |
| `GET /api/documents/:docId/chunks[/:chunkId]` | sections/chunks; full passage text |
| `GET/POST /api/session/documents`, `DELETE /api/session/documents/:docId` | private documents (header `x-session-id`) |
| `POST/DELETE /api/documents[/:docId]` | shared uploads (admin, `x-upload-token`) |

---

## 13. Known limitations

- **Keyword retrieval:** BM25 with a stemmer and synonym map. It misses heavy paraphrase and
  typos (e.g. "how mch does it cst"); there are no embeddings.
- **The synonym map is tuned to the Access to Information Act.** Other documents rely on plain
  keyword and stem matching.
- **PDFs need selectable text:** PDFs are converted to text in the browser (pdf.js, with running
  headers/footers removed by page position); scanned, image-only PDFs are rejected (no OCR). Tables
  and multi-column layouts may lose their structure. Documents without recognisable headings are split
  by length, so their citations point to chunks rather than sections (the ingestion report says so).
- **Conflict detection depends on the model** noticing the disagreement, backed by the number check.
- **Groq free tier:** 1,000 output tokens per minute for `qwen3.8-27b` (about 4–6 answers a
  minute). The fallback model and the answer cache absorb bursts; beyond that, users see a
  "busy" message with the source passages.
- **Private documents live in memory:** lost on restart or redeploy, and tied to one instance
  (run a single replica).
- **Not legal advice.** Answers are only as current as the bundled text (revised to 31 Dec 2022).
