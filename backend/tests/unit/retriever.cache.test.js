// Caching behavior of the hybrid retriever: fitted BM25/TF-IDF engines are
// reused when the identical corpus array reference is queried repeatedly (the
// common case with the version-cached corpus), and rebuilt when a new corpus
// is supplied. Modules are reset per test so cache state never leaks.

const CORPUS = [
  { id: '1', text: 'Built a full-stack MERN application with React, Node.js, Express and MongoDB.', heading: 'MERN practice', sourceType: 'experience', sourceTitle: 'MERN', createdAt: new Date('2025-01-01') },
  { id: '2', text: 'Trained machine learning classifiers in Python with NumPy, pandas and scikit-learn.', heading: 'ML foundations', sourceType: 'experience', sourceTitle: 'ML', createdAt: new Date('2025-02-01') },
];

describe('retriever fitted-engine cache', () => {
  let retrieve;
  let fitSpy;

  beforeEach(() => {
    jest.resetModules();
    const tfidfModule = require('../../src/rag/tfidf');
    fitSpy = jest.spyOn(tfidfModule.TfidfVectorizer.prototype, 'fit');
    ({ retrieve } = require('../../src/rag/retriever'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fits the vectorizer once for repeated queries on the same corpus reference', () => {
    retrieve('react mongodb', CORPUS, { topK: 2 });
    retrieve('python scikit-learn', CORPUS, { topK: 2 });
    retrieve('rag pipeline', CORPUS, { topK: 2 });

    expect(fitSpy).toHaveBeenCalledTimes(1);
  });

  it('re-fits when a different corpus array is supplied', () => {
    retrieve('react mongodb', CORPUS, { topK: 2 });
    retrieve('react mongodb', [...CORPUS], { topK: 2 }); // new array reference = index change

    expect(fitSpy).toHaveBeenCalledTimes(2);
  });

  it('still returns full results through the cached engines', () => {
    const first = retrieve('What did I build with React and MongoDB?', CORPUS, { topK: 2 });
    const second = retrieve('What did I build with React and MongoDB?', CORPUS, { topK: 2 });
    expect(first[0].id).toBe('1');
    expect(second[0].id).toBe('1');
  });
});
