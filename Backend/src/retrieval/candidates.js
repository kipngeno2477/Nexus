// Shared validation + duplicate policy for heap selection and the full-sort baseline,
// so both algorithms are compared on exactly the same rules.

export class InvalidKError extends Error {
  constructor(k) {
    super(`K must be a positive integer, got ${JSON.stringify(k)}`);
    this.name = "InvalidKError";
    this.code = "invalid_k";
  }
}

export function validateK(k) {
  if (typeof k !== "number" || !Number.isInteger(k) || k <= 0) throw new InvalidKError(k);
}

const REQUIRED_STRINGS = ["docId", "chunkId"];

/** Returns a reason string if the candidate is unusable, otherwise null. */
export function invalidReason(c) {
  if (c === null || typeof c !== "object") return "not_an_object";
  for (const f of REQUIRED_STRINGS) {
    if (typeof c[f] !== "string" || c[f].length === 0) return `missing_${f}`;
  }
  if (typeof c.score !== "number" || !Number.isFinite(c.score)) return "non_finite_score";
  return null;
}

export function emptyRejected() {
  return { invalid: 0, duplicate: 0, reasons: {} };
}

export function recordInvalid(rejected, reason) {
  rejected.invalid++;
  rejected.reasons[reason] = (rejected.reasons[reason] || 0) + 1;
}
