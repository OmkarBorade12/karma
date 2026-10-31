"""Pandas/NumPy retrieval evaluation.

Self-probes the hybrid retriever with questions derived from the corpus and
computes ranking metrics (precision@k, recall@k, MRR, nDCG) with pandas,
returning a JSON-safe aggregate plus per-probe rows.
"""

import numpy as np
import pandas as pd

from ..rag.retriever import retrieve

RELEVANCE_COVERAGE_THRESHOLD = 0.25


def _is_relevant(hit) -> bool:
    return (hit.get("coverage") or 0) >= RELEVANCE_COVERAGE_THRESHOLD


def _ndcg(rankings: list[int], k: int) -> float:
    """nDCG@k with binary gains over the ranked hit positions (1-indexed)."""
    dcg = sum(
        1.0 / np.log2(rank + 1) for rank in rankings if rank <= k
    )
    ideal = sum(1.0 / np.log2(r + 1) for r in range(1, min(k, len(rankings)) + 1))
    return float(dcg / ideal) if ideal > 0 else 0.0


def evaluate_probes(corpus, probes, top_k: int = 3) -> dict:
    """Run each probe question through the retriever and score the results."""
    rows = []
    for question in probes:
        hits = retrieve(question, corpus, top_k=top_k)
        coverage = (
            sum(h.get("coverage") or 0 for h in hits) / len(hits) if hits else 0.0
        )
        relevant_positions = [
            i + 1 for i, h in enumerate(hits) if _is_relevant(h)
        ]
        precision = len(relevant_positions) / (top_k or 1)
        recall = 1.0 if relevant_positions else 0.0
        mrr = 1.0 / relevant_positions[0] if relevant_positions else 0.0
        ndcg = _ndcg(relevant_positions, top_k)
        rows.append(
            {
                "question": question,
                "hits": len(hits),
                "avgCoverage": round(coverage, 4),
                "precisionAtK": round(precision, 4),
                "recallAtK": round(recall, 4),
                "mrr": round(mrr, 4),
                "ndcgAtK": round(ndcg, 4),
                "healthy": bool(hits) and coverage >= RELEVANCE_COVERAGE_THRESHOLD,
            }
        )

    df = pd.DataFrame(rows)
    if df.empty:
        return {
            "probes": [],
            "metrics": {
                "totalProbes": 0,
                "healthyProbes": 0,
                "avgCoverage": 0.0,
                "avgPrecisionAtK": 0.0,
                "avgRecallAtK": 0.0,
                "avgMrr": 0.0,
                "avgNdcgAtK": 0.0,
                "topK": top_k,
            },
        }

    metrics = {
        "totalProbes": int(len(df)),
        "healthyProbes": int(df["healthy"].sum()),
        "avgCoverage": round(float(df["avgCoverage"].mean()), 4),
        "avgPrecisionAtK": round(float(df["precisionAtK"].mean()), 4),
        "avgRecallAtK": round(float(df["recallAtK"].mean()), 4),
        "avgMrr": round(float(df["mrr"].mean()), 4),
        "avgNdcgAtK": round(float(df["ndcgAtK"].mean()), 4),
        "topK": top_k,
    }
    return {"probes": df.to_dict(orient="records"), "metrics": metrics}
