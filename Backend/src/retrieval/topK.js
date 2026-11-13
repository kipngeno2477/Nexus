// Bounded min-heap top-K selection — the selection algorithm used by the live pipeline.
//
// Complexity (n candidates):
//   - each push / replaceRoot: O(log K)
//   - selection: O(n log K) for K >= 2; O(n) for K = 1 (heap of size 1, sifts are O(1))
//   - heap storage: O(K); duplicate-tracking Set: O(n) worst case
//   - final sort of selected results: O(K log K)
//
// Duplicate policy: identity is docId::chunkId. The FIRST valid occurrence is kept;
// later occurrences are ignored and counted in rejected.duplicate.
// Invalid candidates (missing ids, non-finite scores) are skipped and counted, never repaired.
// Fewer than K valid candidates → return what exists with insufficient = true. No filler.

import { MinHeap } from "./minHeap.js";
import { better, byRelevanceDesc, identityKey } from "./compare.js";
import { validateK, invalidReason, emptyRejected, recordInvalid } from "./candidates.js";

/**
 * @param {Iterable<{docId:string, chunkId:string, score:number}>} candidates
 * @param {number} k
 * @param {{ onStep?: (heap: MinHeap) => void }} [opts]  test hook to check heap validity per step
 */
export function topK(candidates, k, opts = {}) {
  validateK(k);
  const heap = new MinHeap(better);
  const seen = new Set();
  const rejected = emptyRejected();
  let considered = 0;
  let replacements = 0;

  for (const c of candidates ?? []) {
    considered++;
    const reason = invalidReason(c);
    if (reason) {
      recordInvalid(rejected, reason);
      continue;
    }
    const key = identityKey(c);
    if (seen.has(key)) {
      rejected.duplicate++;
      continue;
    }
    seen.add(key);

    if (heap.size() < k) {
      heap.push(c);
    } else if (better(c, heap.peek()) > 0) {
      heap.replaceRoot(c);
      replacements++;
    }
    opts.onStep?.(heap);
  }

  const results = heap.toArray().sort(byRelevanceDesc);
  return {
    results,
    requestedK: k,
    returned: results.length,
    considered,
    replacements,
    rejected,
    insufficient: results.length < k,
  };
}
