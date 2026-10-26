// TF-IDF vectorizer (from scratch) over the local corpus. Produces sparse
// { term: weight } embeddings suitable for cosine similarity, stored directly
// in MongoDB objects.

const { tokenize } = require('./tokenizer');

class TfidfVectorizer {
  constructor() {
    this.idf = new Map(); // term -> idf weight
    this.vocabSize = 0;
    this.docCount = 0;
  }

  /** Fit against an array of token arrays (one per chunk). */
  fit(tokenLists) {
    const df = new Map();
    let total = 0;
    for (const tokens of tokenLists) {
      total += 1;
      const seen = new Set();
      for (const t of tokens) {
        if (seen.has(t)) continue;
        seen.add(t);
        df.set(t, (df.get(t) || 0) + 1);
      }
    }
    this.docCount = total;
    this.idf = new Map();
    // Smooth inverse document frequency (standard scikit-learn-like formulation).
    for (const [term, freq] of df.entries()) {
      this.idf.set(term, Math.log((1 + total) / (1 + freq)) + 1);
    }
    this.vocabSize = df.size;
    return this;
  }

  tf(tokens) {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    return tf;
  }

  /** Embed a token list into a sparse TF-IDF vector (L2-normalized). */
  embed(tokens) {
    const tf = this.tf(tokens);
    const vec = {};
    for (const [term, count] of tf.entries()) {
      const idf = this.idf.get(term) ?? Math.log(1 + this.docCount + 1) + 1;
      vec[term] = (1 + Math.log(count)) * idf;
    }
    let norm = 0;
    for (const w of Object.values(vec)) norm += w * w;
    norm = Math.sqrt(norm) || 1;
    for (const term of Object.keys(vec)) vec[term] /= norm;
    return vec;
  }
}

// Expand a bare text query with nearby conceptual synonyms (a miniature,
// hand-curated retrieval aid — purely lexical, no external model).
const SYNONYMS = {
  react: ['hooks', 'component', 'frontend'],
  mongodb: ['database', 'nosql', 'collection'],
  node: ['backend', 'server', 'express'],
  python: ['script', 'ml', 'numpy', 'pandas'],
  machine: ['model', 'training', 'features'],
  internship: ['intern', 'experience', 'worked'],
  project: ['built', 'developed', 'implemented'],
  data: ['dataset', 'pipeline', 'analysis'],
  api: ['rest', 'endpoint', 'http'],
  leader: ['led', 'team', 'managed', 'coordinated'],
  hackathon: ['competition', 'prize', 'winner'],
};

function expandQuery(tokens) {
  const out = [...tokens];
  for (const t of tokens) {
    const syn = SYNONYMS[t];
    if (syn) out.push(...syn.map((s) => s.split(' ')).flat());
  }
  return out;
}

module.exports = { TfidfVectorizer, expandQuery, SYNONYMS };
