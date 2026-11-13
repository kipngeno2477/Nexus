import { test } from "node:test";
import assert from "node:assert/strict";
import { MinHeap } from "../src/retrieval/minHeap.js";
import { better } from "../src/retrieval/compare.js";
import { topK } from "../src/retrieval/topK.js";
import { fullSortTopK } from "../src/retrieval/fullSortTopK.js";
import { InvalidKError } from "../src/retrieval/candidates.js";

// Seeded PRNG so failures are reproducible.
function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const c = (docId, chunkId, score, extra = {}) => ({ docId, chunkId, score, sectionId: "s1", ...extra });
const ids = (r) => r.results.map((x) => `${x.docId}/${x.chunkId}`);

test("MinHeap keeps the least desirable at the root and stays valid", () => {
  const rand = rng(1);
  const h = new MinHeap(better);
  for (let i = 0; i < 200; i++) {
    h.push(c(`d${i % 7}`, `c${i}`, Math.floor(rand() * 10)));
    assert.ok(h.isValidHeap());
  }
  let prev = h.pop();
  while (h.size()) {
    const cur = h.pop();
    assert.ok(better(cur, prev) >= 0, "pop order must be non-decreasing desirability");
    assert.ok(h.isValidHeap());
    prev = cur;
  }
});

test("invalid K is rejected", () => {
  for (const k of [0, -1, 2.5, "3", NaN, Infinity, null, undefined]) {
    assert.throws(() => topK([c("a", "1", 1)], k), InvalidKError, `k=${String(k)}`);
    assert.throws(() => fullSortTopK([c("a", "1", 1)], k), InvalidKError);
  }
});

test("empty candidate set returns empty, insufficient", () => {
  for (const input of [[], null, undefined]) {
    const r = topK(input, 5);
    assert.deepEqual(r.results, []);
    assert.equal(r.insufficient, true);
  }
});

test("fewer than K valid candidates: no filler", () => {
  const r = topK([c("a", "1", 3), c("b", "1", 2)], 5);
  assert.equal(r.returned, 2);
  assert.equal(r.insufficient, true);
  assert.deepEqual(ids(r), ["a/1", "b/1"]);
});

test("non-finite scores and missing ids are rejected and counted", () => {
  const r = topK(
    [c("a", "1", NaN), c("a", "2", Infinity), c("a", "3", -Infinity), c("a", "4", "5"), { chunkId: "x", score: 1 }, null, c("a", "5", 1)],
    3
  );
  assert.deepEqual(ids(r), ["a/5"]);
  assert.equal(r.rejected.invalid, 6);
  assert.equal(r.rejected.reasons.non_finite_score, 4);
});

test("duplicates: first occurrence kept, later ignored", () => {
  const r = topK([c("a", "1", 1, { tag: "first" }), c("a", "1", 99, { tag: "second" }), c("b", "1", 2)], 5);
  assert.equal(r.returned, 2);
  assert.equal(r.rejected.duplicate, 1);
  assert.equal(r.results.find((x) => x.docId === "a").tag, "first");
});

test("ties resolve by docId then chunkId, independent of input order", () => {
  const pool = [];
  for (const d of ["d3", "d1", "d2"]) for (const ch of ["c2", "c1", "c3"]) pool.push(c(d, ch, 5));
  pool.push(c("d9", "c9", 6));
  const rand = rng(42);
  const expected = ["d9/c9", "d1/c1", "d1/c2", "d1/c3"];
  for (let i = 0; i < 100; i++) {
    assert.deepEqual(ids(topK(shuffle(pool, rand), 4)), expected);
    assert.deepEqual(ids(fullSortTopK(shuffle(pool, rand), 4)), expected);
  }
});

test("K = 1 and K >= n", () => {
  const pool = [c("a", "1", 1), c("b", "1", 3), c("c", "1", 2)];
  assert.deepEqual(ids(topK(pool, 1)), ["b/1"]);
  const r = topK(pool, 10);
  assert.deepEqual(ids(r), ["b/1", "c/1", "a/1"]);
  assert.equal(r.insufficient, true);
});

test("heap property holds after every insertion/replacement", () => {
  const rand = rng(7);
  const pool = Array.from({ length: 500 }, (_, i) => c(`d${i % 13}`, `c${i}`, Math.round(rand() * 50)));
  let steps = 0;
  topK(pool, 16, {
    onStep: (h) => {
      steps++;
      assert.ok(h.isValidHeap());
      assert.ok(h.size() <= 16);
    },
  });
  assert.equal(steps, 500);
});

test("metadata is preserved intact", () => {
  const cand = c("bylaw-a", "s3-c01", 4.2, { sectionTitle: "Section 3 Licences", text: "..." });
  const [out] = topK([cand, c("z", "1", 1)], 1).results;
  assert.deepEqual(out, cand);
});

test("randomised: heap top-K equals full-sort top-K on pools much larger than K", () => {
  const rand = rng(2026);
  for (let trial = 0; trial < 300; trial++) {
    const n = 50 + Math.floor(rand() * 2000);
    const k = 1 + Math.floor(rand() * 40);
    const pool = [];
    for (let i = 0; i < n; i++) {
      const r = rand();
      const score = r < 0.02 ? NaN : r < 0.03 ? Infinity : Math.floor(rand() * 20); // many ties
      pool.push(c(`d${Math.floor(rand() * 30)}`, `c${Math.floor(rand() * 60)}`, score)); // natural dupes
    }
    const h = topK(pool, k);
    const f = fullSortTopK(pool, k);
    assert.deepEqual(h.results, f.results, `trial ${trial} n=${n} k=${k}`);
    assert.deepEqual(h.rejected, f.rejected);
  }
});
