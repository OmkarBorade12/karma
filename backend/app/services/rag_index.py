"""Indexing service: ingest text → chunk → store term-frequency vectors in
MongoDB. IDF weighting happens at query time over the whole corpus, so vector
quality always reflects the current knowledge base.

A corpus-version counter drives two cache levels: the cached corpus list and
(implicitly, via object identity) the fitted retrieval engines + Qdrant sync.
Every index write bumps the version and clears the Redis answer-cache namespace.
"""

from collections import Counter

from ..db import get_db
from ..models import COLLECTIONS, now_utc
from ..rag.chunker import chunk_text
from ..rag.tokenizer import tokenize
from . import cache as answer_cache

corpus_version = 0
_corpus_cache = {"version": None, "corpus": None}


def bump_corpus_version() -> int:
    global corpus_version
    corpus_version += 1
    return corpus_version


def term_counts(tokens) -> dict:
    return dict(Counter(tokens))


def reset_corpus_cache() -> None:
    _corpus_cache["version"] = None
    _corpus_cache["corpus"] = None


async def index_document(document_id, text, source_title, source_type, content_length=None):
    """Chunk + index a plain-text document. Returns the created chunk docs."""
    pieces = chunk_text(text)
    if not pieces:
        return []

    db = get_db()
    docs = []
    for p in pieces:
        tokens = tokenize(f"{p['heading'] + ' ' if p['heading'] else ''}{p['text']}")
        docs.append(
            {
                "document": document_id,
                "indexInDoc": p["index"],
                "heading": p["heading"] or None,
                "text": p["text"],
                "sourceTitle": source_title or "Untitled",
                "sourceType": source_type or "note",
                "terms": term_counts(tokens),
                "tokenCount": len(tokens),
                "createdAt": now_utc(),
                "updatedAt": now_utc(),
            }
        )
    created = await db[COLLECTIONS["chunks"]].insert_many(docs)
    bump_corpus_version()
    await answer_cache.cache_clear_namespace("karma:v")
    return [
        {**doc, "_id": inserted} for doc, inserted in zip(docs, created.inserted_ids)
    ]


async def deindex_document(document_id) -> int:
    db = get_db()
    result = await db[COLLECTIONS["chunks"]].delete_many({"document": document_id})
    bump_corpus_version()
    await answer_cache.cache_clear_namespace("karma:v")
    return result.deleted_count


async def load_corpus() -> list:
    db = get_db()
    cursor = (
        db[COLLECTIONS["chunks"]]
        .find({}, {"text": 1, "heading": 1, "sourceTitle": 1, "sourceType": 1, "createdAt": 1})
        .sort("createdAt", 1)
    )
    corpus = []
    async for d in cursor:
        corpus.append(
            {
                "id": str(d["_id"]),
                "text": d["text"],
                "heading": d.get("heading"),
                "sourceTitle": d.get("sourceTitle"),
                "sourceType": d.get("sourceType"),
                "createdAt": d.get("createdAt"),
            }
        )
    return corpus


async def get_corpus() -> list:
    """Version-aware cached corpus access — repeats are served from memory."""
    if _corpus_cache["corpus"] is not None and _corpus_cache["version"] == corpus_version:
        return _corpus_cache["corpus"]
    corpus = await load_corpus()
    _corpus_cache["version"] = corpus_version
    _corpus_cache["corpus"] = corpus
    return corpus
