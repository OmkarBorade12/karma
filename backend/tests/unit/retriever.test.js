const { retrieve, rerank } = require('../../src/rag/retriever');

const CORPUS = [
  { id: '1', text: 'Built a full-stack MERN application with React, Node.js, Express and MongoDB including REST APIs and authentication.', heading: 'Full-Stack MERN development practice', sourceType: 'experience', sourceTitle: 'MERN practice', createdAt: new Date('2025-01-01') },
  { id: '2', text: 'Trained machine learning classifiers in Python with NumPy, pandas and scikit-learn using cross-validation.', heading: 'Machine Learning Foundations', sourceType: 'experience', sourceTitle: 'ML foundations', createdAt: new Date('2025-02-01') },
  { id: '3', text: 'Implemented a retrieval-augmented generation pipeline: BM25 + TF-IDF cosine retrieval with reciprocal rank fusion and cited answer synthesis.', heading: 'RAG and intelligent-systems', sourceType: 'experience', sourceTitle: 'RAG study', createdAt: new Date('2025-03-01') },
  { id: '4', text: 'I like coffee in the mornings before coding sessions.', heading: '', sourceType: 'note', sourceTitle: 'Daily notes', createdAt: new Date('2025-04-01') },
];

describe('hybrid retriever', () => {
  it('ranks the most relevant chunk first', () => {
    const hits = retrieve('What did I build with React and MongoDB?', CORPUS, { topK: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe('1');
  });

  it('finds ML experience for skill questions', () => {
    const hits = retrieve('What experience do I have with scikit-learn?', CORPUS, { topK: 2 });
    expect(hits[0].id).toBe('2');
  });

  it('excludes irrelevant personal notes from top results for technical queries', () => {
    const hits = retrieve('How does my RAG pipeline retrieve documents?', CORPUS, { topK: 3 });
    expect(hits.some((h) => h.id === '4')).toBe(false);
  });

  it('returns [] for empty corpus or empty question', () => {
    expect(retrieve('anything', [], { topK: 3 })).toEqual([]);
    expect(retrieve('   ', CORPUS, { topK: 3 })).toEqual([]);
  });

  it('attaches score breakdown fields', () => {
    const hits = retrieve('react dashboard', CORPUS, { topK: 1 });
    expect(hits[0]).toHaveProperty('fusedScore');
    expect(hits[0]).toHaveProperty('bm25Score');
    expect(hits[0]).toHaveProperty('cosineScore');
    expect(hits[0]).toHaveProperty('rerankScore');
    expect(hits[0]).toHaveProperty('coverage');
  });

  it('respects topK bounds', () => {
    const hits = retrieve('experience with React, Python or RAG', CORPUS, { topK: 2 });
    expect(hits.length).toBe(2);
  });
});

describe('rerank', () => {
  const q = ['react', 'applications'];

  it('boosts chunks covering more query terms', () => {
    const a = { id: 'a', text: 'React applications built with care.', fusedScore: 0.01, sourceType: 'note', createdAt: new Date() };
    const b = { id: 'b', text: 'Unrelated text completely.', fusedScore: 0.01, sourceType: 'note', createdAt: new Date() };
    const ranked = rerank([b, a], q);
    expect(ranked[0].id).toBe('a');
  });

  it('applies source-type weights (experience > note)', () => {
    const sameText = 'documents about react applications and node';
    const exp = { id: 'e', text: sameText, heading: null, fusedScore: 0.5, sourceType: 'experience', createdAt: new Date() };
    const note = { id: 'n', text: sameText, heading: null, fusedScore: 0.5, sourceType: 'note', createdAt: new Date() };
    const ranked = rerank([note, exp], q);
    expect(ranked[0].id).toBe('e');
  });
});
