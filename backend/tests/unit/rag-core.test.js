const { TfidfVectorizer, expandQuery } = require('../../src/rag/tfidf');
const { cosine, normalizeScores, rrf } = require('../../src/rag/vecmath');
const { Bm25Index } = require('../../src/rag/bm25');

describe('tfidf vectorizer', () => {
  const corpus = [
    'built a react dashboard with mongodb Express backend',
    'trained machine learning classifiers with scikit-learn',
    'designed a RAG pipeline with BM25 and TF-IDF retrieval',
  ];

  it('fits idf weights and embeds with expected vector shape', () => {
    const v = new TfidfVectorizer();
    const tokenLists = corpus.map((t) => t.split(' '));
    v.fit(tokenLists);
    expect(v.docCount).toBe(3);
    expect(v.vocabSize).toBeGreaterThan(10);
    const vec = v.embed(['react', 'dashboard', 'tensorflow']);
    expect(vec['react']).toBeGreaterThan(0);
    expect(vec['tensorflow']).toBeGreaterThan(0); // unseen term gets fallback idf
  });

  it('rare terms weigh more than common terms', () => {
    const v = new TfidfVectorizer();
    v.fit(corpus.map((t) => t.split(' ')));
    const vec = v.embed(['rag', 'pipeline']);
    // 'rag' appears in 1 doc; should not be dominated by a multi-doc term
    expect(vec['rag']).toBeGreaterThan(0);
  });

  it('embed produces L2-normalized vectors', () => {
    const v = new TfidfVectorizer().fit(corpus.map((t) => t.split(' ')));
    const vec = v.embed(['react', 'mongodb', 'trained']);
    const norm = Math.sqrt(Object.values(vec).reduce((s, w) => s + w * w, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('cosine of identical vectors is 1, orthogonal is ~0', () => {
    const v = new TfidfVectorizer().fit([['react'], ['python']]);
    const a = v.embed(['react']);
    const b = v.embed(['react']);
    const c = v.embed(['python']);
    expect(cosine(a, b)).toBeCloseTo(1, 5);
    expect(cosine(a, c)).toBeCloseTo(0, 5);
  });
});

describe('vecmath helpers', () => {
  it('normalizeScores min-max normalizes', () => {
    expect(normalizeScores([0, 5, 10])).toEqual([0, 0.5, 1]);
  });
  it('normalizeScores safe for constant nonzero arrays', () => {
    expect(normalizeScores([3, 3])).toEqual([1, 1]);
  });
  it('rrf fuses two ranked lists with position decay', () => {
    const fused = rrf(['a', 'b'], ['b', 'c']);
    const byId = Object.fromEntries(fused.map((f) => [f.id, f.fused]));
    // 'b' appears in both lists -> top fused score
    expect(byId['b']).toBeGreaterThan(byId['a']);
    expect(byId['a']).toBeGreaterThan(byId['c']); // rank-1 list weight beats rank-2
  });
});

describe('BM25 index', () => {
  const build = () => {
    const index = new Bm25Index();
    index.add('1', 'built a react dashboard with mongodb and express');
    index.add('2', 'trained machine learning classifiers with scikit-learn');
    index.add('3', 'designed a RAG pipeline with BM25 and TF-IDF retrieval');
    return index.fit();
  };

  it('ranks lexically relevant docs first', () => {
    const index = build();
    const ranked = index.score(['react', 'dashboard']);
    expect(ranked[0][0]).toBe('1');
  });

  it('returns empty for no-match queries', () => {
    const index = build();
    expect(index.score(['kubernetes', 'helm']).length).toBe(0);
  });

  it('term frequency saturates (BM25 sublinear behaviour)', () => {
    const one = new Bm25Index();
    one.add('x', 'mongo');
    one.add('y', 'other');
    one.fit();
    const s1 = one.score(['mongo'])[0][1];

    const six = new Bm25Index();
    six.add('x', 'mongo mongo mongo mongo mongo mongo');
    six.add('y', 'other');
    six.fit();
    const s6 = six.score(['mongo'])[0][1];

    // tf=6 must score much less than linear growth (6x), i.e. saturating.
    expect(s6).toBeLessThan(s1 * 4);
    expect(s6).toBeGreaterThan(s1);
  });
});
