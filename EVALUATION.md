# Evaluation

How well Nexus retrieves the right law, answers only from it, cites it, abstains when it
should, and handles failures. Everything below was measured with the code in this repository
(`npm test`, `npm run bench`, `npm run eval`). Raw outputs are in `Backend/eval-results/`.

**Summary (final run, run 3)**

| | |
|---|---|
| Questions answered or abstained correctly | **26 / 27 (96%)** |
| Answerable questions answered | **19 / 20 (95%)** |
| Unanswerable questions abstained (no made-up answer) | **5 / 5 (100%)** |
| Key facts present in answers | **100%** |
| Citations pointing to a relevant section | **96%** |
| Fabrication traps triggered | **0** |
| Failure scenarios handled as designed | **17 / 17** |
| Heap top-K identical to full sort | **27 / 27 real queries · 300 / 300 randomised trials · 12 / 12 benchmark cases** |
| Model latency (p50 / p95) | **1.0 s / 2.8 s** |

---

## 1. Setup

| | |
|---|---|
| Corpus | 1 document: Access to Information Act, 2016 (Kenya), 28 sections in 7 Parts, **53 chunks** (≈200 words, 40-word overlap); see [SOURCES.md](SOURCES.md) |
| Question set | `Backend/src/eval/questions.json`: **27 questions**. 15 direct, 3 paraphrased, 1 conditional, 1 definition, 1 fabrication trap, 1 noisy (typos), 3 unanswerable, 2 near-domain unanswerable |
| Ground truth | For each question: expected section(s), acceptable sections for citations, expected status, and key facts as regexes (e.g. `twenty-one days\|21 days`). All checked by hand against `Backend/data/raw/bylaw.txt` |
| Retrieval | BM25 + bounded min-heap, **K = 4**, plus at most 1 cross-referenced section |
| Evidence gate | at least 60% of the question's terms must appear in the selected passages |
| Model | Groq `qwen/qwen3.8-27b` (reasoning off), temperature 0; fallback `openai/gpt-oss-20b` (not needed in runs 2–3) |
| Pacing | 13 s after each model call (Groq free tier: 1,000 output tokens per minute) |
| Hardware for timings | Intel Core i5-8365U (4 cores / 8 threads), Node 22 |

**Metrics**
- **Recall@K:** share of answerable questions whose expected section is among the top K retrieved chunks.
- **MRR:** mean of 1 / (rank of the first expected section).
- **Status correct:** `answered` when the Act covers the question, `insufficient_evidence` when it doesn't (either accepted for the trap and noisy questions).
- **Key-fact recall:** share of expected facts found in the answer text (answered questions only).
- **Citation precision:** share of cited passages whose section is in the question's acceptable list.
- **Unsupported claims:** claims removed (no valid citation) or flagged (number not in any passage, or low word overlap).

---

## 2. Retrieval (no model involved)

`npm run eval -- --retrieval-only`

| Recall@1 | @2 | @3 | **@4** | @5 | @8 | MRR |
|---|---|---|---|---|---|---|
| 73% | 86% | 91% | **91%** | 91% | 95% | 0.818 |

On the 22 questions that have an expected section, 20 have it in the top 4.

| Miss | Why |
|---|---|
| q17 "What kinds of information can the government **refuse to release**?" | The Act's words are "limitation" and "exempt"; the expected section (s6) ranks 6th. The model then correctly said the passages it was given did not list the categories |
| q22 "how **mch** does it **cst** to get info frm govt??" | Typos: BM25 has no fuzzy matching, so nothing matches; the gate abstains. Counted as acceptable (abstaining is better than guessing), but it is a retrieval limitation |

The **cross-reference step** exists for cases like q17, where retrieved passages say
"exempted under section 6". For "What information is exempt from disclosure?" it adds s6 and the
answer lists all of section 6's grounds. For q17's wording, fewer than 2 retrieved chunks cite
section 6, so it doesn't trigger.

---

## 3. Grounded answers (full pipeline), three runs

`npm run eval`. Groq output is not perfectly deterministic even at temperature 0, so the set was
run three times. Fixes were made between runs; **run 1 is the unmodified baseline**.

| Metric | Run 1 (baseline) | Run 2 | **Run 3 (final)** |
|---|---|---|---|
| Status correct | 23 / 27 (85%) | 26 / 27 (96%) | **26 / 27 (96%)** |
| Answerable → answered | 16 / 20 (80%) | 19 / 20 (95%) | **19 / 20 (95%)** |
| Unanswerable → abstained | 5 / 5 (100%) | 5 / 5 (100%) | **5 / 5 (100%)** |
| Key-fact recall (answered) | 100% | 100% | **100%** |
| Citation precision | 100% | 96% | **96%** |
| Claims generated | 62 | 77 | 79 |
| Unsupported claims removed / flagged | 0 / 0 | 0 / 0 | **0 / 0** |
| Invented citations removed | 0 | 0 | 0 |
| Fabrication traps triggered | 0 | 0 | **0** |
| Stopped at gate (no model call) | 5 (1 wrongly) | 4 | 4 |
| JSON repairs | 2 | 0 | 0 |
| Conflict scenario | ✗ | ✗ | **✓** |
| Model latency p50 / p95 | 0.8 s / 2.1 s | 0.9 s / 1.4 s | 1.0 s / 2.8 s |
| Tokens used | 35,423 | 37,392 | 37,483 |

### What failed in run 1 and what was changed

| Run-1 failure | Root cause (from raw model output) | Fix (general, not question-specific) |
|---|---|---|
| q16 "fired… blow the whistle" stopped at the gate | "being" and the idiom "whistle" counted as missing terms (3/6 found) | "being" added to stopwords; "whistle" mapped to disclosure/protection in the synonym map |
| q19 life-or-liberty, q12 lodge a complaint: abstained although passage 1 contained the answer | Model nondeterminism: Groq sometimes rejected output that broke the JSON schema (**HTTP 400 `json_validate_failed`**, which we treated as fatal), or the model **omitted the `verdict` field** | Client retries once in plain JSON mode on `json_validate_failed`; parser infers a missing verdict from the content (warning `verdict_inferred`) instead of discarding a good answer |
| Conflict scenario (runs 1–2) | The evidence gate's absolute BM25 floor (score ≥ 1) rejected the two-document synthetic corpus (score 0.93). **BM25 scores depend on corpus size**, so the same would hit small uploaded documents | Absolute floor disabled by default (`RETRIEVAL_MIN_SCORE=0`); the corpus-independent coverage check is the gate. Verified that no unanswerable question relied on the floor |

The unanswerable and near-domain questions (speed limits, passports, county elections, littering
fines, commissioners' salaries) were refused in **every run**. Three were stopped by the gate
before any model call, and the model refused the other two itself.

### Per question (run 3)

| id | category | status | ok | facts | citations (precise) | answered by | model ms |
|---|---|---|---|---|---|---|---|
| q01 | direct | answered | ✓ | 100% | 3 (100%) | qwen3.8-27b | 2537 |
| q02 | direct | answered | ✓ | 100% | 2 (100%) | qwen3.8-27b | 966 |
| q03 | direct | answered | ✓ | 100% | 4 (75%) | qwen3.8-27b | 1032 |
| q04 | direct | answered | ✓ | 100% | 1 (100%) | qwen3.8-27b | 1103 |
| q05 | direct | answered | ✓ | 100% | 2 (100%) | qwen3.8-27b | 2842 |
| q06 | direct | answered | ✓ | 100% | 1 (100%) | qwen3.8-27b | 861 |
| q07 | direct | answered | ✓ | 100% | 1 (100%) | qwen3.8-27b | 836 |
| q08 | direct | answered | ✓ | 100% | 2 (100%) | qwen3.8-27b | 899 |
| q09 | direct | answered | ✓ | 100% | 2 (50%) | qwen3.8-27b | 3754 |
| q10 | direct | answered | ✓ | 100% | 2 (100%) | qwen3.8-27b | 1250 |
| q11 | direct | answered | ✓ | 100% | 1 (100%) | qwen3.8-27b | 873 |
| q12 | direct | answered | ✓ | 100% | 2 (100%) | qwen3.8-27b | 1182 |
| q13 | direct | answered | ✓ | 100% | 1 (100%) | qwen3.8-27b | 1597 |
| q14 | direct | answered | ✓ | 100% | 1 (100%) | qwen3.8-27b | 770 |
| q15 | direct | answered | ✓ | 100% | 1 (100%) | qwen3.8-27b | 733 |
| q16 | paraphrase | answered | ✓ | 100% | 3 (100%) | qwen3.8-27b | 1425 |
| q17 | paraphrase | insufficient_evidence | ✗ | 0% | 0 | qwen3.8-27b | 768 |
| q18 | paraphrase | answered | ✓ | 100% | 1 (100%) | qwen3.8-27b | 923 |
| q19 | condition | answered | ✓ | 100% | 1 (100%) | qwen3.8-27b | 1393 |
| q20 | definition | answered | ✓ | 100% | 1 (100%) | qwen3.8-27b | 1190 |
| q21 | fabrication trap | answered (no amount invented) | ✓ | n/a | 2 (100%) | qwen3.8-27b | 1959 |
| q22 | noisy | insufficient_evidence | ✓ | n/a | 0 | gate | – |
| q23 | unanswerable | insufficient_evidence | ✓ | n/a | 0 | gate | – |
| q24 | unanswerable | insufficient_evidence | ✓ | n/a | 0 | gate | – |
| q25 | unanswerable | insufficient_evidence | ✓ | n/a | 0 | qwen3.8-27b | 1023 |
| q26 | near-domain | insufficient_evidence | ✓ | n/a | 0 | gate | – |
| q27 | near-domain | insufficient_evidence | ✓ | n/a | 0 | qwen3.8-27b | 610 |

**Notes**
- **q21 (fabrication trap):** "What is the exact fee in shillings for photocopies?" The Act sets
  no amount. The answer says fees may not exceed the actual cost of copying, are prescribed by
  the Cabinet Secretary's regulations, and that overcharging is an offence. **No shilling amount
  was invented** (checked by the `forbid` patterns).
- **Citation precision below 100% (q03, q09):** an extra citation outside the expected list in
  that run. A rerun of both questions cited only s9/s14 and s13 respectively, so this varies from
  run to run; it is reported as measured.
- **Unsupported claims are 0** because claims were well grounded in these runs. The removal and
  flagging paths are exercised by the failure scenarios below (an invented citation, an uncited
  claim, a made-up number).
- Full answers for every question are in `Backend/eval-results/run3.md`.

---

## 4. Failure handling

Run as part of `npm run eval`, through the real pipeline, with the model replaced by a stub
where a failure has to be forced. **17/17 pass** in the final run.

| Scenario | Expected | Result |
|---|---|---|
| K = 0, K = 11, K = "3", K = 2.5 | `invalid_input`, no model call | ✓ (×4) |
| Empty question; question over 500 characters | `invalid_input` | ✓ (×2) |
| Unknown document id in `docIds` | `invalid_input` | ✓ |
| No matching passage at all (empty candidate set) | `insufficient_evidence`, model not called | ✓ |
| Model outage | `model_unavailable` after exactly 2 attempts; retrieved passages still returned | ✓ |
| Search index outage | `retrieval_error` | ✓ |
| Malformed model output twice | stops after 1 repair (2 calls) | ✓ |
| Model invents a citation (`E9`) and adds an uncited claim | invented tag removed; uncited claim dropped and reported | ✓ |
| Model states a number found in no passage | claim flagged `number_not_in_source` | ✓ |
| Tied scores in shuffled order (50 runs) | one deterministic order (doc id, then chunk id) | ✓ |
| Fewer than K valid candidates + a NaN score + a duplicate | 1 result, 1 invalid, 1 duplicate counted, no filler | ✓ |
| Noisy copy of the Act (23 page numbers, 24 running headers, tabs, CRLF, BOM added) | identical chunks to the clean copy | ✓ |
| Conflicting evidence: two synthetic documents (500 vs 800 shillings), real model | `conflicting_evidence`, both passages cited | ✓ ("two different amounts… 2019 and 2021", refs 1+2) |

Further failure paths are covered by the automated tests (`npm test`, 71 tests): timeouts,
5xx, 429 with retry-after, fallback model, a non-retryable 400, the step budget, private-session
isolation and expiry, the upload limits, and the rate limiter.

---

## 5. Heap top-K vs full sort

### Correctness
- **Randomised equivalence:** 300 trials, pools of roughly 50–2,050 candidates with heavy ties, NaN and
  Infinity scores and natural duplicates, K from 1 to 40. Heap results equal full-sort results,
  and the rejection counts match (`Backend/test/topK.test.js`).
- **Heap property** checked after every insertion and replacement; **ties** give the same output for 100
  shuffles; **K = 1**, **K ≥ n**, **empty input** and **invalid K** are covered.
- **On the real corpus:** for all 27 evaluation questions, the heap's top 8 equals the full sort's top 8.

### Timing
`npm run bench`: synthetic pools with ties, the same candidates / K / duplicate policy / tie
order for both methods, median of 9–25 runs, Node 22, i5-8365U.

| n | K | Heap (ms) | Full sort (ms) | Identical? |
|---|---|---|---|---|
| 1,000 | 1 | 0.63 | 1.09 | yes |
| 1,000 | 5 | 0.63 | 0.77 | yes |
| 1,000 | 10 | 0.34 | 0.80 | yes |
| 1,000 | 50 | 0.43 | 0.82 | yes |
| 10,000 | 1 | 4.22 | 12.70 | yes |
| 10,000 | 5 | 5.20 | 13.17 | yes |
| 10,000 | 10 | 3.99 | 12.96 | yes |
| 10,000 | 50 | 3.84 | 10.13 | yes |
| 100,000 | 1 | 62.94 | 210.69 | yes |
| 100,000 | 5 | 56.73 | 209.77 | yes |
| 100,000 | 10 | 61.30 | 212.93 | yes |
| 100,000 | 50 | 55.81 | 207.19 | yes |

At n = 100,000 the heap is about 3.5× faster. Both timings include the shared validation and the
duplicate-tracking `Set` (O(n)), which dominate the heap's time. The gap is O(n log K)
selection versus an O(n log n) sort. In the live app n = 53 chunks, where selection takes
well under a millisecond either way. The heap's advantage matters as the corpus or private
uploads grow.

### Complexity

| | Heap (bounded, size K) | Full sort |
|---|---|---|
| Insert / replace | O(log K) | n/a |
| Selection over n candidates | O(n log K), or O(n) for K = 1 | O(n log n) |
| Extra storage | O(K) heap (+ O(n) duplicate set) | O(n) |
| Final ordering | O(K log K) | included |

---

## 6. Limitations found by this evaluation

1. **Paraphrase gap in keyword retrieval:** q17 ("refuse to release" vs "limitation/exempt")
   and typos (q22). Embeddings or a larger synonym list would help; the current map is tuned to
   this Act, so it was not extended for q17, to avoid fitting the test set.
2. **Model nondeterminism:** even at temperature 0, outputs vary between runs (in run 1, two
   answerable questions were wrongly abstained because of malformed or rejected model output;
   in runs 2–3, occasional extra citations). The bounded re-ask, JSON-mode retry and
   verdict inference absorb most of it; three runs are reported for that reason.
3. **Single-document corpus:** retrieval was evaluated on one Act (53 chunks). Multi-document
   behaviour (the document filter, private uploads ranked alongside the Act, conflicts across
   documents) is covered by tests and the synthetic conflict scenario, not by a large real corpus.
4. **Ground truth is regex-based:** key-fact checks confirm the facts appear, not that the whole
   answer is perfectly phrased. Answers were also read by hand (`eval-results/run3.md`).
5. **Free-tier limits:** with 1,000 output tokens per minute the full evaluation needs pacing
   (about 6 minutes). Runs 2–3 needed no fallback answers or repairs at that pace.

---

## Reproduce

```bash
cd Backend
npm test                            # 71 tests
npm run bench                       # heap vs full sort
npm run eval -- --retrieval-only    # retrieval metrics + failure scenarios, no model calls (skips the conflict scenario)
npm run eval                        # full evaluation (needs LLM_* configured; ~6 min on Groq free tier)
```
