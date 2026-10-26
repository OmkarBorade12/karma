// Indexing service: ingest text -> chunk -> store term-frequency vectors.
// IDF weighting happens at query time over the whole local corpus, so the
// vector quality always reflects the current knowledge base.

const Chunk = require('../models/Chunk');
const { chunkText } = require('../rag/chunker');
const { tokenize } = require('../rag/tokenizer');

// Term-count map for a chunk's tokens (sparse {term: count}).
function termCounts(tokens) {
  const counts = {};
  for (const t of tokens) counts[t] = (counts[t] || 0) + 1;
  return counts;
}

// Bumped every time the index content changes. Consumers cache per version.
let corpusVersion = 0;
const corpusCache = { version: null, corpus: null };

function bumpCorpusVersion() {
  corpusVersion += 1;
}

/**
 * Chunk and index a plain-text document.
 * Returns the created Chunk documents.
 */
async function indexDocument({ documentId, text, sourceTitle, sourceType, contentLength }) {
  const pieces = chunkText(text);
  if (!pieces.length) return [];

  const docs = pieces.map((p) => {
    const tokens = tokenize(`${p.heading ? p.heading + ' ' : ''}${p.text}`);
    return {
      document: documentId,
      indexInDoc: p.index,
      heading: p.heading || null,
      text: p.text,
      sourceTitle: sourceTitle || 'Untitled',
      sourceType: sourceType || 'note',
      terms: termCounts(tokens),
      tokenCount: tokens.length,
    };
  });
  const created = await Chunk.insertMany(docs, { ordered: false });
  bumpCorpusVersion();
  return created;
}

/**
 * Delete all chunks belonging to a document.
 */
async function deindexDocument(documentId) {
  const res = await Chunk.deleteMany({ document: documentId });
  bumpCorpusVersion();
  return res.deletedCount;
}

/**
 * Load the retrieval corpus: [{ id, text, heading, sourceType, sourceTitle, createdAt }]
 * from which the retriever builds BM25 + TF-IDF indices at query time.
 */
async function loadCorpus() {
  const docs = await Chunk.find({}, 'text heading sourceTitle sourceType createdAt')
    .sort({ createdAt: 1 })
    .lean();

  return docs.map((d) => ({
    id: String(d._id),
    text: d.text,
    heading: d.heading,
    sourceTitle: d.sourceTitle,
    sourceType: d.sourceType,
    createdAt: d.createdAt,
  }));
}

/**
 * Version-aware cached corpus access: identical to loadCorpus() but repeats
 * are served from memory until an index write invalidates the cache. This keeps
 * /api/ask from re-loading every chunk from MongoDB on each query.
 */
async function getCorpus() {
  if (corpusCache.corpus && corpusCache.version === corpusVersion) return corpusCache.corpus;
  const corpus = await loadCorpus();
  corpusCache.version = corpusVersion;
  corpusCache.corpus = corpus;
  return corpus;
}

module.exports = { indexDocument, deindexDocument, loadCorpus, getCorpus, termCounts };
