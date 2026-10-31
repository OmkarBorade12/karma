"""Hybrid retriever: BM25 (lexical) + TF-IDF/Qdrant vector (semantic) fused via
Reciprocal Rank Fusion, then a deterministic precision reranker.

The fitted engines (BM25 index + sklearn TF-IDF) are cached per corpus object
identity — with the version-cached corpus this means one fit per corpus
version instead of a rebuild on every query. The vector side runs through the
Qdrant vector store when available and falls back to in-process cosine.
"""

from datetime import datetime, timezone

from .bm25 import Bm25Index
from .tfidf import TfidfEngine, cosine_sparse, expand_query
from .vecmath import rrf
from .tokenizer import tokenize

BM25_POOL = 15
VECTOR_POOL = 15
RERANK_TOP = 10

TYPE_WEIGHTS = {
    "experience": 0.12,
    "project": 0.10,
    "resume": 0.08,
    "note": 0.03,
    "qa": 0.05,
    "insight": 0.04,
}

# Fitted-engine cache keyed by corpus object identity (the common case is the
# version-cached corpus list, reused across queries until an index write).
_fitted = {
    "corpus": None,
    "bm25": None,
    "engine": None,
    "doc_sparse": None,
}


def get_fitted_engines(chunks):
    if _fitted["corpus"] is chunks and _fitted["bm25"] is not None:
        return _fitted

    bm25 = Bm25Index()
    for c in chunks:
        bm25.add(c["id"], c["text"])
    bm25.fit()

    engine = TfidfEngine().fit([c["text"] for c in chunks])
    matrix = engine.embed_matrix([c["text"] for c in chunks]).tocsr()
    doc_sparse = []
    for row in matrix:
        coo = row.tocoo()
        doc_sparse.append({int(col): float(w) for col, w in zip(coo.col, coo.data) if w > 0})

    _fitted["corpus"] = chunks
    _fitted["bm25"] = bm25
    _fitted["engine"] = engine
    _fitted["doc_sparse"] = doc_sparse
    return _fitted


def reset_fitted_cache():
    """Test helper: drop the fitted-engine cache between test modules."""
    _fitted["corpus"] = None
    _fitted["bm25"] = None
    _fitted["engine"] = None
    _fitted["doc_sparse"] = None


def _vector_rank(expanded_tokens, engine, doc_sparse, chunks, pool):
    """Rank chunks by TF-IDF cosine, preferring the Qdrant vector store."""
    query_sparse = engine.embed_query(expanded_tokens)
    try:
        from ..services.vector_store import get_vector_store

        store = get_vector_store()
        ranked = store.search(query_sparse, engine, chunks, pool)
        if ranked is not None:
            return ranked
    except Exception:
        pass
    # In-process cosine fallback
    scored = [
        {"id": c["id"], "s": cosine_sparse(query_sparse, doc_sparse[i])}
        for i, c in enumerate(chunks)
    ]
    scored = [x for x in scored if x["s"] > 0]
    scored.sort(key=lambda x: x["s"], reverse=True)
    return scored[:pool]


def _unique(tokens) -> set:
    return set(tokens)


def rerank(candidates, query_tokens, now=None):
    """Fine-grained deterministic reranking of the fused candidate pool."""
    now = now or datetime.now(timezone.utc)
    q_set = _unique(query_tokens)
    ranked = []
    for c in candidates:
        tokens = tokenize(c["text"])
        t_set = set(tokens)
        score = c["fused_score"]

        covered = sum(1 for q in q_set if q in t_set)
        coverage = covered / (len(q_set) or 1)
        score += coverage * 0.5

        if c.get("heading"):
            if any(t in q_set for t in set(tokenize(c["heading"]))):
                score += 0.15

        score += TYPE_WEIGHTS.get(c.get("sourceType") or c.get("source_type"), 0.02)

        length = len(c["text"])
        if 200 <= length <= 900:
            score += 0.05
        if length < 80:
            score -= 0.05

        created = c.get("createdAt") or c.get("created_at")
        if created:
            if isinstance(created, str):
                try:
                    created = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
                except ValueError:
                    created = None
            if created is not None:
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                age_days = max(0.0, (now - created).total_seconds() / 86400)
                score += max(0.0, 0.05 - age_days / 100000)

        entry = dict(c)
        entry["rerank_score"] = score
        entry["coverage"] = coverage
        ranked.append(entry)
    ranked.sort(key=lambda x: x["rerank_score"], reverse=True)
    return ranked


def retrieve(question, chunks, top_k: int = 5, pool_size: int = RERANK_TOP, now=None):
    """Retrieve the top-K chunks for a question with score breakdowns.

    chunks: [{id, text, heading, sourceType, sourceTitle, createdAt}]
    Returns ranked chunk dicts; [] when corpus or question is empty.
    """
    if not chunks or not str(question or "").strip():
        return []
    query_tokens = tokenize(question)
    if not query_tokens:
        return []
    expanded = expand_query(query_tokens)

    fitted = get_fitted_engines(chunks)
    bm25_ranked = [
        {"id": doc_id, "s": s} for doc_id, s in fitted["bm25"].score(query_tokens)[:BM25_POOL]
    ]
    cos_ranked = _vector_rank(expanded, fitted["engine"], fitted["doc_sparse"], chunks, VECTOR_POOL)

    fused = rrf([r["id"] for r in bm25_ranked], [r["id"] for r in cos_ranked])
    bm25_by_id = {r["id"]: r["s"] for r in bm25_ranked}
    cos_by_id = {r["id"]: r["s"] for r in cos_ranked}

    by_id = {str(c["id"]): c for c in chunks}
    pool = []
    for f in fused[: max(pool_size, top_k)]:
        chunk = by_id.get(str(f["id"]))
        if chunk is None:
            continue
        entry = dict(chunk)
        entry["fused_score"] = f["fused"]
        entry["bm25_score"] = bm25_by_id.get(f["id"], 0)
        entry["cosine_score"] = cos_by_id.get(f["id"], 0)
        pool.append(entry)

    ranked = rerank(pool, query_tokens, now=now)
    return ranked[:top_k]
