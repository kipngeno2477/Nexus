// Baseline: full sort then slice. Same validation, duplicate policy and tie ordering as topK.
// Complexity: O(n log n) time, O(n) space. Used only for comparison/benchmarking.

import { byRelevanceDesc, identityKey } from "./compare.js";
import { validateK, invalidReason, emptyRejected, recordInvalid } from "./candidates.js";

export function fullSortTopK(candidates, k) {
  validateK(k);
  const seen = new Set();
  const rejected = emptyRejected();
  const valid = [];
  let considered = 0;

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
    valid.push(c);
  }

  const results = valid.sort(byRelevanceDesc).slice(0, k);
  return {
    results,
    requestedK: k,
    returned: results.length,
    considered,
    rejected,
    insufficient: results.length < k,
  };
}
