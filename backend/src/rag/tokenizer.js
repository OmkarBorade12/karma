// Text normalization, tokenization and stemming utilities used across the RAG engine.

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'so', 'because',
  'of', 'at', 'by', 'for', 'with', 'about', 'to', 'from', 'in', 'into', 'on',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
  'have', 'has', 'had', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he',
  'she', 'his', 'her', 'it', 'its', 'they', 'them', 'their', 'this', 'that',
  'these', 'those', 'as', 'there', 'here', 'what', 'which', 'who', 'whom',
  'will', 'would', 'can', 'could', 'should', 'may', 'might', 'just', 'also',
]);

const STOPWORD_PREFIXES = /^(?:pre|post|trans|de|un|in|re|con)$/;

// Light rule-based suffix stripping (Porter-flavoured, deterministic, no deps).
function consolidateBase(base) {
  // Undo geminated consonants from -ing/-ed stripping ('running' -> 'runn' -> 'run').
  const last3 = base.slice(-3);
  if (last3.length === 3 && last3[1] === last3[2] && !/[aeiouyw]/.test(last3[2])) {
    return base.slice(0, -1);
  }
  return base;
}

function stem(word) {
  if (word.length <= 3) return word;
  if (word.endsWith('ization')) return word.slice(0, -7) + 'ize';
  if (word.endsWith('ational')) return word.slice(0, -7) + 'ate';
  if (word.endsWith('iveness') || word.endsWith('fulness') || word.endsWith('ousness')) {
    return word.slice(0, -4);
  }
  if (word.endsWith('ement')) return word.slice(0, -3);
  if (word.endsWith('ability')) return word.slice(0, -5);
  if (word.endsWith('arily')) return word.slice(0, -5);
  if (word.endsWith('ally') && word.length > 6) return word.slice(0, -4);
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('ss')) return word;
  if (word.endsWith('s') && !word.endsWith('us') && word.length > 4) return word.slice(0, -1);
  if (word.endsWith('ing') && word.length > 5) return consolidateBase(word.slice(0, -3));
  if (word.endsWith('ed') && word.length > 5) return consolidateBase(word.slice(0, -2));
  if (word.endsWith('ly') && word.length > 5) return word.slice(0, -2);
  return word;
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[^\w\s'+#.:/-]/g, ' ');
}

const KEEP = new Set(['node.js', 'next.js', 'c#', 'vue.js', 'react.js', 'angular.js']);

// Tokens: lowercase, punctuation-normalized, stopword-filtered, stemmed.
// Well-known tech identifiers survive stemming and stopword removal intact.
function tokenize(text, { keepStopwords = false } = {}) {
  const cleaned = normalize(text);
  const raw = cleaned.split(/[\s]+/).filter(Boolean);
  const out = [];
  for (const tok of raw) {
    const dotted = tok.replace(/^-+|-+$/g, '');
    if (KEEP.has(dotted) || /^[#/][\w/#.+]+$/.test(dotted)) {
      out.push(dotted);
      continue;
    }
    const words = dotted.split(/[./]/).filter(Boolean);
    for (const w of words) {
      if (!/^[a-z0-9]+[\w-]*$/.test(w) || w.length < 2) continue;
      if (STOPWORD_PREFIXES.test(w)) continue;
      if (!keepStopwords && STOPWORDS.has(w)) continue;
      out.push(stem(w));
    }
  }
  return out;
}

// Original (unstemmed, lightly normalized) words — used for highlighting/citations.
function wordsForDisplay(text) {
  return normalize(text)
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
}

function isStopword(word) {
  return STOPWORDS.has(word);
}

module.exports = { tokenize, stem, normalize, wordsForDisplay, isStopword, STOPWORDS };
