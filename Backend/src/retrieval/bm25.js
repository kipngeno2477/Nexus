// BM25 keyword scoring. Produces one candidate per chunk ({...metadata, score});
// selection is done separately by topK (the heap). This module never truncates.

const STOPWORDS = new Set(
  ("a an and are as at be by can do does for from has have how i if in into is it its may me my " +
    "no not of on or our shall should so such that the their them then there these they this to " +
    "under upon was we what when where which who will with within without would you your " +
    "am much many get need want know tell please any about also someone something able allowed").split(" ")
);

// Light suffix stripping so "protected"/"protection" and "destroys"/"destroying" meet.
// Applied identically to documents and queries; not linguistically perfect, just consistent.
const SUFFIXES = ["ational", "ations", "ation", "itions", "ition", "ments", "ment", "ings", "ing", "ions", "ion", "ies", "ied", "ers", "er", "ures", "ure", "ed", "es", "ly", "s"];
export function stem(t) {
  if (t.length <= 4 || /^\d+$/.test(t)) return t;
  for (const s of SUFFIXES) {
    if (t.endsWith(s) && t.length - s.length >= 4) {
      const base = t.slice(0, -s.length);
      return s === "ies" || s === "ied" ? `${base}y` : base;
    }
  }
  return t.endsWith("e") && t.length > 5 ? t.slice(0, -1) : t; // disclose ~ disclosure

}

export function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1 && !STOPWORDS.has(t)).map(stem);
}

export class BM25Index {
  constructor(chunks, { k1 = 1.2, b = 0.75, synonyms = {} } = {}) {
    this.k1 = k1;
    this.b = b;
    this.synonyms = synonyms;
    this.chunks = chunks;
    this.docLen = [];
    this.postings = new Map(); // term -> Map(chunkIndex -> tf)

    chunks.forEach((chunk, i) => {
      const toks = tokenize(`${chunk.sectionTitle ?? ""} ${chunk.text}`);
      this.docLen[i] = toks.length;
      for (const t of toks) {
        let p = this.postings.get(t);
        if (!p) this.postings.set(t, (p = new Map()));
        p.set(i, (p.get(i) ?? 0) + 1);
      }
    });
    const N = chunks.length;
    this.avgLen = N ? this.docLen.reduce((s, x) => s + x, 0) / N : 0;
    this.idf = new Map();
    for (const [t, p] of this.postings) {
      this.idf.set(t, Math.log(1 + (N - p.size + 0.5) / (p.size + 0.5)));
    }
  }

  #synonymsOf(term) {
    if (!this.stemmedSynonyms) {
      this.stemmedSynonyms = new Map();
      for (const [k, vs] of Object.entries(this.synonyms)) {
        const key = stem(k.toLowerCase());
        const set = this.stemmedSynonyms.get(key) ?? new Set();
        for (const v of vs) tokenize(v).forEach((x) => set.add(x));
        this.stemmedSynonyms.set(key, set);
      }
    }
    return this.stemmedSynonyms.get(term) ?? new Set();
  }

  expand(queryTokens) {
    const out = new Set(queryTokens);
    for (const t of queryTokens) for (const s of this.#synonymsOf(t)) out.add(s);
    return [...out];
  }

  /**
   * Share of the question's own terms (each satisfied by itself or a synonym) that appear
   * in the given chunks. Used by the evidence gate: high BM25 on one common word is not
   * evidence the question is answerable.
   */
  coverage(query, chunks) {
    const terms = [...new Set(tokenize(query))];
    const present = new Set(chunks.flatMap((c) => tokenize(`${c.sectionTitle ?? ""} ${c.text}`)));
    const uncovered = terms.filter((t) => !present.has(t) && ![...this.#synonymsOf(t)].some((s) => present.has(s)));
    return { total: terms.length, covered: terms.length - uncovered.length, ratio: terms.length ? 1 - uncovered.length / terms.length : 0, uncovered };
  }

  /** Scores every chunk containing at least one query term. Returns unsorted candidates. */
  score(query) {
    const terms = this.expand(tokenize(query));
    const scores = new Map();
    for (const t of terms) {
      const p = this.postings.get(t);
      if (!p) continue;
      const idf = this.idf.get(t);
      for (const [i, tf] of p) {
        const norm = tf + this.k1 * (1 - this.b + (this.b * this.docLen[i]) / this.avgLen);
        scores.set(i, (scores.get(i) ?? 0) + (idf * (tf * (this.k1 + 1))) / norm);
      }
    }
    const candidates = [];
    for (const [i, score] of scores) candidates.push({ ...this.chunks[i], score });
    return { candidates, queryTerms: terms };
  }
}
