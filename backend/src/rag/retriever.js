// Hybrid retriever: BM25 (lexical) + TF-IDF cosine (semantic-light) fused via
// Reciprocal Rank Fusion, then a deterministic precision reranker.

const { Bm25Index } = require('./bm25');
const { TfidfVectorizer, expandQuery } = require('./tfidf');
const { cosine, rrf } = require('./vecmath');
const { tokenize } = require('./tokenizer');

const BM25_POOL = 15;
const VECTOR_POOL = 15;
const RERANK_TOP = 10;

// Fitted-engine cache. When the same corpus array reference is reused across
// queries (the common case with the version-cached corpus), the BM25/TF-IDF
// indices are fitted once instead of rebuilt on every single /api/ask.
const fittedCache = { corpus: null, bm25: null, vectorizer: null, embeddings: null };

function getFittedEngines(chunks) {
  if (fittedCache.corpus === chunks) return fittedCache;
  const bm25 = new Bm25Index();
  for (const c of chunks) bm25.add(c.id, c.text, {});
  bm25.fit();
  const vectorizer = new TfidfVectorizer().fit(chunks.map((c) => tokenize(c.text)));
  const embeddings = chunks.map((c) => [c.id, vectorizer.embed(tokenize(c.text))]);
  fittedCache.corpus = chunks;
  fittedCache.bm25 = bm25;
  fittedCache.vectorizer = vectorizer;
  fittedCache.embeddings = embeddings;
  return fittedCache;
}

function uniqTokens(tokens) {
  return new Set(tokens);
}

// Fine-grained deterministic reranking of the fused candidate pool.
function rerank(candidates, queryTokens, { now = new Date() } = {}) {
  const qSet = uniqTokens(queryTokens);
  return candidates
    .map((c) => {
      const tokens = tokenize(c.text);
      const tSet = uniqTokens(tokens);
      let score = c.fusedScore;

      // 1) Distinct query-term coverage — the dominant rerank signal.
      let covered = 0;
      for (const q of qSet) if (tSet.has(q)) covered += 1;
      const coverage = covered / (qSet.size || 1);
      score += coverage * 0.5;

      // 2) Heading relevance (headings are high-signal section labels).
      if (c.heading) {
        const hTokens = uniqTokens(tokenize(c.heading));
        let hHit = false;
        for (const t of hTokens) if (qSet.has(t)) hHit = true;
        if (hHit) score += 0.15;
      }

      // 3) Source-type weights: experience narratives beat auxiliary notes.
      const typeWeight = { experience: 0.12, project: 0.1, resume: 0.08, note: 0.03, qa: 0.05, insight: 0.04 };
      score += typeWeight[c.sourceType] ?? 0.02;

      // 4) Length prior — slightly prefer meaty chunks over tiny ones.
      const len = c.text.length;
      if (len >= 200 && len <= 900) score += 0.05;
      if (len < 80) score -= 0.05;

      // 5) Freshness of the source document (mild).
      if (c.createdAt) {
        const ageDays = Math.max(0, (now - new Date(c.createdAt)) / 86400000);
        score += Math.max(0, 0.05 - ageDays / 100000);
      }

      return { ...c, rerankScore: score, coverage };
    })
    .sort((a, b) => b.rerankScore - a.rerankScore);
}

/**
 * Retrieve top-K chunks for a question.
 * chunks: [{ id, text, heading, sourceType, sourceTitle, createdAt }]
 * Returns ranked chunks with score breakdowns; [] when nothing matches.
 */
function retrieve(question, chunks, { topK = 5, poolSize = RERANK_TOP, now = new Date() } = {}) {
  if (!chunks.length || !question.trim()) return [];
  const queryTokens = tokenize(question);
  if (!queryTokens.length) return [];
  const expanded = expandQuery(queryTokens);

  const { bm25, vectorizer, embeddings } = getFittedEngines(chunks);
  const bm25Ranked = bm25.score(queryTokens).slice(0, BM25_POOL).map(([id, s]) => ({ id, s }));

  const queryVec = vectorizer.embed(expanded);
  const cosRanked = embeddings
    .map(([id, vec]) => ({ id, s: cosine(queryVec, vec) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, VECTOR_POOL);

  const fused = rrf(bm25Ranked.map((r) => r.id), cosRanked.map((r) => r.id));
  const scoreById = {
    bm25: new Map(bm25Ranked.map((r) => [r.id, r.s])),
    cos: new Map(cosRanked.map((r) => [r.id, r.s])),
  };

  const pool = fused
    .slice(0, Math.max(poolSize, topK))
    .map(({ id, fused: fusedScore }) => {
      const c = chunks.find((ch) => String(ch.id) === String(id));
      if (!c) return null;
      return {
        ...c,
        fusedScore,
        bm25Score: scoreById.bm25.get(id) || 0,
        cosineScore: scoreById.cos.get(id) || 0,
      };
    })
    .filter(Boolean);

  const ranked = rerank(pool, queryTokens, { now });
  return ranked.slice(0, topK);
}

module.exports = { retrieve, rerank };
