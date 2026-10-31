"""Qdrant vector store for TF-IDF sparse embeddings.

Primary vector-search path for the hybrid retriever. Uses a real Qdrant
server when QDRANT_URL is set (Docker Compose), otherwise qdrant-client's
embedded in-memory mode (zero installs). Every failure degrades gracefully
to the retriever's in-process cosine path by returning None.

The collection is re-synced (drop + bulk upsert) whenever the retrieval
corpus object changes — i.e. once per corpus version, never per query.
"""

import os
import uuid

_COLLECTION = os.environ.get("KARMA_QDRANT_COLLECTION", "karma_chunks")
_VECTOR_NAME = "tfidf"

_store = {
    "client": None,
    "corpus": None,
    "engine": None,
}


def get_vector_store():
    """Return the singleton store handle (client may still be None)."""
    return _VectorStore()


class _VectorStore:
    def _ensure_client(self):
        if _store["client"] is not None:
            return _store["client"]
        from qdrant_client import QdrantClient

        url = os.environ.get("QDRANT_URL")
        if url:
            _store["client"] = QdrantClient(url=url, timeout=5)
        else:
            _store["client"] = QdrantClient(":memory:")
        return _store["client"]

    def _point_id(self, chunk_id: str) -> str:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"karma-chunk:{chunk_id}"))

    def _resync(self, engine, chunks):
        """Drop + rebuild the collection so it mirrors the current corpus."""
        client = self._ensure_client()
        from qdrant_client import models

        try:
            client.delete_collection(_COLLECTION)
        except Exception:
            pass
        client.create_collection(
            collection_name=_COLLECTION,
            vectors_config={},
            sparse_vectors_config={
                _VECTOR_NAME: models.SparseVectorParams(index=models.SparseIndexParams())
            },
        )
        matrix = engine.embed_matrix([c["text"] for c in chunks]).tocsr()
        points = []
        for row, chunk in zip(matrix, chunks):
            coo = row.tocoo()
            indices = [int(c) for c in coo.col]
            values = [float(w) for w in coo.data]
            if not indices:
                continue
            points.append(
                models.PointStruct(
                    id=self._point_id(str(chunk["id"])),
                    vector={_VECTOR_NAME: models.SparseVector(indices=indices, values=values)},
                    payload={"chunk_id": str(chunk["id"])},
                )
            )
        if points:
            client.upsert(collection_name=_COLLECTION, points=points)
        _store["corpus"] = chunks
        _store["engine"] = engine

    def search(self, query_sparse: dict, engine, chunks, limit: int):
        """Return [(chunk_id, score)] ranked by cosine, or None to fall back."""
        if not chunks or not query_sparse:
            return []
        if _store["corpus"] is not chunks or _store["engine"] is not engine:
            self._resync(engine, chunks)

        client = _store["client"]
        try:
            from qdrant_client import models

            result = client.query_points(
                collection_name=_COLLECTION,
                query=models.SparseVector(
                    indices=[int(i) for i in query_sparse.keys()],
                    values=[float(v) for v in query_sparse.values()],
                ),
                using=_VECTOR_NAME,
                limit=limit,
                with_payload=True,
            )
            ranked = []
            for point in result.points:
                chunk_id = (point.payload or {}).get("chunk_id")
                if chunk_id:
                    ranked.append({"id": chunk_id, "s": float(point.score)})
            return ranked
        except Exception:
            return None
