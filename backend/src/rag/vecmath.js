// Sparse vector math helpers.

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const term in a) {
    na += a[term] * a[term];
    if (term in b) dot += a[term] * b[term];
  }
  for (const term in b) nb += b[term] * b[term];
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Min-max normalize scores within a result set (null-safe for constant sets).
function normalizeScores(scores) {
  if (!scores.length) return [...scores];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (max === min) return scores.map(() => (max > 0 ? 1 : 0));
  return scores.map((s) => (s - min) / (max - min));
}

// Reciprocal Rank Fusion over two ranked id lists.
function rrf(listA, listB, { k = 60, wA = 0.7, wB = 0.3 } = {}) {
  const score = new Map();
  const add = (ids, w) => {
    ids.forEach((id, rank) => {
      score.set(id, (score.get(id) || 0) + w / (k + rank + 1));
    });
  };
  add(listA, wA);
  add(listB, wB);
  return [...score.entries()]
    .map(([id, fused]) => ({ id, fused }))
    .sort((a, b) => b.fused - a.fused);
}

module.exports = { cosine, normalizeScores, rrf };
