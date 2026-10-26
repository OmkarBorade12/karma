// BM25 (Okapi) scoring over a local corpus of chunks.

const { tokenize } = require('./tokenizer');

class Bm25Index {
  constructor({ k1 = 1.5, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.docs = []; // { id, tokens, tf, len }
    this.options = [];
    this.avgdl = 0;
    this.df = new Map();
  }

  add(id, text, options = {}) {
    const tokens = tokenize(text);
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    this.docs.push({ id, tf, len: tokens.length || 1 });
    this.options.push({ id, options });
    return this;
  }

  fit() {
    this.avgdl = this.docs.reduce((s, d) => s + d.len, 0) / (this.docs.length || 1);
    this.df = new Map();
    for (const d of this.docs) {
      for (const term of d.tf.keys()) this.df.set(term, (this.df.get(term) || 0) + 1);
    }
    return this;
  }

  idfRaw(term) {
    const n = this.docs.length || 1;
    const df = this.df.get(term) || 0;
    // Okapi idf (non-negative variant).
    return Math.log((n - df + 0.5) / (df + 0.5) + 1);
  }

  score(queryTokens) {
    const results = new Map();
    for (const d of this.docs) {
      let s = 0;
      for (const term of new Set(queryTokens)) {
        const f = d.tf.get(term) || 0;
        if (!f) continue;
        const idf = this.idfRaw(term);
        const denom = f + this.k1 * (1 - this.b + this.b * (d.len / this.avgdl));
        s += idf * ((f * (this.k1 + 1)) / denom);
      }
      if (s > 0) results.set(d.id, s);
    }
    return [...results.entries()].sort((a, b) => b[1] - a[1]);
  }
}

module.exports = { Bm25Index };
