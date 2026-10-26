// Question answering over the personal experience corpus (RAG pipeline entry).

const { getCorpus } = require('./ragIndex');
const { retrieve } = require('../rag/retriever');
const { synthesize } = require('../rag/synthesizer');
const llm = require('./llmClient');

const LLM_SYSTEM_PROMPT = [
  'You are KARMA, a career-intelligence assistant that answers ONLY from the provided context',
  'about its owner experience. Never invent facts. If the context does not contain the answer,',
  'say so plainly. Answer in short, crisp sentences. Cite sources as [n] matching the context',
  'block numbers.',
].join(' ');

function contextToPrompt(ranked) {
  return ranked
    .map(
      (r, i) =>
        `Context [${i + 1}] (source: ${r.sourceTitle}${r.heading ? ` > ${r.heading}` : ''}):\n${r.text}`
    )
    .join('\n\n');
}

async function ask(question, { topK = 5, useLlm = true } = {}) {
  const q = String(question || '').trim();
  if (!q) {
    const err = new Error('Question is required');
    err.status = 400;
    throw err;
  }

  const corpus = await getCorpus();
  if (!corpus.length) {
    return {
      question: q,
      answer: 'The memory index is empty. Ingest documents or wait for the autopilot to seed, then ask again.',
      references: [],
      confidence: 0,
      metrics: { mode: 'empty-index', chunksUsed: 0 },
      llmUsed: false,
    };
  }

  const ranked = retrieve(q, corpus, { topK });
  const local = synthesize(q, ranked);

  let answer = local.answer;
  let llmUsed = false;

  if (useLlm && llm.isConfigured()) {
    try {
      const prompt = [
        'Answer the question using ONLY this context from stored experience.',
        'Cite blocks as [1], [2], ...',
        '',
        contextToPrompt(ranked),
        '',
        `Question: ${q}`,
      ].join('\n');
      const llmAnswer = await llm.complete(LLM_SYSTEM_PROMPT, prompt);
      if (llmAnswer && llmAnswer.trim().length > 20) {
        answer = llmAnswer.trim();
        llmUsed = true;
      }
    } catch (err) {
      // LLM failure is non-fatal: local extractive answer stands.
      answer = local.answer;
    }
  }

  const references = local.references.map((r) => ({ ...r }));

  return {
    question: q,
    answer,
    references,
    confidence: local.confidence,
    metrics: { ...local.metrics, mode: llmUsed ? 'llm' : 'local-extractive', corpusSize: corpus.length },
    llmUsed,
    chunkIds: ranked.map((r) => r.id),
  };
}

module.exports = { ask, LLM_SYSTEM_PROMPT };
