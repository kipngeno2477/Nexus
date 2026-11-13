// BM25 keyword scoring. Produces one candidate per chunk ({...metadata, score});
// selection is done separately by topK (the heap). This module never truncates.

const STOPWORDS = new Set(
  ("a an and are as at be by can do does for from has have how i if in into is it its may me my " +
    "no not of on or our shall should so such that the their them then there these they this to " +
    "under upon was we what when where which who will with within without would you your").split(" ")
);

export function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1 && !STOPWORDS.has(t));
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

  expand(queryTokens) {
    const out = new Set(queryTokens);
    for (const t of queryTokens) for (const s of this.synonyms[t] ?? []) tokenize(s).forEach((x) => out.add(x));
    return [...out];
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
