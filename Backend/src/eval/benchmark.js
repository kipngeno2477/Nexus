// Heap top-K vs full-sort baseline on identical candidate pools.
// Usage: npm run bench
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { topK } from "../retrieval/topK.js";
import { fullSortTopK } from "../retrieval/fullSortTopK.js";

function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function makePool(n, rand) {
  return Array.from({ length: n }, (_, i) => ({
    docId: `doc${i % 50}`,
    chunkId: `c${i}`,
    sectionId: `s${i % 20}`,
    score: Math.round(rand() * 1000) / 10, // ties present
  }));
}

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

function time(fn, runs) {
  const t = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    t.push(performance.now() - t0);
  }
  return median(t);
}

const rand = rng(11);
const rows = [];
for (const n of [1_000, 10_000, 100_000]) {
  const pool = makePool(n, rand);
  for (const k of [1, 5, 10, 50]) {
    const runs = n >= 100_000 ? 9 : 25;
    topK(pool, k); fullSortTopK(pool, k); // warm-up
    const identical = isDeepStrictEqual(topK(pool, k).results, fullSortTopK(pool, k).results);
    rows.push({
      n,
      K: k,
      "heap ms": +time(() => topK(pool, k), runs).toFixed(3),
      "full sort ms": +time(() => fullSortTopK(pool, k), runs).toFixed(3),
      identical,
    });
  }
}
console.log(`Node ${process.version}; median of runs; same pool, K, duplicate policy and tie order`);
console.table(rows);
console.log("\nMarkdown:\n| n | K | Heap (ms) | Full sort (ms) | Identical? |\n|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.n} | ${r.K} | ${r["heap ms"]} | ${r["full sort ms"]} | ${r.identical ? "yes" : "NO"} |`);
