// Protects the (free-tier) model quota:
//  - RateLimiter: fixed-window per-client limit on /api/ask
//  - AnswerCache: identical questions over the shared knowledge base reuse a recent answer

export class RateLimiter {
  constructor({ limit = 10, windowMs = 60_000, now = Date.now } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.hits = new Map(); // key -> { count, resetAt }
  }

  /** @returns {{ ok: boolean, remaining: number, retryAfterMs: number }} */
  take(key) {
    const t = this.now();
    let h = this.hits.get(key);
    if (!h || h.resetAt <= t) {
      h = { count: 0, resetAt: t + this.windowMs };
      this.hits.set(key, h);
      if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
    }
    if (h.count >= this.limit) return { ok: false, remaining: 0, retryAfterMs: h.resetAt - t };
    h.count++;
    return { ok: true, remaining: this.limit - h.count, retryAfterMs: 0 };
  }
}

const CACHEABLE = new Set(["answered", "insufficient_evidence", "conflicting_evidence"]);

export class AnswerCache {
  constructor({ max = 200, ttlMs = 15 * 60_000, now = Date.now } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.now = now;
    this.map = new Map(); // insertion order = LRU order
  }

  static key({ question, k, docIds, kbVersion }) {
    const q = String(question ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    const ids = Array.isArray(docIds) ? [...docIds].sort().join(",") : "";
    return `${kbVersion}|${k ?? ""}|${ids}|${q}`;
  }

  get(key) {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expires <= this.now()) {
      this.map.delete(key);
      return null;
    }
    this.map.delete(key); // refresh LRU position
    this.map.set(key, e);
    return e.value;
  }

  set(key, result) {
    if (!CACHEABLE.has(result.status)) return; // never cache failures
    // A model's abstention may be a fluke; only the deterministic retrieval-gate abstention is cached.
    if (result.status === "insufficient_evidence" && result.debug?.llm?.calls > 0) return;
    this.map.set(key, { value: result, expires: this.now() + this.ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
}
