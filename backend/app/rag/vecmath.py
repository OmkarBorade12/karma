"""Sparse vector math + Reciprocal Rank Fusion."""


def normalize_scores(scores):
    """Min-max normalize a score list; constant nonzero sets map to all-1."""
    if not scores:
        return list(scores)
    lo, hi = min(scores), max(scores)
    if hi == lo:
        return [1 if hi > 0 else 0 for _ in scores]
    return [(s - lo) / (hi - lo) for s in scores]


def rrf(list_a, list_b, k: int = 60, w_a: float = 0.7, w_b: float = 0.3) -> list:
    """Weighted Reciprocal Rank Fusion over two ranked id lists.

    Returns [{id, fused}] sorted by fused score desc.
    """
    score = {}

    def add(ids, w):
        for rank, doc_id in enumerate(ids):
            score[doc_id] = score.get(doc_id, 0.0) + w / (k + rank + 1)

    add(list_a, w_a)
    add(list_b, w_b)
    return [{"id": i, "fused": f} for i, f in sorted(score.items(), key=lambda kv: kv[1], reverse=True)]
