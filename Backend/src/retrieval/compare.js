// Deterministic total ordering for candidate chunks.
// Used by BOTH the heap (root = least desirable) and the final output sort,
// so tied scores resolve the same way regardless of input order.

function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Returns > 0 if `a` is MORE desirable than `b`, < 0 if less, 0 if identical identity.
 * Order: higher score, then lower docId, then lower chunkId.
 */
export function better(a, b) {
  if (a.score !== b.score) return a.score > b.score ? 1 : -1;
  const d = cmpStr(b.docId, a.docId); // lower docId preferred
  if (d !== 0) return d;
  return cmpStr(b.chunkId, a.chunkId); // then lower chunkId preferred
}

/** Comparator for Array.prototype.sort giving descending relevance. */
export function byRelevanceDesc(a, b) {
  return -better(a, b);
}

export function identityKey(c) {
  return `${c.docId}::${c.chunkId}`;
}
