"""Question answering over the personal experience corpus (RAG entry point).

Pipeline: version-cached corpus → hybrid retrieval (BM25 + Qdrant TF-IDF,
RRF fusion, heuristic rerank, optional GPT-4o/Gemini rerank) → cited answer
via LLM synthesis or the local extractive synthesizer.
"""

from ..rag.retriever import retrieve
from ..rag.synthesizer import synthesize
from . import cache as answer_cache
from . import llm_client
from .rag_index import get_corpus

LLM_SYSTEM_PROMPT = (
    "You are KARMA, a career-intelligence assistant that answers ONLY from the "
    "provided context about its owner experience. Never invent facts. If the "
    "context does not contain the answer, say so plainly. Answer in short, "
    "crisp sentences. Cite sources as [n] matching the context block numbers."
)


class AskError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _context_to_prompt(ranked) -> str:
    blocks = []
    for i, r in enumerate(ranked):
        heading = f" > {r['heading']}" if r.get("heading") else ""
        blocks.append(f"Context [{i + 1}] (source: {r.get('sourceTitle')}{heading}):\n{r['text']}")
    return "\n\n".join(blocks)


async def ask(question, top_k: int = 5, use_llm: bool = True) -> dict:
    q = str(question or "").strip()
    if not q:
        raise AskError("Question is required", status=400)

    # Redis/in-memory answer cache, keyed by corpus version + question + topK.
    from .rag_index import corpus_version as version

    cache_key = f"{answer_cache.cache_namespace(version)}:ask:{top_k}:{q.lower()}"
    cached = await answer_cache.cache_get(cache_key)
    if cached is not None:
        return cached

    corpus = await get_corpus()
    if not corpus:
        return {
            "question": q,
            "answer": (
                "The memory index is empty. Ingest documents or wait for the "
                "autopilot to seed, then ask again."
            ),
            "references": [],
            "confidence": 0,
            "metrics": {"mode": "empty-index", "chunksUsed": 0},
            "llmUsed": False,
        }

    ranked = retrieve(q, corpus, top_k=top_k)

    # Optional GPT-4o/Gemini reranking of the retrieved pool (non-fatal).
    reranked_by = "heuristic"
    if use_llm and llm_client.is_configured() and len(ranked) > 1:
        llm_ranked = await llm_client.rerank_with_llm(q, ranked)
        if llm_ranked:
            for entry in llm_ranked:
                entry.pop("rerank_score", None)
            ranked = llm_ranked
            reranked_by = llm_client.active_provider()

    local = synthesize(q, ranked)

    answer, llm_used = local["answer"], False
    if use_llm and llm_client.is_configured():
        try:
            prompt = "\n".join(
                [
                    "Answer the question using ONLY this context from stored experience.",
                    "Cite blocks as [1], [2], ...",
                    "",
                    _context_to_prompt(ranked),
                    "",
                    f"Question: {q}",
                ]
            )
            llm_answer = await llm_client.complete(LLM_SYSTEM_PROMPT, prompt)
            if llm_answer and len(llm_answer.strip()) > 20:
                answer = llm_answer.strip()
                llm_used = True
        except Exception:
            answer = local["answer"]

    result = {
        "question": q,
        "answer": answer,
        "references": local["references"],
        "confidence": local["confidence"],
        "metrics": {
            **local["metrics"],
            "mode": "llm" if llm_used else "local-extractive",
            "corpusSize": len(corpus),
            "rerankedBy": reranked_by,
        },
        "llmUsed": llm_used,
        "chunkIds": [r["id"] for r in ranked],
    }
    # Only cache the deterministic (no-LLM) path; LLM answers are not cached so
    # repeated asks with an uplift configured stay live.
    if not llm_used:
        await answer_cache.cache_set(cache_key, result, ttl_seconds=600)
    return result
