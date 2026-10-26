// Local extractive answer synthesizer: composes a cited, question-aware answer
// purely from retrieved chunks. Deterministic, no external model required.

const { tokenize, wordsForDisplay, isStopword } = require('./tokenizer');

// Classify question intent to shape the answer's structure.
function detectIntent(question) {
  const q = question.toLowerCase();
  if (/\b(list|skills|tech stack|know|tools|languages)\b/.test(q) && /\bskill|stack|tool|language/.test(q)) return 'skills';
  if (/\bprojects?\b/.test(q)) return 'projects';
  if (/\bexperience|worked|intern|career|background|journey|story\b/.test(q)) return 'experience';
  if (/\bhow (long|much)|when\b/.test(q)) return 'timeline';
  return 'general';
}

// Split a chunk's text into sentences, keeping list items intact.
function toUnits(text) {
  const units = [];
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[-*\u2022]/.test(trimmed) || trimmed.length < 60) {
      units.push(trimmed);
      continue;
    }
    // Split long prose into sentences
    const sentences = trimmed.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
    units.push(...sentences.filter(Boolean));
  }
  return units;
}

// Low-information structural units never make good answer lines.
// QA-source "Q:" lines are interview prompts, not answer material — the
// matching "A:" line carries the content they'd surface.
const LABEL_PREFIX_RE = /^(title|organization|source|type|kind|outcome|Q)\s*:/i;
const SOURCE_PAREN_RE = /^\(source[:.)]/i;

function isLowInfo(unit) {
  return LABEL_PREFIX_RE.test(unit.trim()) || SOURCE_PAREN_RE.test(unit.trim());
}

// Score a sentence by overlap with query terms (display words, non-stemmed).
function scoreUnit(unit, queryStems, queryWords) {
  if (isLowInfo(unit)) return -1;
  const stems = new Set(tokenize(unit));
  let stemHits = 0;
  for (const q of queryStems) if (stems.has(q)) stemHits += 1;
  const stemScore = stemHits / (queryStems.length || 1);

  const unitWords = wordsForDisplay(unit);
  const uWords = new Set(unitWords);
  let wordHits = 0;
  for (const w of queryWords) if (uWords.has(w)) wordHits += 1;
  const wordScore = wordHits / (queryWords.length || 1);

  // Reward info-dense units (numbers, tech terms) and penalize stopword soup.
  const density = unitWords.filter((w) => !isStopword(w)).length / (unit.split(/\s+/).length || 1);
  const hasNumbersOrDetails = /\d|x/.test(unit) ? 0.05 : 0;

  return stemScore * 0.6 + wordScore * 0.4 + density * 0.1 + hasNumbersOrDetails;
}

/**
 * Compose an answer.
 * Returns { answer, references, confidence, metrics } where references is
 * [{ n, sourceTitle, heading, sourceType }] numbered as cited in the text.
 */
function synthesize(question, rankedChunks, { maxUnits = 7 } = {}) {
  if (!rankedChunks.length) {
    return {
      answer: "I couldn't find anything in the stored experience that matches this question yet. Try ingesting more documents or rephrasing.",
      references: [],
      confidence: 0,
      metrics: { unitsUsed: 0 },
    };
  }

  const queryStems = [...new Set(tokenize(question))];
  const queryWords = wordsForDisplay(question);
  const intent = detectIntent(question);

  // Rank individual units (sentences/list items) across chunks, keeping provenance.
  const candidates = [];
  rankedChunks.forEach((chunk, chunkIdx) => {
    for (const unit of toUnits(chunk.text)) {
      let s = scoreUnit(unit, queryStems, queryWords);
      // Skills questions should surface explicit skill lists over structural noise.
      if (intent === 'skills' && /^skills?\s*:/i.test(unit.trim())) s += 0.15;
      candidates.push({
        unit,
        chunkIdx,
        chunk,
        score: s + (chunk.rerankScore || chunk.fusedScore || 0) * 0.15,
      });
    }
  });
  candidates.sort((a, b) => b.score - a.score);

  const references = []; // [{n, ...}] stable numbering by chunk order used
  const chunkToRef = new Map();
  rankedChunks.forEach((chunk, i) => {
    references.push({
      n: i + 1,
      sourceTitle: chunk.sourceTitle || 'Untitled source',
      heading: chunk.heading || null,
      sourceType: chunk.sourceType || 'unknown',
      text: (chunk.text || '').slice(0, 400),
    });
    chunkToRef.set(i, i + 1);
  });

  const chosen = [];
  const seen = new Set();
  for (const cand of candidates) {
    if (chosen.length >= maxUnits) break;
    if (cand.score <= 0.05) break;
    const key = cand.unit.toLowerCase();
    if (seen.has(key)) continue;
    // skip near-duplicates (same first 8 words)
    const fp = key.split(/\s+/).slice(0, 8).join(' ');
    if (seen.has(fp)) continue;
    seen.add(key);
    seen.add(fp);
    chosen.push(cand);
  }

  let lead = null;
  if (intent === 'projects') {
    lead = chosen.find((c) => /\b(built|developed|created|implemented|project)\b/i.test(c.unit));
  } else if (intent === 'experience') {
    lead = chosen.find((c) => /\b(worked|intern|experience|role|at)\b/i.test(c.unit));
  } else if (intent === 'skills') {
    lead = chosen.find((c) => /\b(skills?|proficient|experience with|technologies|stack)\b/i.test(c.unit));
  }

  const ordered = lead ? [lead, ...chosen.filter((c) => c !== lead)] : chosen;
  const bodyLines = ordered.map((c) =>
    `- ${stripListMarker(c.unit).trim()} [${chunkToRef.get(c.chunkIdx)}]`
  );

  const answer = [
    "Here's what your stored experience says:",
    ...bodyLines,
  ].join('\n');

  const avgCoverage = rankedChunks.reduce((s, c) => s + (c.coverage ?? 0), 0) / rankedChunks.length;
  const confidence = Math.max(0, Math.min(1, avgCoverage * 0.6 + Math.min(chosen.length, 5) / 5 * 0.4));
  const metrics = { unitsUsed: ordered.length, chunksUsed: rankedChunks.length, intent };

  return { answer, references, confidence, metrics };
}

function stripListMarker(u) {
  return u.replace(/^[-*\u2022]\s*/, '');
}

module.exports = { synthesize, detectIntent, scoreUnit, toUnits };
